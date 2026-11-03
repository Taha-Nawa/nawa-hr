import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { gatePost, gateGet, mv, DEVICE_TOKEN, addHolidays } from './helpers/seed.js';

const MON = '2026-11-02';
const SCHED = [{ weekday: 1, start: '09:00', end: '13:00' }, { weekday: 3, start: '09:00', end: '13:00' }]; // الإثنين والأربعاء

async function world(now = `${MON}T09:20:00Z`) {
  const { db, env } = await apiEnv();
  env.TIMEZONE = 'UTC';
  env.__NOW = now;
  await seedOrg(db);
  await db.prepare('UPDATE employees SET center_id = 1 WHERE id IN (1, 2, 3)').run();
  await db.prepare('UPDATE employees SET center_id = 2 WHERE id = 4').run();
  const u = {
    hr: await login(db, 'hr@nawaculture.org', 'hr', null),
    admin: await login(db, 'adm@nawaculture.org', 'admin', null),
    dir: await login(db, 'd@nawaculture.org', 'director', null),
    emp: await login(db, 'e@nawaculture.org', 'employee', 2),
    mgrC1: await login(db, 'm1@nawaculture.org', 'manager', 1), // مركز 1
    mgrC2: await login(db, 'm4@nawaculture.org', 'manager', 4), // مركز 2
    sup: await login(db, 'sup@nawaculture.org', 'manager', 3), // مشرف مباشر على مزوّد في مركز 2 (يتبع مركز 1)
  };
  return { db, env, u };
}
const j = (env, who, method, path, body) => call(env, method, path, { cookie: who.cookie, body });
const prov = (over = {}) => ({ name: 'أ. سلمى', phone: '0599', centerId: 1, service: 'تدريس', project: 'القراءة', supervisorId: 2, contractStart: '2026-10-15', contractEnd: '2026-12-15', schedule: SCHED, ...over });

async function makeProvider(env, hr, over) {
  const r = await j(env, hr, 'POST', '/api/providers', prov(over));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body; // { id, code, card }
}
const scan = (card, code, type, date, time, id) => ({ id: id || `MV-${date}${time}-${code}-${type}`, card, code, name: 'x', center: 'المبنى الرئيسي', type, date, time, iso: `${date}T${time}:00`, device: 'DEV-01', offline: false, note: '' });

