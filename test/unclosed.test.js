import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { setWork, addEmployee, gatePost, gateGet, mv, DEVICE_TOKEN } from './helpers/seed.js';
import { EMP_SQL, PROV_SQL, clampDays } from '../src/worker/unclosed.js';

// «اليوم»: الإثنين 2026-11-02. الأحد 2026-11-01 والخميس 2026-10-29 يوما دوام؛ الجمعة والسبت عطلة.
const TODAY = '2026-11-02';
const SUN = '2026-11-01';
const THU = '2026-10-29';
const SETTINGS = {
  start: '08:30', end: '15:00', toleranceMinutes: 10,
  weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'],
  leaveTypes: { 'إجازة سنوية': true },
};

async function world() {
  const { db, env } = await apiEnv();
  env.TIMEZONE = 'UTC';
  env.__NOW = `${TODAY}T12:00:00Z`;
  await setWork(db, SETTINGS);
  await seedOrg(db); // 1 مديرة، 2 و3 مرؤوسان، 4 مستقل — كلهم المركز 1
  await addEmployee(db, { id: 5, code: 'NW-005', centerId: 2 });
  const u = {
    hr: await login(db, 'hr@nawaculture.org', 'hr', null),
    mgr: await login(db, 'mgr@nawaculture.org', 'manager', 1),
    emp2: await login(db, 'emp2@nawaculture.org', 'employee', 2),
    dir: await login(db, 'dir@nawaculture.org', 'director', null),
  };
  return { db, env, u };
}
const api = (env, who, path) => call(env, 'GET', path, { cookie: who.cookie });
const names = (body) => body.days.map((d) => `${d.date}:${d.items.map((i) => i.code).join(',')}`);

test('الموظفون: حضور بلا انصراف يظهر يوماً بيوم ويختفي بتسجيل الانصراف، وإجازة أو عطلة لا تظهر', async () => {
  const { db, env, u } = await world();
  await gatePost(env, [
    mv('NW-002', 'حضور', THU, '08:30'), // نسي الانصراف قبل أسبوع
    mv('NW-003', 'حضور', SUN, '08:30'), mv('NW-003', 'انصراف', SUN, '15:00'), // أكمل يومه
    mv('NW-003', 'حضور', TODAY, '08:35'), // اليوم لم ينصرف بعد
    mv('NW-004', 'حضور', SUN, '08:30'), mv('NW-004', 'خروج', SUN, '11:00'), // غادر ولم يعد ولم ينصرف
    mv('NW-005', 'حضور', SUN, '08:40'),
    mv('NW-001', 'حضور', '2026-10-30', '09:00'), // الجمعة عطلة: لا تنبيه
  ]);
  const r = await api(env, u.hr, '/api/unclosed');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.today, TODAY);
  assert.deepEqual(names(r.body), [`${TODAY}:NW-003`, `${SUN}:NW-004,NW-005`, `${THU}:NW-002`]);
  assert.equal(r.body.total, 4);
  assert.equal(r.body.past, 3, 'أيام سابقة فقط تُعدّ تنبيهاً');
  assert.equal(r.body.days[0].isToday, true);
  const four = r.body.days[1].items.find((i) => i.code === 'NW-004');
  assert.deepEqual({ k: four.kind, ci: four.checkIn, lt: four.lastType, tm: four.lastTime, c: four.center }, { k: 'employee', ci: '08:30', lt: 'خروج', tm: '11:00', c: 'المبنى الرئيسي' });

  // تسجيل الانصراف يُسقطه من القائمة فوراً
  await gatePost(env, [mv('NW-004', 'انصراف', SUN, '15:00')]);
  assert.deepEqual(names((await api(env, u.hr, '/api/unclosed')).body), [`${TODAY}:NW-003`, `${SUN}:NW-005`, `${THU}:NW-002`]);

  // وكذلك تصحيح الموارد البشرية اليدوي (حركة انصراف يدوية عبر المحرك نفسه)
  await db.prepare("INSERT INTO day_overrides (employee_id, date, dep_time) VALUES (5, ?, '15:00') ON CONFLICT(employee_id, date) DO UPDATE SET dep_time = '15:00'").bind(SUN).run();
  const { recomputePairs } = await import('../src/worker/recompute.js');
  const { loadWorkSettings } = await import('../src/worker/settings.js');
  await recomputePairs(db, [{ e: 5, d: SUN }], await loadWorkSettings(db));
  assert.deepEqual(names((await api(env, u.hr, '/api/unclosed')).body), [`${TODAY}:NW-003`, `${THU}:NW-002`]);

  // موظف متوقف لا يظهر
  await db.prepare("UPDATE employees SET status = 'inactive' WHERE id = 2").run();
  assert.deepEqual(names((await api(env, u.hr, '/api/unclosed')).body), [`${TODAY}:NW-003`]);
});

