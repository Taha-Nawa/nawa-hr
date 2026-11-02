// «ماذا أنجزت اليوم»: سجل يومي سريع (إنجاز / اجتماع / تدريب أو نشاط خارجي / مهمة قادمة).
// خاص بصاحبه؛ يستورد منه محرّر التقرير الشهري بنقرة، فلا يُكتب التقرير من الذاكرة آخر الشهر.
import { h, clear, toast, confirmBox, dialog, icon, todayLocal, longDate } from '../dom.js';
import { get, post, patch, del } from '../api.js';
import { monthLabel, shiftMonthStr, STATUS_SUGGESTIONS, IMPORTANCE_SUGGESTIONS, dmy } from '../monthly-report-lib.js';
import { KIND_META, KIND_ORDER, countKinds, groupByDay, doneFromTodo, suggestFor, applySuggestion, repeatToday } from '../work-log-lib.js';

const LIM = { title: 400, short: 80, details: 500, place: 120 };
let lastMonth = null;

/**
 * نموذج سطر واحد (للإضافة السريعة والتعديل). vals تحفظ ما كُتب عند تبديل النوع.
 * يُرجع { el, read(), focus(), reset() }.
 */
let formSeq = 0;
function entryForm({ vals, today, onSubmit, submitLabel, submitIcon = null, showKinds = true, getSuggestions = () => [] }) {
  const uid = `wl${++formSeq}`;
  const box = h('form', { class: 'wl-form', novalidate: true });
  const kinds = h('div', { class: 'seg-tabs wl-kinds', role: 'tablist', 'aria-label': 'نوع السطر' });
  const fields = h('div', { class: 'wl-fields' });
  let suggBox = null;
  function drawSugg() {
    if (!suggBox) return;
    const list = suggestFor(getSuggestions(), vals.kind, vals.title);
    clear(suggBox);
    suggBox.hidden = !list.length;
    if (!list.length) return;
    suggBox.append(h('span', { class: 'muted small' }, 'من إدخالاتك السابقة:'),
      ...list.map((sg) => h('button', {
        type: 'button', class: 'btn btn-sm wl-chip', title: sg.title,
        onclick: () => { Object.assign(vals, applySuggestion(vals, sg)); drawFields(); box.querySelector('.wl-title input')?.focus(); },
      }, sg.title)));
  }
  const mk = (key, label, { fcls = '', ...attrs } = {}) => {
    const el = h('input', { ...attrs, 'aria-label': label, value: vals[key] ?? '', oninput: (e) => { vals[key] = e.target.value; if (key === 'title') drawSugg(); } }); // type أولاً ثم value
    return h('label', { class: `field ${fcls}`.trim() }, h('span', { class: 'field-label' }, label), el);
  };

  function drawFields() {
    clear(fields);
    const k = vals.kind;
    const dateField = mk('date', k === 'todo' ? 'تاريخ البدء' : 'التاريخ', { type: 'date', ...(k === 'todo' ? {} : { max: today }) });
    const title = mk('title', KIND_META[k].titleLabel, { type: 'text', maxlength: LIM.title, required: true, fcls: 'wl-title', autocomplete: 'off', enterkeyhint: 'done' });
    suggBox = h('div', { class: 'wl-sugg', role: 'group', 'aria-label': 'اقتراحات من إدخالاتك السابقة', hidden: true });
    fields.append(title, suggBox, dateField);
    drawSugg();
    if (k === 'done') {
      fields.append(mk('status', 'الحالة', { type: 'text', list: `${uid}-status`, maxlength: LIM.short, placeholder: 'تم الإنجاز' }),
        mk('details', 'تحديات أو ملاحظات (اختياري)', { type: 'text', maxlength: LIM.details, fcls: 'wl-wide' }));
    } else if (k === 'todo') {
      fields.append(mk('importance', 'درجة الأهمية', { type: 'text', list: `${uid}-importance`, maxlength: LIM.short, placeholder: 'مهم' }),
        mk('endDate', 'تاريخ الانتهاء المتوقع', { type: 'date', min: vals.date || undefined }));
    } else {
      fields.append(mk('place', 'المكان', { type: 'text', maxlength: LIM.place }),
        mk('details', 'ملخص (اختياري)', { type: 'text', maxlength: LIM.details, fcls: 'wl-wide' }));
    }
  }

  function drawKinds() {
    clear(kinds);
    if (!showKinds) return;
    kinds.append(...KIND_ORDER.map((k) => h('button', {
      type: 'button', role: 'tab', class: `seg-tab${vals.kind === k ? ' on' : ''}`, 'aria-selected': String(vals.kind === k),
      onclick: () => { vals.kind = k; if (k !== 'todo' && vals.date > today) vals.date = today; drawKinds(); drawFields(); },
    }, icon(KIND_META[k].icon), KIND_META[k].label)));
  }

  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, submitIcon ? icon(submitIcon) : null, submitLabel);
  box.append(kinds, fields, h('div', { class: 'wl-submit' }, submit),
    h('datalist', { id: `${uid}-status` }, STATUS_SUGGESTIONS.map((s) => h('option', { value: s }))),
    h('datalist', { id: `${uid}-importance` }, IMPORTANCE_SUGGESTIONS.map((s) => h('option', { value: s }))));
  box.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!String(vals.title || '').trim()) { toast('اكتب نص السطر أولاً', 'err'); box.querySelector('.wl-title input')?.focus(); return; }
    submit.disabled = true;
    try { await onSubmit({ ...vals }); } finally { submit.disabled = false; }
  });
  drawKinds();
  drawFields();
  return {
    el: box,
    focus: () => box.querySelector('.wl-title input')?.focus(),
    redraw: drawFields,
    refreshSuggestions: drawSugg,
  };
}

