/**
 * السجل اليومي «ماذا أنجزت اليوم»: سطر سريع لكل إنجاز أو اجتماع أو تدريب/نشاط خارجي أو مهمة قادمة.
 * لصاحبه، ويظهر للمسؤولين الأعلى منه في الشجرة الإدارية (خطّه المباشر فقط) إن أبقى خيار «مشاركة» (مفعّل افتراضياً).
 * لا موارد بشرية ولا مسؤول نظام ولا مدير مركز يرونه بصفتهم تلك. للمسؤول ملاحظات تعود للموظف فيعدّل أو يردّ ثم يعتمد المسؤول.
 * لا يُسجَّل في سجل التدقيق (ملاحظات عمل شخصية، ولئلا يمتلئ السجل بأسطر يومية).
 */
import { json, localDate, nowOf, addDays } from './util.js';
import { tzOf } from './close.js';
import { isMonth, monthBounds, parseBody } from '../engine/monthly-report.js';
import { validateEntry, LIMITS } from '../engine/work-log.js';

const SUGGEST_MAX = 150;
const COLS = 'id, date, kind, title, status, details, place, importance, end_date AS endDate, shared';
const NOTE_MAX = 500;

// كل من تحت المسؤول في الشجرة (مرؤوسوه المباشرون وغير المباشرين)، بحدّ عمق يمنع الدوران لو تكرّرت علاقة بالخطأ
const SUBTREE = `WITH RECURSIVE sub(id, depth) AS (
  SELECT id, 1 FROM employees WHERE manager_id = ?1 AND status = 'active' AND id <> ?1
  UNION SELECT e.id, s.depth + 1 FROM employees e JOIN sub s ON e.manager_id = s.id WHERE s.depth < 8 AND e.status = 'active' AND e.id <> ?1
) `;

const notesFor = async (db, ids) => {
  const map = new Map();
  if (!ids.length) return map;
  const rows = (await db.prepare(`SELECT n.id, n.log_id AS logId, n.note, n.status, n.reply, n.created_at AS createdAt, n.addressed_at AS addressedAt, a.name AS author
    FROM work_log_notes n JOIN employees a ON a.id = n.author_id WHERE n.log_id IN (SELECT value FROM json_each(?)) ORDER BY n.id`).bind(JSON.stringify(ids)).all()).results;
  for (const r of rows) map.set(r.logId, [...(map.get(r.logId) || []), r]);
  return map;
};

