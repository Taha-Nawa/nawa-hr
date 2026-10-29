import { test } from 'node:test';
import assert from 'node:assert/strict';
import { materializeRange } from '../src/worker/recompute.js';
import {
  golden, freshEnv, addEmployee, addHolidays, addOverride, gatePost, gateGet, mv, rowToResult, setWork, DEVICE_TOKEN,
} from './helpers/seed.js';

async function seedGolden(env) {
  const { db } = env.DB ? { db: env.DB } : env;
  await addEmployee(db, { id: 1, code: golden.employeeCode });
  await addHolidays(db, golden.holidays);
  for (const d of golden.days) {
    const anyManual = Object.values(d.manual).some((v) => v);
    if (anyManual || d.leaveType) await addOverride(db, 1, d.date, { manual: d.manual, leaveType: d.leaveType });
  }
}

const goldenMoves = () =>
  golden.movements.map((m) => ({
    id: m.id, card: `${m.code}-A`, code: m.code, name: 'x', center: 'المبنى الرئيسي',
    type: m.type, date: m.date, time: m.time, iso: `${m.date}T${m.time}:00`, device: 'DEV-01', offline: false, note: '',
  }));

test('الطريق كاملاً: حركات البوابة ثم إعادة الحساب تطابق إكسل (365 يوماً × 17 عموداً)', async () => {
  const { env } = await freshEnv();
  await seedGolden(env);

  // نرسلها كما تفعل البوابة: دفعات صغيرة.
  const all = goldenMoves();
  let saved = 0;
  for (let i = 0; i < all.length; i += 7) {
    const r = await gatePost(env, all.slice(i, i + 7));
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.ok(!r.body.warning, 'لا تحذير: الإعدادات موجودة');
    saved += r.body.saved;
  }
  assert.equal(saved, all.length);

  // أ) الأيام التي فيها حركات حُسبت تلقائياً عند الاستقبال وتطابق إكسل.
  const days = new Map(golden.days.map((d) => [d.date, d]));
  const rows = (await env.DB.prepare('SELECT * FROM daily_results WHERE employee_id = 1').all()).results;
  const movementDays = new Set(golden.movements.map((m) => m.date));
  assert.equal(rows.length, movementDays.size, 'كل يوم فيه حركات حُسب عند الاستقبال');
  for (const r of rows) assert.deepEqual(rowToResult(r), days.get(r.date).expected, `يوم ${r.date} بعد الاستقبال`);

  // ب) تعبئة السنة كلها (أيام الغياب والعطل والإجازات بلا حركات) تطابق إكسل.
  const dates = golden.days.map((d) => d.date).sort();
  await materializeRange(env.DB, 1, dates[0], dates.at(-1), golden.settings);
  const full = (await env.DB.prepare('SELECT * FROM daily_results WHERE employee_id = 1 ORDER BY date').all()).results;
  assert.equal(full.length, golden.days.length);
  let cells = 0;
  for (const r of full) {
    assert.deepEqual(rowToResult(r), days.get(r.date).expected, `يوم ${r.date} بعد التعبئة`);
    cells += Object.keys(days.get(r.date).expected).length;
  }
  assert.equal(cells, 365 * 17);
});

test('إعادة إرسال الحركات نفسها لا تكرّر ولا تغيّر النتائج (منع التكرار بمعرّف الحركة)', async () => {
  const { env } = await freshEnv();
  await seedGolden(env);
  const all = goldenMoves();
  await gatePost(env, all);
  const before = (await env.DB.prepare('SELECT * FROM daily_results ORDER BY date').all()).results.map(rowToResult);

  const again = await gatePost(env, all);
  assert.equal(again.body.saved, 0);
  assert.equal(again.body.skipped, all.length);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM movements').first('n');
  assert.equal(n, all.length);
  const after = (await env.DB.prepare('SELECT * FROM daily_results ORDER BY date').all()).results.map(rowToResult);
  assert.deepEqual(after, before);
});

