// إدخال حضور متطوع لشهر كامل: صف لكل يوم (الوصول، الانصراف، المغادرة، العودة، السبب) مع حساب الساعات فوراً.
import { h, clear, icon, confirmBox, toast, hrs, AR_DAYS } from '../dom.js';
import { get, put } from '../api.js';
import { timeField } from '../time12.js';
import { monthDays, shiftMonthStr, hoursOf, totalsOf } from '../sheet-lib.js';
import { monthLabel } from './volunteers.js';

export default async function render({ user, params }) {
  const id = Number(params.id);
  let month = params.month;
  const canEdit = ['hr', 'admin'].includes(user.role);
  const data = await get(`/api/volunteers/${id}/month?month=${month}`);
  const byDate = new Map(data.days.map((d) => [d.date, d]));
  let dirty = false;

  const err = h('div', { class: 'notice notice-err', hidden: true });
  const totalBox = h('div', { class: 'sums' });
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', disabled: !canEdit }, 'حفظ الشهر');
  const printLink = h('a', { class: 'btn', href: `#/volunteers/${id}/${month}/print` }, icon('printer'), 'الكشف للطباعة');

  const rows = monthDays(month).map(({ date, dow }) => {
    const cur = byDate.get(date) || {};
    const mark = () => { dirty = true; printLink.classList.add('is-disabled'); refresh(); };
    const f = {
      arrive: timeField({ value: cur.arrive || '', label: `${date} الوصول`, disabled: !canEdit, onchange: mark }),
      depart: timeField({ value: cur.depart || '', label: `${date} الانصراف`, disabled: !canEdit, onchange: mark }),
      exit: timeField({ value: cur.exit || '', label: `${date} المغادرة`, disabled: !canEdit, onchange: mark }),
      ret: timeField({ value: cur.ret || '', label: `${date} العودة`, disabled: !canEdit, onchange: mark }),
    };
    const reason = h('input', { type: 'text', maxlength: 80, value: cur.reason || '', 'aria-label': `${date} السبب`, disabled: !canEdit, oninput: mark });
    const hoursCell = h('td', { class: 'num' });
    const value = () => ({ date, arrive: f.arrive.value || null, depart: f.depart.value || null, exit: f.exit.value || null, ret: f.ret.value || null, reason: reason.value.trim() || null });
    const clearRow = h('button', { type: 'button', class: 'btn btn-sm btn-ghost', disabled: !canEdit, 'aria-label': `مسح يوم ${date}`, onclick: () => {
      for (const k of Object.keys(f)) f[k].value = '';
      reason.value = '';
      mark();
    } }, 'مسح');
    const tr = h('tr', { class: dow === 5 ? 'off' : '' },
      h('td', null, AR_DAYS[dow]),
      h('td', { class: 'num' }, `${Number(date.slice(8))}`),
      h('td', { class: 'w2' }, f.arrive), h('td', { class: 'w2' }, f.depart), h('td', { class: 'w2' }, f.exit), h('td', { class: 'w2' }, f.ret),
      h('td', { class: 'wide' }, reason), hoursCell, h('td', { class: 'row-actions' }, canEdit ? clearRow : null));
    return { tr, value, hoursCell };
  });

  function refresh() {
    const vals = rows.map((r) => r.value());
    rows.forEach((r, i) => {
      const done = vals[i].arrive && vals[i].depart;
      r.hoursCell.textContent = done ? hrs(hoursOf(vals[i])) : '—';
      r.hoursCell.classList.toggle('blank', !done); // في عرض البطاقات على الجوال تُخفى الخانة الفارغة فقط
    });
    const t = totalsOf(vals);
    clear(totalBox).append(
      h('div', { class: 'sum' }, h('b', null, t.days), h('span', null, 'أيام حضور')),
      h('div', { class: 'sum' }, h('b', null, hrs(t.hours)), h('span', null, 'ساعات')));
  }

  async function save() {
    err.hidden = true;
    saveBtn.disabled = true;
    try {
      await put(`/api/volunteers/${id}/month`, { month, days: rows.map((r) => r.value()) });
      dirty = false;
      printLink.classList.remove('is-disabled');
      toast('تم حفظ الشهر');
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
    saveBtn.disabled = !canEdit;
  }
  saveBtn.addEventListener('click', save);
  printLink.addEventListener('click', (e) => { if (dirty) { e.preventDefault(); toast('احفظ الشهر أولاً ثم اطبع الكشف', 'err'); } });

  async function jump(delta) {
    if (dirty && !(await confirmBox('فيه تعديلات لم تُحفظ. هل تتركها وتنتقل؟', 'انتقل بلا حفظ', true))) return;
    location.hash = `#/volunteers/${id}/${shiftMonthStr(month, delta)}`;
  }

  const table = h('table', { class: 'tbl vol-edit' },
    h('thead', null, h('tr', null, ['اليوم', 'التاريخ', 'ساعة الوصول', 'ساعة الانصراف', 'ساعة المغادرة', 'ساعة العودة', 'السبب', 'الساعات', ''].map((x, i) => h('th', { class: i === 1 || i === 7 ? 'num' : '' }, x)))),
    h('tbody', null, rows.map((r) => r.tr)));

  const page = h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', null, h('a', { href: '#/volunteers', class: 'back' }, 'كل المتطوعين'), h('h1', null, data.volunteer.name),
        h('p', { class: 'sub' }, [data.volunteer.center, data.volunteer.project].filter(Boolean).join(' — ') || 'حضور شهري')),
      h('div', { class: 'date-nav' },
        h('button', { type: 'button', class: 'btn', onclick: () => jump(-1) }, 'الشهر السابق'),
        h('strong', { class: 'month-label' }, monthLabel(month)),
        h('button', { type: 'button', class: 'btn', onclick: () => jump(1) }, 'الشهر التالي'))),
    canEdit ? null : h('div', { class: 'notice' }, 'عرض فقط: إدخال حضور المتطوعين للموارد البشرية.'),
    totalBox, err,
    h('div', { class: 'table-wrap' }, table),
    h('div', { class: 'row-actions sticky-actions' }, saveBtn, printLink));
  refresh();
  return page;
}
