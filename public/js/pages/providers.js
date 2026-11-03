// مزوّدو الخدمة: لوحة «من في المركز الآن» (تتجدّد كل دقيقة) + قائمة المزوّدين وإجمالي الشهر.
import { h, clear, icon, toast, todayLocal, AR_MONTHS } from '../dom.js';
import { get } from '../api.js';
import { shiftMonthStr } from '../sheet-lib.js';
import { fmtRange12, fmt12 } from '../time12.js';
import { liveInfo, CONTRACT, contractNote, endingSoon, scheduleLines, fmtMin, fmtHours, dmy } from '../providers-lib.js';
import { providerDialog } from './provider-form.js';

export const monthLabel = (m) => `${AR_MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const REFRESH_MS = 60000;

export function boardCard(i) {
  const info = liveInfo(i.state);
  const lines = [];
  if (i.session) lines.push(h('p', { class: 'pv-line' }, icon('clock'), `حصة ${fmtRange12(i.session.start, i.session.end)}`));
  if (i.arrive) lines.push(h('p', { class: 'pv-line' }, icon('check'), `حضر ${fmt12(i.arrive)}`, i.depart ? ` — انصرف ${fmt12(i.depart)}` : ''));
  if (i.sinceMin) lines.push(h('p', { class: 'pv-line pv-warn' }, `لم يسجّل حضوره منذ ${fmtMin(i.sinceMin)}`));
  if (i.lateMin > 0) lines.push(h('p', { class: 'pv-line pv-warn' }, `تأخر ${fmtMin(i.lateMin)}`));
  if (i.flags?.includes('exit_no_return')) lines.push(h('p', { class: 'pv-line pv-warn' }, 'خرج ولم تُسجَّل عودته'));
  return h('article', { class: `pv-card pv-${info.tone}` },
    h('header', null, h('a', { class: 'pv-name', href: `#/providers/${i.id}` }, i.name), h('span', { class: `chip ${info.chip}` }, info.label)),
    h('p', { class: 'pv-meta' }, [i.center, i.service].filter(Boolean).join(' · ') || i.code),
    ...lines);
}

function summary(items) {
  const n = (...s) => items.filter((i) => s.includes(i.state)).length;
  return [
    ['في المركز الآن', n('present', 'present_late', 'extra'), 'chip-present'],
    ['لم يحضروا', n('noshow', 'absent'), 'chip-absent'],
    ['بانتظار حضورهم', n('waiting'), 'chip-late'],
    ['خرجوا أو بين حصتين', n('out', 'break', 'left'), 'chip-leave'],
    ['حصصهم لم تبدأ', n('upcoming'), 'chip-none'],
    ['أنهوا حصصهم', n('done'), 'chip-off'],
  ].filter(([, c]) => c > 0);
}

