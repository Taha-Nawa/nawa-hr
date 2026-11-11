import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeOrg } from '../src/engine/org.js';

const E = (id, name, managerId, o = {}) => ({ id, code: `NW-${id}`, name, managerId, centerId: 1, center: 'م1', status: 'active', email: `${name}@x.org`, ...o });
const U = (employeeId, role = 'employee', active = 1) => ({ employeeId, email: `u${employeeId}@x.org`, role, active });
const ids = (r, check) => r.checks.find((c) => c.id === check)?.items.map((i) => i.id).sort((a, b) => a - b);

// 1 مديرة عامة ← 2 مدير (3، 4 مرؤوسان)، 5 مدير آخر (بلا مرؤوسين)
const base = () => ({
  employees: [E(1, 'عليا', null), E(2, 'مدير أ', 1), E(3, 'موظف ب', 2), E(4, 'موظف ج', 2), E(5, 'موظف د', 1)],
  users: [U(1, 'director'), U(2, 'manager'), U(3), U(4), U(5)],
  centers: [{ id: 1, name: 'م1', active: 1 }],
});

test('هيكل سليم: المستويات ونطاق الإشراف وحجم الفريق، ولا ملاحظات، والدرجة 100', () => {
  const r = analyzeOrg(base());
  assert.equal(r.score, 100);
  assert.equal(r.grade, 'ممتاز');
  assert.deepEqual(r.roots, [1]);
  const n = Object.fromEntries(r.nodes.map((x) => [x.id, x]));
  assert.deepEqual([n[1].depth, n[2].depth, n[3].depth], [0, 1, 2]);
  assert.deepEqual([n[1].reports, n[1].team, n[2].reports, n[3].reports], [2, 4, 2, 0]);
  assert.deepEqual(r.stats, { active: 5, inactive: 0, levels: 3, managers: 2, avgSpan: 2, maxSpan: 2, centers: 1, withAccount: 5, flagged: 0 });
  assert.deepEqual(r.checks, []);
});

test('مدير خرج من الخدمة: مرؤوسوه ملاحظة عالية ويصيرون قمماً وتنخفض الدرجة', () => {
  const d = base();
  d.employees[1].status = 'inactive';
  const r = analyzeOrg(d);
  assert.deepEqual(ids(r, 'manager_inactive'), [3, 4]);
  assert.equal(r.nodes.find((x) => x.id === 3).parent, null);
  assert.equal(r.score, 50); // الفعّالون 4 (1،3،4،5) والمتأثرون 2 (3،4)
});

test('حلقة وذاتية ومدير غير موجود', () => {
  const d = base();
  d.employees[0].managerId = 5; // 1 ← 5 ← 1 (حلقة)
  d.employees.push(E(6, 'ذاتي', 6), E(7, 'يتيم', 99));
  d.users.push(U(6), U(7));
  const r = analyzeOrg(d);
  assert.deepEqual(ids(r, 'cycle'), [1, 5]);
  assert.deepEqual(ids(r, 'self'), [6]);
  assert.deepEqual(ids(r, 'manager_gone'), [7]);
  assert.ok(r.score < 100);
  // الرسم لا يدور: كل عقدة لها عمق
  assert.ok(r.nodes.filter((x) => x.depth === null).length === 0);
});

test('أكثر من قمة: تُعرض الزائدة وتُستثنى صاحبة أكبر فريق', () => {
  const d = base();
  d.employees.push(E(8, 'قمة ثانية', null));
  d.users.push(U(8));
  const r = analyzeOrg(d);
  assert.deepEqual(ids(r, 'multi_root'), [8]);
});

test('الحسابات: مدير بلا اعتماد، وموظف بلا حساب (مع/بلا بريد)', () => {
  const d = base();
  d.users = d.users.filter((u) => u.employeeId !== 2 && u.employeeId !== 5); // مدير بلا حساب + موظف بلا حساب
  d.employees[4].email = null;
  const r = analyzeOrg(d);
  assert.deepEqual(ids(r, 'manager_no_approver'), [2]);
  assert.deepEqual(ids(r, 'no_account'), [2, 5]);
  assert.equal(r.checks.find((c) => c.id === 'no_account').items.find((i) => i.id === 5).detail, 'بلا بريد في بياناته');
  // مدير بحساب بدور موظف لا يعتمد
  const d2 = base();
  d2.users[1].role = 'employee';
  assert.deepEqual(ids(analyzeOrg(d2), 'manager_no_approver'), [2]);
});

test('منتهي الخدمة بحساب أو بطاقة فعّالة = ملاحظة عالية؛ وبعد الإغلاق تزول', () => {
  const d = base();
  d.employees[4].status = 'inactive';
  d.badges = [{ employeeId: 5, status: 'active' }];
  let r = analyzeOrg(d);
  assert.deepEqual(ids(r, 'departed_access'), [5]);
  assert.equal(r.checks.find((c) => c.id === 'departed_access').items[0].detail, 'حساب فعّال + بطاقة فعّالة');
  d.users[4].active = 0;
  d.badges[0].status = 'revoked';
  r = analyzeOrg(d);
  assert.equal(ids(r, 'departed_access'), undefined);
});

test('نطاق واسع وعمق وبلا مركز ومركز بلا مشرف ومركز فارغ ومدير من مركز آخر', () => {
  const emps = [E(1, 'قمة', null)];
  for (let i = 2; i <= 13; i += 1) emps.push(E(i, `م${i}`, 1)); // 12 مرؤوساً مباشراً
  emps[2].centerId = null; // بلا مركز
  emps[3].centerId = 2; emps[3].center = 'م2'; // مديره من مركز آخر
  const users = emps.map((e) => U(e.id, e.id === 1 ? 'director' : 'employee'));
  const r = analyzeOrg({ employees: emps, users, centers: [{ id: 1, name: 'م1', active: 1 }, { id: 2, name: 'م2', active: 1 }, { id: 3, name: 'فارغ', active: 1 }] });
  assert.deepEqual(ids(r, 'wide_span'), [1]);
  assert.deepEqual(ids(r, 'no_center'), [3]);
  assert.deepEqual(ids(r, 'cross_center'), [4]);
  assert.equal(r.checks.find((c) => c.id === 'center_empty').items[0].name, 'فارغ');
  // سلسلة عميقة
  const chain = Array.from({ length: 7 }, (_, i) => E(i + 1, `س${i + 1}`, i ? i : null));
  const deep = analyzeOrg({ employees: chain, users: chain.map((e) => U(e.id, 'manager')), centers: [{ id: 1, name: 'م1', active: 1 }] });
  assert.equal(deep.stats.levels, 7);
  assert.deepEqual(ids(deep, 'deep'), [6, 7]);
});

test('بلا موظفين: لا انهيار', () => {
  const r = analyzeOrg({});
  assert.deepEqual([r.score, r.stats.active, r.roots.length, r.checks.length], [100, 0, 0, 0]);
});