test('إنشاء مزوّد: رمز تلقائي وبطاقة سرّية، والتحقق من المدخلات', async () => {
  const { env, u } = await world();
  const a = await makeProvider(env, u.hr);
  assert.equal(a.code, 'SP-001');
  assert.match(a.card, /^PV-[0-9a-f]{20}$/);
  const b = await makeProvider(env, u.admin, { name: 'أ. رنا', centerId: 2 });
  assert.equal(b.code, 'SP-002');
  assert.notEqual(a.card, b.card);

  const bad = async (over, re) => {
    const r = await j(env, u.hr, 'POST', '/api/providers', prov(over));
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.match(r.body.error, re);
  };
  await bad({ name: '  ' }, /اسم المزوّد/);
  await bad({ contractStart: 'x' }, /بداية العقد/);
  await bad({ contractEnd: '2026-10-01' }, /قبل بدايته/);
  await bad({ contractEnd: '2029-01-01' }, /أطول من سنتين/);
  await bad({ schedule: [] }, /حصة واحدة/);
  await bad({ schedule: [{ weekday: 1, start: '09:00', end: '11:00' }, { weekday: 1, start: '10:00', end: '12:00' }] }, /متداخلتان/);
  await bad({ centerId: 99 }, /المركز غير موجود/);
  await bad({ supervisorId: 99 }, /المشرف/);
  for (const who of [u.dir, u.emp, u.mgrC1]) assert.equal((await j(env, who, 'POST', '/api/providers', prov())).status, 403);
  assert.equal(await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'provider.create'").first('n'), 2);
});

test('تفاصيل المزوّد: البطاقة لمن يديرهم فقط', async () => {
  const { env, u } = await world();
  const a = await makeProvider(env, u.hr);
  const hr = await j(env, u.hr, 'GET', `/api/providers/${a.id}`);
  assert.equal(hr.body.card.card, a.card);
  assert.equal(hr.body.provider.contract.state, 'active');
  assert.equal(hr.body.schedule.length, 2);
  const mgr = await j(env, u.mgrC1, 'GET', `/api/providers/${a.id}`);
  assert.equal(mgr.status, 200);
  assert.equal(mgr.body.card, undefined);
  assert.equal(mgr.body.canManage, false);
  assert.equal((await j(env, u.dir, 'GET', `/api/providers/${a.id}`)).body.card, undefined);
});

test('الرؤية: المدير المباشر يرى من يشرف عليه أو من في مركزه فقط', async () => {
  const { env, u } = await world();
  const a = await makeProvider(env, u.hr); // مركز 1، المشرف موظف 2
  const b = await makeProvider(env, u.hr, { name: 'ب', centerId: 2, supervisorId: 3 }); // مركز 2، المشرف موظف 3
  const names = async (who) => (await j(env, who, 'GET', '/api/providers')).body.providers.map((p) => p.code).sort();
  assert.deepEqual(await names(u.hr), ['SP-001', 'SP-002']);
  assert.deepEqual(await names(u.dir), ['SP-001', 'SP-002']);
  assert.deepEqual(await names(u.mgrC1), ['SP-001']); // موظف 1 في مركز 1
  assert.deepEqual(await names(u.mgrC2), ['SP-002']); // موظف 4 في مركز 2
  assert.deepEqual(await names(u.sup), ['SP-001', 'SP-002']); // موظف 3: مركز 1 (يرى أ) ومشرف على ب
  assert.equal((await j(env, u.mgrC2, 'GET', `/api/providers/${a.id}`)).status, 404);
  assert.equal((await j(env, u.mgrC1, 'GET', `/api/providers/${b.id}`)).status, 404);
  assert.equal((await j(env, u.emp, 'GET', '/api/providers')).status, 403);
  assert.equal((await j(env, u.mgrC1, 'GET', `/api/providers/${a.id}/month?month=2026-10`)).status, 200);
});

test('البوابة: بطاقة المزوّد تظهر في القائمة وحركاتها تُحفظ في جدولها ولا تلوّث حركات الموظفين', async () => {
  const { env, db, u } = await world();
  const a = await makeProvider(env, u.hr);
  const list = await gateGet(env, `action=badges&token=${DEVICE_TOKEN}`);
  const mine = list.body.badges.find((x) => x.card === a.card);
  assert.deepEqual({ code: mine.code, name: mine.name, center: mine.center, status: mine.status, kind: mine.kind }, { code: 'SP-001', name: 'أ. سلمى', center: 'المبنى الرئيسي', status: 'سارية', kind: 'provider' });

  await db.prepare("INSERT INTO employees (id, code, name, center_id) VALUES (50, 'NW-050', 'موظف', 1)").run();
  await db.prepare("INSERT INTO badges (card, employee_id) VALUES ('NW-050-A', 50)").run();
  const batch = [scan(a.card, 'SP-001', 'حضور', MON, '09:02'), mv('NW-050', 'حضور', MON, '08:30')];
  const r = await gatePost(env, batch);
  assert.equal(r.body.saved, 2);
  assert.equal(r.body.unmatched, undefined);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM provider_movements').first('n'), 1);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM movements').first('n'), 1);
  assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM movements WHERE employee_id IS NULL").first('n'), 0);
  const again = await gatePost(env, batch);
  assert.deepEqual([again.body.saved, again.body.skipped], [0, 2]);
  assert.ok(r.queries <= 20, `استعلامات: ${r.queries}`);
  // بطاقة غريبة تبقى «غير مطابقة» كما كانت
  const odd = await gatePost(env, [scan('UNKNOWN-CARD', 'ZZ', 'حضور', MON, '09:00')]);
  assert.equal(odd.body.unmatched, 1);
});