test('الأمان: رمز خاطئ أو ناقص أو جهاز معطّل يُرفض ولا يُكتب شيء', async () => {
  const { env, db } = await freshEnv();
  await addEmployee(db, { id: 1, code: 'NW-001' });
  const m = [mv('NW-001', 'حضور', '2026-03-01', '08:20')];

  for (const bad of ['wrong-token-wrong-token-wrong', '', null, 'x'.repeat(500)]) {
    const r = await gatePost(env, m, bad);
    assert.equal(r.status, 401, `رمز ${String(bad).slice(0, 12)}`);
    assert.equal(r.body.ok, false);
  }
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM movements').first('n'), 0);

  const { handleGate } = await import('../src/worker/gate.js');
  const noToken = await handleGate(new Request('https://hr.test/api/gate', { method: 'POST', body: JSON.stringify({ moves: m }) }), env);
  assert.equal(noToken.status, 401, 'بلا رمز إطلاقاً');

  await db.prepare("UPDATE devices SET active = 0 WHERE id = 'DEV-01'").run();
  assert.equal((await gatePost(env, m)).status, 401, 'جهاز ملغى');
  assert.equal((await gateGet(env, `action=ping&token=${DEVICE_TOKEN}`)).status, 401);
});

test('الرمز لا يُخزَّن بصيغته الأصلية في أي مكان', async () => {
  const { db } = await freshEnv();
  const dump = JSON.stringify((await db.prepare('SELECT * FROM devices').all()).results);
  assert.ok(!dump.includes(DEVICE_TOKEN));
});

test('بطاقة أو كود غير معروف: تُحفظ الحركة ولا تضيع، وتُعلَّم غير مطابقة، ولا تُحسب لأحد', async () => {
  const { env, db } = await freshEnv();
  const r = await gatePost(env, [mv('NW-999', 'حضور', '2026-03-01', '08:20', { card: 'NOPE' })]);
  assert.equal(r.body.saved, 1);
  assert.equal(r.body.unmatched, 1);
  const row = await db.prepare('SELECT employee_id FROM movements').first();
  assert.equal(row.employee_id, null);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM daily_results').first('n'), 0);
});

test('البطاقة تغلب الكود عند التعارض، ويُطابَق بالكود إن لم تُعرف البطاقة', async () => {
  const { env, db } = await freshEnv();
  await addEmployee(db, { id: 1, code: 'NW-001' });
  await addEmployee(db, { id: 2, code: 'NW-002' });
  await gatePost(env, [
    mv('NW-002', 'حضور', '2026-03-01', '08:20', { id: 'A', card: 'NW-001-A' }), // بطاقة 1 وكود 2 → الموظف 1
    mv('NW-002', 'حضور', '2026-03-02', '08:20', { id: 'B', card: 'UNKNOWN' }), // بطاقة مجهولة → بالكود → الموظف 2
  ]);
  const rows = (await db.prepare('SELECT id, employee_id FROM movements ORDER BY id').all()).results;
  assert.deepEqual(rows, [{ id: 'A', employee_id: 1 }, { id: 'B', employee_id: 2 }]);
});

test('الحركات غير الصالحة تُرفض مع السبب والصالحة في الدفعة نفسها تُحفظ', async () => {
  const { env, db } = await freshEnv();
  await addEmployee(db, { id: 1, code: 'NW-001' });
  const r = await gatePost(env, [
    mv('NW-001', 'حضور', '2026-03-01', '08:20', { id: 'ok-1' }),
    mv('NW-001', 'حضور', '2026-02-31', '08:20', { id: 'bad-date' }),
    mv('NW-001', 'حضور', '2026-03-01', '25:00', { id: 'bad-time' }),
    mv('NW-001', 'دخول', '2026-03-01', '08:20', { id: 'bad-type' }),
    { type: 'حضور', date: '2026-03-01', time: '08:20' }, // بلا معرّف
  ]);
  assert.equal(r.body.saved, 1);
  assert.equal(r.body.rejected.length, 4);
  assert.deepEqual(r.body.rejected.map((x) => x.id).slice(0, 3), ['bad-date', 'bad-time', 'bad-type']);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM movements').first('n'), 1);
});

