import { h, clear, dialog, field, select, toast, dash, confirmBox } from '../dom.js';
import { get, post, patch } from '../api.js';

const ROLES = [
  ['employee', 'موظف (يرى نفسه)'],
  ['manager', 'مدير مباشر (يرى فريقه)'],
  ['hr', 'موارد بشرية (يدير الموظفين)'],
  ['director', 'مدير عام (اطلاع كامل)'],
  ['admin', 'مسؤول النظام (كل شيء)'],
];
const ROLE_NAME = Object.fromEntries(ROLES.map(([k, v]) => [k, v.split(' (')[0]]));

export default async function render({ user }) {
  const { employees } = await get('/api/employees');
  const empName = new Map(employees.map((e) => [e.id, `${e.name} (${e.code})`]));
  const body = h('div', { class: 'table-wrap' });

  async function load() {
    const { users } = await get('/api/users');
    clear(body).append(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['الحساب', 'الدور', 'مرتبط بالموظف', 'الحالة', ''].map((t) => h('th', null, t)))),
      h('tbody', null, users.map((u) => h('tr', { class: u.active ? '' : 'row-off' },
        h('td', { dir: 'ltr', class: 'ltr-cell' }, u.email),
        h('td', null, ROLE_NAME[u.role] || u.role, u.medical ? h('span', { class: 'chip chip-present', title: 'يؤكّد الأوراق الطبية' }, 'أوراق طبية') : null),
        h('td', { class: 'muted' }, dash(empName.get(u.employeeId))),
        h('td', null, h('span', { class: `chip ${u.active ? 'chip-present' : 'chip-absent'}` }, u.active ? 'فعّال' : 'موقوف')),
        h('td', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => form(u) }, 'تعديل')))))));
  }

  function form(u) {
    const isNew = !u;
    const email = h('input', { type: 'email', required: true, dir: 'ltr', value: u?.email || '', disabled: !isNew, placeholder: 'name@nawaculture.org' });
    const role = select(ROLES, u?.role || 'employee');
    const emp = select([['', 'بلا ربط'], ...employees.map((e) => [e.id, `${e.name} (${e.code})`])], u?.employeeId ?? '');
    const active = select([['1', 'فعّال'], ['0', 'موقوف']], u ? String(u.active) : '1');
    const medical = h('input', { type: 'checkbox', checked: !!u?.medical });
    const err = h('div', { class: 'notice notice-err', hidden: true, role: 'alert' });
    // مستخدم جديد: اختيار الموظف يملأ بريده المسجّل في بطاقته إن كان الحقل فارغاً (يبقى قابلاً للتعديل)
    if (isNew) {
      const mail = new Map(employees.map((e) => [String(e.id), e.email]));
      emp.addEventListener('change', () => { if (!email.value && mail.get(emp.value)) email.value = mail.get(emp.value); });
    }
    const dlg = dialog({
      title: isNew ? 'مستخدم جديد' : 'تعديل المستخدم',
      content: h('form', { class: 'form-grid', onsubmit: async (e) => {
        e.preventDefault();
        const employeeId = emp.value === '' ? null : Number(emp.value);
        try {
          if (isNew) await post('/api/users', { email: email.value, role: role.value, employeeId, medical: medical.checked });
          else await patch(`/api/users/${u.id}`, { role: role.value, employeeId, active: active.value === '1', medical: medical.checked });
          toast('حُفظ');
          dlg.close();
          load();
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
        }
      } },
      field('البريد المؤسسي', email, 'يجب أن يطابق حساب Microsoft للشخص'),
      field('الدور', role),
      field('الموظف المرتبط', emp, 'يحدد «نفسه» و«فريقه» في الصلاحيات'),
      isNew ? null : field('الحالة', active, 'إيقاف الحساب ينهي جلساته فوراً'),
      h('div', { class: 'span-all' }, h('label', { class: 'check' }, medical, h('span', null, 'يؤكّد الأوراق الطبية للإجازات المرضية'))),
      h('p', { class: 'field-hint span-all' }, 'الإجازة المرضية بلا ورقة طبية تُقبل يوماً واحداً فقط؛ ما زاد عليه تؤكّد الورقةَ الموارد البشرية والمدير العام والمسؤول دائماً، ومن فُوِّض هنا (مثل مديرة الشؤون الإدارية والمالية) فيرى هذه الطلبات ويقرّرها وإن كان دوره «مدير مباشر» أو «موظف».'),
      h('div', { class: 'span-all' }, err),
      isNew ? null : h('div', { class: 'span-all' }, h('button', { type: 'button', class: 'btn btn-danger-ghost', onclick: async () => {
        if (!(await confirmBox(`سيُحذف رقم PIN والأجهزة المتذكَّرة وتُنهى جلسات ${u.email}. يدخل بعدها بحساب Microsoft أو رمز البريد. استعمله إن نسي الموظف PIN أو فقد هاتفه.`, 'إعادة الضبط', true))) return;
        try {
          await post(`/api/users/${u.id}/reset-login`);
          toast('أُعيد ضبط دخول المستخدم');
        } catch (ex) {
          toast(ex.message, 'err');
        }
      } }, 'إعادة ضبط الدخول (PIN والأجهزة)')),
      h('div', { class: 'dlg-actions span-all' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'إلغاء'), h('button', { type: 'submit', class: 'btn btn-primary' }, 'حفظ'))),
    });
  }

  const page = h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', null, h('h1', null, 'المستخدمون'), h('p', { class: 'sub' }, `مسجّل دخولك: ${user.email}. لا يدخل النظام إلا من أُضيف هنا، حتى لو كان له حساب على Microsoft.`)),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => form(null) }, 'مستخدم جديد')),
    body);
  await load();
  return page;
}