const fresh = (kind, date) => ({ kind, date, title: '', status: '', details: '', place: '', importance: '', endDate: '' });

export default async function render({ user, params }) {
  const today = todayLocal();
  const wanted = /^\d{4}-(0[1-9]|1[0-2])$/.test(params?.month || '') && params.month <= today.slice(0, 7) ? params.month : null;
  let month = wanted || lastMonth || today.slice(0, 7);
  lastMonth = month;
  const vals = fresh('done', today);
  const list = h('div', { class: 'wl-list' });
  const summary = h('p', { class: 'muted small', role: 'status' });
  const monthTitle = h('p', { class: 'sub' });
  const reportLink = h('a', { class: 'btn', href: '#' }, icon('report'), 'تقريري الشهري');
  let entries = [];
  let form;
  let suggestions = [];

  if (user.employeeId == null) {
    return h('div', { class: 'page' }, h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'ماذا أنجزت اليوم'))),
      h('div', { class: 'notice notice-warn' }, 'حسابك غير مرتبط ببطاقة موظف، اطلب من مسؤول النظام ربطه ليظهر لك سجلك اليومي.'));
  }

  function metaLine(e) {
    const bits = [];
    if (e.kind === 'done') bits.push(h('span', { class: 'chip chip-off' }, e.status));
    if (e.place) bits.push(h('span', null, `المكان: ${e.place}`));
    if (e.kind === 'todo') {
      if (e.importance) bits.push(h('span', null, `الأهمية: ${e.importance}`));
      bits.push(h('span', null, e.endDate ? `من ${dmy(e.date)} إلى ${dmy(e.endDate)}` : `يبدأ ${dmy(e.date)}`));
    }
    return bits;
  }

  function drawList() {
    clear(list);
    const n = countKinds(entries);
    clear(summary).append(entries.length
      ? `${monthLabel(month)}: ${n.done} إنجاز · ${n.meeting} اجتماع · ${n.training} تدريب/نشاط · ${n.todo} مهمة قادمة`
      : '');
    if (!entries.length) { list.append(h('p', { class: 'empty' }, 'لا أسطر في هذا الشهر بعد. اكتب أول سطر أعلاه، وسطر واحد كل يوم يكفي ليكتمل تقريرك.')); return; }
    for (const day of groupByDay(entries)) {
      list.append(h('section', { class: 'panel wl-day' },
        h('h3', { class: 'wl-day-head' }, longDate(day.date)),
        h('ul', { class: 'plain wl-items' }, day.items.map((e) => h('li', { class: 'wl-item' },
          h('span', { class: `chip ${KIND_META[e.kind].chip}` }, KIND_META[e.kind].label),
          h('div', { class: 'wl-body' },
            h('p', { class: 'wl-text' }, e.title),
            metaLine(e).length ? h('p', { class: 'muted small wl-meta' }, ...metaLine(e)) : null,
            e.details ? h('p', { class: 'muted small wl-meta' }, e.details) : null),
          h('div', { class: 'wl-actions' },
            e.kind === 'todo' ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => finishTodo(e) }, icon('check'), 'أنجزتها') : null,
            e.kind !== 'todo' && e.date !== today ? h('button', { type: 'button', class: 'btn btn-sm', title: 'نسخ هذا السطر إلى اليوم', onclick: () => repeatEntry(e) }, 'كرّر اليوم') : null,
            h('button', { type: 'button', class: 'btn btn-sm', onclick: () => editEntry(e) }, 'تعديل'),
            h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost', 'aria-label': `حذف: ${e.title}`, onclick: () => removeEntry(e) }, icon('trash')))))))); 
    }
  }

  async function load() {
    clear(list).append(h('p', { class: 'loading' }, 'جارٍ التحميل…'));
    monthTitle.textContent = monthLabel(month);
    reportLink.href = `#/monthly-report/${user.employeeId}/${month > today.slice(0, 7) ? today.slice(0, 7) : month}`;
    try {
      entries = (await get(`/api/work-log?month=${month}`)).entries;
    } catch (e) {
      clear(list).append(h('div', { class: 'notice notice-err' }, e.message));
      return;
    }
    drawList();
  }

  async function add(v) {
    try {
      const r = await post('/api/work-log', v);
      toast('أُضيف السطر');
      vals.title = ''; vals.details = ''; vals.place = ''; vals.status = ''; vals.importance = ''; vals.endDate = '';
      form.redraw();
      form.focus();
      if (r.entry.date.slice(0, 7) === month) { entries.push(r.entry); entries.sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1)); drawList(); }
      else toast(`حُفظ في ${monthLabel(r.entry.date.slice(0, 7))}`);
    } catch (e) { toast(e.message, 'err'); }
  }

  function editEntry(e) {
    const ev = { ...fresh(e.kind, e.date), ...Object.fromEntries(Object.entries(e).map(([k, x]) => [k, x ?? ''])) };
    const f = entryForm({ vals: ev, today, submitLabel: 'حفظ التعديل', onSubmit: async (v) => {
      try {
        await patch(`/api/work-log/${e.id}`, { kind: v.kind, date: v.date, title: v.title, status: v.status, details: v.details, place: v.place, importance: v.importance, endDate: v.endDate });
        d.close();
        toast('حُفظ التعديل');
        await load();
      } catch (err) { toast(err.message, 'err'); }
    } });
    const d = dialog({ title: 'تعديل السطر', content: f.el, wide: true });
  }

  async function finishTodo(e) {
    try {
      await patch(`/api/work-log/${e.id}`, doneFromTodo(e, today));
      toast(`سُجّلت في إنجازات اليوم (${dmy(today)})`);
      await load();
    } catch (err) { toast(err.message, 'err'); }
  }

  async function repeatEntry(e) {
    try {
      const r = await post('/api/work-log', repeatToday(e, today));
      toast(`نُسخ السطر إلى اليوم (${dmy(today)})`);
      if (r.entry.date.slice(0, 7) === month) await load();
    } catch (err) { toast(err.message, 'err'); }
  }

  async function removeEntry(e) {
    if (!(await confirmBox(`حذف هذا السطر؟\n«${e.title}»`, 'حذف', true))) return;
    try {
      await del(`/api/work-log/${e.id}`);
      entries = entries.filter((x) => x.id !== e.id);
      drawList();
      toast('حُذف السطر');
    } catch (err) { toast(err.message, 'err'); }
  }

  form = entryForm({ vals, today, submitLabel: 'إضافة', submitIcon: 'plus', onSubmit: add, getSuggestions: () => suggestions });
  get('/api/work-log/suggest').then((r) => { suggestions = r.suggestions || []; form.refreshSuggestions(); }).catch(() => { /* الاقتراحات اختيارية */ });
  const nav = h('div', { class: 'date-nav' });
  function drawNav() {
    clear(nav).append(
      h('button', { type: 'button', class: 'btn', onclick: () => { month = shiftMonthStr(month, -1); lastMonth = month; drawNav(); load(); } }, 'الشهر السابق'),
      h('button', { type: 'button', class: 'btn', disabled: month >= today.slice(0, 7), onclick: () => { month = shiftMonthStr(month, 1); lastMonth = month; drawNav(); load(); } }, 'الشهر التالي'));
  }
  drawNav();

  const root = h('div', { class: 'page wl-page' },
    h('header', { class: 'page-head' },
      h('div', null, h('h1', null, 'ماذا أنجزت اليوم'), monthTitle),
      h('div', { class: 'page-actions' }, nav, reportLink)),
    h('section', { class: 'panel wl-add' },
      h('h2', null, 'سطر جديد'),
      h('p', { class: 'muted small' }, 'اكتب ما أنجزته أو حضرته أو ما ستعمل عليه. هذا السجل لك وحدك؛ تستورد منه إلى تقريرك الشهري بنقرة، وتقدّم التقرير متى شئت.'),
      form.el),
    summary, list);
  await load();
  return root;
}
