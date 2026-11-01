// صفحة «التقرير الشهري»: يكتب الموظف مهام شهره واجتماعاته وخطة الشهر القادم، ويُحفظ تلقائياً في النظام،
// ثم يصدّره PDF بتنسيق نموذج الجمعية (أو حزمة: PDF + التايم شيت من بيانات الحضور في النظام نفسه).
import { h, clear, field, select, toast, icon, dialog, todayLocal, AR_MONTHS } from '../dom.js';
import { get, put } from '../api.js';
import { printReport } from '../report-print.js';
import { downloadTimesheet } from '../timesheet-export.js';

const STATUSES = ['تم الإنجاز', 'قيد التنفيذ', 'متأخر', 'مؤجل', 'ملغاة'];
const IMPORTANCE = ['مهم', 'متوسط', 'عادي'];
const DONE = new Set(['تم الإنجاز', 'ملغاة']);
const SAVE_DELAY = 1500;

// أخطاء إملائية متكررة في تقارير سابقة (تُصحَّح بزر «تنظيف وتصحيح»). تُوسَّع هنا عند ظهور أخطاء جديدة.
const FIXES = [
  ['تكنولجيا', 'تكنولوجيا'], ['التكنولجية', 'التكنولوجية'], ['تكنولجية', 'تكنولوجية'], ['تكنولجي', 'تكنولوجي'],
  ['اليئة', 'البيئة'], ['الملاخظات', 'الملاحظات'], ['ملاخظات', 'ملاحظات'], ['شمروع', 'مشروع'], ['اليافيعن', 'اليافعين'],
  ['اخصائي', 'أخصائي'], ['الادارة', 'الإدارة'], ['الانجاز', 'الإنجاز'], ['الايميلات', 'الإيميلات'], ['توفيع', 'توقيع'],
];

const monthNow = () => todayLocal().slice(0, 7);
const validMonth = (m) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(m || '') ? m : null);
const nextMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const lastDay = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
};
const hhmm = () => new Date().toTimeString().slice(0, 5);

// ------------------------------------------------------------------ محرّر جدول
/**
 * جدول صفوف قابل للتحرير. cols: [{ key, label, type: 'area'|'text'|'select'|'date', opts, w }].
 * Enter داخل حقل نصي يضيف صفاً جديداً؛ الجداول تتحول إلى بطاقات على الجوال تلقائياً (stackTables في main.js).
 */
