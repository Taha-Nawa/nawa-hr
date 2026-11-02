import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { setWork } from './helpers/seed.js';

const NOW = '2026-11-02T07:00:00Z'; // الإثنين 09:00 بتوقيت الخليل
const SETTINGS = {
  start: '08:30', end: '15:00', toleranceMinutes: 10,
  weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'],
  leaveTypes: { 'إجازة سنوية': true, 'إجازة مرضية': true, 'إجازة رسمية / طارئة': true },
};

async function world() {
  const { db, env } = await apiEnv();
  env.__NOW = NOW;
  const sent = [];
  env.__MAILER = { kind: 'test', send: async (m) => { sent.push(m); } };
  await setWork(db, SETTINGS);
  await seedOrg(db); // 1 مديرة (مدير 2 و3)، 4 مستقل
  const u = {
    emp2: await login(db, 'emp2@nawaculture.org', 'employee', 2),
    mgr: await login(db, 'mgr@nawaculture.org', 'manager', 1),
    hr: await login(db, 'hr@nawaculture.org', 'hr', 4),
    director: await login(db, 'dir@nawaculture.org', 'director', null),
    admin: await login(db, 'adm@nawaculture.org', 'admin', null),
  };
  return { db, env, u, sent };
}
const post = (env, who, path, body) => call(env, 'POST', path, { cookie: who.cookie, body });
const leave = (o = {}) => ({ kind: 'leave', purpose: 'annual', reason: 'سفر عائلي', fromDate: '2026-11-08', toDate: '2026-11-10', ...o });
const to = (sent) => sent.map((m) => m.to).sort();

test('تقديم الطلب يُشعر المدير المباشر وحده، والرسالة تحمل التفاصيل ورابط الطلب', async () => {
  const { env, u, sent } = await world();
  const r = await post(env, u.emp2, '/api/requests', leave());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(to(sent), ['mgr@nawaculture.org']);
  const m = sent[0];
  assert.match(m.subject, /طلب إجازة جديد من موظف أ/);
  assert.match(m.text, /2026-11-08/);
  assert.match(m.text, /سفر عائلي/);
  assert.match(m.html, new RegExp(`https://hr.test/#/requests\\?open=${r.body.id}`));
});

test('القرار يُشعر الموظف: اعتماد، ورفض مع السبب، وإلغاء اعتماد', async () => {
  const { env, u, sent } = await world();
  const a = await post(env, u.emp2, '/api/requests', leave());
  sent.length = 0;
  assert.equal((await post(env, u.mgr, `/api/requests/${a.body.id}/approve`, {})).status, 200);
  assert.deepEqual(to(sent), ['emp2@nawaculture.org']);
  assert.match(sent[0].subject, /اعتُمد طلب إجازة/);

  sent.length = 0;
  assert.equal((await post(env, u.hr, `/api/requests/${a.body.id}/cancel`, { note: 'تغيّر البرنامج' })).status, 200);
  assert.deepEqual(to(sent), ['emp2@nawaculture.org']);
  assert.match(sent[0].subject, /أُلغي/);
  assert.match(sent[0].text, /تغيّر البرنامج/);

  const b = await post(env, u.emp2, '/api/requests', leave({ fromDate: '2026-11-15', toDate: '2026-11-15' }));
  sent.length = 0;
  assert.equal((await post(env, u.mgr, `/api/requests/${b.body.id}/reject`, { note: 'ضغط عمل في هذه الفترة' })).status, 200);
  assert.match(sent[0].subject, /رُفض/);
  assert.match(sent[0].text, /سبب الرفض: ضغط عمل في هذه الفترة/);
});

test('من ألغى طلبه المعلّق بنفسه لا يصله إشعار، ولا يُشعَر من قرّر هو', async () => {
  const { env, u, sent } = await world();
  const a = await post(env, u.emp2, '/api/requests', leave());
  sent.length = 0;
  assert.equal((await post(env, u.emp2, `/api/requests/${a.body.id}/cancel`, {})).status, 200);
  assert.equal(sent.length, 0);
});

test('بلا مدير مباشر بحساب فعّال يذهب الطلب إلى الموارد البشرية', async () => {
  const { db, env, u, sent } = await world();
  await db.prepare("UPDATE users SET active = 0 WHERE email = 'mgr@nawaculture.org'").run();
  await post(env, u.emp2, '/api/requests', leave());
  assert.deepEqual(to(sent), ['hr@nawaculture.org']);
});

test('المرضية التي تلزمها ورقة طبية تذهب إلى مؤكِّدي الأوراق لا المدير المباشر', async () => {
  const { db, env, u, sent } = await world();
  await db.prepare("UPDATE users SET medical = 1 WHERE email = 'mgr@nawaculture.org'").run(); // مفوَّضة بتأكيد الأوراق
  const r = await post(env, u.emp2, '/api/requests', { kind: 'leave', purpose: 'sick', fromDate: '2026-11-01', toDate: '2026-11-02', medicalProof: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(to(sent), ['adm@nawaculture.org', 'dir@nawaculture.org', 'hr@nawaculture.org', 'mgr@nawaculture.org']);
});

test('المنح المباشر نيابة عن الموظف يُعلمه بالاعتماد ولا يُشعر معتمِداً', async () => {
  const { env, u, sent } = await world();
  const r = await post(env, u.hr, '/api/requests', leave({ employeeId: 2, approve: true }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(to(sent), ['emp2@nawaculture.org']);
  assert.match(sent[0].subject, /اعتُمد/);
});

test('الإيقاف من القواعد، وغياب إعداد البريد، وفشل الإرسال: كلها لا تؤثر على الطلب', async () => {
  const { db, env, u, sent } = await world();
  await db.prepare("INSERT INTO settings (key, value) VALUES ('requests', ?)").bind(JSON.stringify({ notify: { enabled: false } })).run();
  assert.equal((await post(env, u.emp2, '/api/requests', leave())).status, 201);
  assert.equal(sent.length, 0, 'موقوف من القواعد');

  await db.prepare("DELETE FROM settings WHERE key = 'requests'").run();
  env.__MAILER = { send: async () => { throw new Error('smtp down'); } };
  assert.equal((await post(env, u.emp2, '/api/requests', leave({ fromDate: '2026-11-15', toDate: '2026-11-15' }))).status, 201, 'فشل الإرسال لا يفشل الطلب');

  delete env.__MAILER;
  assert.equal((await post(env, u.emp2, '/api/requests', leave({ fromDate: '2026-11-16', toDate: '2026-11-16' }))).status, 201, 'بلا مزوّد بريد');
});

test('نص الطلب يُهرَّب في رسالة HTML', async () => {
  const { env, u, sent } = await world();
  await post(env, u.emp2, '/api/requests', leave({ reason: '<img src=x onerror=alert(1)>' }));
  assert.ok(!sent[0].html.includes('<img'), sent[0].html);
  assert.match(sent[0].html, /&lt;img/);
});