test('طلب بلا حركات أو بصيغة معطوبة أو ضخم', async () => {
  const { env } = await freshEnv();
  assert.equal((await gatePost(env, [])).body.saved, 0);
  assert.equal((await gatePost(env, new Array(101).fill(mv('NW-001', 'حضور', '2026-03-01', '08:20')))).status, 413);
  const res = await (await import('../src/worker/gate.js')).handleGate(
    new Request('https://hr.test/api/gate', { method: 'POST', body: '{not json' }), env);
  assert.equal(res.status, 400);
});

test('الإعدادات ناقصة: الحركات تُحفظ مع تحذير، ويُحسب كل شيء لاحقاً عند توفّرها', async () => {
  const { env, db } = await freshEnv({ withSettings: false });
  await addEmployee(db, { id: 1, code: 'NW-001' });
  const r = await gatePost(env, [mv('NW-001', 'حضور', '2026-03-01', '08:20'), mv('NW-001', 'انصراف', '2026-03-01', '15:05')]);
  assert.equal(r.body.saved, 2);
  assert.equal(r.body.warning, 'settings_missing');
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM daily_results').first('n'), 0);

  await setWork(db, golden.settings);
  await materializeRange(db, 1, '2026-03-01', '2026-03-01', golden.settings);
  const row = await db.prepare('SELECT * FROM daily_results').first();
  assert.equal(row.status, 'حاضر');
  assert.equal(row.net_hours, 6.75);
});

test('إعدادات معطوبة تُعامَل كأنها غير موجودة (لا تخمين)', async () => {
  const { env, db } = await freshEnv({ withSettings: false });
  await addEmployee(db, { id: 1, code: 'NW-001' });
  for (const bad of [{ ...golden.settings, start: '99:99' }, { ...golden.settings, weekdays: ['عمل'] }, { ...golden.settings, toleranceMinutes: -1 }, 'not-an-object']) {
    await setWork(db, bad);
    const r = await gatePost(env, [mv('NW-001', 'حضور', '2026-03-01', '08:20', { id: `x${Math.random()}` })]);
    assert.equal(r.body.warning, 'settings_missing', JSON.stringify(bad).slice(0, 40));
  }
});

test('ميزانية D1: 100 حركة لـ 100 موظف في طلب واحد ضمن 50 استعلاماً و100 متغيّر', async () => {
  const { env, db } = await freshEnv();
  const moves = [];
  for (let i = 1; i <= 100; i++) {
    const code = `NW-${String(i).padStart(3, '0')}`;
    db.raw.exec(`INSERT INTO employees (id, code, name, center_id) VALUES (${i}, '${code}', 'موظف ${i}', 1)`);
    db.raw.exec(`INSERT INTO badges (card, employee_id) VALUES ('${code}-A', ${i})`);
    moves.push(mv(code, 'حضور', '2026-03-02', '08:31'));
  }
  const r = await gatePost(env, moves); // الشيم يرمي خطأ إن تجاوز الحدود
  assert.equal(r.status, 200);
  assert.equal(r.body.saved, 100);
  assert.ok(r.queries <= 12, `استعلامات الطلب: ${r.queries}`);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM daily_results').first('n'), 100);
  // موظف متأخر 1 دقيقة ضمن السماحية → «حاضر» والدقائق من بداية الدوام كما في إكسل
  const one = await db.prepare('SELECT status, late_minutes FROM daily_results WHERE employee_id = 1').first();
  assert.deepEqual(one, { status: 'حاضر', late_minutes: 1 });
});

test('كل حركة جديدة تعيد حساب يومها فقط، وحركة متأخرة ليوم سابق تحدّث ذلك اليوم', async () => {
  const { env, db } = await freshEnv();
  await addEmployee(db, { id: 1, code: 'NW-001' });
  await gatePost(env, [mv('NW-001', 'حضور', '2026-03-02', '08:20')]);
  let row = await db.prepare("SELECT * FROM daily_results WHERE date = '2026-03-02'").first();
  assert.equal(row.alert, 'انصراف غير مسجّل');
  assert.equal(row.presence_hours, 0);

  // بوابة كانت دون اتصال وتصل حركة انصرافها بعد يومين
  const late = await gatePost(env, [mv('NW-001', 'انصراف', '2026-03-02', '15:10', { offline: true })]);
  assert.equal(late.body.saved, 1);
  row = await db.prepare("SELECT * FROM daily_results WHERE date = '2026-03-02'").first();
  assert.equal(row.alert, '');
  assert.equal(row.net_hours, 6.83);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM daily_results').first('n'), 1);
});