test('انتهاء العقد أو إيقاف المزوّد: تختفي بطاقته من البوابة تلقائياً وتبقى حركاته محفوظة', async () => {
  const { env, db, u } = await world();
  const a = await makeProvider(env, u.hr, { contractEnd: '2026-11-04' });
  const has = async () => (await gateGet(env, `action=badges&token=${DEVICE_TOKEN}`)).body.badges.some((x) => x.card === a.card);
  assert.equal(await has(), true);
  env.__NOW = '2026-11-04T10:00:00Z';
  assert.equal(await has(), true, 'آخر يوم في العقد');
  env.__NOW = '2026-11-05T06:00:00Z';
  assert.equal(await has(), false, 'اليوم التالي للنهاية');
  assert.equal((await gatePost(env, [scan(a.card, 'SP-001', 'حضور', '2026-11-05', '09:00')])).body.saved, 1, 'مسح قديم متأخر الوصول يُحفظ');
  const list = await j(env, u.hr, 'GET', '/api/providers?month=2026-11');
  assert.equal(list.body.providers[0].contract.state, 'ended');
  const month = await j(env, u.hr, 'GET', `/api/providers/${a.id}/month?month=2026-11`);
  const d = month.body.days.find((x) => x.date === '2026-11-05');
  assert.equal(d.outsideContract, true);
  assert.equal(d.sessions.length, 0);
  assert.equal(d.status, 'extra');

  env.__NOW = `${MON}T10:00:00Z`;
  assert.equal(await has(), true);
  assert.equal((await j(env, u.hr, 'PATCH', `/api/providers/${a.id}`, { active: false })).status, 200);
  assert.equal(await has(), false, 'الإيقاف يخفي البطاقة');
  assert.equal((await j(env, u.hr, 'PATCH', `/api/providers/${a.id}`, { active: true })).status, 200);
  assert.equal(await has(), true);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM provider_movements').first('n'), 1);
});

test('لوحة «من في المركز الآن» عبر اليوم', async () => {
  const { env, u } = await world(`${MON}T08:00:00Z`);
  const a = await makeProvider(env, u.hr);
  const b = await makeProvider(env, u.hr, { name: 'ب', centerId: 2, schedule: [{ weekday: 1, start: '10:00', end: '12:00' }] });
  const board = async (at) => { env.__NOW = `${MON}T${at}:00Z`; return (await j(env, u.hr, 'GET', '/api/providers/board')).body; };
  const state = (bd, id) => bd.items.find((x) => x.id === id)?.state;

  let bd = await board('08:00');
  assert.equal(state(bd, a.id), 'upcoming');
  bd = await board('09:10');
  assert.equal(state(bd, a.id), 'waiting');
  bd = await board('09:20');
  assert.equal(state(bd, a.id), 'noshow');
  assert.equal(bd.items[0].id, a.id, 'غير الحاضر أولاً');
  assert.equal(bd.items[0].sinceMin, 20);
  assert.equal(bd.counts.noshow, 1);

  await gatePost(env, [scan(a.card, 'SP-001', 'حضور', MON, '09:25')]);
  bd = await board('09:30');
  assert.equal(state(bd, a.id), 'present_late');
  assert.equal(bd.items.find((x) => x.id === a.id).arrive, '09:25');
  await gatePost(env, [scan(a.card, 'SP-001', 'خروج', MON, '10:30')]);
  bd = await board('10:40');
  assert.equal(state(bd, a.id), 'out');
  await gatePost(env, [scan(a.card, 'SP-001', 'عودة', MON, '10:45'), scan(a.card, 'SP-001', 'انصراف', MON, '13:00')]);
  bd = await board('13:30');
  assert.equal(state(bd, a.id), 'done');
  assert.equal(state(bd, b.id), 'absent');
  assert.equal(bd.items.find((x) => x.id === a.id).countedMin, 4 * 60 - 25 - 15);

  // طارئ بإخلاء في المركز 1 الساعة 11:00: يُقصّ الجدول، والمركز 2 لا يتأثر
  await env.DB.prepare("INSERT INTO emergencies (date, center_id, dismiss_time, created_by) VALUES (?, 1, '11:00', 'x')").bind(MON).run();
  bd = await board('09:20');
  assert.equal(bd.items.find((x) => x.id === a.id).sessions[0].end, '11:00');
  await env.DB.prepare("UPDATE emergencies SET dismiss_time = NULL, leave_type = 'طارئة'").run();
  bd = await board('09:20');
  assert.equal(state(bd, a.id), 'off', 'إغلاق اليوم كاملاً: لا حصة ولا تنبيه');
  assert.equal(state(bd, b.id), 'upcoming', 'مركز آخر لا يتأثر');
  await addHolidays(env.DB, [MON]);
  bd = await board('10:20');
  assert.deepEqual([...new Set(bd.items.map((x) => x.state))], ['off'], 'عطلة رسمية: لا حصص');
});

