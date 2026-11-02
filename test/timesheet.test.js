import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimesheet, TIMESHEET_DAY_HOURS } from '../src/engine/timesheet.js';
import { buildXlsx, crc32, sheetNames } from '../public/js/xlsx-write.js';
import { timesheetSheet } from '../public/js/timesheet-sheet.js';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';

// أكتوبر 2026: الخميس 1، الجمعة 2، السبت 3 (عطلة أسبوعية)، الأحد 4
const OCT = (d) => `2026-10-${String(d).padStart(2, '0')}`;
const one = [{ funder: 'Funder A', share: 1, from: '2026-01-01', to: '2030-12-31' }];
const day = (dayType, approvedHours, leaveType = '') => ({ dayType, approvedHours, leaveType });
const build = (days, allocations = one) => buildTimesheet({ year: 2026, month: 10, days, allocations, dayHours: 6.5 });
const at = (row, d) => row.values[d - 1];

test('يوم عمل كامل: ساعات الممول 6.5 + ساعة طارئة = 7.5، بلا إجازة سنوية', () => {
  const t = build({ [OCT(1)]: day('عمل', 6.5) });
  assert.equal(at(t.funders[0], 1), 6.5);
  assert.equal(at(t.emergency, 1), 1);
  assert.equal(at(t.annual, 1), null);
  assert.equal(at(t.total, 1), TIMESHEET_DAY_HOURS);
});

test('يوم بنقص ساعات: النقص يظهر في الإجازة السنوية ويكتمل اليوم إلى 7.5', () => {
  const t = build({ [OCT(5)]: day('عمل', 6.38) });
  assert.equal(at(t.funders[0], 5), 6.38);
  assert.ok(Math.abs(at(t.annual, 5) - 0.12) < 1e-9);
  assert.equal(at(t.emergency, 5), 1);
  assert.ok(Math.abs(at(t.total, 5) - 7.5) < 1e-9);
});

test('نقص ضئيل (≤ 0.001) لا يُسجَّل إجازة سنوية', () => {
  const t = build({ [OCT(5)]: day('عمل', 6.4995) });
  assert.equal(at(t.annual, 5), null);
});

test('غياب (معتمدة صفر في يوم عمل): ساعات الممول 0 والإجازة السنوية 7.5 بلا ساعة طارئة', () => {
  const t = build({ [OCT(4)]: day('عمل', 0) });
  assert.equal(at(t.funders[0], 4), 0, 'صفر لا فارغ: الصيغة تُرجع صفراً');
  assert.equal(at(t.annual, 4), 7.5);
  assert.equal(at(t.emergency, 4), null);
  assert.equal(at(t.total, 4), 7.5);
});

test('عطلة أسبوعية: كل الخلايا فارغة والمجموع فارغ', () => {
  const t = build({ [OCT(2)]: day('عطلة أسبوعية', 0) });
  for (const r of [t.funders[0], t.official, t.annual, t.sick, t.emergency, t.total]) assert.equal(at(r, 2), null);
});

test('عطلة رسمية: 7.5 في صف العطل، والممول 0، ولا إجازة سنوية', () => {
  const t = build({ [OCT(8)]: day('عطلة رسمية', 0) });
  assert.equal(at(t.official, 8), 7.5);
  assert.equal(at(t.funders[0], 8), 0);
  assert.equal(at(t.annual, 8), null);
  assert.equal(at(t.total, 8), 7.5);
});

test('إجازة مرضية: صف المرض 7.5 ولا تُسجَّل إجازة سنوية (كما في صيغ الشيت)', () => {
  const t = build({ [OCT(6)]: day('عمل', 6.5, 'إجازة مرضية') });
  assert.equal(at(t.sick, 6), 7.5);
  assert.equal(at(t.annual, 6), null);
  // الشيت يحسب الساعات المعتمدة (6.5 للإجازة المحتسبة) على الممول أيضاً — يوثَّق هنا كي لا يتغير بصمت
  assert.equal(at(t.funders[0], 6), 6.5);
});

test('يوم بلا حساب: كل الخلايا فارغة (لا صفر ولا غياب)', () => {
  const t = build({});
  for (const r of [t.funders[0], t.official, t.annual, t.sick, t.emergency, t.total]) assert.equal(at(r, 20), null);
  assert.equal(t.total.total, 0);
});