test('تصحيح يدوي محفوظ في day_overrides له الأولوية عند إعادة الحساب', async () => {
  const { env, db } = await freshEnv();
  await addEmployee(db, { id: 1, code: 'NW-001' });
  await addOverride(db, 1, '2026-03-02', { manual: { in: '08:30', dep: '15:00' } });
  await gatePost(env, [mv('NW-001', 'حضور', '2026-03-02', '10:00')]);
  const row = await db.prepare("SELECT * FROM daily_results WHERE date = '2026-03-02'").first();
  assert.equal(row.check_in, '08:30');
  assert.equal(row.source, 'يدوي');
  assert.equal(row.status, 'حاضر');
});

test('قائمة البطاقات بنفس صيغة Apps Script، والموظف غير النشط أو البطاقة الملغاة', async () => {
  const { env, db } = await freshEnv();
  await db.prepare("UPDATE employees SET photo_url = NULL").run();
  await addEmployee(db, { id: 1, code: 'NW-001', name: 'أحمد' });
  await addEmployee(db, { id: 2, code: 'NW-002', name: 'ليلى', centerId: 2 });
  await addEmployee(db, { id: 3, code: 'NW-003', name: 'مستقيل', status: 'inactive' });
  await db.prepare("UPDATE badges SET status = 'revoked' WHERE card = 'NW-002-A'").run();

  const r = await gateGet(env, `action=badges&token=${DEVICE_TOKEN}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.count, 2);
  assert.deepEqual(r.body.badges, [
    { card: 'NW-001-A', code: 'NW-001', name: 'أحمد', center: 'المبنى الرئيسي', status: 'سارية', photo: '' },
    { card: 'NW-002-A', code: 'NW-002', name: 'ليلى', center: 'مركز الزيتونة', status: 'ملغاة', photo: '' },
  ]);
});

test('ping والرمز في ترويسة Authorization، وإجراء مجهول، وCORS للتطبيق المستضاف على نطاق آخر', async () => {
  const { env } = await freshEnv();
  const p = await gateGet(env, 'action=ping', { authorization: `Bearer ${DEVICE_TOKEN}` });
  assert.equal(p.body.ok, true);
  assert.equal(p.body.device, 'DEV-01');
  assert.equal(p.res.headers.get('access-control-allow-origin'), '*');
  assert.equal((await gateGet(env, `action=nope&token=${DEVICE_TOKEN}`)).status, 400);

  const { handleGate } = await import('../src/worker/gate.js');
  const opt = await handleGate(new Request('https://hr.test/api/gate', { method: 'OPTIONS' }), env);
  assert.equal(opt.status, 204);
  assert.match(opt.headers.get('access-control-allow-headers'), /content-type/);
});

test('آخر ظهور للجهاز يُحدَّث ولا يُكتب في كل طلب (توفير حدّ الكتابة اليومي)', async () => {
  const { env, db } = await freshEnv();
  await addEmployee(db, { id: 1, code: 'NW-001' });
  await gatePost(env, [mv('NW-001', 'حضور', '2026-03-02', '08:20', { id: 'a' })]);
  const first = await db.prepare("SELECT last_seen FROM devices WHERE id='DEV-01'").first('last_seen');
  assert.ok(first);
  await db.prepare("UPDATE devices SET last_seen = '2000-01-01 00:00:00'").run();
  await db.prepare("UPDATE devices SET last_seen = datetime('now')").run();
  const stamp = await db.prepare("SELECT last_seen FROM devices WHERE id='DEV-01'").first('last_seen');
  await gatePost(env, [mv('NW-001', 'انصراف', '2026-03-02', '15:05', { id: 'b' })]);
  assert.equal(await db.prepare("SELECT last_seen FROM devices WHERE id='DEV-01'").first('last_seen'), stamp);
});
