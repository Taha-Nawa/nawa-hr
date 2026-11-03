/**
 * مزوّدو الخدمة (قرار 3 نوفمبر 2026): معلّمون ومدرّبون بعقود محدودة بلا حساب nawaculture.
 * يسجّلون حضورهم بالبطاقة (QR) على بوابة المركز نفسها، وتُراقَب حركاتهم بجدول عقودهم: تأخر، غياب، خروج، ساعات محتسبة.
 * سجلّهم مستقل عن الموظفين: لا تايم شيت ولا أرصدة ولا طلبات. الحساب في src/engine/providers.js.
 *
 * الصلاحيات: الموارد البشرية والمسؤول يديران (تعديل، بطاقات، تصحيح الحركات)، والمدير العام يطّلع، والمدير المباشر يرى
 * من هو مشرفٌ عليه أو من يتبع مركزه (قراءة فقط). الموظف العادي لا يرى شيئاً.
 */
import { json, clip, isDate, isTime, addDays, localDate, nowOf, randomToken } from './util.js';
import { can } from './authz.js';
import { tzOf } from './close.js';
import {
  PROVIDER_RULES, MOVE_TYPES, validateSchedule, contractState, sessionsOn, presenceOf, dayReport, liveState, monthTotals, nextProviderCode,
} from '../engine/providers.js';
import { toMin, toHHMM } from '../engine/attendance.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthBounds = (m) => {
  const from = `${m}-01`;
  const next = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 10);
  return { from, to: addDays(next, -1) };
};
const datesBetween = (from, to) => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
const dowOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
const nowMinOf = (tz, now) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
};

export const PROVIDER_SELECT = `SELECT p.id, p.code, p.name, p.phone, p.center_id AS centerId, c.name AS center, p.service, p.project,
  p.supervisor_id AS supervisorId, s.name AS supervisor, p.contract_start AS contractStart, p.contract_end AS contractEnd, p.notes, p.active
  FROM providers p LEFT JOIN centers c ON c.id = p.center_id LEFT JOIN employees s ON s.id = p.supervisor_id`;

/** نطاق الرؤية: إدارة/اطلاع للكل، والمدير المباشر لمن يشرف عليهم أو لمن في مركزه، وغير ذلك لا شيء. */
export function providerScope(user, alias = 'p') {
  if (can(user, 'provider.manage') || user.role === 'director') return { sql: '1 = 1', params: [] };
  if (user.role === 'manager' && user.employeeId != null) {
    return { sql: `(${alias}.supervisor_id = ? OR ${alias}.center_id = (SELECT center_id FROM employees WHERE id = ?))`, params: [user.employeeId, user.employeeId] };
  }
  return { sql: '0 = 1', params: [] };
}

export async function loadProviders(db, user, { id = null, activeOnly = false } = {}) {
  const sc = providerScope(user);
  const where = [sc.sql];
  const params = [...sc.params];
  if (id !== null) { where.push('p.id = ?'); params.push(id); }
  if (activeOnly) where.push('p.active = 1');
  return (await db.prepare(`${PROVIDER_SELECT} WHERE ${where.join(' AND ')} ORDER BY p.active DESC, p.contract_end DESC, p.name`).bind(...params).all()).results;
}

async function loadSchedules(db, ids) {
  const map = new Map(ids.map((i) => [i, []]));
  if (!ids.length) return map;
  const rows = (await db.prepare('SELECT provider_id AS pid, weekday, start_time AS start, end_time AS end FROM provider_schedule WHERE provider_id IN (SELECT value FROM json_each(?)) ORDER BY weekday, start_time').bind(JSON.stringify(ids)).all()).results;
  for (const r of rows) map.get(r.pid).push({ weekday: r.weekday, start: r.start, end: r.end });
  return map;
}