test('ممولان بنسبتين 50/50: توزيع الساعات ونسبة المركز', () => {
  const t = build({ [OCT(1)]: day('عمل', 6.5) }, [
    { funder: 'A', share: 0.5, from: '2026-01-01', to: '2030-12-31' },
    { funder: 'B', share: 0.5, from: '2026-01-01', to: '2030-12-31' },
  ]);
  assert.equal(at(t.funders[0], 1), 3.25);
  assert.equal(at(t.funders[1], 1), 3.25);
  assert.equal(t.funders[0].costCenter, 0.5);
  assert.equal(t.funders[1].costCenter, 0.5);
  assert.equal(at(t.total, 1), 7.5);
});

test('تغيير الممول في منتصف الشهر: الممول القديم صفر بعد نهاية فترته، والجديد يأخذ كامل الساعات', () => {
  const t = build({ [OCT(12)]: day('عمل', 6.5), [OCT(20)]: day('عمل', 6.5) }, [
    { funder: 'Old', share: 1, from: '2026-01-01', to: '2026-10-14' },
    { funder: 'New', share: 1, from: '2026-10-15', to: '2030-12-31' },
  ]);
  assert.equal(at(t.funders[0], 12), 6.5);
  assert.equal(at(t.funders[1], 12), 0);
  assert.equal(at(t.funders[0], 20), 0);
  assert.equal(at(t.funders[1], 20), 6.5);
  assert.equal(t.funders[0].costCenter, 0.5);
});

test('أربعة مشاريع تظهر كلها بنسبها؛ وأكثر من 6 يُقتطع مع تنبيه؛ وبلا توزيع صفوف الممولين فارغة مع تنبيه', () => {
  const four = [['A', 0.4], ['B', 0.3], ['C', 0.2], ['D', 0.1]].map(([f, share]) => ({ funder: f, share, from: '2026-01-01', to: '2030-12-31' }));
  const t4 = build({ [OCT(1)]: day('عمل', 6.5) }, four);
  assert.deepEqual(t4.funders.map((f) => f.funder), ['A', 'B', 'C', 'D']);
  assert.deepEqual(t4.funders.map((f) => Math.round(at(f, 1) * 100) / 100), [2.6, 1.95, 1.3, 0.65]);
  assert.ok(Math.abs(t4.funders.reduce((s, f) => s + at(f, 1), 0) - 6.5) < 1e-9, 'مجموع الموزَّع = ساعات الدوام');
  assert.deepEqual(t4.notes, []);
  const seven = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((f) => ({ funder: f, share: 1 / 7, from: '2026-01-01', to: '2030-12-31' }));
  const many = build({ [OCT(1)]: day('عمل', 6.5) }, seven);
  assert.equal(many.funders.length, 6);
  assert.ok(many.notes.includes('too_many_funders'));
  const none = build({ [OCT(1)]: day('عمل', 6.5) }, []);
  assert.equal(none.funders.length, 0);
  assert.ok(none.notes.includes('no_allocation'));
  assert.equal(at(none.emergency, 1), 1, 'باقي الصفوف تعمل بلا توزيع');
});

test('توزيع خارج الشهر لا يظهر، وبلا ساعات يُستعمل التوزيع المدخل كنسبة المركز', () => {
  const t = build({}, [
    { funder: 'Past', share: 1, from: '2025-01-01', to: '2025-12-31' },
    { funder: 'Now', share: 1, from: '2026-01-01', to: '2030-12-31' },
  ]);
  assert.deepEqual(t.funders.map((f) => f.funder), ['Now']);
  assert.equal(t.funders[0].costCenter, 1);
});

test('شهر قصير: الأعمدة بعد آخر يوم فارغة', () => {
  const t = buildTimesheet({ year: 2026, month: 2, days: {}, allocations: one, dayHours: 6.5 });
  assert.equal(t.daysInMonth, 28);
  assert.equal(t.funders[0].values.length, 28);
  assert.equal(t.monthName, 'February');
});

// ------------------------------------------------------------------ ملف إكسل
function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && dv.getUint32(end, true) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'سجل نهاية zip');
  const count = dv.getUint16(end + 10, true);
  let p = dv.getUint32(end + 16, true);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extra = dv.getUint16(p + 30, true);
    const comment = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const lnLen = dv.getUint16(off + 26, true);
    const lxLen = dv.getUint16(off + 28, true);
    const data = bytes.subarray(off + 30 + lnLen + lxLen, off + 30 + lnLen + lxLen + size);
    assert.equal(crc32(data), crc, `CRC ${name}`);
    files[name] = data;
    p += 46 + nameLen + extra + comment;
  }
  return files;
}

