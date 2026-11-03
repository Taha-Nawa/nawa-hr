import { h, clear, todayLocal, addDays, longDate, hrs, dash } from '../dom.js';
import { get } from '../api.js';
import { fmt12, fmtRange12 } from '../time12.js';
import { monthLabel } from '../monthly-report-lib.js';
import { unclosedPanel } from './unclosed-panel.js';

// تصنيف الحالة القادمة من المحرك إلى مجموعة للعرض واللون.
const GROUPS = [
  { id: 'present', label: 'حاضر' },
  { id: 'late', label: 'متأخر' },
  { id: 'absent', label: 'غياب' },
  { id: 'leave', label: 'إجازة أو مهمة' },
  { id: 'off', label: 'عطلة' },
  { id: 'none', label: 'بلا تسجيل' },
];

export function groupOf(status) {
  if (status === null || status === undefined) return 'none';
  if (status === 'حاضر') return 'present';
  if (status === 'متأخر') return 'late';
  if (status === 'غياب') return 'absent';
  if (status === 'عطلة أسبوعية' || status === 'عطلة رسمية') return 'off';
  return 'leave';
}

export function statusChip(status, isToday = false) {
  const g = groupOf(status);
  const text = status ?? (isToday ? 'لم يسجّل بعد' : 'لا نتيجة');
  return h('span', { class: `chip chip-${g}` }, text);
}

