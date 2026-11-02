// الحضور اليدوي: للموارد البشرية والمسؤول. تسجيل/تعديل الحركات، تغيير الحالة، منح إجازة أو إذن، أو مسح التصحيح، لموظف أو عدة موظفين ولمدى أيام.
import { h, clear, dialog, field, select, toast, confirmBox, todayLocal, addDays, longDate, hrs, dash } from '../dom.js';
import { get, post } from '../api.js';
import { statusChip, groupOf } from './today.js';

const MODES = [
  ['times', 'تسجيل أو تعديل حركات الحضور والانصراف'],
  ['status', 'تغيير حالة اليوم (حاضر / غياب / نوع إجازة أو مهمة)'],
  ['leave', 'منح إجازة (طلب معتمد يُخصم من الرصيد)'],
  ['permit', 'منح إذن مغادرة أو تأخير'],
  ['clear', 'مسح التصحيحات اليدوية (العودة لحركات البوابة)'],
];
const PURPOSES = [['annual', 'اعتيادية (سنوية)'], ['sick', 'مرضية'], ['emergency', 'طارئة'], ['other', 'أخرى']];

const names = (list) => (list.length <= 4 ? list.map((e) => e.name).join('، ') : `${list.slice(0, 4).map((e) => e.name).join('، ')} و${list.length - 4} آخرين`);

/**
 * يفتح نافذة الإجراء لموظفين محددين. employees: [{id, name}]، date: اليوم المبدئي، work: {start,end,leaveTypes}.
 * عند النجاح يُستدعى onDone().
 */