const info = { name: 'Test Employee', code: 'NW-143', post: 'Assistant', place: 'Center', supervisor: 'Boss – Manager', approver: 'Finance Person' };

test('ملف الإكسل: بنية zip سليمة وأجزاء المصنّف والصورة والأوراق كلها موجودة', () => {
  const t = build({ [OCT(1)]: day('عمل', 6.5) });
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const bytes = buildXlsx({ sheets: [timesheetSheet(t, info, png), timesheetSheet(t, { ...info, code: 'NW-144' })] });
  const f = unzip(bytes);
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/drawings/drawing1.xml', 'xl/media/image1.png']) assert.ok(f[n], n);
  const sheet1 = new TextDecoder().decode(f['xl/worksheets/sheet1.xml']);
  assert.match(sheet1, /Monthly Timesheet/);
  assert.match(sheet1, /Test Employee/);
  assert.match(sheet1, /<drawing r:id="rId1"\/>/);
  assert.doesNotMatch(new TextDecoder().decode(f['xl/worksheets/sheet2.xml']), /<drawing/);
  assert.match(new TextDecoder().decode(f['xl/workbook.xml']), /name="NW-143"[\s\S]*name="NW-144"/);
});

test('أسماء الأوراق: تقصير إلى 31 حرفاً وإزالة المحارف الممنوعة وكسر التكرار', () => {
  const [a, b, c] = sheetNames(['x'.repeat(40), 'A/B:C', 'a/b:c']);
  assert.equal(a.length, 31);
  assert.equal(b, 'A B C');
  assert.notEqual(c.toLowerCase(), b.toLowerCase());
});

test('النص الذي يحوي رموز XML أو أحرف تحكم لا يكسر الملف', () => {
  const t = build({});
  const bytes = buildXlsx({ sheets: [timesheetSheet(t, { ...info, name: 'A & B <x> "q" \u0001' })] });
  const xml = new TextDecoder().decode(unzip(bytes)['xl/worksheets/sheet1.xml']);
  assert.match(xml, /A &amp; B &lt;x&gt; &quot;q&quot; /);
  assert.doesNotMatch(xml, /\u0001/);
});

// ------------------------------------------------------------------ واجهة API
async function world() {
  const { db, env } = await apiEnv();
  await seedOrg(db); // 1 مديرة، 2 و3 تحتها، 4 مستقل
  await db.prepare("UPDATE employees SET name_en = 'Employee A', job_title_en = 'Officer' WHERE id = 2").run();
  await db.prepare("UPDATE employees SET name_en = 'Finance Boss', job_title_en = 'Administration and Finance Department Manager' WHERE id = 4").run();
  await db.prepare("UPDATE employees SET name_en = 'The Director', job_title_en = 'Director' WHERE id = 1").run();
  await db.prepare("INSERT INTO employee_projects (employee_id, funder, share, from_date, to_date) VALUES (2, 'Funder X', 0.5, '2026-01-01', '2030-12-31'), (2, 'Funder Y', 0.5, '2026-01-01', '2030-12-31')").run();
  const ins = (date, dayType, approved) =>
    db.prepare("INSERT INTO daily_results (employee_id, date, day_type, approved_hours, status) VALUES (2, ?, ?, ?, 'حاضر')").bind(date, dayType, approved).run();
  await ins('2026-10-01', 'عمل', 6.5);
  await ins('2026-10-04', 'عمل', 0);
  await ins('2026-09-30', 'عمل', 6.5); // خارج الشهر
  await db.prepare("INSERT INTO day_overrides (employee_id, date, leave_type) VALUES (2, '2026-10-04', 'إجازة مرضية')").run();
  return {
    env,
    emp: await login(db, 'emp@nawaculture.org', 'employee', 2),
    mgr: await login(db, 'mgr@nawaculture.org', 'manager', 1),
    other: await login(db, 'other@nawaculture.org', 'employee', 3),
    hr: await login(db, 'hr@nawaculture.org', 'hr', 4),
  };
}
const q = (env, cookie, qs) => call(env, 'GET', `/api/reports/timesheet?${qs}`, { cookie });