export function registerWorkLogRoutes(add, kit) {
  const { bad, forbidden, notFound, readJson } = kit;
  const unlinked = () => json({ ok: false, error: 'حسابك غير مرتبط ببطاقة موظف، اطلب من مسؤول النظام ربطه' }, 403);

  add('GET', '/api/work-log', async ({ db, user, url }) => {
    if (user.employeeId == null) return unlinked();
    const month = url.searchParams.get('month');
    if (!isMonth(month)) return bad('الشهر غير صالح (YYYY-MM)');
    const { from, to } = monthBounds(month);
    const rows = (await db.prepare(`SELECT ${COLS} FROM work_log WHERE employee_id = ? AND date >= ? AND date <= ? ORDER BY date, id LIMIT ?`)
      .bind(user.employeeId, from, to, LIMITS.perMonth).all()).results;
    const notes = await notesFor(db, rows.map((r) => r.id));
    return json({ ok: true, month, entries: rows.map((r) => ({ ...r, shared: !!r.shared, notes: notes.get(r.id) || [] })) });
  });

  // اقتراحات من إدخالاته السابقة: أسطر سجله في آخر 120 يوماً (الأحدث ثم الأكثر تكراراً)، ثم عناوين مهام واجتماعات تقاريره الثلاثة الأخيرة
  // (تنفع من لم يبدأ السجل بعد). المقارنة بالعنوان بعد توحيد المسافات؛ سجل اليوم يغلب التقرير عند التطابق.
  add('GET', '/api/work-log/suggest', async ({ db, user, env }) => {
    if (user.employeeId == null) return unlinked();
    const since = addDays(localDate(tzOf(env), nowOf(env)), -120);
    const [logs, reports] = await Promise.all([
      db.prepare(`SELECT kind, title, status, place, importance, MAX(date) AS last, COUNT(*) AS n
                    FROM work_log WHERE employee_id = ? AND date >= ? GROUP BY kind, title ORDER BY last DESC, n DESC LIMIT ?`)
        .bind(user.employeeId, since, SUGGEST_MAX).all(),
      db.prepare('SELECT month, body FROM monthly_reports WHERE employee_id = ? ORDER BY month DESC LIMIT 3').bind(user.employeeId).all(),
    ]);
    const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
    const seen = new Set();
    const out = [];
    const push = (s) => {
      const key = `${s.kind}|${norm(s.title)}`;
      if (!norm(s.title) || seen.has(key) || out.length >= SUGGEST_MAX) return;
      seen.add(key);
      out.push({ kind: s.kind, title: norm(s.title), status: s.status || '', place: s.place || '', importance: s.importance || '', last: s.last || null, count: s.n || 1, source: s.source });
    };
    for (const r of logs.results) push({ ...r, source: 'log' });
    for (const r of reports.results) {
      const b = parseBody(r.body);
      const list = (v) => (Array.isArray(v) ? v : []);
      for (const t of list(b.tasks)) push({ kind: 'done', title: t?.title, status: t?.status, source: 'report' });
      for (const m of list(b.meetings)) push({ kind: 'meeting', title: m?.title, place: m?.place, source: 'report' });
      for (const n of list(b.next)) push({ kind: 'todo', title: n?.title, importance: n?.importance, source: 'report' });
    }
    return json({ ok: true, suggestions: out });
  });

  add('POST', '/api/work-log', async ({ request, db, user, env }) => {
    if (user.employeeId == null) return unlinked();
    const { body, error } = await readJson(request);
    if (error) return error;
    const today = localDate(tzOf(env), nowOf(env));
    const v = validateEntry(body, today);
    if (!v.ok) return bad(v.error);
    const e = v.value;
    const shared = body.shared === false || body.shared === 0 ? 0 : 1; // مشاركة افتراضياً
    const { from, to } = monthBounds(e.date.slice(0, 7));
    const n = await db.prepare('SELECT COUNT(*) AS n FROM work_log WHERE employee_id = ? AND date >= ? AND date <= ?').bind(user.employeeId, from, to).first('n');
    if (n >= LIMITS.perMonth) return bad(`بلغ السجل الحد الأقصى لهذا الشهر (${LIMITS.perMonth} سطراً)`);
    const res = await db.prepare(
      'INSERT INTO work_log (employee_id, date, kind, title, status, details, place, importance, end_date, shared) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(user.employeeId, e.date, e.kind, e.title, e.status, e.details, e.place, e.importance, e.endDate, shared).run();
    return json({ ok: true, entry: { id: res.meta.last_row_id, ...e, shared: !!shared, notes: [] } }, 201);
  });

  add('PATCH', '/api/work-log/:id', async ({ request, db, user, env, params }) => {
    if (user.employeeId == null) return unlinked();
    const id = Number(params.id);
    const cur = await db.prepare(`SELECT ${COLS}, employee_id AS owner FROM work_log WHERE id = ?`).bind(id).first();
    if (!cur) return notFound('السطر');
    if (cur.owner !== user.employeeId) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const merged = { ...cur, ...body };
    if (body.endDate === undefined) merged.endDate = cur.endDate;
    const v = validateEntry(merged, localDate(tzOf(env), nowOf(env)));
    if (!v.ok) return bad(v.error);
    const e = v.value;
    if (e.date.slice(0, 7) !== cur.date.slice(0, 7)) {
      const { from, to } = monthBounds(e.date.slice(0, 7));
      const n = await db.prepare('SELECT COUNT(*) AS n FROM work_log WHERE employee_id = ? AND date >= ? AND date <= ?').bind(user.employeeId, from, to).first('n');
      if (n >= LIMITS.perMonth) return bad(`بلغ سجل ذلك الشهر الحد الأقصى (${LIMITS.perMonth} سطراً)`);
    }
    const shared = body.shared === undefined ? (cur.shared ? 1 : 0) : body.shared === false || body.shared === 0 ? 0 : 1;
    const changed = ['date', 'kind', 'title', 'status', 'details', 'place', 'importance'].some((k) => (cur[k] ?? null) !== (e[k] ?? null)) || (cur.endDate ?? null) !== (e.endDate ?? null);
    const stmts = [db.prepare("UPDATE work_log SET date = ?, kind = ?, title = ?, status = ?, details = ?, place = ?, importance = ?, end_date = ?, shared = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(e.date, e.kind, e.title, e.status, e.details, e.place, e.importance, e.endDate, shared, id)];
    // تعديل المحتوى يعني أن الموظف تفاعل مع ملاحظات المسؤول المفتوحة: تصير «تم التعديل» ويراها المسؤول
    if (changed) stmts.push(db.prepare("UPDATE work_log_notes SET status = 'addressed', addressed_at = datetime('now') WHERE log_id = ? AND status = 'open'").bind(id));
    await db.batch(stmts);
    return json({ ok: true, entry: { id, ...e, shared: !!shared } });
  });

  add('DELETE', '/api/work-log/:id', async ({ db, user, params }) => {
    if (user.employeeId == null) return unlinked();
    const id = Number(params.id);
    const cur = await db.prepare('SELECT employee_id AS owner FROM work_log WHERE id = ?').bind(id).first();
    if (!cur) return notFound('السطر');
    if (cur.owner !== user.employeeId) return forbidden();
    await db.batch([db.prepare('DELETE FROM work_log_notes WHERE log_id = ?').bind(id), db.prepare('DELETE FROM work_log WHERE id = ?').bind(id)]);
    return json({ ok: true });
  });

  // ---------------------------------------------------------------- متابعة المسؤول لفريقه (الخط المباشر في الشجرة)
  // الموظف يردّ على ملاحظة دون تعديل المحتوى (أو يؤكّد أنه عدّل)
  add('POST', '/api/work-log/:id/addressed', async ({ request, db, user, params }) => {
    if (user.employeeId == null) return unlinked();
    const id = Number(params.id);
    const cur = await db.prepare('SELECT employee_id AS owner FROM work_log WHERE id = ?').bind(id).first();
    if (!cur) return notFound('السطر');
    if (cur.owner !== user.employeeId) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const reply = String(body.reply ?? '').trim().slice(0, NOTE_MAX) || null;
    await db.prepare("UPDATE work_log_notes SET status = 'addressed', reply = COALESCE(?, reply), addressed_at = datetime('now') WHERE log_id = ? AND status = 'open'").bind(reply, id).run();
    return json({ ok: true });
  });

  // أسطر مرؤوسيه (المشاركة فقط) في شهر، مع الملاحظات؛ بلا مرؤوسين ترجع قائمة أعضاء فارغة
  add('GET', '/api/work-log/team', async ({ db, user, url }) => {
    if (user.employeeId == null) return json({ ok: true, members: [], entries: [] });
    const month = url.searchParams.get('month');
    if (!isMonth(month)) return bad('الشهر غير صالح (YYYY-MM)');
    const { from, to } = monthBounds(month);
    const members = (await db.prepare(`${SUBTREE} SELECT e.id, e.name, e.job_title AS jobTitle, e.department, e.project,
        (SELECT COUNT(*) FROM work_log w WHERE w.employee_id = e.id AND w.shared = 1 AND w.date >= ?2 AND w.date <= ?3) AS entries,
        (SELECT COUNT(*) FROM work_log_notes n JOIN work_log w ON w.id = n.log_id WHERE w.employee_id = e.id AND n.author_id = ?1 AND n.status = 'addressed') AS toReview
      FROM employees e WHERE e.id IN (SELECT id FROM sub) ORDER BY e.name`).bind(user.employeeId, from, to).all()).results;
    if (!members.length) return json({ ok: true, month, members: [], entries: [] });
    const entries = (await db.prepare(`${SUBTREE} SELECT w.id, w.employee_id AS employeeId, w.date, w.kind, w.title, w.status, w.details, w.place, w.importance, w.end_date AS endDate
      FROM work_log w WHERE w.employee_id IN (SELECT id FROM sub) AND w.shared = 1 AND w.date >= ?2 AND w.date <= ?3 ORDER BY w.date DESC, w.id LIMIT 1500`).bind(user.employeeId, from, to).all()).results;
    const notes = await notesFor(db, entries.map((r) => r.id));
    return json({ ok: true, month, members, entries: entries.map((r) => ({ ...r, notes: notes.get(r.id) || [] })) });
  });

  add('POST', '/api/work-log/:id/notes', async ({ request, db, user, params }) => {
    if (user.employeeId == null) return unlinked();
    const id = Number(params.id);
    const row = await db.prepare('SELECT employee_id AS owner, shared FROM work_log WHERE id = ?').bind(id).first();
    if (!row || !row.shared) return notFound('السطر');
    const under = await db.prepare(`${SUBTREE} SELECT 1 AS x FROM sub WHERE id = ?2`).bind(user.employeeId, row.owner).first();
    if (!under) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const note = String(body.note ?? '').trim().slice(0, NOTE_MAX);
    if (!note) return bad('اكتب الملاحظة');
    const r = await db.prepare('INSERT INTO work_log_notes (log_id, author_id, note) VALUES (?, ?, ?)').bind(id, user.employeeId, note).run();
    return json({ ok: true, id: r.meta.last_row_id }, 201);
  });

  // اعتماد المسؤول لتعديل الموظف (أو سحب ملاحظته): كاتب الملاحظة وحده
  add('POST', '/api/work-log-notes/:nid/close', async ({ db, user, params }) => {
    if (user.employeeId == null) return unlinked();
    const n = await db.prepare('SELECT author_id AS author FROM work_log_notes WHERE id = ?').bind(Number(params.nid)).first();
    if (!n) return notFound('الملاحظة');
    if (n.author !== user.employeeId) return forbidden();
    await db.prepare("UPDATE work_log_notes SET status = 'closed', closed_at = datetime('now') WHERE id = ?").bind(Number(params.nid)).run();
    return json({ ok: true });
  });
}
