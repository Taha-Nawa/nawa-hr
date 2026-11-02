// النسخة الاحتياطية: صلاحية مسؤول النظام أو رمز السكربت فقط، بلا أسرار، ترقيم كامل، استرجاع مطابق، وتذكير بالبريد.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { setWork } from './helpers/seed.js';
import { BACKUP_TABLES, BACKUP_EXCLUDED, backupReminder } from '../src/worker/backup.js';
import { pullAll, toSqlStatements, toSqlFile } from '../public/js/backup-lib.js';

const NOW = '2026-11-06T07:00:00Z';
const SETTINGS = {
  start: '08:30', end: '15:00', toleranceMinutes: 10,
  weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'],
  leaveTypes: { 'إجازة سنوية': true, 'مهمة عمل': true },
};
const TOKEN = 'backup-token-0123456789-abcdefghij';

async function world() {
  const { db, env } = await apiEnv();
  env.__NOW = NOW;
  env.BACKUP_TOKEN = TOKEN;
  await setWork(db, SETTINGS);
  await seedOrg(db);
  const u = {
    emp: await login(db, 'emp2@nawaculture.org', 'employee', 2),
    mgr: await login(db, 'mgr@nawaculture.org', 'manager', 1),
    hr: await login(db, 'hr@nawaculture.org', 'hr', 4),
    dir: await login(db, 'dir@nawaculture.org', 'director', null),
    admin: await login(db, 'adm@nawaculture.org', 'admin', null),
  };
  return { db, env, u };
}
const get = (env, path, opts = {}) => call(env, 'GET', path, opts);
const bearer = (t = TOKEN) => ({ headers: { authorization: `Bearer ${t}` } });

test('الصلاحية: المسؤول والرمز فقط؛ غير ذلك 401/403', async () => {
  const { env, u } = await world();
  for (const path of ['/api/backup/status', '/api/backup/manifest', '/api/backup/table?name=centers']) {
    assert.equal((await get(env, path)).status, 401, `${path} بلا جلسة`);
    for (const who of ['emp', 'mgr', 'hr', 'dir']) assert.equal((await get(env, path, { cookie: u[who].cookie })).status, 403, `${path} ${who}`);
    assert.equal((await get(env, path, { cookie: u.admin.cookie })).status, 200, `${path} admin`);
    assert.equal((await get(env, path, bearer())).status, 200, `${path} token`);
    assert.equal((await get(env, path, bearer('wrong-token-wrong-token-wrong-token'))).status, 401, `${path} رمز خاطئ`);
  }
  for (const who of ['emp', 'mgr', 'hr', 'dir']) assert.equal((await call(env, 'POST', '/api/backup/done', { cookie: u[who].cookie, body: { rows: 1, tables: 1 } })).status, 403);
  assert.equal((await call(env, 'POST', '/api/backup/done', { body: { rows: 1, tables: 1 } })).status, 401);
});

test('بلا BACKUP_TOKEN (أو قصير) يتعطّل مسار الرمز تماماً', async () => {
  const { env } = await world();
  delete env.BACKUP_TOKEN;
  assert.equal((await get(env, '/api/backup/manifest', bearer())).status, 401);
  env.BACKUP_TOKEN = 'short';
  assert.equal((await get(env, '/api/backup/manifest', bearer('short'))).status, 401);
});

test('كل جدول في المخطط مصنَّف: يُنسخ أو مستبعد صراحةً (يمنع تسرّب جدول أسرار جديد)', async () => {
  const { db } = await world();
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE '_cf_%'").all()).results.map((r) => r.name);
  const known = new Set([...BACKUP_TABLES, ...BACKUP_EXCLUDED]);
  assert.deepEqual(tables.filter((t) => !known.has(t)), [], 'جدول جديد غير مصنَّف في backup.js');
  assert.deepEqual(BACKUP_TABLES.filter((t) => !tables.includes(t)), [], 'جدول مذكور لا وجود له');
  assert.equal(BACKUP_TABLES.filter((t) => BACKUP_EXCLUDED.includes(t)).length, 0);
});

test('القائمة تحصي الجداول بعدد استعلامات ضمن الحد، والصفحة تحترم الحجم', async () => {
  const { db, env, u } = await world();
  const m = (await get(env, '/api/backup/manifest', { cookie: u.admin.cookie })).body;
  // حد الـ50 استعلاماً مفروض داخل الـ shim (يرمي عند تجاوزه)، فنجاح الطلب يكفي
  assert.deepEqual(m.tables.map((t) => t.name), BACKUP_TABLES);
  assert.equal(m.tables.find((t) => t.name === 'employees').rows, 4);
  assert.equal((await get(env, '/api/backup/table?name=nope', bearer())).status, 400);
  assert.equal((await get(env, '/api/backup/table?name=employees&limit=0', bearer())).status, 400);
  assert.equal((await get(env, '/api/backup/table?name=employees&limit=5000', bearer())).status, 400);
  assert.equal((await get(env, '/api/backup/table?name=employees&offset=-1', bearer())).status, 400);
  const p1 = (await get(env, '/api/backup/table?name=employees&offset=0&limit=3', bearer())).body;
  const p2 = (await get(env, '/api/backup/table?name=employees&offset=3&limit=3', bearer())).body;
  assert.equal(p1.rows.length, 3);
  assert.equal(p1.done, false);
  assert.equal(p2.rows.length, 1);
  assert.equal(p2.done, true);
  assert.ok(p1.columns.includes('code'));
  void db;
});