test('API التايم شيت: يرجع البيانات المحسوبة مع الرأس واسم مسؤول الإدارة والمالية', async () => {
  const { env, hr } = await world();
  const r = await q(env, hr.cookie, 'month=2026-10&employees=2');
  assert.equal(r.status, 200);
  assert.equal(r.body.approver, 'Finance Boss');
  const [s] = r.body.sheets;
  assert.equal(s.employee.name, 'Employee A');
  assert.equal(s.employee.supervisor, 'The Director – Director');
  const ts = s.timesheet;
  assert.equal(ts.funders.length, 2);
  assert.equal(ts.funders[0].values[0], 3.25);
  assert.equal(ts.sick.values[3], 7.5, 'الإجازة المرضية من تصحيحات اليوم');
  assert.equal(ts.funders[0].values[29], null, 'يوم بلا حساب فارغ، وحساب شهر سبتمبر لا يدخل');
});

test('API التايم شيت: الصلاحيات — موظف نفسه فقط، مدير مرؤوسوه، الموارد البشرية الكل', async () => {
  const { env, emp, mgr, other, hr } = await world();
  assert.equal((await q(env, emp.cookie, 'month=2026-10&employees=2')).status, 200);
  assert.equal((await q(env, emp.cookie, 'month=2026-10&employees=3')).status, 403);
  assert.equal((await q(env, emp.cookie, 'month=2026-10&employees=2,3')).status, 403, 'طلب مختلط لا يُسرّب جزءاً');
  assert.equal((await q(env, other.cookie, 'month=2026-10&employees=2')).status, 403);
  assert.equal((await q(env, mgr.cookie, 'month=2026-10&employees=2,3')).status, 200);
  assert.equal((await q(env, mgr.cookie, 'month=2026-10&employees=4')).status, 403);
  assert.equal((await q(env, hr.cookie, 'month=2026-10&employees=1,2,3,4')).status, 200);
  assert.equal((await q(env, null, 'month=2026-10&employees=2')).status, 401);
  assert.equal((await q(env, hr.cookie, 'month=2026-10&employees=999')).status, 403, 'غير موجود لا يُفرَّق عن غير مسموح');
});

test('API التايم شيت: مدخلات خاطئة تُرفض', async () => {
  const { env, hr } = await world();
  for (const qs of ['month=2026-13&employees=2', 'month=26-10&employees=2', 'employees=2', 'month=2026-10', 'month=2026-10&employees=a', 'month=2026-10&employees=0', `month=2026-10&employees=${Array.from({ length: 26 }, (_, i) => i + 1).join(',')}`]) {
    assert.equal((await q(env, hr.cookie, qs)).status, 400, qs);
  }
});

test('API التايم شيت: عدد الاستعلامات ثابت وصغير (حدّ D1: 50 لكل طلب)', async () => {
  const { env, hr } = await world();
  const r = await q(env, hr.cookie, 'month=2026-10&employees=1,2,3,4');
  assert.equal(r.status, 200);
  assert.ok(env.DB.queries <= 10, `استعلامات: ${env.DB.queries}`);
});

// ------------------------------------------------------------------ إعداد الساعات لكل فترة (قرار 2 نوفمبر 2026)
import { mergeTimesheetConfig, validateTimesheetConfig, hoursFor } from '../src/engine/timesheet.js';

const close = (a, b) => Math.abs(a - b) < 1e-9;
const cfg = (periods) => mergeTimesheetConfig({ periods });
const withCfg = (days, config, allocations = one) => buildTimesheet({ year: 2026, month: 10, days, allocations, dayHours: 6.5, config });

test('بلا إعداد أو بإعداد افتراضي صريح: النتائج كما كانت (6.5 دوام + 1 طارئة = 7.5)', () => {
  const days = { [OCT(1)]: day('عمل', 6.5), [OCT(5)]: day('عمل', 6.38), [OCT(6)]: day('عمل', 0), [OCT(7)]: day('عطلة رسمية', 0) };
  const plain = build(days);
  const explicit = withCfg(days, cfg([{ from: '', attendanceHours: null, extraHours: 1, extraRow: 'emergency' }]));
  assert.deepEqual(explicit, plain);
  assert.deepEqual(withCfg(days, null), plain);
});

