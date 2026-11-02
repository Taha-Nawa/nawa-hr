// التقرير الشهري للموظف: يكتبه صاحبه (مسودة ثم تقديم) ويقرؤه مديره، ويطبع PDF بنموذج «التقرير الشهري» المعتمد.
import { h, clear, toast, confirmBox, icon, todayLocal } from '../dom.js';
import { get, put, patch } from '../api.js';
import { fmtStamp } from '../time12.js';
import {
  monthLabel, shiftMonthStr, monthBounds, tasksFromPrevious, nextFromTasks, appendUnique, STATUS_SUGGESTIONS, IMPORTANCE_SUGGESTIONS,
} from '../monthly-report-lib.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
const blankTask = () => ({ title: '', status: '', challenges: '' });
const blankMeeting = () => ({ title: '', summary: '', place: '', date: '' });
const blankNext = () => ({ title: '', importance: '', start: '', end: '' });

/** محرّر أسطر: كل سطر بطاقة شبكية (حقل لكل عمود). items تُعدَّل في مكانها ويُنادى onChange عند أي تغيير. */
function rowsEditor({ items, columns, canEdit, onChange, cls }) {
  const box = h('div', { class: `mr-rows ${cls}` });
  const cell = (item, c) => {
    const common = { 'aria-label': c.label, value: item[c.key] ?? '', disabled: !canEdit, oninput: (e) => { item[c.key] = e.target.value; onChange(); }, ...(c.attrs || {}) };
    const input = c.type === 'textarea' ? h('textarea', { rows: 2, maxlength: c.max, ...common }) : h('input', { type: c.type || 'text', maxlength: c.max, list: c.list, ...common });
    return h('label', { class: `mr-cell ${c.cls || ''}` }, h('span', { class: 'mr-lab' }, c.label), input);
  };
  function redraw() {
    clear(box);
    items.forEach((item, i) => box.append(h('div', { class: 'mr-row' },
      h('span', { class: 'mr-no', 'aria-hidden': 'true' }, String(i + 1)),
      columns.map((c) => cell(item, c)),
      canEdit ? h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost mr-del', 'aria-label': `حذف السطر ${i + 1}`, onclick: () => { items.splice(i, 1); redraw(); onChange(); } }, icon('trash')) : null)));
    if (!items.length) box.append(h('p', { class: 'empty small' }, canEdit ? 'لا أسطر بعد، أضف سطراً.' : 'لا شيء في هذا القسم.'));
  }
  redraw();
  return { el: box, redraw };
}

export default async function render({ user, params }) {
  const id = Number(params.id);
  const month = params.month;
  let d;
  try {
    d = await get(`/api/monthly-reports/${id}/${month}`);
  } catch (e) {
    return h('div', { class: 'page' }, h('div', { class: 'notice notice-err' }, e.message), user.role !== 'employee' ? h('a', { href: '#/monthly-report', class: 'back' }, 'كل التقارير') : null);
  }
  const { employee, canEdit, canReview, prevNext } = d;
  const { from, to } = monthBounds(month);
  const today = todayLocal();
  const state = { tasks: d.report.tasks.map((t) => ({ ...blankTask(), ...t })), meetings: d.report.meetings.map((t) => ({ ...blankMeeting(), ...t })), next: d.report.next.map((t) => ({ ...blankNext(), ...t })) };
  let status = d.report.status;
  let dirty = false;
  const KEY = `nawa-mr:${id}:${month}`;

  const attachments = h('textarea', { rows: 3, maxlength: 4000, 'aria-label': 'المرفقات', disabled: !canEdit, placeholder: 'اسم كل مرفق في سطر (الملفات نفسها تُرسل مع التقرير خارج النظام)', value: d.report.attachments.join('\n') });
  const submitDate = h('input', { type: 'date', min: from, value: d.report.submitDate || '', disabled: !canEdit, 'aria-label': 'تاريخ تقديم التقرير' });
  const notesBox = h('textarea', { rows: 3, maxlength: d.limits.notes, 'aria-label': 'ملاحظات المدير المباشر', disabled: !canReview, value: d.report.managerNotes || '' });

  const snapshot = () => ({ ...clone(state), attachments: attachments.value, submitDate: submitDate.value });
  const stash = () => { try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), snap: snapshot() })); } catch { /* التخزين غير متاح */ } };
  const unstash = () => { try { localStorage.removeItem(KEY); } catch { /* تجاهل */ } };
  let timer = null;
  const changed = () => { dirty = true; refresh(); clearTimeout(timer); timer = setTimeout(stash, 700); };
  attachments.addEventListener('input', changed);
  submitDate.addEventListener('change', changed);

  const datalists = [
    h('datalist', { id: 'mr-status' }, STATUS_SUGGESTIONS.map((s) => h('option', { value: s }))),
    h('datalist', { id: 'mr-importance' }, IMPORTANCE_SUGGESTIONS.map((s) => h('option', { value: s }))),
  ];
  const mk = (items, columns, cls) => rowsEditor({ items, columns, canEdit, onChange: changed, cls });
  const tasks = mk(state.tasks, [
    { key: 'title', label: 'المهمة', type: 'textarea', max: d.limits.title, cls: 'grow' },
    { key: 'status', label: 'الحالة', list: 'mr-status', max: d.limits.short },
    { key: 'challenges', label: 'التحديات والمعيقات', type: 'textarea', max: d.limits.challenges },
  ], 'mr-tasks');
  const meetings = mk(state.meetings, [
    { key: 'title', label: 'عنوان / نشاط', type: 'textarea', max: d.limits.title },
    { key: 'summary', label: 'ملخص الاجتماع', type: 'textarea', max: d.limits.summary },
    { key: 'place', label: 'المكان', max: d.limits.place },
    { key: 'date', label: 'التاريخ', type: 'date', attrs: { min: from, max: to } },
  ], 'mr-meet');
  const next = mk(state.next, [
    { key: 'title', label: 'المهمة', type: 'textarea', max: d.limits.title },
    { key: 'importance', label: 'درجة الأهمية', list: 'mr-importance', max: d.limits.short },
    { key: 'start', label: 'تاريخ البدء', type: 'date' },
    { key: 'end', label: 'تاريخ الانتهاء المتوقع', type: 'date' },
  ], 'mr-next');

  const addBtn = (items, make, rows, label) => canEdit
    ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { items.push(make()); rows.redraw(); changed(); } }, icon('plus'), label)
    : null;

  const importPrev = canEdit && prevNext.length
    ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => {
      const before = state.tasks.length;
      state.tasks.splice(0, state.tasks.length, ...appendUnique(state.tasks.filter((t) => t.title || t.status || t.challenges), tasksFromPrevious(prevNext)));
      tasks.redraw();
      changed();
      toast(`أُضيف ${state.tasks.length - before} مهمة من مهام الشهر السابق`);
    } }, icon('inbox'), `استيراد مهام ${monthLabel(shiftMonthStr(month, -1))} (${prevNext.length})`)
    : null;
  const carry = canEdit
    ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => {
      const add = nextFromTasks(state.tasks, month);
      if (!add.length) { toast('لا مهام غير منجزة لترحيلها', 'err'); return; }
      const before = state.next.length;
      state.next.splice(0, state.next.length, ...appendUnique(state.next, add));
      next.redraw();
      changed();
      toast(`رُحّلت ${state.next.length - before} مهمة غير منجزة إلى الشهر القادم`);
    } }, icon('arrow-left'), 'ترحيل غير المنجز إلى الشهر القادم')
    : null;

  // ---- الشريط العلوي وأزرار الحفظ
  const chip = h('span', { class: 'chip' });
  const bar = h('div', { class: 'mr-bar' });
  const stamp = h('p', { class: 'muted small' });
  const printLink = h('a', { href: `#/monthly-report/${id}/${month}/print`, class: 'btn' }, icon('printer'), 'معاينة وطباعة PDF');
  printLink.addEventListener('click', (e) => { if (dirty) { e.preventDefault(); toast('احفظ التقرير أولاً ثم اطبعه', 'err'); } });
  let busy = false;

  async function save(newStatus) {
    if (busy) return;
    busy = true;
    refresh();
    try {
      const r = await put(`/api/monthly-reports/${id}/${month}`, {
        tasks: state.tasks, meetings: state.meetings, next: state.next, attachments: attachments.value.split('\n'),
        submitDate: submitDate.value, ...(newStatus ? { status: newStatus } : {}),
      });
      status = r.status;
      if (r.submitDate) submitDate.value = r.submitDate;
      dirty = false;
      unstash();
      toast(newStatus === 'submitted' ? 'قُدِّم التقرير' : newStatus === 'draft' ? 'أُعيد إلى مسودة' : 'تم الحفظ');
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      busy = false;
      refresh();
    }
  }

  function refresh() {
    chip.className = `chip ${status === 'submitted' ? 'chip-present' : 'chip-late'}`;
    chip.textContent = status === 'submitted' ? 'مُقدَّم' : 'مسودة';
    printLink.classList.toggle('is-disabled', dirty);
    clear(bar);
    if (canEdit) {
      bar.append(...[
        h('button', { type: 'button', class: status === 'submitted' ? 'btn btn-primary' : 'btn', disabled: busy || (!dirty && status === 'submitted'), onclick: () => save(status === 'submitted' ? 'submitted' : 'draft') }, status === 'submitted' ? 'حفظ التعديلات' : 'حفظ المسودة'),
        status === 'submitted'
          ? h('button', { type: 'button', class: 'btn', disabled: busy, onclick: async () => { if (await confirmBox('إعادة التقرير إلى مسودة؟ يختفي عن مديرك حتى تقدّمه من جديد.', 'إعادة إلى مسودة')) save('draft'); } }, 'إعادة إلى مسودة')
          : h('button', { type: 'button', class: 'btn btn-primary', disabled: busy, onclick: async () => { if (await confirmBox('تقديم التقرير لمديرك المباشر؟ يستطيع قراءته وكتابة ملاحظاته، وتبقى لك إمكانية التعديل.', 'تقديم')) save('submitted'); } }, 'تقديم التقرير'),
        dirty ? h('span', { class: 'muted small' }, 'تعديلات لم تُحفظ') : null,
      ].filter(Boolean)); // append الأصلية تكتب null نصاً
    }
    bar.append(printLink);
    clear(stamp).append(d.report.updatedAt ? `آخر حفظ: ${fmtStamp(d.report.updatedAt)}` : 'لم يُحفظ بعد');
  }

  // ---- التنقل بين الأشهر (لا شهر لم يبدأ)
  const goMonth = async (delta) => {
    const m = shiftMonthStr(month, delta);
    if (m > today.slice(0, 7)) return;
    if (dirty && !(await confirmBox('فيه تعديلات لم تُحفظ (نسخة منها محفوظة على هذا الجهاز). هل تنتقل؟', 'انتقل', true))) return;
    location.hash = `#/monthly-report/${id}/${m}`;
  };
  const isCurrent = month >= today.slice(0, 7);

  const section = (title, hint, body, tools) => h('section', { class: 'panel mr-sec' },
    h('div', { class: 'mr-sec-head' }, h('h2', null, title), tools ? h('div', { class: 'row-actions' }, tools) : null),
    hint ? h('p', { class: 'muted small' }, hint) : null, body);

  const root = h('div', { class: 'page mr-page' },
    h('header', { class: 'page-head' },
      h('div', null,
        user.role !== 'employee' ? h('a', { href: '#/monthly-report', class: 'back' }, 'كل التقارير') : null,
        h('h1', null, canEdit ? 'تقريري الشهري' : `تقرير ${employee.name}`),
        h('p', { class: 'sub' }, `${monthLabel(month)} · `, chip)),
      h('div', { class: 'date-nav' },
        h('button', { type: 'button', class: 'btn', onclick: () => goMonth(-1) }, 'الشهر السابق'),
        h('button', { type: 'button', class: 'btn', disabled: isCurrent, onclick: () => goMonth(1) }, 'الشهر التالي'))),
    h('div', { class: 'panel mr-ident' },
      h('dl', { class: 'req-info' },
        h('div', { class: 'kv' }, h('dt', null, 'الاسم'), h('dd', null, employee.name)),
        h('div', { class: 'kv' }, h('dt', null, 'الوظيفة'), h('dd', null, employee.jobTitle || '—')),
        h('div', { class: 'kv' }, h('dt', null, 'الإدارة'), h('dd', null, employee.department || '—')),
        h('div', { class: 'kv' }, h('dt', null, 'مدة التقرير'), h('dd', null, `شهر ${monthLabel(month)}`)),
        h('div', { class: 'kv' }, h('dt', null, 'تاريخ تقديم التقرير'), h('dd', null, submitDate))),
      !employee.jobTitle || !employee.department ? h('p', { class: 'muted small' }, 'الوظيفة والإدارة تُؤخذان من بطاقة الموظف؛ اطلب من الموارد البشرية استكمالها إن كانت ناقصة.') : null),
    h('div', { class: 'mr-actions' }, bar, stamp),
    section('1. المهام الرئيسية خلال فترة التقرير', canEdit ? 'اكتب كل مهمة في سطر، وحالتها، وما واجهك من تحديات (إن وُجدت).' : null,
      h('div', null, tasks.el, ...datalists), [importPrev, addBtn(state.tasks, blankTask, tasks, 'إضافة مهمة')]),
    section('2. الاجتماعات والنشاطات الخارجية خلال فترة التقرير', null, meetings.el, addBtn(state.meetings, blankMeeting, meetings, 'إضافة اجتماع / نشاط')),
    section('المرفقات', 'أسماء المرفقات فقط (النظام لا يحفظ ملفات).', attachments),
    section('3. المهام الرئيسية خلال فترة التقرير اللاحقة', null, next.el, [carry, addBtn(state.next, blankNext, next, 'إضافة مهمة')]),
    status === 'submitted' || canReview
      ? h('section', { class: 'panel mr-sec' },
        h('h2', null, 'ملاحظات المدير المباشر'),
        d.report.managerNotes || canReview ? notesBox : h('p', { class: 'muted' }, 'لا ملاحظات بعد.'),
        d.report.notesBy ? h('p', { class: 'muted small' }, `آخر ملاحظة: ${d.report.notesBy}`) : null,
        canReview ? h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: async (ev) => {
          ev.target.disabled = true;
          try { await patch(`/api/monthly-reports/${id}/${month}/notes`, { notes: notesBox.value }); toast('حُفظت الملاحظات'); } catch (e) { toast(e.message, 'err'); } finally { ev.target.disabled = false; }
        } }, 'حفظ الملاحظات')) : null)
      : null);

  // مسودة محفوظة على الجهاز لم تصل الخادم (انقطاع أو إغلاق قبل الحفظ)
  if (canEdit) {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      const server = d.report.updatedAt ? Date.parse(`${d.report.updatedAt.replace(' ', 'T')}Z`) : 0;
      if (saved && saved.at > server && JSON.stringify(saved.snap) !== JSON.stringify(snapshot())) {
        const note = h('div', { class: 'notice notice-warn', role: 'status' },
          `لديك تعديلات غير محفوظة على هذا الجهاز (${fmtStamp(new Date(saved.at).toISOString())}). `,
          h('button', { type: 'button', class: 'btn btn-sm', onclick: () => {
            for (const k of ['tasks', 'meetings', 'next']) state[k].splice(0, state[k].length, ...saved.snap[k]);
            attachments.value = saved.snap.attachments ?? '';
            submitDate.value = saved.snap.submitDate || '';
            for (const r of [tasks, meetings, next]) r.redraw();
            note.remove();
            changed();
          } }, 'استعادتها'),
          h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { unstash(); note.remove(); } }, 'تجاهلها'));
        root.insertBefore(note, root.querySelector('.mr-ident'));
      }
    } catch { /* تجاهل */ }
  }
  refresh();
  return root;
}