test('لا أسرار في النسخة: بصمة الجهاز والجلسات وPIN ورموز البريد خارجها', async () => {
  const { db, env, u } = await world();
  // أسرار موجودة فعلاً في القاعدة
  await db.prepare("INSERT OR REPLACE INTO devices (id, name, token_hash, active) VALUES ('DEV-TEST', 'بوابة', 'DEVICE_HASH_SECRET_123', 1)").run();
  await db.prepare("INSERT INTO user_pins (user_id, salt, pin_hash) VALUES (?, 'SALT_SECRET_123', 'PIN_HASH_SECRET_123')").bind(u.hr.id).run();
  await db.prepare("INSERT INTO email_codes (email, salt, code_hash, expires_at) VALUES ('a@b.c', 'S', 'CODE_HASH_SECRET_123', datetime('now', '+1 hour'))").run();
  await db.prepare("INSERT INTO auth_meta (key, value) VALUES ('k', 'AUTH_META_SECRET_123')").run();
  await db.prepare("INSERT INTO trusted_devices (user_id, token_hash, expires_at) VALUES (?, 'TRUSTED_SECRET_123', datetime('now', '+1 day'))").bind(u.hr.id).run();
  const backup = await pullAll(async (p) => (await get(env, p, bearer())).body);
  const text = JSON.stringify(backup);
  for (const secret of ['DEVICE_HASH_SECRET_123', 'SALT_SECRET_123', 'PIN_HASH_SECRET_123', 'CODE_HASH_SECRET_123', 'AUTH_META_SECRET_123', 'TRUSTED_SECRET_123', u.admin.token, TOKEN]) {
    assert.ok(!text.includes(secret), `تسرّب: ${secret.slice(0, 12)}…`);
  }
  assert.ok(!backup.tables.devices.columns.includes('token_hash'));
  for (const t of BACKUP_EXCLUDED) assert.equal(backup.tables[t], undefined, t);
  assert.ok(backup.tables.users.rows.length >= 4, 'المستخدمون (بلا أسرار) داخل النسخة');
});

test('سحب كامل بترقيم صغير يعيد كل الصفوف، ثم الاسترجاع إلى قاعدة جديدة يطابق الأصل', async () => {
  const { db, env } = await world();
  await db.prepare("INSERT OR REPLACE INTO devices (id, name, token_hash, active) VALUES ('DEV-TEST', 'بوابة ''الخضر''', 'X', 1)").run();
  // بيانات متنوعة: حركات (مفتاح نصي)، طلب، وحرف اقتباس وعربي
  await db.prepare("INSERT INTO movements (id, employee_id, card, code, name, center, type, date, time, device_id) SELECT 'm' || value, 2, 'NW-002-A', 'NW-002', 'سارة', 'x', 'حضور', '2026-11-0' || (1 + value % 5), '08:3' || (value % 10), 'DEV-TEST' FROM (WITH RECURSIVE c(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM c WHERE value < 25) SELECT value FROM c)").run();
  await db.prepare("INSERT INTO requests (employee_id, kind, purpose, reason, from_date, to_date, request_date, created_by, days) VALUES (2, 'leave', 'other', 'سبب ''مقتبس'' وعربي', '2026-11-08', '2026-11-08', '2026-11-06', 'x@y.z', 1)").run();
  const calls = [];
  const backup = await pullAll(async (p) => { calls.push(p); return (await get(env, p, bearer())).body; }, { pageSize: 10 });
  assert.equal(backup.tables.movements.rows.length, 25);
  assert.ok(calls.filter((c) => c.includes('name=movements')).length >= 3, 'ترقيم على عدة صفحات');
  for (const t of BACKUP_TABLES) {
    const n = (await db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).first()).n;
    assert.equal(backup.tables[t].rows.length, n, `عدد صفوف ${t}`);
  }

  // استرجاع في قاعدة جديدة (نفس المخطط) من عبارات SQL
  const { db: db2 } = await apiEnv();
  const fresh = () => { db.resetCount?.(); db2.resetCount?.(); }; // حدّ الـ50 للطلب الواحد لا ينطبق على عملية استرجاع خارجية
  for (const t of [...BACKUP_TABLES].reverse()) { fresh(); await db2.prepare(`DELETE FROM "${t}"`).run().catch(() => {}); }
  const stmts = toSqlStatements(backup, { batch: 7 });
  assert.ok(stmts.length >= 8 && stmts.length < 200, `عدد العبارات ${stmts.length}`);
  for (const s of stmts) { fresh(); await db2.prepare(s).run(); }
  for (const t of BACKUP_TABLES) {
    fresh();
    const cols = backup.tables[t].columns.map((c) => `"${c}"`).join(', ');
    const pk = backup.tables[t].columns.slice(0, 1).map((c) => `"${c}"`).join(', ');
    const a = (await db.prepare(`SELECT ${cols} FROM "${t}" ORDER BY ${pk}, ${cols}`).all()).results;
    const b = (await db2.prepare(`SELECT ${cols} FROM "${t}" ORDER BY ${pk}, ${cols}`).all()).results;
    assert.deepEqual(b, a, `محتوى ${t} بعد الاسترجاع`);
  }
  assert.match(toSqlFile(backup), /^-- نسخة احتياطية .*\nPRAGMA defer_foreign_keys = true;/s);
  // بصمة الجهاز لا تُستعاد: قيمة لا تطابق أي رمز
  assert.equal((await db2.prepare("SELECT token_hash FROM devices WHERE id = 'DEV-TEST'").first()).token_hash, 'restored:DEV-TEST');
});