test('فترات مختلفة في الشهر نفسه: الدوام الموزّع والإضافي وصفّه يتبعان فترة كل يوم', () => {
  const config = cfg([
    { from: '', attendanceHours: null, extraHours: 1, extraRow: 'emergency' },
    { from: '2026-10-15', attendanceHours: 7, extraHours: 0.5, extraRow: 'other' },
  ]);
  const t = withCfg({ [OCT(1)]: day('عمل', 6.5), [OCT(18)]: day('عمل', 6.5), [OCT(19)]: day('عمل', 3.25), [OCT(20)]: day('عمل', 0), [OCT(21)]: day('عطلة رسمية', 0) }, config);
  // قبل 15: كما كان
  assert.deepEqual([at(t.funders[0], 1), at(t.emergency, 1), at(t.others, 1), at(t.total, 1)], [6.5, 1, null, 7.5]);
  // بعد 15: دوام كامل يوزّع 7 ساعات، و0.5 في «Others»
  assert.deepEqual([at(t.funders[0], 18), at(t.emergency, 18), at(t.others, 18), at(t.annual, 18), at(t.total, 18)], [7, null, 0.5, null, 7.5]);
  // نصف الدوام (3.25 من 6.5) = 3.5 موزّعة، والنقص 3.5 إجازة سنوية، واليوم يكتمل 7.5
  assert.ok(close(at(t.funders[0], 19), 3.5) && close(at(t.annual, 19), 3.5) && close(at(t.total, 19), 7.5));
  // غياب يوم عمل وعطلة رسمية: يوم كامل بحسب فترته (7 + 0.5)
  assert.equal(at(t.annual, 20), 7.5);
  assert.equal(at(t.official, 21), 7.5);
  assert.equal(t.others.total, 1, 'يومان عملا بعد 15 أكتوبر × 0.5، ومجموع صف أخرى يدخل المجموع العام');
  assert.ok(close(t.total.total, t.funders[0].total + t.annual.total + t.official.total + t.emergency.total + t.others.total));
});

test('المسؤول يحدّد يوم الشيت كما يشاء: دوام 7 + إضافي 1 = 8، أو بلا إضافي', () => {
  const eight = withCfg({ [OCT(1)]: day('عمل', 6.5), [OCT(4)]: day('عطلة رسمية', 0), [OCT(5)]: day('عمل', 0, 'إجازة مرضية') }, cfg([{ from: '', attendanceHours: 7, extraHours: 1, extraRow: 'emergency' }]));
  assert.deepEqual([at(eight.funders[0], 1), at(eight.emergency, 1), at(eight.total, 1)], [7, 1, 8]);
  assert.equal(at(eight.official, 4), 8);
  assert.equal(at(eight.sick, 5), 8);
  const none = withCfg({ [OCT(1)]: day('عمل', 6.5) }, cfg([{ from: '', attendanceHours: null, extraHours: 0, extraRow: 'emergency' }]));
  assert.deepEqual([at(none.funders[0], 1), at(none.emergency, 1), at(none.total, 1)], [6.5, null, 6.5], 'صفر إضافي = لا خلية');
});

test('التوزيع على عدة مشاريع يتبع ساعات الدوام الموزّعة في الفترة', () => {
  const split = [{ funder: 'A', share: 0.5, from: '2026-01-01', to: '2030-12-31' }, { funder: 'B', share: 0.5, from: '2026-01-01', to: '2030-12-31' }];
  const t = withCfg({ [OCT(1)]: day('عمل', 6.5) }, cfg([{ from: '', attendanceHours: 7, extraHours: 0.5, extraRow: 'emergency' }]), split);
  assert.deepEqual([at(t.funders[0], 1), at(t.funders[1], 1)], [3.5, 3.5]);
  assert.equal(t.funders[0].costCenter, 0.5);
});

test('تنقية الإعداد: التاريخ والساعات والتكرار وصف الإضافي، والفترات تُرتَّب', () => {
  const c = cfg([
    { from: '2026-06-01', attendanceHours: 6, extraHours: 2, extraRow: 'other' },
    { from: '', attendanceHours: null, extraHours: 1, extraRow: 'x' },
    { from: '2026-06-01', attendanceHours: 5, extraHours: 1, extraRow: 'emergency' }, // مكرر
    { from: 'غلط', extraHours: 1 },
    { from: '2026-09-01', attendanceHours: 30, extraHours: 1 },
    { from: '2026-09-02', attendanceHours: 20, extraHours: 5 }, // 25 ساعة
  ]);
  assert.deepEqual(c.periods.map((p) => [p.from, p.extraRow]), [['', 'emergency'], ['2026-06-01', 'other']]);
  assert.deepEqual(hoursFor('2026-05-31', c, 6.5), { attendance: 6.5, extra: 1, full: 7.5, extraRow: 'emergency', factor: 1 });
  assert.deepEqual(hoursFor('2026-06-01', c, 6.5).full, 8);
  assert.deepEqual(hoursFor('2026-10-01', null, 6.5).full, 7.5);
});