export function openManualDialog({ employees, date, work, onDone }) {
  const today = todayLocal();
  const types = Object.keys(work?.leaveTypes || {});
  let mode = 'times';

  const modeSel = select(MODES, mode, { 'aria-label': 'الإجراء', onchange: (e) => { mode = e.target.value; drawFields(); } });
  const dFrom = h('input', { type: 'date', value: date, required: true, onchange: () => { if (dTo.value < dFrom.value) dTo.value = dFrom.value; dTo.min = dFrom.value; } });
  const dTo = h('input', { type: 'date', value: date, min: date, required: true });
  const reason = h('textarea', { rows: '2', maxlength: '300', placeholder: 'السبب (مطلوب، يُحفظ في سجل التدقيق)', required: true });
  const offDays = h('input', { type: 'checkbox' });
  const err = h('div', { class: 'notice notice-err', hidden: true, role: 'alert' });
  const fields = h('div', { class: 'form-grid' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'تنفيذ');

  // ---- حقول كل إجراء
  const t = Object.fromEntries(['in', 'out', 'ret', 'dep'].map((k) => [k, h('input', { type: 'time', 'aria-label': k })]));
  const touched = new Set();
  for (const k of Object.keys(t)) t[k].addEventListener('input', () => touched.add(k));
  const full = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { t.in.value = work?.start || ''; t.dep.value = work?.end || ''; t.out.value = ''; t.ret.value = ''; ['in', 'out', 'ret', 'dep'].forEach((k) => touched.add(k)); } }, 'دوام كامل');
  const statusSel = select([['present', 'حاضر — دوام كامل (من بداية الدوام إلى نهايته)'], ['absent', 'غياب (يمسح التصحيحات اليدوية ويبقى ما سجّلته البوابة)'], ...types.map((x) => [`type:${x}`, `نوع: ${x} (بلا طلب ولا خصم من الرصيد)`])], 'present', { 'aria-label': 'الحالة' });
  const purpose = select(PURPOSES, 'annual', { 'aria-label': 'نوع الإجازة' });
  const leaveType = select([['', '— حسب النوع —'], ...types.map((x) => [x, x])], '', { 'aria-label': 'نوع الإجازة في السجل' });
  const permitKind = select([['exit', 'إذن مغادرة'], ['late', 'إذن تأخير']], 'exit', { 'aria-label': 'نوع الإذن' });
  const pFrom = h('input', { type: 'time', value: '' });
  const pTo = h('input', { type: 'time', value: '' });

  function drawFields() {
    const offBox = h('label', { class: 'check span-all' }, offDays, h('span', null, 'تضمين أيام العطلة (تُتخطّى افتراضياً)'));
    clear(fields).append(
      field('من تاريخ', dFrom), field(mode === 'permit' ? 'اليوم (يوم واحد)' : 'إلى تاريخ', dTo));
    dTo.disabled = mode === 'permit';
    if (mode === 'permit') dTo.value = dFrom.value;
    if (mode === 'times') {
      fields.append(
        h('div', { class: 'span-all' }, h('div', { class: 'row-actions' }, h('strong', null, 'الأوقات'), full)),
        field('حضور', t.in), field('انصراف', t.dep), field('خروج', t.out), field('عودة', t.ret),
        h('p', { class: 'field-hint span-all' }, 'اترك الحقل الذي لا تريد تغييره كما هو. لمسح وقت مسجّل يدوياً اكتبه ثم احذفه. الأوقات اليدوية تتقدّم على حركات البوابة.'),
        offBox);
    } else if (mode === 'status') {
      fields.append(h('div', { class: 'span-all' }, field('الحالة الجديدة', statusSel)), offBox);
    } else if (mode === 'leave') {
      fields.append(
        field('نوع الإجازة', purpose), field('نوعها في سجل الحضور', leaveType),
        h('p', { class: 'field-hint span-all' }, 'تُنشأ لكل موظف إجازة معتمدة (تُخصم من رصيده وتدخل التايم شيت وتُطبع). ترفضها النظام إن تقاطعت مع إجازة أخرى له.'));
    } else if (mode === 'permit') {
      fields.append(
        field('النوع', permitKind), field('الغرض', purpose),
        field('من الساعة', pFrom), field('إلى الساعة', pTo),
        h('p', { class: 'field-hint span-all' }, 'يُسجَّل الإذن معتمداً، ويُعفى يومه من العجز بقدر مدته (بحسب إعداد الإعفاء).'));
    } else {
      fields.append(h('p', { class: 'field-hint span-all' }, 'يزيل الأوقات اليدوية والنوع اليدوي لهذه الأيام فيعود الحساب إلى حركات البوابة. لا يمسّ إجازة معتمدة بطلب ولا إعلان طارئ.'), offBox);
    }
    submit.textContent = mode === 'leave' ? 'منح الإجازة' : mode === 'permit' ? 'منح الإذن' : mode === 'clear' ? 'مسح التصحيحات' : 'حفظ';
  }

  const timesBody = () => {
    const set = {};
    for (const k of touched) set[k] = t[k].value;
    return { set };
  };

  async function viaManual(extra = {}) {
    const base = { employeeIds: employees.map((e) => e.id), from: dFrom.value, to: dTo.value, reason: reason.value.trim(), includeOffDays: offDays.checked, ...extra };
    if (mode === 'times') Object.assign(base, timesBody());
    else if (mode === 'clear') base.clear = true;
    else {
      const v = statusSel.value;
      if (v === 'present') base.set = { in: work.start, dep: work.end, out: '', ret: '' };
      else if (v === 'absent') base.clear = true;
      else base.leaveType = v.slice(5);
    }
    try {
      return await post('/api/attendance/manual', base);
    } catch (e) {
      if (!e.body?.needsRelease) throw e;
      const lines = e.body.conflicts.map((c) => `${c.name || c.employeeId} — ${c.date} (طلب #${c.requestId})`).join('\n');
      const ok = await confirmBox(`${e.body.error}\n\n${lines}`, 'نعم، ألغِ هذه الأيام من الإجازة وسجّل', true);
      if (!ok) throw new Error('لم يُنفَّذ شيء');
      return post('/api/attendance/manual', { ...base, releaseLeave: true });
    }
  }

  async function viaRequests() {
    const failed = [];
    let done = 0;
    for (const e of employees) {
      try {
        await post('/api/requests', mode === 'leave'
          ? { kind: 'leave', purpose: purpose.value, purposeOther: purpose.value === 'other' ? reason.value.trim().slice(0, 80) : undefined, reason: reason.value.trim(), fromDate: dFrom.value, toDate: dTo.value, employeeId: e.id, approve: true, leaveType: leaveType.value || undefined, medicalProof: purpose.value === 'sick' }
          : { kind: permitKind.value, purpose: purpose.value, purposeOther: purpose.value === 'other' ? reason.value.trim().slice(0, 80) : undefined, reason: reason.value.trim(), fromDate: dFrom.value, fromTime: pFrom.value, toTime: pTo.value, employeeId: e.id, approve: true });
        done += 1;
      } catch (ex) {
        failed.push(`${e.name}: ${ex.message}`);
      }
    }
    return { done, failed };
  }

  const form = h('form', { class: 'form-grid', onsubmit: async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    if (reason.value.trim().length < 3) { reason.focus(); err.textContent = 'اكتب السبب (3 أحرف على الأقل)'; err.hidden = false; return; }
    if (mode !== 'leave' && mode !== 'permit' && dTo.value > today) { err.textContent = 'الحضور اليدوي لأيام اليوم وما قبله. للأيام القادمة استعمل «منح إجازة».'; err.hidden = false; return; }
    submit.disabled = true;
    try {
      if (mode === 'leave' || mode === 'permit') {
        const r = await viaRequests();
        if (r.failed.length) {
          err.textContent = `تم لـ ${r.done} من ${employees.length}. تعذّر: ${r.failed.join(' | ')}`;
          err.hidden = false;
          if (r.done) onDone?.();
          return;
        }
        toast(`مُنحت لـ ${r.done} موظف`);
      } else {
        const r = await viaManual();
        toast(`حُدّث ${r.pairs} يوم-موظف${r.skippedOffDays ? ` (تُخطّي ${r.skippedOffDays} يوم عطلة)` : ''}${r.releasedLeaveDays ? ` · أُلغي ${r.releasedLeaveDays} يوم من إجازات معتمدة` : ''}`);
      }
      dlg.close();
      onDone?.();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      submit.disabled = false;
    }
  } },
  h('p', { class: 'span-all' }, h('strong', null, `الموظفون (${employees.length}): `), names(employees)),
  h('div', { class: 'span-all' }, field('الإجراء', modeSel)),
  h('div', { class: 'span-all' }, fields),
  h('div', { class: 'span-all' }, field('السبب', reason)),
  h('div', { class: 'span-all' }, err),
  h('div', { class: 'dlg-actions span-all' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'إلغاء'), submit));
  drawFields();
  const dlg = dialog({ title: employees.length === 1 ? `الحضور اليدوي — ${employees[0].name}` : 'الحضور اليدوي لعدة موظفين', content: form, wide: true });
  return dlg;
}

