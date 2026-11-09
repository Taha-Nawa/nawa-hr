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
  let existing = [];

  async function load() {
    const { users } = await get('/api/users');
    existing = users;
    const admins = users.filter((u) => u.role === 'admin' && u.active).length;
    clear(body).append(
      admins < 2 ? h('div', { class: 'notice notice-warn' }, `يوجد ${admins === 1 ? 'مسؤول نظام فعّال واحد' : 'لا مسؤول نظام فعّال'} فقط. أضف مسؤولاً ثانياً (زر «مستخدم جديد» ثم الدور «مسؤول النظام») حتى لا يتوقف النظام إن فُقد هذا الحساب.`) : null,
      h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['الحساب', 'الدور', 'مرتبط بالموظف', 'الحالة', ''].map((t) => h('th', null, t)))),
      h('tbody', null, users.map((u) => h('tr', { class: u.active ? '' : 'row-off' },
        h('td', { dir: 'ltr', class: 'ltr-cell' }, u.email),
        h('td', null, ROLE_NAME[u.role] || u.role, u.medical ? h('span', { class: 'chip chip-present', title: 'يؤكّد الأوراق الطبية' }, 'أوراق طبية') : null),
        h('td', { class: 'muted' }, dash(empName.get(u.employeeId))),
        h('td', null, h('span', { class: `chip ${u.active ? 'chip-present' : 'chip-absent'}` }, u.active ? 'فعّال' : 'موقوف')),
        h('td', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => form(u) }, 'تعديل')))))));
  }

  // إنشاء حسابات لعدد من الموظفين دفعة واحدة (الدور: موظف أو مدير مباشر؛ البريد من بطاقة الموظف)
  async function bulkDialog() {
    const { candidates } = await get('/api/users/candidates');
    if (!candidates.length) { toast('كل الموظفين الفعّالين لهم حسابات'); return; }
    const WHY = { no_email: 'لا بريد في بطاقته', bad_email: 'بريده غير صالح', email_taken: 'بريده مستعمل في حساب آخر' };
    const rows = candidates.map((c) => {
      const box = h('input', { type: 'checkbox', checked: !c.blocked, disabled: !!c.blocked, 'aria-label': c.name });
      const role = select([['employee', 'موظف'], ['manager', 'مدير مباشر']], c.suggestedRole, { disabled: !!c.blocked, 'aria-label': `دور ${c.name}` });
      return { c, box, role, tr: h('tr', { class: c.blocked ? 'row-off' : '' },
        h('td', null, box), h('td', null, c.name, h('span', { class: 'muted' }, ` · ${c.code}`)),
        h('td', { class: 'muted' }, dash(c.center)),
        h('td', { dir: 'ltr', class: 'ltr-cell' }, c.email || h('span', { class: 'muted' }, WHY.no_email)),
        h('td', null, c.blocked ? h('span', { class: 'chip chip-absent' }, WHY[c.blocked]) : role)) };
    });
    const ready = rows.filter((r) => !r.c.blocked);
    const all = h('input', { type: 'checkbox', checked: true, 'aria-label': 'تحديد الكل', onchange: (e) => { ready.forEach((r) => { r.box.checked = e.target.checked; }); count(); } });
    const countEl = h('b', null);
    const count = () => { countEl.textContent = String(ready.filter((r) => r.box.checked).length); };
    ready.forEach((r) => r.box.addEventListener('change', count));
    count();
    const err = h('div', { class: 'notice notice-err', hidden: true, role: 'alert' });
    const dlg = dialog({
      title: 'إنشاء حسابات للموظفين',
      content: h('div', null,
        h('p', { class: 'muted small' }, 'تُنشأ الحسابات بالبريد المسجّل في بطاقة كل موظف، فيدخل بحساب Microsoft نفسه. يُرشَّح «مدير مباشر» لمن له مرؤوسون. الأدوار الأعلى (موارد بشرية، مدير عام، مسؤول) تُمنح فردياً من «مستخدم جديد».'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, h('th', null, all), ['الموظف', 'المركز', 'البريد', 'الدور'].map((t) => h('th', null, t)))),
          h('tbody', null, rows.map((r) => r.tr)))),
        err,
        h('div', { class: 'dlg-actions' },
          h('span', { class: 'muted' }, 'المحدَّد: ', countEl),
          h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'إلغاء'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: async (e) => {
            const items = ready.filter((r) => r.box.checked).map((r) => ({ employeeId: r.c.id, role: r.role.value }));
            if (!items.length) { err.textContent = 'اختر موظفاً واحداً على الأقل'; err.hidden = false; return; }
            e.target.disabled = true;
            try {
              const res = await post('/api/users/bulk', { items });
              toast(`أُنشئ ${res.created} حساباً${res.skipped.length ? ` وتُخطّي ${res.skipped.length}` : ''}`);
              dlg.close();
              load();
            } catch (ex) {
              err.textContent = ex.message;
              err.hidden = false;
              e.target.disabled = false;
            }
          } }, 'إنشاء الحسابات المحدَّدة'))),
    });
  }

  function form(u) {
    const isNew = !u;
    // النطاق المؤسسي يُستنتج من بريد من يضيف المستخدم؛ الاقتراح يكمل الاسم بالنطاق، وإن اكتفى المدير بالاسم يُكمَّل عند الحفظ
    const domain = (user.email.split('@')[1] || 'nawaculture.org').toLowerCase();
    const listId = `mail-sug-${Math.random().toString(36).slice(2, 7)}`;
    const sug = h('datalist', { id: listId });
    const email = h('input', { type: 'text', inputmode: 'email', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', list: isNew ? listId : null, required: true, dir: 'ltr', value: u?.email || '', disabled: !isNew, placeholder: `name@${domain}` });
    const fullMail = (v) => { const t = v.trim().toLowerCase(); return t && !t.includes('@') ? `${t}@${domain}` : t; };
    if (isNew) {
      // الاقتراحات من بريد الموظفين المسجّل في بطاقاتهم (من لا حساب له بعد)، ثم إكمال الاسم بالنطاق
      const taken = new Set(existing.map((x) => x.email.toLowerCase()));
      email.addEventListener('input', () => {
        const t = email.value.trim().toLowerCase();
        clear(sug);
        if (!t) return;
        const hits = employees.filter((e) => e.email && !taken.has(e.email.toLowerCase()) && (e.email.toLowerCase().includes(t) || e.name.includes(t))).slice(0, 8);
        for (const e of hits) sug.append(h('option', { value: e.email.toLowerCase(), label: e.name }));
        if (!t.includes('@') && !hits.some((e) => e.email.toLowerCase() === `${t}@${domain}`)) sug.append(h('option', { value: `${t}@${domain}` }));
      });
    }
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
          if (isNew) await post('/api/users', { email: fullMail(email.value), role: role.value, employeeId, medical: medical.checked });
          else await patch(`/api/users/${u.id}`, { role: role.value, employeeId, active: active.value === '1', medical: medical.checked });
          toast('حُفظ');
          dlg.close();
          load();
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
        }
      } },
      field('البريد المؤسسي', email, `اكتب الاسم فقط (مثل salem) ويُكمَّل بـ @${domain}؛ ويجب أن يطابق حساب Microsoft للشخص`),
      sug,
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
      h('div', { class: 'page-actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => bulkDialog().catch((ex) => toast(ex.message, 'err')) }, 'حسابات للموظفين (دفعة)'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => form(null) }, 'مستخدم جديد'))),
    body);
  await load();
  return page;
}