test('النافذة الزمنية: days يحدّد الأيام وقيمة سيئة ترجع إلى الافتراضي وتُسقَّف بـ 31', async () => {
  const { env, u } = await world();
  await gatePost(env, [mv('NW-002', 'حضور', THU, '08:30'), mv('NW-003', 'حضور', SUN, '08:30')]);
  assert.deepEqual(names((await api(env, u.hr, '/api/unclosed?days=1')).body), []);
  assert.deepEqual(names((await api(env, u.hr, '/api/unclosed?days=3')).body), [`${SUN}:NW-003`], 'من 31 أكتوبر');
  assert.deepEqual(names((await api(env, u.hr, '/api/unclosed?days=7')).body), [`${SUN}:NW-003`, `${THU}:NW-002`]);
  assert.deepEqual(names((await api(env, u.hr, '/api/unclosed?days=abc')).body), [`${SUN}:NW-003`, `${THU}:NW-002`], 'افتراضي 7');
  assert.equal(clampDays('999'), 31);
  assert.equal(clampDays('0'), 7);
  assert.equal(clampDays('2.5'), 7);
  assert.equal(clampDays('999', 14), 14);
});

test('الصلاحيات: الموظف نفسه فقط، والمدير مرؤوسوه، والموارد والمدير العام الجميع', async () => {
  const { env, u } = await world();
  await gatePost(env, [mv('NW-002', 'حضور', SUN, '08:30'), mv('NW-003', 'حضور', SUN, '08:30'), mv('NW-004', 'حضور', SUN, '08:30'), mv('NW-005', 'حضور', SUN, '08:30')]);
  const codes = async (who) => (await api(env, who, '/api/unclosed')).body.days.flatMap((d) => d.items.map((i) => i.code));
  assert.deepEqual(await codes(u.emp2), ['NW-002']);
  assert.deepEqual(await codes(u.mgr), ['NW-002', 'NW-003']);
  assert.deepEqual((await codes(u.hr)).sort(), ['NW-002', 'NW-003', 'NW-004', 'NW-005']);
  assert.deepEqual((await codes(u.dir)).sort(), ['NW-002', 'NW-003', 'NW-004', 'NW-005']);
  assert.equal((await call(env, 'GET', '/api/unclosed')).status, 401, 'بلا جلسة');
});

test('استعلام الموظفين يستعمل الفهرس الجزئي فلا يمسح daily_results', async () => {
  const { db } = await world();
  const plan = async (sql, binds) => (await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all()).results.map((r) => r.detail).join(' | ');
  const p = await plan(EMP_SQL({ sql: '1 = 1', params: [] }), ['2026-10-27', TODAY]);
  assert.match(p, /daily_results_unclosed/, p);
  assert.doesNotMatch(p, /SCAN r\b|SCAN daily_results/, p);
  assert.ok(PROV_SQL);
});

