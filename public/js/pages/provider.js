// ملف مزوّد الخدمة: بياناته وعقده وجدوله وبطاقته، وكشف حضوره الشهري يوماً بيوم مع التصحيح اليدوي لمن يملك الصلاحية.
import { h, clear, dialog, field, select, toast, icon, todayLocal, confirmBox, AR_DAYS } from '../dom.js';
import { get, post, del } from '../api.js';
import { shiftMonthStr } from '../sheet-lib.js';
import { fmt12, fmtRange12, timeField } from '../time12.js';
import { dayInfo, CONTRACT, contractNote, endingSoon, scheduleLines, fmtMin, fmtHours, dmy, exitsText, dayNotes } from '../providers-lib.js';
import { providerDialog } from './provider-form.js';
import { monthLabel } from './providers.js';

const TYPES = ['حضور', 'خروج', 'عودة', 'انصراف'];

export default async function render({ params }) {
  const id = Number(params.id);
  let month = /^\d{4}-\d{2}$/.test(params.month || '') ? params.month : todayLocal().slice(0, 7);
  let detail = null;
  let data = null;
  const box = h('div', { class: 'page' });

  async function load() {
    [detail, data] = await Promise.all([get(`/api/providers/${id}`), get(`/api/providers/${id}/month?month=${month}`)]);
    draw();
  }

  // ---- نافذة حركات يوم: الحالية (مع حذف) + إضافة يدوية
  function movesDialog({ date = null, moves = [] }) {
    const dateInput = h('input', { type: 'date', required: true, value: date || '', max: todayLocal() });
    const note = h('input', { type: 'text', maxlength: 200, placeholder: 'السبب (إلزامي): مثال: نسي المسح، عطل في البوابة', required: true });
    const rows = [];
    const rowsBox = h('div', { class: 'sched-rows' });
    const addRow = (type = 'حضور') => {
      const t = select(TYPES.map((x) => [x, x]), type, { 'aria-label': 'نوع الحركة' });
      const tm = timeField({ label: 'الوقت' });
      const row = { t, tm };
      row.el = h('div', { class: 'sched-row mv-row' }, field('الحركة', t), field('الوقت', tm),
        h('button', { type: 'button', class: 'icon-btn sched-del', 'aria-label': 'حذف السطر', onclick: () => { rows.splice(rows.indexOf(row), 1); row.el.remove(); } }, icon('trash')));
      rows.push(row);
      rowsBox.append(row.el);
    };
    addRow('حضور');
    addRow('انصراف');
    const err = h('div', { class: 'notice notice-err', role: 'alert', hidden: true });
    const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'إضافة الحركات');
    const existing = moves.length ? h('div', { class: 'mv-list' }, h('h3', null, 'الحركات المسجّلة'),
      moves.map((m) => h('div', { class: 'mv-item' },
        h('strong', null, m.type), h('span', null, fmt12(m.time)), h('span', { class: 'code' }, m.manual ? `يدوي${m.note ? ` — ${m.note}` : ''}` : `بوابة ${m.device || ''}`),
        h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: async () => {
          if (!(await confirmBox(`حذف حركة «${m.type}» الساعة ${fmt12(m.time)}؟ تُسجَّل العملية في سجل التدقيق.`, 'احذفها', true))) return;
          try { await del(`/api/providers/${id}/moves/${encodeURIComponent(m.id)}`); dlg.close(); toast('حُذفت الحركة'); await load(); } catch (e) { toast(e.message, 'err'); }
        } }, icon('trash'), 'حذف')))) : null;
    const form = h('form', { class: 'form-grid', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      const fail = (m) => { err.textContent = m; err.hidden = false; };
      if (!dateInput.value) return fail('حدّد التاريخ');
      if (!rows.length) return fail('أضف حركة واحدة على الأقل');
      if (rows.some((r) => !r.tm.value)) return fail('أكمل وقت كل حركة');
      if (!note.value.trim()) return fail('اكتب سبب التسجيل اليدوي');
      submit.disabled = true;
      try {
        await post(`/api/providers/${id}/moves`, { date: dateInput.value, note: note.value, moves: rows.map((r) => ({ type: r.t.value, time: r.tm.value })) });
        dlg.close();
        toast('أُضيفت الحركات');
        await load();
      } catch (ex) { fail(ex.message); submit.disabled = false; }
    } },
    existing ? h('div', { class: 'span-all' }, existing) : null,
    existing ? h('div', { class: 'span-all' }, h('h3', null, 'إضافة حركات ناقصة')) : null,
    date ? null : field('التاريخ', dateInput),
    h('div', { class: date ? 'span-all' : '' }, field('السبب', note)),
    h('div', { class: 'span-all' }, rowsBox, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => addRow('خروج') }, icon('plus'), 'حركة أخرى')),
    h('div', { class: 'span-all' }, err),
    h('div', { class: 'dlg-actions span-all' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'إغلاق'), submit));
    if (date) dateInput.value = date;
    const dlg = dialog({ title: date ? `حركات ${AR_DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${dmy(date)}` : 'تسجيل حضور يدوي', content: form, wide: true });
  }

  async function edit() {
    let centers = [];
    let employees = [];
    try { [centers, employees] = await Promise.all([get('/api/centers').then((r) => r.centers), get('/api/employees').then((r) => r.employees)]); } catch { /* اختيارية */ }
    providerDialog({ p: detail.provider, schedule: detail.schedule, centers, employees, onDone: load });
  }

  async function reissue() {
    if (!(await confirmBox('تُلغى البطاقة الحالية فوراً وتصدر بطاقة جديدة (للضياع أو التلف). تُطبع البطاقة الجديدة بعد ذلك. متابعة؟', 'أصدر بطاقة جديدة', true))) return;
    try {
      await post(`/api/providers/${id}/card`);
      location.hash = `#/providers/${id}/card`;
    } catch (e) { toast(e.message, 'err'); }
  }

  const info = (k, v) => [h('dt', null, k), h('dd', null, v || '—')];

  function drawInfo() {
    const p = detail.provider;
    const cs = CONTRACT[p.contract.state];
    return h('section', { class: 'panel' },
      h('dl', { class: 'info' },
        info('الرمز', h('span', { dir: 'ltr' }, p.code)),
        info('نوع الخدمة', p.service),
        info('المركز', p.center),
        info('المشروع', p.project),
        info('المشرف المسؤول', p.supervisor),
        info('الهاتف', p.phone ? h('span', { dir: 'ltr' }, p.phone) : null),
        info('العقد', [`${dmy(p.contractStart)} ← ${dmy(p.contractEnd)} `, h('span', { class: `chip ${endingSoon(p.contract) ? 'chip-late' : cs.chip}` }, cs.label), ' ', h('span', { class: 'code' }, contractNote(p.contract))]),
        info('جدول الدوام', scheduleLines(detail.schedule).map((l) => h('div', null, l))),
        p.notes ? info('ملاحظات', p.notes) : null),
      endingSoon(p.contract) ? h('div', { class: 'notice notice-warn' }, 'يقترب انتهاء العقد: عند انتهائه تتوقف بطاقته عن العمل على البوابة تلقائياً. لتمديده عدّل تاريخ النهاية.') : null,
      p.active ? null : h('div', { class: 'notice' }, 'هذا المزوّد موقوف: بطاقته لا تعمل على البوابة.'),
      detail.canManage ? h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: edit }, 'تعديل البيانات والعقد والجدول'),
        h('a', { class: 'btn btn-sm', href: `#/providers/${id}/card` }, icon('qr'), 'طباعة البطاقة'),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: reissue }, icon('key'), 'إصدار بطاقة جديدة (ضاعت أو تلفت)')) : null);
  }

  function stat(label, value, sub, tone = '') {
    return h('div', { class: `pv-stat ${tone}`.trim() }, h('span', { class: 'pv-stat-label' }, label), h('strong', null, value), sub ? h('span', { class: 'pv-stat-sub' }, sub) : null);
  }

  function drawTotals() {
    const t = data.totals;
    return h('div', { class: 'pv-stats' },
      stat('الساعات المحتسبة', `${fmtHours(t.countedHours)} س`, `من ${fmtHours(t.scheduledHours)} س مجدولة حتى اليوم`, 'ok'),
      stat('أيام الحضور', `${t.attendedDays}`, `من ${t.sessionDays} يوم فيه حصص`),
      stat('أيام الغياب', `${t.absentDays}`, t.absentDays ? 'لم يحضر أي حصة' : 'لا غياب', t.absentDays ? 'bad' : ''),
      stat('التأخر', t.lateDays ? `${t.lateDays} أيام` : '—', t.lateMin ? `إجمالي ${fmtMin(t.lateMin)}` : 'ملتزم بالبداية', t.lateDays ? 'warn' : ''),
      stat('انصراف مبكر', t.earlyDays ? `${t.earlyDays} أيام` : '—', t.earlyMin ? `إجمالي ${fmtMin(t.earlyMin)}` : '', t.earlyDays ? 'warn' : ''),
      t.unclosedDays ? stat('ينقصها انصراف', `${t.unclosedDays}`, 'لا تُحتسب ساعاتها حتى تُصحَّح', 'bad') : null);
  }

  function drawTable() {
    if (!data.days.length) return h('div', { class: 'table-wrap' }, h('p', { class: 'empty' }, 'لا حصص ولا حركات في هذا الشهر.'));
    return h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['اليوم', 'الحصة', 'الوصول', 'الخروج ← العودة', 'الانصراف', 'المحتسب', 'الحالة', detail.canManage ? '' : null].filter((x) => x !== null).map((x, i) => h('th', { class: i === 5 ? 'num' : '' }, x)))),
      h('tbody', null, data.days.map((d) => {
        const info = dayInfo(d.status);
        const notes = dayNotes(d);
        return h('tr', { class: d.future ? 'is-future' : '' },
          h('td', null, h('strong', null, AR_DAYS[d.dow]), h('div', { class: 'code' }, dmy(d.date))),
          h('td', null, d.sessions.length ? d.sessions.map((s) => h('div', null, fmtRange12(s.start, s.end))) : '—'),
          h('td', null, d.arrive ? fmt12(d.arrive) : '—'),
          h('td', null, exitsText(d.exits) || '—'),
          h('td', null, d.depart ? fmt12(d.depart) : '—'),
          h('td', { class: 'num' }, d.future ? '—' : d.sessions.length ? [h('strong', null, fmtMin(d.countedMin)), h('div', { class: 'code' }, `من ${fmtMin(d.scheduledMin)}`)] : '—'),
          h('td', null, h('span', { class: `chip ${info.chip}` }, info.label), notes.length ? h('div', { class: 'alert-text' }, notes.join(' · ')) : null),
          detail.canManage ? h('td', { class: 'row-actions' }, d.future ? null : h('button', { type: 'button', class: 'btn btn-sm', onclick: () => movesDialog({ date: d.date, moves: d.moves }) }, 'الحركات')) : null);
      }))));
  }

  function draw() {
    const p = detail.provider;
    clear(box).append(
      h('header', { class: 'page-head' },
        h('div', null, h('a', { href: '#/providers', class: 'back' }, 'كل المزوّدين'), h('h1', null, p.name), h('p', { class: 'sub' }, [p.service, p.center, p.project].filter(Boolean).join(' — ') || p.code)),
        h('div', { class: 'row-actions' }, h('a', { class: 'btn', href: `#/providers/${id}/${month}/print` }, icon('printer'), 'كشف الشهر للطباعة'))),
      drawInfo(),
      h('div', { class: 'page-head pv-month-head' },
        h('h2', { class: 'section-title' }, 'الحضور الشهري'),
        h('div', { class: 'date-nav' },
          h('a', { class: 'btn', href: `#/providers/${id}/${shiftMonthStr(month, -1)}` }, 'الشهر السابق'),
          h('strong', { class: 'month-label' }, monthLabel(month)),
          h('a', { class: 'btn', href: `#/providers/${id}/${shiftMonthStr(month, 1)}` }, 'الشهر التالي'),
          detail.canManage ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => movesDialog({}) }, icon('plus'), 'تسجيل حضور يدوي') : null)),
      drawTotals(),
      drawTable(),
      h('p', { class: 'field-hint' }, `الساعات المحتسبة هي زمن وجوده في المركز خلال حصصه فقط (الوصول المبكر والبقاء بعد النهاية لا يُحتسبان). التأخر والانصراف المبكر ضمن ${data.rules.lateGraceMin} دقائق لا يُخصمان. يوم فيه حضور بلا انصراف لا تُحتسب ساعاته حتى يُصحَّح.`));
  }

  await load();
  return box;
}
