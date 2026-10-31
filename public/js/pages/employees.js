import { h, clear, dialog, field, select, toast, dash } from '../dom.js';
import { get, post, patch } from '../api.js';

const CAN_EDIT = ['hr', 'admin'];

/** نموذج إضافة/تعديل موظف. emp = null للإضافة. onSaved يُستدعى بعد النجاح. */
export async function employeeForm({ emp, onSaved }) {
  const [{ centers }, { employees }] = await Promise.all([get('/api/centers'), get('/api/employees')]);
  const isNew = !emp;
  const v = emp || {};
  const f = {
    code: h('input', { name: 'code', value: v.code || '', required: true, disabled: !isNew, dir: 'ltr', autocomplete: 'off', placeholder: 'NW-014' }),
    name: h('input', { name: 'name', value: v.name || '', required: true }),
    email: h('input', { name: 'email', type: 'email', value: v.email || '', dir: 'ltr', placeholder: 'name@nawaculture.org' }),
    center: select([['', 'بلا مركز'], ...centers.map((c) => [c.id, c.name])], v.centerId),
    manager: select([['', 'بلا مدير مباشر'], ...employees.filter((e) => e.id !== v.id && e.status === 'active').map((e) => [e.id, `${e.name} (${e.code})`])], v.managerId),
    jobTitle: h('input', { value: v.jobTitle || '' }),
    department: h('input', { value: v.department || '' }),
    contractType: h('input', { value: v.contractType || '', placeholder: 'عقد كامل / جزئي …' }),
    project: h('input', { value: v.project || '' }),
    nameEn: h('input', { value: v.nameEn || '', dir: 'ltr', lang: 'en' }),
    jobTitleEn: h('input', { value: v.jobTitleEn || '', dir: 'ltr', lang: 'en' }),
    departmentEn: h('input', { value: v.departmentEn || '', dir: 'ltr', lang: 'en' }),
    managerLabelEn: h('input', { value: v.managerLabelEn || '', dir: 'ltr', lang: 'en', placeholder: 'Manager name – Title' }),
    startDate: h('input', { type: 'date', value: v.startDate || '' }),
    endDate: h('input', { type: 'date', value: v.endDate || '' }),
    status: select([['active', 'على رأس العمل'], ['inactive', 'متوقف']], v.status || 'active'),
    card: h('input', { value: '', dir: 'ltr', placeholder: 'NW-014-A', autocomplete: 'off' }),
  };
  const err = h('div', { class: 'notice notice-err', hidden: true, role: 'alert' });

  const form = h('form', { class: 'form-grid', onsubmit: async (e) => {
    e.preventDefault();
    err.hidden = true;
    const idOrNull = (el) => (el.value === '' ? null : Number(el.value));
    const common = {
      name: f.name.value, email: f.email.value || null, centerId: idOrNull(f.center), managerId: idOrNull(f.manager),
      jobTitle: f.jobTitle.value || null, department: f.department.value || null, contractType: f.contractType.value || null,
      project: f.project.value || null, startDate: f.startDate.value || null,
      nameEn: f.nameEn.value || null, jobTitleEn: f.jobTitleEn.value || null, departmentEn: f.departmentEn.value || null, managerLabelEn: f.managerLabelEn.value || null,
    };
    try {
      if (isNew) await post('/api/employees', { ...common, code: f.code.value, card: f.card.value || undefined });
      else await patch(`/api/employees/${emp.id}`, { ...common, endDate: f.endDate.value || null, status: f.status.value });
      toast(isNew ? 'أُضيف الموظف' : 'حُفظت التعديلات');
      dlg.close();
      onSaved?.();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  } },
  field('كود الموظف', f.code, isNew ? 'لا يتكرر ولا يُعاد استخدامه' : null),
  field('الاسم', f.name),
  field('البريد المؤسسي', f.email),
  field('المركز', f.center),
  field('المسمى الوظيفي', f.jobTitle),
  field('القسم', f.department),
  field('المدير المباشر', f.manager),
  field('نوع التعاقد', f.contractType),
  field('المشروع / الممول', f.project),
  field('تاريخ التعيين', f.startDate),
  field('الاسم بالإنجليزية', f.nameEn),
  field('المسمى بالإنجليزية', f.jobTitleEn),
  field('القسم بالإنجليزية', f.departmentEn),
  field('المدير المباشر بالإنجليزية', f.managerLabelEn),
  isNew ? field('البطاقة (اختياري)', f.card, 'محتوى رمز البطاقة، مثل NW-014-A') : field('تاريخ انتهاء الخدمة', f.endDate),
  isNew ? null : field('الحالة', f.status),
  h('div', { class: 'span-all' }, err),
  h('div', { class: 'dlg-actions span-all' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'إلغاء'), h('button', { type: 'submit', class: 'btn btn-primary' }, isNew ? 'إضافة الموظف' : 'حفظ التعديلات')));

  const dlg = dialog({ title: isNew ? 'موظف جديد' : `تعديل: ${emp.name}`, content: form, wide: true });
  return dlg;
}

export default async function render({ user }) {
  const canEdit = CAN_EDIT.includes(user.role);
  let employees = (await get('/api/employees')).employees;
  let q = '';
  let showInactive = false;

  const body = h('div', { class: 'table-wrap' });
  const count = h('p', { class: 'sub' });

  const reload = async () => {
    employees = (await get('/api/employees')).employees;
    draw();
  };

  function draw() {
    const list = employees.filter((e) => (showInactive || e.status === 'active') && (!q || `${e.name} ${e.code} ${e.email || ''} ${e.department || ''}`.includes(q)));
    count.textContent = `${list.length} من ${employees.length}`;
    clear(body);
    if (!employees.length) {
      body.append(h('p', { class: 'empty' }, canEdit ? 'لا موظفين بعد. أضف أول موظف أو استورد ملف إكسل الحالي.' : 'لا موظفين ضمن صلاحياتك.'));
      return;
    }
    if (!list.length) {
      body.append(h('p', { class: 'empty' }, 'لا نتائج مطابقة.'));
      return;
    }
    body.append(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['الموظف', 'المسمى والقسم', 'المركز', 'التعاقد', 'التعيين', canEdit ? '' : null].map((t) => (t === null ? null : h('th', null, t))))),
      h('tbody', null, list.map((e) => h('tr', { class: e.status === 'active' ? '' : 'row-off' },
        h('td', null, h('a', { class: 'emp-link', href: `#/employees/${e.id}` }, e.name), h('div', { class: 'code' }, e.code, e.status === 'active' ? '' : ' · متوقف')),
        h('td', null, dash(e.jobTitle), e.department ? h('div', { class: 'muted small' }, e.department) : null),
        h('td', { class: 'muted' }, dash(e.center)),
        h('td', { class: 'muted' }, dash(e.contractType)),
        h('td', { class: 'num muted' }, dash(e.startDate)),
        canEdit ? h('td', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => employeeForm({ emp: e, onSaved: reload }) }, 'تعديل')) : null)))));
  }

  const page = h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', null, h('h1', null, user.role === 'employee' ? 'بياناتي' : 'الموظفون'), count),
      canEdit ? h('button', { type: 'button', class: 'btn btn-primary', onclick: () => employeeForm({ emp: null, onSaved: reload }) }, 'موظف جديد') : null),
    h('div', { class: 'tools' },
      h('input', { type: 'search', class: 'search', placeholder: 'بحث بالاسم أو الكود أو القسم', 'aria-label': 'بحث', oninput: (e) => { q = e.target.value.trim(); draw(); } }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { showInactive = e.target.checked; draw(); } }), 'إظهار المتوقفين')),
    body);
  draw();
  return page;
}