test('تسجيل اكتمال النسخة: الحالة والتدقيق، ثم تصير «مستحقة» بعد 7 أيام', async () => {
  const { db, env, u } = await world();
  let s = (await get(env, '/api/backup/status', { cookie: u.admin.cookie })).body;
  assert.deepEqual([s.last, s.due, s.tokenEnabled], [null, true, true]);
  assert.equal((await call(env, 'POST', '/api/backup/done', { cookie: u.admin.cookie, body: { rows: 0, tables: 0 } })).status, 400);
  const r = await call(env, 'POST', '/api/backup/done', { cookie: u.admin.cookie, body: { rows: 123, tables: 20 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  s = (await get(env, '/api/backup/status', { cookie: u.admin.cookie })).body;
  assert.deepEqual([s.due, s.last.rows, s.last.by, s.last.via], [false, 123, 'adm@nawaculture.org', 'browser']);
  const viaToken = await call(env, 'POST', '/api/backup/done', { ...bearer(), body: { rows: 5, tables: 20 } });
  assert.equal(viaToken.status, 200);
  assert.equal((await get(env, '/api/backup/status', bearer())).body.last.via, 'script');
  const log = (await db.prepare("SELECT actor, detail FROM audit_log WHERE action = 'backup.export' ORDER BY id").all()).results;
  assert.deepEqual(log.map((x) => x.actor), ['adm@nawaculture.org', 'backup-token']);
  env.__NOW = '2026-11-14T07:00:00Z';
  s = (await get(env, '/api/backup/status', { cookie: u.admin.cookie })).body;
  assert.equal(s.due, true);
  assert.equal(s.daysSince, 8);
});

test('التذكير بالبريد: عند عدم وجود نسخة أو بعد 14 يوماً، ومرة كل 7 أيام، ولا يرسل إن كانت حديثة', async () => {
  const { env, u } = await world();
  const sent = [];
  env.__MAILER = { kind: 'test', send: async (m) => { sent.push(m); } };
  const at = (iso) => new Date(iso);
  assert.deepEqual(await backupReminder(env, { now: at(NOW) }), { sent: 1 }, 'لا نسخة: تذكير للمسؤول الوحيد');
  assert.deepEqual(sent.map((m) => m.to), ['adm@nawaculture.org']);
  assert.match(sent[0].subject, /لم تُؤخذ نسخة/);
  assert.match(sent[0].text, /#\/backup/);
  assert.deepEqual(await backupReminder(env, { now: at('2026-11-10T07:00:00Z') }), { sent: 0, reason: 'recent' }, 'لا تكرار قبل 7 أيام');
  assert.equal((await backupReminder(env, { now: at('2026-11-14T07:00:00Z') })).sent, 1, 'بعد 7 أيام يتكرر');

  // نسخة أُخذت في 2026-11-06: حديثة حتى 14 يوماً، ثم تذكير، ثم لا تكرار قبل 7 أيام
  await call(env, 'POST', '/api/backup/done', { cookie: u.admin.cookie, body: { rows: 1, tables: 1 } });
  await env.DB.prepare("DELETE FROM settings WHERE key = 'backup'").run();
  await call(env, 'POST', '/api/backup/done', { cookie: u.admin.cookie, body: { rows: 1, tables: 1 } });
  sent.length = 0;
  assert.deepEqual(await backupReminder(env, { now: at('2026-11-19T07:00:00Z') }), { sent: 0, reason: 'fresh' }, '13 يوماً');
  assert.equal((await backupReminder(env, { now: at('2026-11-21T07:00:00Z') })).sent, 1, '15 يوماً');
  assert.deepEqual(await backupReminder(env, { now: at('2026-11-22T07:00:00Z') }), { sent: 0, reason: 'recent' });
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /قبل 15 يوماً/);
});

test('بلا مرسل بريد مُعدّ لا تذكير ولا خطأ', async () => {
  const { env } = await world();
  env.__MAILER = null;
  const r = await backupReminder(env, { now: new Date(NOW) });
  assert.equal(r.sent, 0);
});