test('الحفظ من الإعدادات يرفض بدل أن يتجاهل، برسالة تحدد الفترة', () => {
  const bad = (p) => validateTimesheetConfig({ periods: [p] }).error;
  const ok = { from: '2026-01-01', attendanceHours: 6.5, extraHours: 1, extraRow: 'emergency' };
  assert.ok(validateTimesheetConfig({ periods: [ok] }).config);
  assert.match(bad({ ...ok, from: '2026-02-30' }), /تاريخ البداية/);
  assert.match(bad({ ...ok, attendanceHours: -1 }), /ساعات الدوام/);
  assert.match(bad({ ...ok, extraHours: '1' }), /الإضافية/);
  assert.match(bad({ ...ok, extraRow: 'unpaid' }), /صف/);
  assert.match(bad({ ...ok, attendanceHours: 23, extraHours: 2 }), /24/);
  assert.match(validateTimesheetConfig({ periods: [ok, ok] }).error, /مكرر/);
  assert.match(validateTimesheetConfig({}).error, /غير صالحة/);
  assert.deepEqual(validateTimesheetConfig({ periods: [] }).config, { periods: [] }, 'قائمة فارغة = العودة للافتراضي');
});

test('API: إعداد ساعات التايم شيت — الكتابة للمسؤول، وتنعكس في تقرير الشهر، وأربعة مشاريع تُحفظ', async () => {
  const { db, env } = await apiEnv();
  env.__NOW = '2026-11-02T07:00:00Z';
  await seedOrg(db);
  const hr = await login(db, 'hr@nawaculture.org', 'hr', 4);
  const admin = await login(db, 'adm@nawaculture.org', 'admin', null);
  const emp = await login(db, 'e@nawaculture.org', 'employee', 2);
  const body = { config: { periods: [{ from: '', attendanceHours: 7, extraHours: 0.5, extraRow: 'other' }] } };
  assert.equal((await call(env, 'PUT', '/api/settings/timesheet', { cookie: hr.cookie, body })).status, 403);
  assert.equal((await call(env, 'GET', '/api/settings/timesheet', { cookie: emp.cookie })).status, 403);
  assert.equal((await call(env, 'PUT', '/api/settings/timesheet', { cookie: admin.cookie, body: { config: { periods: [{ from: '', extraHours: 99, extraRow: 'other' }] } } })).status, 400);
  const saved = await call(env, 'PUT', '/api/settings/timesheet', { cookie: admin.cookie, body });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const read = await call(env, 'GET', '/api/settings/timesheet', { cookie: hr.cookie });
  assert.deepEqual([read.body.config.periods[0].extraRow, read.body.dayHours, read.body.canEdit], ['other', 6.5, false]);

  // 4 مشاريع للموظف 2 (50 + 25 + 15 + 10)
  const four = [['A', 0.5], ['B', 0.25], ['C', 0.15], ['D', 0.1]].map(([funder, share]) => ({ funder, share, from: '2026-01-01', to: '2026-12-31' }));
  const put = await call(env, 'PUT', '/api/employees/2/projects', { cookie: hr.cookie, body: { allocations: four } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  await db.prepare("INSERT INTO daily_results (employee_id, date, day_type, required_hours, approved_hours, status) VALUES (2, '2026-10-01', 'عمل', 6.5, 6.5, 'حاضر')").run();
  const rep = await call(env, 'GET', '/api/reports/timesheet?month=2026-10&employees=2', { cookie: hr.cookie });
  assert.equal(rep.status, 200, JSON.stringify(rep.body));
  const t = rep.body.sheets[0].timesheet;
  assert.deepEqual(t.funders.map((f) => f.funder), ['A', 'B', 'C', 'D']);
  assert.deepEqual([t.funders[0].values[0], t.others.values[0], t.emergency.values[0], t.total.values[0]], [3.5, 0.5, null, 7.5]);
});