export default async function render({ user }) {
  const today = todayLocal();
  let date = today;
  let rows = [];
  let filter = 'all';
  let q = '';
  let center = '';

  const settings = ['hr', 'director', 'admin'].includes(user.role) ? await get('/api/settings').catch(() => null) : null;

  const head = h('header', { class: 'page-head' });
  const notice = h('div');
  const strip = h('section', { class: 'daystrip', 'aria-label': 'ملخص اليوم' });
  const tools = h('div', { class: 'tools' });
  const tableBox = h('div', { class: 'table-wrap' });
  const unclosed = unclosedPanel({ user, work: settings?.work || null, onChange: () => go(date) });
  const root = h('div', { class: 'page' }, head, notice, strip, tools, tableBox, unclosed.el);

  const dateInput = h('input', { type: 'date', value: date, 'aria-label': 'التاريخ', onchange: (e) => e.target.value && go(e.target.value) });

  let gates = [];
  let backup = null;
  let due = [];
  let noShows = []; // مزوّدو خدمة تجاوزوا مهلة بداية حصتهم دون مسح بطاقة
  async function go(d) {
    date = d;
    dateInput.value = d;
    clear(tableBox).append(h('p', { class: 'loading' }, 'جارٍ التحميل…'));
    try {
      rows = (await get(`/api/day?date=${d}`)).rows;
    } catch (e) {
      clear(tableBox).append(h('div', { class: 'notice notice-err' }, e.message));
      return;
    }
    draw();
  }

  function drawHead() {
    clear(head).append(
      h('div', null, h('h1', null, date === today ? 'اليوم' : 'لوحة اليوم'), h('p', { class: 'sub' }, longDate(date))),
      h('div', { class: 'date-nav' },
        h('button', { type: 'button', class: 'btn', onclick: () => go(addDays(date, -1)), 'aria-label': 'اليوم السابق' }, 'السابق'),
        dateInput,
        h('button', { type: 'button', class: 'btn', onclick: () => go(addDays(date, 1)), 'aria-label': 'اليوم التالي' }, 'التالي'),
        date !== today ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => go(today) }, 'اليوم') : null),
    );
  }

  function draw() {
    drawHead();
    clear(notice);
    if (date === today && gates.length) {
      notice.append(h('div', { class: 'notice notice-warn', role: 'alert' },
        h('b', null, gates.length === 1 ? 'بوابة غير متصلة: ' : 'بوابات غير متصلة: '),
        gates.map((g, i) => h('span', null, i ? '، ' : '', `${g.name || g.id}${g.center ? ` (${g.center})` : ''} — ${g.state === 'silent' ? `منذ ${g.minutesSincePing} دقيقة` : 'لا حركة ولا نبض اليوم'}`)),
        h('div', { class: 'small' }, 'حركات هذه البوابة محفوظة على جهازها وتصل عند عودة الاتصال، لكنها لا تُحتسب قبل ذلك: تأكد من الإنترنت وأن التطبيق مفتوح، أو سجّل الحضور يدوياً.')));
    }
    if (date === today && noShows.length) {
      notice.append(h('div', { class: 'notice notice-warn', role: 'alert' },
        h('b', null, noShows.length === 1 ? 'مزوّد خدمة لم يحضر: ' : 'مزوّدو خدمة لم يحضروا: '),
        noShows.map((i, k) => h('span', null, k ? '، ' : '', `${i.name}${i.center ? ` (${i.center})` : ''}${i.session ? ` — حصته ${fmtRange12(i.session.start, i.session.end)}` : ''}`)),
        ' ', h('a', { href: '#/providers' }, 'افتح لوحة المزوّدين')));
    }
    if (date === today && backup?.due) {
      notice.append(h('div', { class: 'notice notice-warn', role: 'status' },
        backup.last ? `مضى ${backup.daysSince} يوماً على آخر نسخة احتياطية. ` : 'لم تُؤخذ نسخة احتياطية من البيانات بعد. ',
        h('a', { href: '#/backup' }, 'نزّل نسخة الآن')));
    }
    if (date === today) {
      for (const d of due) {
        const mine = `#/monthly-report/${user.employeeId}/${d.month}`;
        notice.append(h('div', { class: 'notice notice-warn', role: 'status' },
          d.phase === 'soon' ? `اقترب نهاية الشهر: تقرير شهر ${monthLabel(d.month)} لم يُقدَّم بعد. ` : `تقرير شهر ${monthLabel(d.month)} لم يُقدَّم بعد. `,
          d.status === 'draft' ? 'عندك مسودة محفوظة. ' : '',
          h('a', { href: mine }, d.status === 'draft' ? 'أكمله وقدّمه' : 'ابدأ تقريرك'),
          ' · ', h('a', { href: `#/work-log/${d.month}` }, 'سجلي اليومي')));
      }
    }
    if (settings && settings.work === null) {
      notice.append(h('div', { class: 'notice notice-warn' },
        'لم تُدخل إعدادات الدوام بعد، لذلك تُحفظ حركات البوابة لكن لا تُحسب. ',
        user.role === 'admin' ? h('a', { href: '#/settings' }, 'افتح الإعدادات') : 'اطلب من مسؤول النظام إدخالها.'));
    }

    const counts = Object.fromEntries(GROUPS.map((g) => [g.id, 0]));
    for (const r of rows) counts[groupOf(r.status)]++;

    clear(strip).append(
      h('div', { class: 'strip-bar', role: 'img', 'aria-label': GROUPS.map((g) => `${g.label} ${counts[g.id]}`).join('، ') },
        GROUPS.filter((g) => counts[g.id]).map((g) => h('span', { class: `seg seg-${g.id}`, style: { flex: `${counts[g.id]} 1 0` } }))),
      h('div', { class: 'strip-legend' },
        h('button', { type: 'button', class: `tile${filter === 'all' ? ' on' : ''}`, onclick: () => { filter = 'all'; draw(); } }, h('b', null, rows.length), h('span', null, 'الكل')),
        GROUPS.map((g) => h('button', { type: 'button', class: `tile tile-${g.id}${filter === g.id ? ' on' : ''}`, disabled: !counts[g.id], onclick: () => { filter = filter === g.id ? 'all' : g.id; draw(); } },
          h('b', null, counts[g.id]), h('span', null, g.id === 'none' && date === today ? 'لم يسجّل بعد' : g.label)))),
    );

    const centers = [...new Set(rows.map((r) => r.center).filter(Boolean))].sort();
    clear(tools).append(
      h('input', { type: 'search', class: 'search', placeholder: 'بحث بالاسم أو الكود', value: q, 'aria-label': 'بحث', oninput: (e) => { q = e.target.value.trim(); drawTable(); } }),
      ...(centers.length > 1
        ? [h('select', { 'aria-label': 'المركز', onchange: (e) => { center = e.target.value; drawTable(); } }, h('option', { value: '' }, 'كل المراكز'), centers.map((c) => h('option', { value: c, selected: c === center }, c)))]
        : []), // لا نمرّر null إلى append الأصلية: تكتبه نصاً «null»
    );
    drawTable();
  }

  function drawTable() {
    const list = rows.filter((r) => (filter === 'all' || groupOf(r.status) === filter) && (!center || r.center === center) && (!q || `${r.name} ${r.code}`.includes(q)));
    clear(tableBox);
    if (!rows.length) {
      tableBox.append(h('p', { class: 'empty' }, 'لا موظفين ضمن صلاحياتك. أضف الموظفين من صفحة «الموظفون» أو استورد ملف إكسل.'));
      return;
    }
    if (!list.length) {
      tableBox.append(h('p', { class: 'empty' }, 'لا نتائج مطابقة للتصفية.'));
      return;
    }
    tableBox.append(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['الموظف', 'المركز', 'حضور', 'خروج', 'عودة', 'انصراف', 'الصافي', 'تأخر', 'الحالة'].map((t, i) => h('th', { class: i >= 2 && i <= 7 ? 'num' : '' }, t)))),
      h('tbody', null, list.map((r) => h('tr', { class: r.alert ? 'has-alert' : '' },
        h('td', null, h('a', { href: `#/employees/${r.id}`, class: 'emp-link' }, r.name), h('div', { class: 'code' }, r.code)),
        h('td', { class: 'muted' }, dash(r.center)),
        h('td', { class: 'num' }, dash(fmt12(r.checkIn))),
        h('td', { class: 'num' }, dash(fmt12(r.exitFirst))),
        h('td', { class: 'num' }, dash(fmt12(r.returnLast))),
        h('td', { class: 'num' }, dash(fmt12(r.departure))),
        h('td', { class: 'num' }, r.netHours ? hrs(r.netHours) : '—'),
        h('td', { class: 'num' }, r.lateMinutes ? `${r.lateMinutes} د` : '—'),
        h('td', null, statusChip(r.status, date === today), r.alert ? h('div', { class: 'alert-text' }, r.alert) : null))))));
  }

  // حالة البوابات (لمن يملك الصلاحية): لا تعطّل اللوحة إن تعذّرت
  try { gates = (await get('/api/gates/status')).problems || []; draw(); } catch { /* غير متاح */ }
  if (['manager', 'hr', 'director', 'admin'].includes(user.role)) {
    try { noShows = (await get('/api/providers/board')).items.filter((i) => i.state === 'noshow'); draw(); } catch { /* غير متاح */ }
  }
  if (user.employeeId != null) { try { due = (await get('/api/monthly-reports/due')).items; draw(); } catch { /* غير متاح */ } }
  if (user.role === 'admin') { try { backup = await get('/api/backup/status'); draw(); } catch { /* غير متاح */ } }
  await go(date);
  return root;
}