test('كشف الشهر: ساعات محتسبة، تأخر، غياب، انصراف غير مسجّل', async () => {
  const { env, u } = await world();
  const a = await makeProvider(env, u.hr);
  await gatePost(env, [
    scan(a.card, 'SP-001', 'حضور', '2026-10-19', '09:30'), scan(a.card, 'SP-001', 'انصراف', '2026-10-19', '13:00'),
    scan(a.card, 'SP-001', 'حضور', '2026-10-26', '08:55'), scan(a.card, 'SP-001', 'انصراف', '2026-10-26', '13:10'),
    scan(a.card, 'SP-001', 'حضور', '2026-10-28', '09:00'),
  ]);
  const r = await j(env, u.hr, 'GET', `/api/providers/${a.id}/month?month=2026-10`);
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.days.map((d) => [d.date, d]));
  assert.deepEqual(Object.keys(by), ['2026-10-19', '2026-10-21', '2026-10-26', '2026-10-28']); // قبل 15/10 لا عقد
  assert.equal(by['2026-10-19'].status, 'late');
  assert.equal(by['2026-10-19'].lateMin, 30);
  assert.equal(by['2026-10-19'].countedMin, 210);
  assert.equal(by['2026-10-21'].status, 'absent');
  assert.equal(by['2026-10-26'].status, 'ok');
  assert.equal(by['2026-10-26'].countedMin, 240);
  assert.equal(by['2026-10-28'].status, 'unclosed');
  assert.equal(by['2026-10-28'].countedMin, 0);
  assert.deepEqual(by['2026-10-28'].flags, ['no_depart']);
  const t = r.body.totals;
  assert.deepEqual([t.scheduledHours, t.countedHours, t.absentDays, t.lateDays, t.unclosedDays, t.attendedDays], [16, 7.5, 1, 1, 1, 2]);

  // الشهر الجاري: أيام لم تأتِ تظهر «قادمة» ولا تُحتسب في الإجمالي
  const nov = await j(env, u.hr, 'GET', `/api/providers/${a.id}/month?month=2026-11`);
  const fut = nov.body.days.find((d) => d.date === '2026-11-04');
  assert.equal(fut.future, true);
  assert.equal(fut.status, 'future');
  assert.equal(nov.body.totals.sessionDays, 1, 'اليوم فقط حتى الآن');
  assert.equal(nov.body.totals.plannedHours, 4 * 9); // الإثنين والأربعاء في نوفمبر 2026: 2،4،9،11،16،18،23،25،30 = 9 حصص
  assert.equal((await j(env, u.hr, 'GET', `/api/providers/${a.id}/month?month=bad`)).status, 400);
});