// ---------------------------------------------------------------- مزوّدو الخدمة
const SCHED = [{ weekday: 0, start: '09:00', end: '13:00' }, { weekday: 1, start: '09:00', end: '13:00' }];
const scan = (card, code, type, date, time) => ({ id: `PV-${date}${time}-${code}-${type}`, card, code, name: 'x', center: 'المبنى الرئيسي', type, date, time, iso: `${date}T${time}:00`, device: 'DEV-01', offline: false, note: '' });
const mkProv = async (env, hr, over = {}) => {
  const r = await call(env, 'POST', '/api/providers', { cookie: hr.cookie, body: { name: 'أ. سلمى', centerId: 1, service: 'تدريس', supervisorId: 2, contractStart: '2026-10-15', contractEnd: '2026-12-15', schedule: SCHED, ...over } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
};

test('مزوّدو الخدمة: حضور بلا انصراف يظهر، ويختفي بالانصراف أو بطارئ فعّال لمركزه، ويُحصر بنطاقه', async () => {
  const { db, env, u } = await world();
  const a = await mkProv(env, u.hr, { name: 'أ. سلمى' });
  const b = await mkProv(env, u.hr, { name: 'أ. رنا', centerId: 2, supervisorId: 4 });
  const c = await mkProv(env, u.hr, { name: 'أ. هدى' });
  await gatePost(env, [
    scan(a.card, a.code, 'حضور', SUN, '09:02'),
    scan(b.card, b.code, 'حضور', SUN, '09:10'), scan(b.card, b.code, 'خروج', SUN, '10:30'),
    scan(c.card, c.code, 'حضور', SUN, '09:00'), scan(c.card, c.code, 'انصراف', SUN, '13:00'),
  ]);
  let r = (await api(env, u.hr, '/api/unclosed')).body;
  assert.deepEqual(r.days.map((d) => d.date), [SUN]);
  assert.deepEqual(r.days[0].items.map((i) => i.name), ['أ. رنا', 'أ. سلمى'], 'مرتبون بالاسم، ومن أكمل يومه (هدى) غائب');
  assert.deepEqual(r.days[0].items.map((i) => i.code).sort(), [a.code, b.code].sort());
  const rana = r.days[0].items.find((i) => i.code === b.code);
  assert.deepEqual({ kind: rana.kind, checkIn: rana.checkIn, lastType: rana.lastType, lastTime: rana.lastTime, center: rana.center }, { kind: 'provider', checkIn: '09:10', lastType: 'خروج', lastTime: '10:30', center: 'مركز الزيتونة' });

  // المدير المباشر للمركز 1 يرى مزوّد مركزه (سلمى) لا مزوّد مركز آخر، والموظف العادي لا يرى مزوّدين
  const mgrCodes = (await api(env, u.mgr, '/api/unclosed')).body.days.flatMap((d) => d.items.filter((i) => i.kind === 'provider').map((i) => i.code));
  assert.deepEqual(mgrCodes, [a.code]);
  assert.deepEqual((await api(env, u.emp2, '/api/unclosed')).body.days.flatMap((d) => d.items.filter((i) => i.kind === 'provider')), []);

  // الانصراف يُسقطه
  await gatePost(env, [scan(a.card, a.code, 'انصراف', SUN, '13:00')]);
  r = (await api(env, u.hr, '/api/unclosed')).body;
  assert.deepEqual(r.days.flatMap((d) => d.items.map((i) => i.code)), [b.code]);

  // طارئ فعّال لمركز المزوّد ذلك اليوم: لا معنى لانصراف منسيّ فيُستثنى
  await db.prepare("INSERT INTO emergencies (date, center_id, dismiss_time, status, created_by) VALUES (?, 2, '11:00', 'active', 'hr')").bind(SUN).run();
  assert.deepEqual((await api(env, u.hr, '/api/unclosed')).body.days, []);
  await db.prepare("UPDATE emergencies SET status = 'cancelled'").run();
  assert.equal((await api(env, u.hr, '/api/unclosed')).body.total, 1, 'يعود بعد إلغاء الطارئ');

  // مزوّد متوقف (غير فعّال) لا يظهر
  await db.prepare('UPDATE providers SET active = 0 WHERE id = ?').bind(b.id).run();
  assert.equal((await api(env, u.hr, '/api/unclosed')).body.total, 0);
});

// ---------------------------------------------------------------- تطبيق البوابة
test('البوابة: ?action=unclosed بنطاق الجهاز (مركزه أو من مُسح حضوره عليه)، وبرمز سليم فقط، وبلا استعلامات كثيرة', async () => {
  const { db, env } = await world();
  await db.prepare("INSERT INTO devices (id, name, center_id, token_hash) VALUES ('DEV-02', 'بوابة 2', 2, ?)").bind(await (await import('../src/worker/util.js')).sha256hex('device-two-token-0123456789')).run();
  await gatePost(env, [
    mv('NW-002', 'حضور', SUN, '08:30'), // مركز 1 على DEV-01
    mv('NW-005', 'حضور', SUN, '08:40'), // مركز 2 على DEV-01: سُجّل على هذا الجهاز فيظهر له
    mv('NW-003', 'حضور', TODAY, '08:35'),
  ]);
  const g = await gateGet(env, `action=unclosed&token=${DEVICE_TOKEN}`);
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.deepEqual(names(g.body), [`${TODAY}:NW-003`, `${SUN}:NW-002,NW-005`]);
  assert.ok(g.queries <= 6, `استعلامات: ${g.queries}`);
  assert.equal(g.body.past, 2);

  // جهاز المركز 2: يرى موظفي مركزه فقط (NW-005) ولو سُجّل حضورهم على جهاز آخر
  const g2 = await gateGet(env, 'action=unclosed&token=device-two-token-0123456789');
  assert.deepEqual(names(g2.body), [`${SUN}:NW-005`]);

  assert.equal((await gateGet(env, 'action=unclosed&token=wrong-token-wrong-token-1')).status, 401);
  assert.equal((await gateGet(env, `action=unclosed&days=1&token=${DEVICE_TOKEN}`)).body.days.length, 1, 'days=1 اليوم فقط');
});

test('تجاهل يوم: الموارد البشرية فقط، لأيام سابقة، ويخرج الاسم من القائمة دون المساس باليوم', async () => {
  const { db, env, u } = await world();
  await gatePost(env, [mv('NW-002', 'حضور', THU, '08:30'), mv('NW-003', 'حضور', SUN, '08:30'), mv('NW-003', 'حضور', TODAY, '08:35')]);
  const dismiss = (who, body) => call(env, 'POST', '/api/unclosed/dismiss', { cookie: who.cookie, body });
  assert.equal((await dismiss(u.mgr, { kind: 'employee', id: 2, date: THU })).status, 403, 'المدير لا يتجاهل');
  assert.equal((await dismiss(u.hr, { kind: 'employee', id: 2, date: TODAY })).status, 400, 'اليوم الحاضر لا يُتجاهل');
  assert.equal((await dismiss(u.hr, { kind: 'employee', id: 2, date: '2026-09-01' })).status, 400, 'أقدم من الفترة');
  assert.equal((await dismiss(u.hr, { kind: 'x', id: 2, date: THU })).status, 400);
  assert.equal((await dismiss(u.hr, { kind: 'employee', id: 999, date: THU })).status, 404);
  const ok = await dismiss(u.hr, { kind: 'employee', id: 2, date: THU });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await dismiss(u.hr, { kind: 'employee', id: 2, date: THU })).status, 200, 'تكرار الطلب آمن');
  assert.deepEqual(names((await api(env, u.hr, '/api/unclosed')).body), [`${TODAY}:NW-003`, `${SUN}:NW-003`]);
  const row = await db.prepare("SELECT alert FROM daily_results WHERE employee_id = 2 AND date = ?").bind(THU).first();
  assert.equal(row.alert, 'انصراف غير مسجّل', 'حساب اليوم لم يتغيّر');
  const log = await db.prepare("SELECT actor FROM audit_log WHERE action = 'unclosed.dismiss'").all();
  assert.equal(log.results.length, 2, 'كل طلب ناجح يُدقَّق');
});

test('قبل تطبيق هجرة التجاهل تبقى القائمة تعمل', async () => {
  const { db, env, u } = await world();
  await gatePost(env, [mv('NW-002', 'حضور', THU, '08:30')]);
  await db.prepare('DROP TABLE unclosed_dismissed').run();
  assert.deepEqual(names((await api(env, u.hr, '/api/unclosed')).body), [`${THU}:NW-002`]);
});
