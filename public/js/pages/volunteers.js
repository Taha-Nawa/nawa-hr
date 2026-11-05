// المتطوعون: قائمة لكل مركز، وإجمالي أيام وساعات الشهر. الإدخال والطباعة من صفحة الشهر.
import { h, clear, dialog, field, select, toast, icon, todayLocal, AR_MONTHS } from '../dom.js';
import { get, post, patch } from '../api.js';
import { shiftMonthStr } from '../sheet-lib.js';

export const monthLabel = (m) => `${AR_MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const fmtHours = (n) => (n ? String(Math.round(n * 100) / 100) : '—');

function volunteerDialog({ v, centers, onDone }) {
  const name = h('input', { type: 'text', maxlength: 120, required: true, value: v?.name || '', autocomplete: 'off' });
  const center = select([['', 'بلا مركز'], ...centers.map((c) => [String(c.id), c.name])], v?.centerId ?? '');
  const project = h('input', { type: 'text', maxlength: 120, value: v?.project || '', placeholder: 'اسم المشروع (يظهر في الكشف)' });
  const coordinator = h('input', { type: 'text', maxlength: 120, value: v?.coordinator || '', placeholder: 'منسق المشروع (يظهر في الكشف)' });
  const phone = h('input', { type: 'tel', maxlength: 40, value: v?.phone || '', dir: 'ltr' });
  const active = h('input', { type: 'checkbox', checked: v ? !!v.active : true });
  const err = h('div', { class: 'notice notice-err', hidden: true });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, v ? 'حفظ' : 'إضافة المتطوع');
  const form = h('form', { class: 'form-grid', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (!name.value.trim()) { err.textContent = 'اكتب اسم المتطوع'; err.hidden = false; return; }
    submit.disabled = true;
    const body = { name: name.value, centerId: center.value === '' ? null : Number(center.value), project: project.value, coordinator: coordinator.value, phone: phone.value, ...(v ? { active: active.checked } : {}) };
    try {
      if (v) await patch(`/api/volunteers/${v.id}`, body); else await post('/api/volunteers', body);
      dlg.close();
      toast(v ? 'تم الحفظ' : 'أُضيف المتطوع');
      onDone();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      submit.disabled = false;
    }
  } },
  h('div', { class: 'span-all' }, field('الاسم', name)),
  field('المركز', center), field('الهاتف', phone),
  field('المشروع', project), field('منسق المشروع', coordinator),
  v ? h('label', { class: 'check-inline span-all' }, active, 'نشط (يظهر في القوائم)') : null,
  h('div', { class: 'span-all' }, err),
  h('div', { class: 'dlg-actions span-all' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'إلغاء'), submit));
  const dlg = dialog({ title: v ? `تعديل ${v.name}` : 'متطوع جديد', content: form, wide: true });
}

export default async function render() {
  let month = todayLocal().slice(0, 7);
  let data = { volunteers: [], canEdit: false };
  let centers = [];
  let center = '';
  let q = '';
  let showInactive = false;
  try {
    centers = (await get('/api/centers')).centers.filter((c) => c.active);
  } catch {
    /* اختيارية */
  }

  const head = h('header', { class: 'page-head' });
  const tools = h('div', { class: 'tools' });
  const box = h('div', { class: 'table-wrap' });

  const visible = () => data.volunteers.filter((v) => (showInactive || v.active) && (!center || String(v.centerId) === center) && (!q || v.name.includes(q)));

  function drawHead() {
    head.replaceChildren(
      h('div', null, h('h1', null, 'المتطوعون'), h('p', { class: 'sub' }, `حضور ${monthLabel(month)} — أدخل أوقات كل متطوع واطبع كشفه الشهري`)),
      h('div', { class: 'date-nav' },
        h('button', { type: 'button', class: 'btn', onclick: () => go(shiftMonthStr(month, -1)) }, 'الشهر السابق'),
        h('strong', { class: 'month-label' }, monthLabel(month)),
        h('button', { type: 'button', class: 'btn', onclick: () => go(shiftMonthStr(month, 1)) }, 'الشهر التالي'),
        data.canEdit ? h('button', { type: 'button', class: 'btn btn-primary', onclick: () => volunteerDialog({ centers, onDone: () => go(month) }) }, icon('plus'), 'متطوع جديد') : null));
  }

  function drawTools() {
    tools.replaceChildren(
      h('input', { type: 'search', class: 'search', placeholder: 'بحث بالاسم', 'aria-label': 'بحث', value: q, oninput: (e) => { q = e.target.value.trim(); drawTable(); } }),
      h('select', { 'aria-label': 'المركز', onchange: (e) => { center = e.target.value; drawTable(); } }, h('option', { value: '' }, 'كل المراكز'), centers.map((c) => h('option', { value: c.id }, c.name))),
      h('label', { class: 'check-inline' }, h('input', { type: 'checkbox', checked: showInactive, onchange: (e) => { showInactive = e.target.checked; drawTable(); } }), 'إظهار غير النشطين'));
  }

  function drawTable() {
    clear(box);
    const list = visible();
    if (!list.length) { box.append(h('p', { class: 'empty' }, data.volunteers.length ? 'لا نتائج مطابقة.' : 'لا متطوعين بعد. أضف أول متطوع.')); return; }
    box.append(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['المتطوع', 'المركز', 'المشروع', 'أيام الشهر', 'ساعات الشهر', ''].map((x, i) => h('th', { class: i === 3 || i === 4 ? 'num' : '' }, x)))),
      h('tbody', null, list.map((v) => h('tr', { class: v.active ? '' : 'is-inactive' },
        h('td', null, h('strong', null, v.name), v.active ? null : h('span', { class: 'chip chip-none' }, 'غير نشط'), v.phone ? h('div', { class: 'code', dir: 'ltr' }, v.phone) : null),
        h('td', null, v.center || '—'),
        h('td', null, v.project || '—', v.coordinator ? h('div', { class: 'code' }, `المنسق: ${v.coordinator}`) : null),
        h('td', { class: 'num' }, v.month?.days || '—'),
        h('td', { class: 'num' }, fmtHours(v.month?.hours)),
        h('td', { class: 'row-actions' },
          data.canEdit ? h('a', { class: 'btn btn-sm btn-primary', href: `#/volunteers/${v.id}/${month}` }, 'إدخال الحضور') : null,
          h('a', { class: 'btn btn-sm', href: `#/volunteers/${v.id}/${month}/print` }, icon('printer'), 'الكشف'),
          data.canEdit ? h('a', { class: 'btn btn-sm', href: `#/volunteers/${v.id}/card` }, icon('qr'), 'البطاقة') : null,
          data.canEdit ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => volunteerDialog({ v, centers, onDone: () => go(month) }) }, 'تعديل') : null))))));
  }

  async function go(m) {
    month = m;
    drawHead();
    clear(box).append(h('p', { class: 'loading' }, 'جارٍ التحميل…'));
    try {
      data = await get(`/api/volunteers?month=${month}`);
    } catch (e) {
      clear(box).append(h('div', { class: 'notice notice-err' }, e.message));
      return;
    }
    drawHead();
    drawTools();
    drawTable();
  }

  const page = h('div', { class: 'page' }, head, tools, box);
  await go(month);
  return page;
}