test('الإدخال اليدوي: سبب إلزامي، لا تاريخ مستقبلي، يصلح يوم الغياب، والحذف يُدقَّق', async () => {
  const { env, u } = await world();
  const a = await makeProvider(env, u.hr);
  const url = `/api/providers/${a.id}/moves`;
  const day = { date: '2026-10-21', moves: [{ type: 'حضور', time: '09:00' }, { type: 'انصراف', time: '13:00' }] };
  assert.match((await j(env, u.hr, 'POST', url, day)).body.error, /سبب/);
  assert.match((await j(env, u.hr, 'POST', url, { ...day, note: 'x', date: '2026-11-03' })).body.error, /مستقبلي/);
  assert.match((await j(env, u.hr, 'POST', url, { ...day, note: 'x', moves: [{ type: 'مرحبا', time: '09:00' }] })).body.error, /نوع الحركة/);
  assert.match((await j(env, u.hr, 'POST', url, { ...day, note: 'x', moves: [{ type: 'حضور', time: '9:00' }] })).body.error, /وقت/);
  for (const who of [u.dir, u.mgrC1, u.emp]) assert.ok([403].includes((await j(env, who, 'POST', url, { ...day, note: 'x' })).status));
  const ok = await j(env, u.hr, 'POST', url, { ...day, note: 'نسي المسح' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.added, 2);

  const m = (await j(env, u.hr, 'GET', `/api/providers/${a.id}/month?month=2026-10`)).body;
  const d = m.days.find((x) => x.date === '2026-10-21');
  assert.equal(d.status, 'ok');
  assert.equal(d.countedMin, 240);
  assert.equal(d.moves.every((x) => x.manual && x.note === 'نسي المسح'), true);

  const del = await j(env, u.hr, 'DELETE', `${url}/${encodeURIComponent(d.moves[1].id)}`);
  assert.equal(del.status, 200);
  const after = (await j(env, u.hr, 'GET', `/api/providers/${a.id}/month?month=2026-10`)).body.days.find((x) => x.date === '2026-10-21');
  assert.equal(after.status, 'unclosed');
  assert.equal((await j(env, u.hr, 'DELETE', `${url}/nope`)).status, 404);
  assert.equal((await j(env, u.dir, 'DELETE', `${url}/${encodeURIComponent(d.moves[0].id)}`)).status, 403);
  const audit = (await env.DB.prepare("SELECT action FROM audit_log WHERE action LIKE 'provider.move.%' ORDER BY id").all()).results.map((r) => r.action);
  assert.deepEqual(audit, ['provider.move.add', 'provider.move.delete']);
});

test('تعديل المزوّد: الجدول والعقد والبطاقة الجديدة تلغي القديمة', async () => {
  const { env, db, u } = await world();
  const a = await makeProvider(env, u.hr);
  const p = await j(env, u.hr, 'PATCH', `/api/providers/${a.id}`, { schedule: [{ weekday: 2, start: '14:00', end: '16:00' }], contractEnd: '2026-12-20', phone: '0598' });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const d = (await j(env, u.hr, 'GET', `/api/providers/${a.id}`)).body;
  assert.deepEqual(d.schedule, [{ weekday: 2, start: '14:00', end: '16:00' }]);
  assert.equal(d.provider.contractEnd, '2026-12-20');
  assert.equal(d.provider.contractStart, '2026-10-15');
  assert.equal(d.provider.phone, '0598');
  assert.match((await j(env, u.hr, 'PATCH', `/api/providers/${a.id}`, { contractEnd: '2026-10-01' })).body.error, /قبل بدايته/);
  assert.match((await j(env, u.hr, 'PATCH', `/api/providers/${a.id}`, { schedule: [] })).body.error, /حصة واحدة/);
  assert.equal((await j(env, u.hr, 'PATCH', '/api/providers/999', { phone: 'x' })).status, 404);
  assert.equal((await j(env, u.dir, 'PATCH', `/api/providers/${a.id}`, { phone: 'x' })).status, 403);

  const re = await j(env, u.hr, 'POST', `/api/providers/${a.id}/card`);
  assert.equal(re.status, 201);
  assert.notEqual(re.body.card, a.card);
  const st = (await db.prepare('SELECT card, status FROM provider_badges ORDER BY created_at, rowid').all()).results;
  assert.deepEqual(st.map((x) => x.status), ['revoked', 'active']);
  const gate = (await gateGet(env, `action=badges&token=${DEVICE_TOKEN}`)).body.badges.filter((x) => x.kind === 'provider');
  assert.deepEqual(gate.map((x) => x.card), [re.body.card]);
  assert.equal((await j(env, u.hr, 'GET', `/api/providers/${a.id}`)).body.card.card, re.body.card);
  assert.equal((await j(env, u.dir, 'POST', `/api/providers/${a.id}/card`)).status, 403);
});

test('القائمة: إجمالي الشهر لكل مزوّد', async () => {
  const { env, u } = await world();
  const a = await makeProvider(env, u.hr);
  await gatePost(env, [scan(a.card, 'SP-001', 'حضور', '2026-10-26', '09:00'), scan(a.card, 'SP-001', 'انصراف', '2026-10-26', '13:00')]);
  const r = await j(env, u.hr, 'GET', '/api/providers?month=2026-10');
  const p = r.body.providers[0];
  assert.equal(p.totals.countedHours, 4);
  assert.equal(p.totals.scheduledHours, 16);
  assert.equal(p.totals.absentDays, 3);
  assert.equal(p.schedule.length, 2);
  assert.equal(r.body.canManage, true);
  assert.equal((await j(env, u.dir, 'GET', '/api/providers?month=2026-10')).body.canManage, false);
  assert.equal((await j(env, u.hr, 'GET', '/api/providers?month=2026-13')).status, 400);
});

test('النسخة الاحتياطية تتضمن جداول المزوّدين وتستبعد سجل التنبيهات', async () => {
  const { BACKUP_TABLES, BACKUP_EXCLUDED } = await import('../src/worker/backup.js');
  for (const t of ['providers', 'provider_schedule', 'provider_badges', 'provider_movements']) assert.ok(BACKUP_TABLES.includes(t), t);
  assert.ok(BACKUP_EXCLUDED.includes('provider_alerts'));
});