function editor({ rows, cols, make, editable, onChange, pasteTitle }) {
  const wrap = h('div');
  const fit = (t) => {
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight + 2}px`;
  };
  const touch = () => onChange();

  function draw(focusRow, focusKey) {
    const head = h('tr', null, h('th', null, 'رقم'), cols.map((c) => h('th', { class: c.cls || '' }, c.label)), editable ? h('th', null, '') : null);
    const body = rows.map((r, i) => h('tr', { dataset: { i } },
      h('td', { class: 'num' }, i + 1),
      cols.map((c) => h('td', { class: c.cls || '' }, control(c, r)),),
      editable ? h('td', { class: 'row-actions' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'للأعلى', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'للأسفل', disabled: i === rows.length - 1, onclick: () => move(i, 1) }, '↓'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'حذف الصف', onclick: () => remove(i) }, '✕')) : null));
    const tools = editable ? h('div', { class: 'tools ed-tools' },
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => add() }, '+ إضافة صف'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => paste() }, 'لصق قائمة (سطر لكل بند)')) : null;
    clear(wrap).append(
      rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'tbl ed' }, h('thead', null, head), h('tbody', null, body))) : h('p', { class: 'empty' }, 'لا صفوف بعد.'),
      tools);
    // التحويل إلى بطاقات على الجوال (main.js) يحدث بعد الإدراج بإطار رسم، فيُقاس الارتفاع بعده
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.querySelectorAll('textarea').forEach(fit)));
    if (focusRow != null) wrap.querySelector(`tr[data-i="${focusRow}"] [data-key="${focusKey}"]`)?.focus();
  }

  function control(c, r) {
    const common = { dataset: { key: c.key }, 'aria-label': c.label, disabled: !editable };
    const set = (e) => {
      r[c.key] = e.target.value;
      if (e.target.tagName === 'TEXTAREA') fit(e.target);
      touch();
    };
    if (c.type === 'select') {
      const el = select((c.opts.includes(r[c.key]) || !r[c.key] ? c.opts : [...c.opts, r[c.key]]).map((o) => [o, o]), r[c.key] || c.opts[0], common);
      el.addEventListener('change', set);
      return el;
    }
    if (c.type === 'date') return h('input', { ...common, type: 'date', value: r[c.key] || '', onchange: set });
    if (c.type === 'text') return h('input', { ...common, value: r[c.key] || '', list: c.list || null, oninput: set });
    return h('textarea', {
      ...common, rows: 1, value: r[c.key] || '', oninput: set,
      onkeydown: (e) => {
        if (e.key !== 'Enter' || e.shiftKey || e.isComposing || !editable) return;
        e.preventDefault();
        const i = Number(e.target.closest('tr').dataset.i);
        add(i + 1, c.key);
      },
    });
  }

  function add(at = rows.length, focusKey = cols[0].key) {
    rows.splice(at, 0, make());
    touch();
    draw(at, focusKey);
  }
  function remove(i) {
    rows.splice(i, 1);
    touch();
    draw();
  }
  function move(i, d) {
    [rows[i], rows[i + d]] = [rows[i + d], rows[i]];
    touch();
    draw(i + d, cols[0].key);
  }
  function paste() {
    const ta = h('textarea', { class: 'paste-box', rows: 8, placeholder: 'الصق هنا: سطر واحد لكل بند. يُتجاهل الترقيم في بداية السطر.' });
    const dlg = dialog({
      title: pasteTitle || 'لصق قائمة',
      content: h('div', null, ta,
        h('div', { class: 'dlg-actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'إلغاء'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
            const lines = ta.value.split(/\r?\n/).map((l) => l.replace(/^\s*(\d+[.\-)]|[-•*])\s*/, '').trim()).filter(Boolean);
            for (const line of lines) {
              const r = make();
              r[cols[0].key] = line;
              rows.push(r);
            }
            dlg.close();
            if (lines.length) {
              touch();
              draw();
              toast(`أُضيف ${lines.length} بند`);
            }
          } }, 'إضافة'))),
    });
    ta.focus();
  }

  draw();
  return { el: wrap, redraw: () => draw(), refit: () => wrap.querySelectorAll('textarea').forEach(fit) };
}

// ------------------------------------------------------------------ الصفحة
export default async function render({ user }) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const employeeId = Number(q.get('employee')) || user.employeeId;
  const month = validMonth(q.get('month')) || monthNow();
  const go = (patch) => {
    const p = new URLSearchParams({ employee: String(employeeId || ''), month, ...patch });
    if (!p.get('employee')) p.delete('employee');
    location.hash = `#/monthly?${p}`;
  };

  if (!employeeId) {
    return h('div', { class: 'notice notice-err' }, 'حسابك غير مرتبط بملف موظف في النظام، راجع الموارد البشرية لربطه ثم عُد إلى هذه الصفحة.');
  }

  const [res, hist, empList] = await Promise.all([
    get(`/api/reports/monthly?month=${month}&employee=${employeeId}`),
    get(`/api/reports/monthly/list?employee=${employeeId}`).catch(() => ({ months: [] })),
    user.role === 'employee' ? Promise.resolve(null) : get('/api/employees').catch(() => null),
  ]);
  const { employee, canEdit, prevPlan } = res;
  const rep = res.report || {};
  const data = {
    tasks: (rep.tasks || []).map((t) => ({ ...t })),
    meetings: (rep.meetings || []).map((m) => ({ ...m })),
    attachments: (rep.attachments || []).map((a) => ({ ...a })),
    plan: (rep.plan || []).map((p) => ({ ...p })),
    notes: rep.notes || '',
    submitDate: rep.submitDate || lastDay(month),
  };
  const sv = { base: rep.updatedAt || '', dirty: false, busy: false, timer: null, conflict: false };

  // ---------------------------------------------------------- الحفظ التلقائي
  const stateChip = h('span', { class: 'save-state', role: 'status', 'aria-live': 'polite' });
  const setState = (kind, text) => {
    stateChip.className = `save-state save-${kind}`;
    stateChip.textContent = text;
  };
  setState('ok', res.report ? `محفوظ ${rep.updatedAt ? new Date(rep.updatedAt).toTimeString().slice(0, 5) : ''}` : 'تقرير جديد');
  const conflictBox = h('div', { class: 'notice notice-err', hidden: true, role: 'alert' });

  async function save() {
    clearTimeout(sv.timer);
    if (!canEdit || sv.conflict) return true;
    if (sv.busy) {
      sv.timer = setTimeout(save, 400);
      return false;
    }
    if (!sv.dirty) return true;
    sv.busy = true;
    sv.dirty = false;
    setState('busy', 'جارٍ الحفظ…');
    try {
      const r = await put(`/api/reports/monthly?month=${month}&employee=${employeeId}`, { ...data, base: sv.base });
      sv.base = r.updatedAt;
      setState(sv.dirty ? 'dirty' : 'ok', sv.dirty ? 'تعديلات غير محفوظة' : `تم الحفظ ${hhmm()}`);
      return true;
    } catch (e) {
      sv.dirty = true;
      if (e.status === 409) {
        sv.conflict = true;
        setState('err', 'تعارض في الحفظ');
        clear(conflictBox).append(e.message, ' ', h('button', { type: 'button', class: 'btn btn-sm', onclick: () => location.reload() }, 'إعادة تحميل الصفحة'));
        conflictBox.hidden = false;
      } else {
        setState('err', 'تعذّر الحفظ — سنعيد المحاولة');
        toast(e.message, 'err');
      }
      return false;
    } finally {
      sv.busy = false;
    }
  }
  const changed = () => {
    if (!canEdit) return;
    sv.dirty = true;
    setState('dirty', 'تعديلات غير محفوظة');
    clearTimeout(sv.timer);
    sv.timer = setTimeout(save, SAVE_DELAY);
    refreshCounts();
  };
  const flush = async () => {
    clearTimeout(sv.timer);
    for (let i = 0; i < 5 && (sv.dirty || sv.busy); i++) {
      await save();
      if (sv.conflict) break;
      if (sv.busy) await new Promise((r) => setTimeout(r, 300));
    }
    return !sv.dirty && !sv.conflict;
  };
  // حفظ عند مغادرة الصفحة أو إخفاء التطبيق (تبديل التبويب/قفل الجوال)
  const onHide = () => { if (document.visibilityState === 'hidden') save(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('hashchange', () => { document.removeEventListener('visibilitychange', onHide); save(); }, { once: true });

  // ---------------------------------------------------------- الأقسام
  const counts = { tasks: h('span', { class: 'chip chip-none' }), meetings: h('span', { class: 'chip chip-none' }), plan: h('span', { class: 'chip chip-none' }) };
  const refreshCounts = () => {
    counts.tasks.textContent = `${data.tasks.filter((t) => t.t.trim()).length} مهمة`;
    counts.meetings.textContent = `${data.meetings.filter((t) => t.t.trim()).length} نشاط`;
    counts.plan.textContent = `${data.plan.filter((t) => t.t.trim()).length} مهمة`;
  };
  const defStatus = STATUSES[0];
  const nm = nextMonth(month);

  const tasksEd = editor({
    rows: data.tasks, editable: canEdit, onChange: changed, pasteTitle: 'لصق قائمة المهام',
    make: () => ({ t: '', s: defStatus, c: '' }),
    cols: [{ key: 't', label: 'المهمة', type: 'area', cls: 'c-wide' }, { key: 's', label: 'الحالة', type: 'select', opts: STATUSES, cls: 'c-mid' }, { key: 'c', label: 'التحديات والمعيقات', type: 'area', cls: 'c-wide' }],
  });
  const meetEd = editor({
    rows: data.meetings, editable: canEdit, onChange: changed,
    make: () => ({ t: '', s: '', p: '', d: data.meetings.at(-1)?.d || `${month}-01` }),
    cols: [{ key: 't', label: 'عنوان / نشاط', type: 'area', cls: 'c-wide' }, { key: 's', label: 'ملخص الاجتماع', type: 'area', cls: 'c-wide' }, { key: 'p', label: 'المكان', type: 'text', list: 'places', cls: 'c-mid' }, { key: 'd', label: 'التاريخ', type: 'date', cls: 'c-mid' }],
  });
  const attEd = editor({
    rows: data.attachments, editable: canEdit, onChange: changed, make: () => ({ t: '' }),
    cols: [{ key: 't', label: 'المرفق (اسم الملف أو وصفه)', type: 'text' }],
  });
  const planEd = editor({
    rows: data.plan, editable: canEdit, onChange: changed, pasteTitle: 'لصق قائمة مهام الشهر القادم',
    make: () => ({ t: '', i: IMPORTANCE[0], sd: `${nm}-01`, ed: lastDay(nm) }),
    cols: [{ key: 't', label: 'المهمة', type: 'area', cls: 'c-wide' }, { key: 'i', label: 'درجة الأهمية', type: 'select', opts: IMPORTANCE, cls: 'c-mid' }, { key: 'sd', label: 'تاريخ البدء', type: 'date', cls: 'c-mid' }, { key: 'ed', label: 'تاريخ الانتهاء المتوقع', type: 'date', cls: 'c-mid' }],
  });

  // ---------------------------------------------------------- إجراءات ذكية
  const sameText = (a, b) => a.trim().replace(/\s+/g, ' ') === b.trim().replace(/\s+/g, ' ');
  function importPlan() {
    const have = data.tasks.filter((t) => t.t.trim());
    const fresh = prevPlan.filter((p) => p.t.trim() && !have.some((t) => sameText(t.t, p.t)));
    if (!prevPlan.length) return toast('لا توجد خطة محفوظة للشهر السابق', 'err');
    if (!fresh.length) return toast('كل مهام خطة الشهر السابق موجودة أصلاً');
    data.tasks.splice(0, data.tasks.length, ...have, ...fresh.map((p) => ({ t: p.t, s: defStatus, c: '' })));
    tasksEd.redraw();
    changed();
    toast(`استُوردت ${fresh.length} مهمة من خطة الشهر السابق، راجع حالة كل مهمة`);
  }
  function carryOver() {
    const open = data.tasks.filter((t) => t.t.trim() && !DONE.has(t.s) && !data.plan.some((p) => sameText(p.t, t.t)));
    if (!open.length) return toast('لا توجد مهام غير منجزة لترحيلها');
    data.plan.push(...open.map((t) => ({ t: t.t, i: IMPORTANCE[0], sd: `${nm}-01`, ed: lastDay(nm) })));
    planEd.redraw();
    changed();
    toast(`رُحّلت ${open.length} مهمة غير منجزة إلى خطة الشهر القادم`);
  }
  function planDates() {
    for (const p of data.plan) Object.assign(p, { sd: `${nm}-01`, ed: lastDay(nm) });
    planEd.redraw();
    changed();
  }
  function clean() {
    let n = 0;
    const fix = (o, k) => {
      const v = o[k];
      if (typeof v !== 'string') return;
      let s = v.replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/`/g, '').trim();
      for (const [a, b] of FIXES) s = s.split(a).join(b);
      if (s !== v) {
        o[k] = s;
        n++;
      }
    };
    data.tasks.forEach((r) => { fix(r, 't'); fix(r, 'c'); });
    data.meetings.forEach((r) => { fix(r, 't'); fix(r, 's'); fix(r, 'p'); });
    data.plan.forEach((r) => fix(r, 't'));
    data.attachments.forEach((r) => fix(r, 't'));
    [tasksEd, meetEd, planEd, attEd].forEach((e) => e.redraw());
    if (n) changed();
    toast(n ? `نُظّف/صُحّح ${n} حقل` : 'لا توجد مسافات زائدة أو أخطاء معروفة');
  }

  function problems() {
    const out = [];
    const tasks = data.tasks.filter((t) => t.t.trim());
    if (!tasks.length) out.push('لا توجد مهام في القسم 1.');
    const seen = new Set();
    for (const t of tasks) {
      const k = t.t.trim().replace(/\s+/g, ' ');
      if (seen.has(k)) out.push(`مهمة مكررة: «${k.slice(0, 50)}»`);
      seen.add(k);
      if (!DONE.has(t.s) && !t.c.trim()) out.push(`مهمة «${k.slice(0, 40)}» حالتها «${t.s}» بلا ذكر للتحديات.`);
    }
    for (const m of data.meetings.filter((x) => x.t.trim())) {
      const nmx = m.t.trim().slice(0, 35);
      if (!m.d) out.push(`اجتماع «${nmx}» بلا تاريخ.`);
      else if (!m.d.startsWith(`${month}-`)) out.push(`اجتماع «${nmx}» تاريخه خارج الشهر (${m.d.split('-').reverse().join('/')}).`);
      if (!m.p.trim()) out.push(`اجتماع «${nmx}» بلا مكان.`);
      if (!m.s.trim()) out.push(`اجتماع «${nmx}» بلا ملخص.`);
    }
    const plan = data.plan.filter((p) => p.t.trim());
    if (!plan.length) out.push('لا توجد مهام في القسم 3 (الشهر القادم).');
    for (const p of plan) if (p.sd && p.ed && p.ed < p.sd) out.push(`مهمة «${p.t.trim().slice(0, 35)}»: الانتهاء قبل البدء.`);
    return out;
  }
  const problemBox = h('div');
  function check() {
    const o = problems();
    clear(problemBox).append(o.length
      ? h('div', { class: 'notice notice-warn' }, h('strong', null, `ملاحظات قبل التصدير (${o.length}):`), h('ul', null, o.map((x) => h('li', null, x))))
      : h('div', { class: 'notice ok-note' }, 'لا توجد ملاحظات — التقرير جاهز للتصدير.'));
    return o;
  }

  // ---------------------------------------------------------- التصدير
  const exportBtn = h('button', { type: 'button', class: 'btn btn-primary' }, icon('download'), 'تصدير PDF');
  const bundleBtn = h('button', { type: 'button', class: 'btn' }, 'الحزمة الشهرية: PDF + تايم شيت');
  const busy = (on) => { exportBtn.disabled = on; bundleBtn.disabled = on; };

  async function ready() {
    if (!(await flush())) {
      toast('تعذّر حفظ التقرير قبل التصدير، راجع رسالة الخطأ أعلاه', 'err');
      return false;
    }
    const o = problems();
    if (o.length) {
      check();
      toast(`${o.length} ملاحظة على التقرير (التصدير مستمر)`);
    }
    return true;
  }
  exportBtn.onclick = async () => {
    busy(true);
    try {
      if (await ready()) await printReport({ employee, month, data });
    } finally {
      busy(false);
    }
  };
  bundleBtn.onclick = async () => {
    busy(true);
    try {
      if (!(await ready())) return;
      let note = '';
      try {
        const { sheets } = await downloadTimesheet([{ id: employee.id }], month, employee.code);
        if (sheets[0]?.timesheet.notes.length) note = 'للتايم شيت تنبيهات (توزيع المشاريع)، راجع صفحة «التقارير».';
      } catch (e) {
        toast(`تعذّر تصدير التايم شيت: ${e.message}`, 'err');
      }
      if (note) toast(note);
      await printReport({ employee, month, data });
    } finally {
      busy(false);
    }
  };

  // ---------------------------------------------------------- ترويسة الصفحة
  const monthInput = h('input', { type: 'month', value: month, max: nm, 'aria-label': 'الشهر', onchange: async (e) => { if (validMonth(e.target.value)) { await flush(); go({ month: e.target.value }); } } });
  const whoSel = empList?.employees?.length > 1
    ? select(empList.employees.filter((e) => e.status === 'active').map((e) => [e.id, `${e.name} (${e.code})`]), employeeId, { 'aria-label': 'الموظف', onchange: async (e) => { await flush(); go({ employee: e.target.value }); } })
    : null;

  const section = (title, hint, chip, body, extra) => h('section', { class: 'panel' },
    h('div', { class: 'sec-head' }, h('div', null, h('h2', null, title), hint ? h('p', { class: 'muted small' }, hint) : null), chip),
    body, extra);

  const histBox = hist.months.length
    ? h('div', { class: 'hist' }, h('span', { class: 'muted small' }, 'الأشهر المحفوظة:'),
      hist.months.slice(0, 12).map((m) => h('a', { class: `chip ${m.month === month ? 'chip-leave' : ''}`, href: `#/monthly?employee=${employeeId}&month=${m.month}`, onclick: (e) => { e.preventDefault(); flush().then(() => go({ month: m.month })); } },
        `${AR_MONTHS[Number(m.month.slice(5)) - 1]} ${m.month.slice(0, 4)}`)))
    : null;

  const fresh = !res.report && prevPlan.some((p) => p.t.trim()) && canEdit;
  const [y, mo] = month.split('-').map(Number);

  const notes = h('textarea', { rows: 2, class: 'notes-box', value: data.notes, disabled: !canEdit, maxlength: 1000, placeholder: 'اختياري. يُطبع بعد عبارة «ملاحظات المدير المباشر:» (اتركه فارغاً لتعبئته يدوياً بعد الطباعة).', oninput: (e) => { data.notes = e.target.value; changed(); } });
  const submit = h('input', { type: 'date', value: data.submitDate, disabled: !canEdit, onchange: (e) => { data.submitDate = e.target.value; changed(); } });

  const root = h('section', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', null, h('h1', null, 'التقرير الشهري'), h('p', { class: 'muted' }, `${employee.name} — ${AR_MONTHS[mo - 1]} ${y}`)),
      h('div', { class: 'head-tools' }, stateChip)),
    h('div', { class: 'panel' },
      h('div', { class: 'inline-form' }, whoSel ? field('الموظف', whoSel) : null, field('الشهر', monthInput), field('تاريخ تقديم التقرير', submit)),
      h('dl', { class: 'info' },
        h('div', null, h('dt', null, 'الاسم'), h('dd', null, employee.name)),
        h('div', null, h('dt', null, 'الوظيفة'), h('dd', null, employee.jobTitle || '—')),
        h('div', null, h('dt', null, 'الإدارة / القسم'), h('dd', null, employee.department || '—'))),
      employee.jobTitle && employee.department ? null : h('p', { class: 'notice notice-warn' }, 'المسمى الوظيفي أو القسم ناقص في ملف الموظف، ويظهر فارغاً في التقرير. تُكمله الموارد البشرية من صفحة الموظف.'),
      histBox),
    canEdit ? null : h('div', { class: 'notice notice-warn' }, 'عرض فقط: لا تملك صلاحية تعديل هذا التقرير، لكن يمكنك تصديره PDF.'),
    conflictBox,
    fresh ? h('div', { class: 'notice notice-warn fresh' },
      h('span', null, `لهذا الشهر تقرير جديد، وفي خطة الشهر السابق ${prevPlan.filter((p) => p.t.trim()).length} مهمة جاهزة للاستيراد.`),
      h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: importPlan }, 'استيراد خطة الشهر السابق')) : null,
    section('1. المهمات الرئيسية خلال فترة التقرير', 'اكتب المهمة واضغط Enter لسطر جديد، أو الصق قائمة كاملة. الترقيم تلقائي.', counts.tasks, tasksEd.el,
      canEdit ? h('div', { class: 'tools' },
        h('button', { type: 'button', class: 'btn', onclick: importPlan }, 'استيراد خطة الشهر السابق'),
        h('button', { type: 'button', class: 'btn', onclick: () => { data.tasks.forEach((t) => { if (t.t.trim()) t.s = defStatus; }); tasksEd.redraw(); changed(); } }, 'تحديد الكل «تم الإنجاز»')) : null),
    section('2. الاجتماعات والنشاطات الخارجية', 'تُرتَّب حسب التاريخ في ملف PDF تلقائياً.', counts.meetings, meetEd.el),
    section('المرفقات', 'أسماء المرفقات فقط (لا تُرفع ملفات). تُطبع ثلاثة أسطر على الأقل كما في النموذج.', null, attEd.el),
    section('3. المهام الرئيسية خلال فترة التقرير اللاحقة', 'التواريخ الافتراضية = الشهر القادم كاملاً. تتحول هذه الخطة إلى مهام الشهر التالي بضغطة.', counts.plan, planEd.el,
      canEdit ? h('div', { class: 'tools' },
        h('button', { type: 'button', class: 'btn', onclick: carryOver }, 'ترحيل غير المنجز من هذا الشهر'),
        h('button', { type: 'button', class: 'btn', onclick: planDates }, 'ضبط كل التواريخ على الشهر القادم')) : null),
    section('ملاحظات المدير المباشر', null, null, notes),
    h('section', { class: 'panel export' },
      h('div', { class: 'tools' }, exportBtn, bundleBtn,
        h('a', { class: 'btn', href: `#/reports?employee=${employee.id}&month=${month}` }, 'التايم شيت فقط'),
        canEdit ? h('button', { type: 'button', class: 'btn', onclick: clean }, 'تنظيف وتصحيح إملائي') : null,
        h('button', { type: 'button', class: 'btn', onclick: check }, 'فحص التقرير')),
      h('p', { class: 'muted small' }, 'يفتح التصدير نافذة الطباعة: اختر «حفظ كـ PDF» (الوجهة) وسيكون اسم الملف جاهزاً. الحزمة الشهرية تنزّل أيضاً التايم شيت من بيانات الحضور المحسوبة في النظام.'),
      problemBox),
    h('datalist', { id: 'places' }, ['online', 'قاعة الاجتماعات', 'قاعة التدريب'].map((p) => h('option', { value: p }))));
  refreshCounts();
  // ارتفاع الحقول النصية يُقاس بعد إدراج الصفحة في المستند (وبعد تحميل الخط)، وعند تغيير عرض النافذة
  const refit = () => [tasksEd, meetEd, attEd, planEd].forEach((e) => e.refit());
  requestAnimationFrame(() => requestAnimationFrame(refit));
  document.fonts?.ready.then(refit);
  window.addEventListener('resize', refit);
  window.addEventListener('hashchange', () => window.removeEventListener('resize', refit), { once: true });
  return root;
}