export default async function render() {
  let month = todayLocal().slice(0, 7);
  let data = { providers: [], canManage: false };
  let board = { items: [] };
  let centers = [];
  let center = '';
  let q = '';
  let showEnded = false;
  try { centers = (await get('/api/centers')).centers.filter((c) => c.active); } catch { /* اختيارية */ }

  const head = h('header', { class: 'page-head' });
  const boardBox = h('section', { class: 'pv-board', 'aria-label': 'من في المركز الآن' });
  const tools = h('div', { class: 'tools' });
  const box = h('div', { class: 'table-wrap' });
  const page = h('div', { class: 'page' }, head, boardBox, h('h2', { class: 'section-title' }, 'كل المزوّدين'), tools, box);

  async function openForm() {
    let employees = [];
    try { employees = (await get('/api/employees')).employees; } catch { /* قائمة المشرفين اختيارية */ }
    providerDialog({ centers, employees, onDone: (res) => { location.hash = `#/providers/${res.id}/card`; } });
  }

  function drawHead() {
    head.replaceChildren(
      h('div', null, h('h1', null, 'مزوّدو الخدمة'), h('p', { class: 'sub' }, 'معلّمون ومدرّبون بعقود محدودة: حضورهم بالبطاقة على البوابة، ومراقبة تأخرهم وغيابهم وساعاتهم')),
      data.canManage ? h('div', { class: 'date-nav' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: openForm }, icon('plus'), 'مزوّد جديد')) : null);
  }

  function drawBoard() {
    clear(boardBox);
    const items = board.items.filter((i) => i.state !== 'off');
    const refresh = h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => loadBoard(true) }, 'تحديث');
    boardBox.append(h('div', { class: 'pv-board-head' },
      h('h2', { class: 'section-title' }, 'من في المركز الآن', board.now ? h('span', { class: 'pv-now' }, ` — ${fmt12(board.now)}`) : null), refresh));
    if (!items.length) { boardBox.append(h('p', { class: 'empty' }, 'لا حصص لمزوّدي الخدمة اليوم.')); return; }
    boardBox.append(h('div', { class: 'pv-summary' }, summary(items).map(([label, c, chip]) => h('span', { class: `chip ${chip}` }, `${label}: ${c}`))));
    boardBox.append(h('div', { class: 'pv-grid' }, items.map(boardCard)));
  }

  async function loadBoard(manual = false) {
    try {
      board = await get('/api/providers/board');
      drawBoard();
      if (manual) toast('تم التحديث');
    } catch (e) {
      if (manual) toast(e.message, 'err');
    }
  }

  const visible = () => data.providers.filter((p) =>
    (showEnded || (p.active && p.contract.state !== 'ended'))
    && (!center || String(p.centerId) === center)
    && (!q || `${p.name} ${p.code} ${p.service || ''}`.includes(q)));

  function drawTools() {
    tools.replaceChildren(
      h('input', { type: 'search', class: 'search', placeholder: 'بحث بالاسم أو الرمز', 'aria-label': 'بحث', value: q, oninput: (e) => { q = e.target.value.trim(); drawTable(); } }),
      h('select', { 'aria-label': 'المركز', onchange: (e) => { center = e.target.value; drawTable(); } }, h('option', { value: '' }, 'كل المراكز'), centers.map((c) => h('option', { value: c.id }, c.name))),
      h('label', { class: 'check-inline' }, h('input', { type: 'checkbox', checked: showEnded, onchange: (e) => { showEnded = e.target.checked; drawTable(); } }), 'إظهار المنتهية عقودهم والموقوفين'),
      h('div', { class: 'date-nav' },
        h('button', { type: 'button', class: 'btn', onclick: () => go(shiftMonthStr(month, -1)) }, 'الشهر السابق'),
        h('strong', { class: 'month-label' }, monthLabel(month)),
        h('button', { type: 'button', class: 'btn', onclick: () => go(shiftMonthStr(month, 1)) }, 'الشهر التالي')));
  }

  function drawTable() {
    clear(box);
    const list = visible();
    if (!list.length) { box.append(h('p', { class: 'empty' }, data.providers.length ? 'لا نتائج مطابقة (جرّب إظهار المنتهية عقودهم).' : data.canManage ? 'لا مزوّدين بعد. أضف أول مزوّد خدمة.' : 'لا مزوّدين ضمن نطاقك.')); return; }
    box.append(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['المزوّد', 'المركز', 'العقد', 'الجدول', `ساعات ${monthLabel(month)}`, ''].map((x, i) => h('th', { class: i === 4 ? 'num' : '' }, x)))),
      h('tbody', null, list.map((p) => {
        const t = p.totals;
        const cs = CONTRACT[p.contract.state];
        return h('tr', { class: p.active ? '' : 'is-inactive' },
          h('td', null, h('a', { href: `#/providers/${p.id}/${month}` }, h('strong', null, p.name)), p.active ? null : h('span', { class: 'chip chip-none' }, 'موقوف'),
            h('div', { class: 'code' }, [p.code, p.service].filter(Boolean).join(' · '))),
          h('td', null, p.center || '—'),
          h('td', null, h('span', { class: 'pv-dates' }, `${dmy(p.contractStart)} ← ${dmy(p.contractEnd)}`), h('div', null, h('span', { class: `chip ${endingSoon(p.contract) ? 'chip-late' : cs.chip}` }, cs.label), ' ', h('span', { class: 'code' }, contractNote(p.contract)))),
          h('td', null, scheduleLines(p.schedule).map((l) => h('div', { class: 'code' }, l))),
          h('td', { class: 'num' }, t && t.scheduledMin ? [h('strong', null, fmtHours(t.countedHours)), ` / ${fmtHours(t.scheduledHours)} س`,
            t.absentDays || t.lateDays || t.unclosedDays ? h('div', { class: 'code' }, [t.absentDays ? `غياب ${t.absentDays}` : '', t.lateDays ? `تأخر ${t.lateDays}` : '', t.unclosedDays ? `ينقصه انصراف ${t.unclosedDays}` : ''].filter(Boolean).join(' · ')) : null] : '—'),
          h('td', { class: 'row-actions' },
            h('a', { class: 'btn btn-sm btn-primary', href: `#/providers/${p.id}/${month}` }, 'الملف والحضور'),
            h('a', { class: 'btn btn-sm', href: `#/providers/${p.id}/${month}/print` }, icon('printer'), 'الكشف')));
      }))));
  }

  async function go(m) {
    month = m;
    drawHead();
    clear(box).append(h('p', { class: 'loading' }, 'جارٍ التحميل…'));
    try {
      data = await get(`/api/providers?month=${month}`);
    } catch (e) {
      clear(box).append(h('div', { class: 'notice notice-err' }, e.message));
      return;
    }
    drawHead();
    drawTools();
    drawTable();
  }

  await Promise.all([go(month), loadBoard()]);
  drawBoard();
  const timer = setInterval(() => { if (!page.isConnected) clearInterval(timer); else loadBoard(); }, REFRESH_MS);
  return page;
}