/** عطل رسمية وطوارئ فعّالة في مدى تاريخي: يحتاجها حساب الحصص (لا حصة في عطلة، وإخلاء الطارئ يقصّ الحصة). */
async function loadCalendar(db, from, to) {
  const [hol, emg] = await Promise.all([
    db.prepare('SELECT date FROM holidays WHERE date >= ? AND date <= ?').bind(from, to).all(),
    db.prepare("SELECT date, center_id AS centerId, dismiss_time AS dismiss FROM emergencies WHERE date >= ? AND date <= ? AND status = 'active'").bind(from, to).all(),
  ]);
  return { holidays: new Set(hol.results.map((r) => r.date)), emergencies: emg.results };
}

/** طارئ ذلك اليوم لمركز المزوّد: null أو { dismissMin } حيث null = إغلاق اليوم كاملاً (الأبكر يغلب) */
function emergencyFor(emergencies, date, centerId) {
  const hit = emergencies.filter((e) => e.date === date && (e.centerId === null || e.centerId === centerId));
  if (!hit.length) return null;
  if (hit.some((e) => !e.dismiss)) return { dismissMin: null };
  return { dismissMin: Math.min(...hit.map((e) => toMin(e.dismiss))) };
}

const moveOut = (r) => ({ id: r.id, type: r.type, time: r.time, device: r.device_id, manual: r.device_id === 'MANUAL', note: r.note });
const sessOut = (s) => ({ start: toHHMM(s.start), end: toHHMM(s.end), minutes: s.minutes, status: s.status, lateMin: s.lateMin, earlyMin: s.earlyMin, outMin: s.outMin, countedMin: s.countedMin });

function dayFor({ p, schedule, date, moves, cal, today, nowMin }) {
  const sessions = sessionsOn(date, p, schedule, { holiday: cal.holidays.has(date), emergency: emergencyFor(cal.emergencies, date, p.centerId) });
  const presence = presenceOf(moves);
  const live = date === today;
  return { sessions, presence, report: dayReport({ sessions, presence, nowMin: live ? nowMin : null }), live };
}

const groupMoves = (rows) => {
  const by = new Map();
  for (const r of rows) {
    const k = `${r.pid}|${r.date}`;
    (by.get(k) || by.set(k, []).get(k)).push(r);
  }
  return by;
};

const STATE_ORDER = ['noshow', 'waiting', 'present_late', 'out', 'present', 'left', 'break', 'extra', 'upcoming', 'done', 'absent', 'off'];

// ---------------------------------------------------------------- لوحة «من في المركز الآن» (تُستعمل من الواجهة ومن مهمة التنبيه)
export async function boardFor(env, providers, { now = nowOf(env) } = {}) {
  const db = env.DB;
  const tz = tzOf(env);
  const today = localDate(tz, now);
  const nowMin = nowMinOf(tz, now);
  const live = providers.filter((p) => p.active && contractState(p, today).state === 'active');
  if (!live.length) return { date: today, nowMin, counts: {}, items: [] };
  const ids = live.map((p) => p.id);
  const [schedules, cal, moves] = await Promise.all([
    loadSchedules(db, ids),
    loadCalendar(db, today, today),
    db.prepare('SELECT provider_id AS pid, id, type, date, time, device_id, note FROM provider_movements WHERE date = ? AND provider_id IN (SELECT value FROM json_each(?)) ORDER BY time').bind(today, JSON.stringify(ids)).all(),
  ]);
  const by = groupMoves(moves.results);
  const items = [];
  for (const p of live) {
    const mv = by.get(`${p.id}|${today}`) || [];
    const sched = schedules.get(p.id);
    const sessions = sessionsOn(today, p, sched, { holiday: cal.holidays.has(today), emergency: emergencyFor(cal.emergencies, today, p.centerId) });
    if (!sessions.length && !mv.length) continue;
    const ls = liveState({ sessions, presence: presenceOf(mv), nowMin });
    const rep = ls.report;
    items.push({
      id: p.id, code: p.code, name: p.name, center: p.center, centerId: p.centerId, service: p.service, supervisorId: p.supervisorId,
      state: ls.state,
      sessions: rep.sessions.map(sessOut),
      session: ls.session ? { start: toHHMM(ls.session.start), end: toHHMM(ls.session.end) } : null,
      arrive: toHHMM(rep.arrive), depart: toHHMM(rep.depart),
      lateMin: rep.lateMin, countedMin: rep.countedMin, scheduledMin: rep.scheduledMin,
      sinceMin: ls.session && ['waiting', 'noshow'].includes(ls.state) ? nowMin - ls.session.start : null,
      flags: rep.flags,
      moves: mv.map(moveOut),
    });
  }
  items.sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || a.name.localeCompare(b.name, 'ar'));
  const counts = {};
  for (const i of items) counts[i.state] = (counts[i.state] || 0) + 1;
  return { date: today, nowMin, now: toHHMM(nowMin), counts, items };
}