// ---------------------------------------------------------------- الصفحة
export default async function render() {
  const today = todayLocal();
  let date = today;
  let rows = [];
  let q = '';
  let center = '';
  const picked = new Set();
  const settings = await get('/api/settings').catch(() => null);
  const work = settings?.work || null;

  const head = h('header', { class: 'page-head' });
  const bar = h('div', { class: 'manual-bar' });
  const tools = h('div', { class: 'tools' });
  const box = h('div', { class: 'table-wrap' });
  const dateInput = h('input', { type: 'date', value: date, max: today, 'aria-label': 'التاريخ', onchange: (e) => e.target.value && go(e.target.value) });

  const chosen = () => rows.filter((r) => picked.has(r.id));
  const open = (list) => openManualDialog({ employees: list.map((r) => ({ id: r.id, name: r.name })), date, work, onDone: () => go(date) });

  function drawHead() {
    clear(head).append(
      h('div', null, h('h1', null, 'الحضور اليدوي'), h('p', { class: 'sub' }, `${longDate(date)} — عدّل الحركات أو الحالة أو امنح إجازة أو إذناً لموظف أو أكثر`)),
      h('div', { class: 'date-nav' },
        h('button', { type: 'button', class: 'btn', onclick: () => go(addDays(date, -1)) }, 'السابق'),
        dateInput,
        h('button', { type: 'button', class: 'btn', disabled: date >= today, onclick: () => go(addDays(date, 1)) }, 'التالي'),
        date !== today ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => go(today) }, 'اليوم') : null));
    dateInput.value = date;
  }

  function drawBar() {
    clear(bar);
    bar.hidden = picked.size === 0;
    if (!picked.size) return;
    bar.append(
      h('strong', null, `${picked.size} محدَّد`),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => open(chosen()) }, 'إجراء للمحدَّدين…'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { picked.clear(); drawTable(); } }, 'إلغاء التحديد'));
  }

  const visible = () => rows.filter((r) => (!center || r.center === center) && (!q || `${r.name} ${r.code}`.toLowerCase().includes(q.toLowerCase())));

  function drawTools() {
    const centers = [...new Set(rows.map((r) => r.center).filter(Boolean))].sort();
    clear(tools).append(
      h('input', { type: 'search', class: 'search', placeholder: 'بحث بالاسم أو الكود', value: q, 'aria-label': 'بحث', oninput: (e) => { q = e.target.value.trim(); drawTable(); } }),
      ...(centers.length > 1 ? [h('select', { 'aria-label': 'المركز', onchange: (e) => { center = e.target.value; drawTable(); } }, h('option', { value: '' }, 'كل المراكز'), centers.map((c) => h('option', { value: c, selected: c === center }, c)))] : []));
  }

  function drawTable() {
    drawBar();
    clear(box);
    const list = visible();
    if (!list.length) { box.append(h('p', { class: 'empty' }, rows.length ? 'لا نتائج مطابقة.' : 'لا موظفين.')); return; }
    const all = h('input', { type: 'checkbox', 'aria-label': 'تحديد الكل', checked: list.every((r) => picked.has(r.id)), onchange: (e) => { for (const r of list) e.target.checked ? picked.add(r.id) : picked.delete(r.id); drawTable(); } });
    box.append(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, h('th', { class: 'pick' }, all), ['الموظف', 'حضور', 'خروج', 'عودة', 'انصراف', 'الصافي', 'الحالة', ''].map((x, i) => h('th', { class: i >= 1 && i <= 5 ? 'num' : '' }, x)))),
      h('tbody', null, list.map((r) => h('tr', { class: r.alert ? 'has-alert' : '' },
        h('td', { class: 'pick' }, h('input', { type: 'checkbox', 'aria-label': `تحديد ${r.name}`, checked: picked.has(r.id), onchange: (e) => { e.target.checked ? picked.add(r.id) : picked.delete(r.id); drawBar(); } })),
        h('td', null, h('a', { href: `#/employees/${r.id}`, class: 'emp-link' }, r.name), h('div', { class: 'code' }, r.code, r.center ? ` · ${r.center}` : '')),
        h('td', { class: 'num' }, dash(r.checkIn)), h('td', { class: 'num' }, dash(r.exitFirst)), h('td', { class: 'num' }, dash(r.returnLast)), h('td', { class: 'num' }, dash(r.departure)),
        h('td', { class: 'num' }, r.netHours ? hrs(r.netHours) : '—'),
        h('td', null, statusChip(r.status, date === today), r.alert ? h('div', { class: 'alert-text' }, r.alert) : null),
        h('td', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => open([r]) }, 'تعديل')))))));
  }

  async function go(d) {
    date = d;
    drawHead();
    clear(box).append(h('p', { class: 'loading' }, 'جارٍ التحميل…'));
    try {
      rows = (await get(`/api/day?date=${d}`)).rows;
    } catch (e) {
      clear(box).append(h('div', { class: 'notice notice-err' }, e.message));
      return;
    }
    for (const id of [...picked]) if (!rows.some((r) => r.id === id)) picked.delete(id);
    drawTools();
    drawTable();
  }

  const page = h('div', { class: 'page' }, head,
    work ? null : h('div', { class: 'notice notice-warn' }, 'أدخل إعدادات الدوام أولاً من «الإعدادات والعطل».'),
    tools, bar, box);
  await go(date);
  return page;
}

export { groupOf };
