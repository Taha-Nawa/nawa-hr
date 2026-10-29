import { h, clear, dialog, field, select, toast, dash } from '../dom.js';
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
        h('td', null, ROLE_NAME[u.role] || u.role),
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
    const err = h('div', { class: 'notice notice-err', hidden: true, role: 'alert' });
    const dlg = dialog({
      title: isNew ? 'مستخدم جديد' : 'تعديل المستخدم',
      content: h('form', { class: 'form-grid', onsubmit: async (e) => {
        e.preventDefault();
        const employeeId = emp.value === '' ? null : Number(emp.value);
        try {
          if (isNew) await post('/api/users', { email: email.value, role: role.value, employeeId });
          else await patch(`/api/users/${u.id}`, { role: role.value, employeeId, active: active.value === '1' });
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
      h('div', { class: 'span-all' }, err),
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