// ---------------------------------------------------------------- بوابة الحضور
/** بطاقات المزوّدين السارية لقائمة بطاقات البوابة: عقدهم ساري اليوم (أو يبدأ غداً) وهم فعّالون. بعد انتهاء العقد تختفي من القائمة تلقائياً. */
export async function gateProviderBadges(db, today) {
  const r = await db
    .prepare(
      `SELECT b.card, p.code, p.name, COALESCE(c.name, '') AS center
         FROM provider_badges b JOIN providers p ON p.id = b.provider_id LEFT JOIN centers c ON c.id = p.center_id
        WHERE b.status = 'active' AND p.active = 1 AND p.contract_start <= ? AND p.contract_end >= ?`,
    )
    .bind(addDays(today, 1), today)
    .all();
  return r.results.map((x) => ({ card: x.card, code: x.code, name: x.name, center: x.center, status: 'سارية', photo: '', kind: 'provider' }));
}

/**
 * يفصل حركات بطاقات المزوّدين عن حركات الموظفين ويحفظها في جدولها (لا تدخل حساب الموظفين ولا «حركات غير مطابقة»).
 * تُحفظ دائماً حتى لو انتهى العقد أو أُلغيت البطاقة (لا تضيع حركة)، والحساب عند القراءة يستبعد ما خارج العقد.
 * يُرجع { rest: حركات الموظفين, saved, skipped }.
 */
export async function ingestProviderMoves(db, deviceId, good) {
  const none = { rest: good, saved: 0, skipped: 0 };
  const cards = [...new Set(good.map((m) => m.card).filter(Boolean))];
  if (!cards.length) return none;
  const found = (await db.prepare('SELECT card, provider_id AS pid FROM provider_badges WHERE card IN (SELECT value FROM json_each(?))').bind(JSON.stringify(cards)).all()).results;
  if (!found.length) return none;
  const byCard = new Map(found.map((r) => [r.card, r.pid]));
  const mine = good.filter((m) => byCard.has(m.card)).map((m) => ({ ...m, pid: byCard.get(m.card) }));
  const rest = good.filter((m) => !byCard.has(m.card));
  const ins = await db
    .prepare(
      `INSERT OR IGNORE INTO provider_movements (id, provider_id, card, type, date, time, iso, device_id, offline, note)
       SELECT json_extract(value,'$.id'), json_extract(value,'$.pid'), json_extract(value,'$.card'), json_extract(value,'$.type'),
              json_extract(value,'$.date'), json_extract(value,'$.time'), json_extract(value,'$.iso'), ?2, json_extract(value,'$.offline'), json_extract(value,'$.note')
         FROM json_each(?1) RETURNING id`,
    )
    .bind(JSON.stringify(mine), deviceId)
    .all();
  return { rest, saved: ins.results.length, skipped: mine.length - ins.results.length };
}

