// متابعة المسؤول لسجلات فريقه اليومية (المشاركة فقط، في خطّه من الشجرة الإدارية): يضيف ملاحظات تعود للموظف ثم يعتمد تعديله.
import { h, clear, toast, icon, todayLocal, longDate } from '../dom.js';
import { get, post } from '../api.js';
import { monthLabel, shiftMonthStr, dmy } from '../monthly-report-lib.js';
import { KIND_META, countKinds, groupByDay } from '../work-log-lib.js';

const NOTE_STATUS = { open: ['بانتظار تعديل الموظف', 'chip-late'], addressed: ['تم التعديل / ردّ الموظف', 'chip-present'], closed: ['اعتُمد', 'chip-off'] };

export default async function render({ user }) {
  const today = todayLocal();
  let month = today.slice(0, 7);
  let who = null; // موظف واحد أو الكل
  let data = { members: [], entries: [] };
  const list = h('div', { class: 'wl-list' });
  const chips = h('div', { class: 'wlt-members', role: 'group', 'aria-label': 'الموظفون' });
  const title = h('p', { class: 'sub' });
  const nav = h('div', { class: 'date-nav' });

  if (user.employeeId == null) return h('div', { class: 'page' }, h('div', { class: 'notice notice-warn' }, 'حسابك غير مرتبط ببطاقة موظف.'));

  async function act(fn, ok) {
    try { await fn(); if (ok) toast(ok); await load(); } catch (e) { toast(e.message, 'err'); }
  }

  function noteForm(e) {
    const input = h('input', { maxlength: '500', placeholder: 'ملاحظتك للموظف…', 'aria-label': 'ملاحظة' });
    return h('form', { class: 'wlt-note-form', onsubmit: (ev) => { ev.preventDefault(); if (input.value.trim()) act(() => post(`/api/work-log/${e.id}/notes`, { note: input.value }), 'أُرسلت الملاحظة للموظف'); } },
      input, h('button', { type: 'submit', class: 'btn btn-sm' }, 'إرسال'));
  }

  function noteBox(n) {
    const [label, cls] = NOTE_STATUS[n.status] || [n.status, 'chip-off'];
    return h('div', { class: `wl-note wl-note-${n.status}` },
      h('p', { class: 'wl-note-head' }, h('strong', null, n.author), h('span', { class: `chip ${cls}` }, label)),
      h('p', { class: 'wl-note-text' }, n.note),
      n.reply ? h('p', { class: 'muted small' }, `ردّ الموظف: ${n.reply}`) : null,
      n.status !== 'closed' ? h('div', { class: 'wl-note-actions' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => act(() => post(`/api/work-log-notes/${n.id}/close`), 'اعتُمدت الملاحظة') }, n.status === 'addressed' ? 'اعتماد التعديل' : 'سحب الملاحظة')) : null);
  }

  function meta(e) {
    const bits = [];
    if (e.kind === 'done' && e.status) bits.push(h('span', { class: 'chip chip-off' }, e.status));
    if (e.place) bits.push(h('span', null, `المكان: ${e.place}`));
    if (e.kind === 'todo') { if (e.importance) bits.push(h('span', null, `الأهمية: ${e.importance}`)); bits.push(h('span', null, e.endDate ? `من ${dmy(e.date)} إلى ${dmy(e.endDate)}` : `يبدأ ${dmy(e.date)}`)); }
    return bits;
  }

  function draw() {
    clear(chips).append(
      h('button', { type: 'button', class: `btn btn-sm wlt-member${who === null ? ' on' : ''}`, onclick: () => { who = null; draw(); } }, 'الكل'),
      ...data.members.map((m) => h('button', { type: 'button', class: `btn btn-sm wlt-member${who === m.id ? ' on' : ''}`, onclick: () => { who = m.id; draw(); } },
        m.name, h('span', { class: 'wlt-count' }, `${m.entries}${m.toReview ? ` · ${m.toReview} للاعتماد` : ''}`))));
    clear(list);
    const shown = data.members.filter((m) => who === null || m.id === who);
    let any = false;
    for (const m of shown) {
      const mine = data.entries.filter((e) => e.employeeId === m.id);
      if (!mine.length) continue;
      any = true;
      const n = countKinds(mine);
      list.append(h('section', { class: 'panel' },
        h('h2', { class: 'wlt-person' }, m.name, h('span', { class: 'muted small' }, [m.jobTitle, m.department].filter(Boolean).join(' · '))),
        h('p', { class: 'muted small' }, `${n.done} إنجاز · ${n.meeting} اجتماع · ${n.training} تدريب/نشاط · ${n.todo} مهمة قادمة`),
        ...groupByDay(mine).map((day) => h('div', { class: 'wl-day' },
          h('h3', { class: 'wl-day-head' }, longDate(day.date)),
          h('ul', { class: 'plain wl-items' }, day.items.map((e) => h('li', { class: 'wl-item' },
            h('span', { class: `chip ${KIND_META[e.kind].chip}` }, KIND_META[e.kind].label),
            h('div', { class: 'wl-body' },
              h('p', { class: 'wl-text' }, e.title),
              meta(e).length ? h('p', { class: 'muted small wl-meta' }, ...meta(e)) : null,
              e.details ? h('p', { class: 'muted small wl-meta' }, e.details) : null,
              ...(e.notes || []).map(noteBox),
              noteForm(e)))))))));
    }
    if (!any) list.append(h('p', { class: 'empty' }, data.members.length ? 'لا أسطر مشاركة في هذا الشهر.' : 'لا مرؤوسين تحتك في الشجرة الإدارية.'));
  }

  async function load() {
    title.textContent = monthLabel(month);
    try { data = await get(`/api/work-log/team?month=${month}`); } catch (e) { clear(list).append(h('div', { class: 'notice notice-err' }, e.message)); return; }
    draw();
  }
  function drawNav() {
    clear(nav).append(
      h('button', { type: 'button', class: 'btn', onclick: () => { month = shiftMonthStr(month, -1); drawNav(); load(); } }, 'الشهر السابق'),
      h('button', { type: 'button', class: 'btn', disabled: month >= today.slice(0, 7), onclick: () => { month = shiftMonthStr(month, 1); drawNav(); load(); } }, 'الشهر التالي'));
  }
  drawNav();
  const root = h('div', { class: 'page wl-page' },
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'متابعة الفريق'), title), h('div', { class: 'page-actions' }, nav, h('a', { class: 'btn', href: '#/work-log' }, icon('check'), 'سجلي'))),
    h('p', { class: 'muted small' }, 'تظهر هنا الأسطر التي اختار موظفوك إظهارها لك (مرؤوسوك في خطّك من الشجرة الإدارية). اكتب ملاحظتك على أي سطر فتصل للموظف ليعدّل أو يردّ، ثم تعتمد التعديل.'),
    chips, list);
  await load();
  return root;
}