// ---------------------------------------------------------------- المسارات
export function registerProviderRoutes(add, kit) {
  const { bad, forbidden, notFound, readJson, auditStmt } = kit;

  const readProvider = async (db, user, id) => (await loadProviders(db, user, { id }))[0] || null;

  function parseBody(b, { partial = false } = {}) {
    const out = {};
    if (!partial || b.name !== undefined) {
      out.name = clip(b.name, 120);
      if (!out.name) return { error: 'اكتب اسم المزوّد' };
    }
    for (const [k, max] of [['phone', 40], ['service', 80], ['project', 120], ['notes', 500]]) if (!partial || b[k] !== undefined) out[k] = clip(b[k], max);
    if (!partial || b.centerId !== undefined) out.centerId = b.centerId === null || b.centerId === '' || b.centerId === undefined ? null : Number(b.centerId);
    if (!partial || b.supervisorId !== undefined) out.supervisorId = b.supervisorId === null || b.supervisorId === '' || b.supervisorId === undefined ? null : Number(b.supervisorId);
    for (const k of ['centerId', 'supervisorId']) if (out[k] !== undefined && out[k] !== null && !Number.isInteger(out[k])) return { error: 'المركز أو المشرف غير صالح' };
    if (!partial || b.contractStart !== undefined || b.contractEnd !== undefined) {
      if (!isDate(b.contractStart) || !isDate(b.contractEnd)) return { error: 'حدّد تاريخ بداية العقد ونهايته' };
      if (b.contractEnd < b.contractStart) return { error: 'نهاية العقد قبل بدايته' };
      const days = Math.round((Date.parse(`${b.contractEnd}T00:00:00Z`) - Date.parse(`${b.contractStart}T00:00:00Z`)) / 86400000);
      if (days > PROVIDER_RULES.maxContractDays) return { error: 'مدة العقد أطول من سنتين: راجع التواريخ' };
      out.contractStart = b.contractStart;
      out.contractEnd = b.contractEnd;
    }
    if (!partial || b.schedule !== undefined) {
      const s = validateSchedule(b.schedule);
      if (s.error) return { error: s.error };
      out.schedule = s.value;
    }
    return { value: out };
  }

  async function refsOk(db, v) {
    if (v.centerId != null && !(await db.prepare('SELECT 1 FROM centers WHERE id = ?').bind(v.centerId).first())) return 'المركز غير موجود';
    if (v.supervisorId != null && !(await db.prepare("SELECT 1 FROM employees WHERE id = ? AND status = 'active'").bind(v.supervisorId).first())) return 'المشرف غير موجود أو متوقف';
    return null;
  }

  const newCard = () => `PV-${randomToken(10)}`;

  // قائمة المزوّدين مع إجمالي الشهر حتى اليوم
  add('GET', '/api/providers', async ({ env, db, user, url }) => {
    if (!can(user, 'provider.read')) return forbidden();
    const tz = tzOf(env);
    const today = localDate(tz, nowOf(env));
    const month = url.searchParams.get('month') || today.slice(0, 7);
    if (!MONTH_RE.test(month)) return bad('الشهر غير صالح (YYYY-MM)');
    const list = await loadProviders(db, user);
    const { from, to } = monthBounds(month);
    const ids = list.map((p) => p.id);
    let totals = new Map();
    let scheduleMap = new Map();
    if (ids.length) {
      const [schedules, cal, moves] = await Promise.all([
        loadSchedules(db, ids),
        loadCalendar(db, from, to),
        db.prepare('SELECT provider_id AS pid, id, type, date, time, device_id, note FROM provider_movements WHERE date >= ? AND date <= ? AND provider_id IN (SELECT value FROM json_each(?)) ORDER BY time').bind(from, to, JSON.stringify(ids)).all(),
      ]);
      scheduleMap = schedules;
      const by = groupMoves(moves.results);
      const nowMin = nowMinOf(tz, nowOf(env));
      for (const p of list) {
        const lo = p.contractStart > from ? p.contractStart : from;
        const hi = [p.contractEnd, to, today].reduce((a, b) => (a < b ? a : b));
        const sched = schedules.get(p.id);
        const reports = [];
        let planned = 0;
        for (const date of datesBetween(lo, p.contractEnd < to ? p.contractEnd : to)) {
          if (date > hi) {
            planned += sessionsOn(date, p, sched, { holiday: cal.holidays.has(date), emergency: emergencyFor(cal.emergencies, date, p.centerId) }).reduce((a, s) => a + (s.end - s.start), 0);
            continue;
          }
          const d = dayFor({ p, schedule: sched, date, moves: by.get(`${p.id}|${date}`) || [], cal, today, nowMin });
          planned += d.sessions.reduce((a, s) => a + (s.end - s.start), 0);
          reports.push(d.report);
        }
        totals.set(p.id, { ...monthTotals(reports), plannedHours: Math.round((planned / 60) * 100) / 100 });
      }
    }
    return json({
      ok: true, today, month, canManage: can(user, 'provider.manage'),
      providers: list.map((p) => ({ ...p, contract: contractState(p, today), schedule: scheduleMap.get(p.id) || [], totals: totals.get(p.id) || null })),
    });
  });

  add('GET', '/api/providers/board', async ({ env, db, user }) => {
    if (!can(user, 'provider.read')) return forbidden();
    const list = await loadProviders(db, user, { activeOnly: true });
    return json({ ok: true, ...(await boardFor(env, list)) });
  });

  add('GET', '/api/providers/:id', async ({ env, db, user, params }) => {
    if (!can(user, 'provider.read')) return forbidden();
    const id = Number(params.id);
    const p = await readProvider(db, user, id);
    if (!p) return notFound('المزوّد');
    const today = localDate(tzOf(env), nowOf(env));
    const schedule = (await loadSchedules(db, [id])).get(id);
    const manage = can(user, 'provider.manage');
    const card = manage ? await db.prepare("SELECT card, created_at AS createdAt FROM provider_badges WHERE provider_id = ? AND status = 'active' ORDER BY created_at DESC, card LIMIT 1").bind(id).first() : null;
    return json({ ok: true, today, canManage: manage, provider: { ...p, contract: contractState(p, today) }, schedule, ...(manage ? { card } : {}) });
  });

  add('POST', '/api/providers', async ({ request, db, user, env }) => {
    if (!can(user, 'provider.manage')) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const r = parseBody(body);
    if (r.error) return bad(r.error);
    const v = r.value;
    const ref = await refsOk(db, v);
    if (ref) return bad(ref);
    const card = newCard();
    for (let attempt = 0; attempt < 2; attempt++) {
      const code = nextProviderCode((await db.prepare('SELECT code FROM providers').all()).results.map((x) => x.code));
      try {
        await db.batch([
          db.prepare('INSERT INTO providers (code, name, phone, center_id, service, project, supervisor_id, contract_start, contract_end, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(code, v.name, v.phone, v.centerId, v.service, v.project, v.supervisorId, v.contractStart, v.contractEnd, v.notes),
          db.prepare("INSERT INTO provider_schedule (provider_id, weekday, start_time, end_time) SELECT p.id, json_extract(j.value, '$.weekday'), json_extract(j.value, '$.start'), json_extract(j.value, '$.end') FROM providers p, json_each(?) j WHERE p.code = ?")
            .bind(JSON.stringify(v.schedule), code),
          db.prepare('INSERT INTO provider_badges (card, provider_id) SELECT ?, id FROM providers WHERE code = ?').bind(card, code),
          auditStmt(db, user, 'provider.create', 'provider', code, { name: v.name, centerId: v.centerId, contractStart: v.contractStart, contractEnd: v.contractEnd }),
        ]);
        const row = await db.prepare('SELECT id FROM providers WHERE code = ?').bind(code).first();
        return json({ ok: true, id: row.id, code, card }, 201);
      } catch (e) {
        if (attempt === 0 && /UNIQUE/i.test(String(e?.message || e))) continue;
        throw e;
      }
    }
    return bad('تعذّر إنشاء رمز المزوّد، أعد المحاولة', 409);
  });

  add('PATCH', '/api/providers/:id', async ({ request, db, user, params }) => {
    if (!can(user, 'provider.manage')) return forbidden();
    const id = Number(params.id);
    const cur = await readProvider(db, user, id);
    if (!cur) return notFound('المزوّد');
    const { body, error } = await readJson(request);
    if (error) return error;
    const merged = { ...body };
    // العقد يُحدَّث كزوج: ما لم يُرسَل منه يؤخذ من الحالي
    if (body.contractStart !== undefined || body.contractEnd !== undefined) {
      merged.contractStart = body.contractStart ?? cur.contractStart;
      merged.contractEnd = body.contractEnd ?? cur.contractEnd;
    }
    const r = parseBody(merged, { partial: true });
    if (r.error) return bad(r.error);
    const v = r.value;
    const ref = await refsOk(db, v);
    if (ref) return bad(ref);
    const pick = (k, curVal) => (v[k] === undefined ? curVal : v[k]);
    const active = body.active === undefined ? cur.active : body.active ? 1 : 0;
    const stmts = [
      db.prepare('UPDATE providers SET name = ?, phone = ?, center_id = ?, service = ?, project = ?, supervisor_id = ?, contract_start = ?, contract_end = ?, notes = ?, active = ? WHERE id = ?').bind(
        pick('name', cur.name), pick('phone', cur.phone), pick('centerId', cur.centerId), pick('service', cur.service), pick('project', cur.project),
        pick('supervisorId', cur.supervisorId), pick('contractStart', cur.contractStart), pick('contractEnd', cur.contractEnd), pick('notes', cur.notes), active, id),
    ];
    if (v.schedule) {
      stmts.push(db.prepare('DELETE FROM provider_schedule WHERE provider_id = ?').bind(id));
      stmts.push(db.prepare("INSERT INTO provider_schedule (provider_id, weekday, start_time, end_time) SELECT ?1, json_extract(j.value, '$.weekday'), json_extract(j.value, '$.start'), json_extract(j.value, '$.end') FROM json_each(?2) j").bind(id, JSON.stringify(v.schedule)));
    }
    stmts.push(auditStmt(db, user, 'provider.update', 'provider', cur.code, { fields: Object.keys(body).filter((k) => k !== 'schedule'), schedule: !!v.schedule, active: body.active }));
    await db.batch(stmts);
    return json({ ok: true });
  });

  // إعادة إصدار البطاقة (ضاعت أو تلفت): تُلغى الفعّالة وتصدر جديدة
  add('POST', '/api/providers/:id/card', async ({ db, user, params }) => {
    if (!can(user, 'provider.manage')) return forbidden();
    const id = Number(params.id);
    const p = await readProvider(db, user, id);
    if (!p) return notFound('المزوّد');
    const card = newCard();
    await db.batch([
      db.prepare("UPDATE provider_badges SET status = 'revoked' WHERE provider_id = ? AND status = 'active'").bind(id),
      db.prepare('INSERT INTO provider_badges (card, provider_id) VALUES (?, ?)').bind(card, id),
      auditStmt(db, user, 'provider.card', 'provider', p.code, { reissued: true }),
    ]);
    return json({ ok: true, card }, 201);
  });

  // كشف شهر مزوّد: كل يوم فيه حصة أو حركة
  add('GET', '/api/providers/:id/month', async ({ env, db, user, params, url }) => {
    if (!can(user, 'provider.read')) return forbidden();
    const id = Number(params.id);
    const month = url.searchParams.get('month');
    if (!MONTH_RE.test(month || '')) return bad('الشهر غير صالح (YYYY-MM)');
    const p = await readProvider(db, user, id);
    if (!p) return notFound('المزوّد');
    const tz = tzOf(env);
    const now = nowOf(env);
    const today = localDate(tz, now);
    const nowMin = nowMinOf(tz, now);
    const { from, to } = monthBounds(month);
    const [schedules, cal, moves] = await Promise.all([
      loadSchedules(db, [id]),
      loadCalendar(db, from, to),
      db.prepare('SELECT provider_id AS pid, id, type, date, time, device_id, note FROM provider_movements WHERE provider_id = ? AND date >= ? AND date <= ? ORDER BY time').bind(id, from, to).all(),
    ]);
    const sched = schedules.get(id);
    const by = groupMoves(moves.results);
    const days = [];
    const reports = [];
    let planned = 0;
    for (const date of datesBetween(from, to)) {
      const mv = by.get(`${id}|${date}`) || [];
      const d = dayFor({ p, schedule: sched, date, moves: mv, cal, today, nowMin });
      planned += d.sessions.reduce((a, s) => a + (s.end - s.start), 0);
      if (!d.sessions.length && !mv.length) continue;
      const future = date > today;
      if (!future) reports.push(d.report);
      const rep = d.report;
      days.push({
        date, dow: dowOf(date), future,
        sessions: future ? d.sessions.map((s) => ({ start: toHHMM(s.start), end: toHHMM(s.end), minutes: s.end - s.start })) : rep.sessions.map(sessOut),
        status: future ? 'future' : rep.status,
        arrive: toHHMM(rep.arrive), depart: toHHMM(rep.depart),
        exits: rep.exits.map((x) => ({ out: toHHMM(x.out), back: toHHMM(x.back) })),
        scheduledMin: rep.scheduledMin, countedMin: rep.countedMin, actualMin: rep.actualMin, lateMin: rep.lateMin, earlyMin: rep.earlyMin,
        flags: rep.flags, outsideContract: (date < p.contractStart || date > p.contractEnd) && mv.length > 0,
        moves: mv.map(moveOut),
      });
    }
    return json({
      ok: true, today, month, from, to, canManage: can(user, 'provider.manage'), rules: { lateGraceMin: PROVIDER_RULES.lateGraceMin, earlyGraceMin: PROVIDER_RULES.earlyGraceMin },
      provider: { ...p, contract: contractState(p, today) }, schedule: sched, days,
      totals: { ...monthTotals(reports), plannedHours: Math.round((planned / 60) * 100) / 100 },
    });
  });

  // إضافة حركات يدوية ليوم (نسيان المسح أو عطل البوابة). السبب إلزامي ويُسجَّل في التدقيق.
  add('POST', '/api/providers/:id/moves', async ({ request, env, db, user, params }) => {
    if (!can(user, 'provider.manage')) return forbidden();
    const id = Number(params.id);
    const p = await readProvider(db, user, id);
    if (!p) return notFound('المزوّد');
    const { body, error } = await readJson(request);
    if (error) return error;
    if (!isDate(body.date)) return bad('التاريخ غير صالح');
    if (body.date > localDate(tzOf(env), nowOf(env))) return bad('لا يُسجَّل حضور بتاريخ مستقبلي');
    const note = clip(body.note, 200);
    if (!note) return bad('اكتب سبب التسجيل اليدوي');
    const moves = Array.isArray(body.moves) ? body.moves : [{ type: body.type, time: body.time }];
    if (!moves.length || moves.length > 8) return bad('حركات اليوم غير صالحة');
    const rows = [];
    for (const m of moves) {
      if (!MOVE_TYPES.includes(m?.type)) return bad('نوع الحركة غير معروف');
      if (!isTime(m?.time)) return bad('وقت الحركة غير صالح');
      rows.push({ id: `MAN-${randomToken(8)}`, type: m.type, time: m.time });
    }
    await db.batch([
      db.prepare(
        `INSERT INTO provider_movements (id, provider_id, type, date, time, device_id, note)
         SELECT json_extract(value,'$.id'), ?1, json_extract(value,'$.type'), ?2, json_extract(value,'$.time'), 'MANUAL', ?3 FROM json_each(?4)`,
      ).bind(id, body.date, note, JSON.stringify(rows)),
      auditStmt(db, user, 'provider.move.add', 'provider', p.code, { date: body.date, moves: rows.map((r) => `${r.type} ${r.time}`), note }),
    ]);
    return json({ ok: true, added: rows.length }, 201);
  });

  add('DELETE', '/api/providers/:id/moves/:moveId', async ({ db, user, params }) => {
    if (!can(user, 'provider.manage')) return forbidden();
    const id = Number(params.id);
    const p = await readProvider(db, user, id);
    if (!p) return notFound('المزوّد');
    const moveId = decodeURIComponent(params.moveId);
    const m = await db.prepare('SELECT id, type, date, time, device_id FROM provider_movements WHERE id = ? AND provider_id = ?').bind(moveId, id).first();
    if (!m) return notFound('الحركة');
    await db.batch([
      db.prepare('DELETE FROM provider_movements WHERE id = ? AND provider_id = ?').bind(moveId, id),
      auditStmt(db, user, 'provider.move.delete', 'provider', p.code, { id: m.id, type: m.type, date: m.date, time: m.time, device: m.device_id }),
    ]);
    return json({ ok: true });
  });
}
