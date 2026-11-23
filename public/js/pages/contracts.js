// وحدة العقود: قائمة عقود اتفاق تقديم الخدمة التربوية (الشكل والأعمدة كما في سجل العقود القديم).
import { h, clear, icon } from '../dom.js';
import { get } from '../api.js';
import { money, pct, STATUSES, STATUS_CHIP } from '../contracts-lib.js';
import { contractDialog } from './contract-form.js';
import { importDialog } from './contract-import.js';
import { dedupeDialog } from './contract-dedupe.js';
import { drawOverview, drawReport, GROUPS } from './contracts-dash.js';
import { printContract, wordContract } from './contract-actions.js';

const dmy = (s) => (s ? s.split('-').reverse().join('/') : '—');

export default async function render({ user } = {}) {
  let all = [];
  let rows = [];
  let lists = null;
  let tab = 'dash';
  let flt = { q: '', status: '', term: '', flag: '', group: null };
  const head = h('header', { class: 'page-head' });
  const tabs = h('nav', { class: 'ct-tabs', 'aria-label': 'أقسام العقود' });
  const pane = h('div', null);
  const page = h('div', { class: 'page' }, head, tabs, pane);

  const FLAGS = { incomplete: 'بيانات ناقصة', over: 'تجاوز حد 25٪', nobank: 'بلا حساب بنكي', nosign: 'بلا تاريخ توقيع' };
  const matches = (r) => (!flt.status || r.status === flt.status)
    && (!flt.term || (flt.term === 'any' ? r.calc.terminated : flt.term === 'none' ? !r.calc.terminated : r.termType === flt.term))
    && (!flt.flag || (flt.flag === 'incomplete' ? r.warnings.length : flt.flag === 'over' ? r.calc.delta !== null && Math.abs(r.calc.delta) > 0.2501 : flt.flag === 'nobank' ? !r.bank || !r.iban : !r.dSign))
    && (!flt.group || (r[flt.group.by] || '— غير محدد —') === flt.group.val)
    && (!flt.q || `${r.name} ${r.idno || ''} ${r.project || ''}`.includes(flt.q));
  const go = (patch) => { flt = { q: '', status: '', term: '', flag: '', group: null, ...patch }; setTab('list'); };
  function setTab(t) {
    tab = t;
    try { sessionStorage.setItem('ct-tab', t); } catch { /* اختياري */ }
    drawTabs();
    drawPane();
  }
  function drawTabs() {
    tabs.replaceChildren(...[['dash', 'لوحة المتابعة'], ['list', `سجل العقود (${all.length})`], ['report', 'تقرير الالتزامات']].map(([k, t]) =>
      h('button', { type: 'button', class: `ct-tab${tab === k ? ' on' : ''}`, 'aria-current': tab === k ? 'page' : null, onclick: () => (k === 'list' ? go({}) : setTab(k)) }, t)));
  }
  function drawPane() {
    if (tab === 'dash') pane.replaceChildren(drawOverview(all, go));
    else if (tab === 'report') pane.replaceChildren(drawReport(all, go));
    else pane.replaceChildren(drawList());
  }
  function drawList() {
    rows = all.filter(matches);
    const sum = h('div', { class: 'pv-summary' });
    const box = h('div', { class: 'table-wrap' });
    const active = [flt.status, flt.term && (flt.term === 'any' ? 'منتهية أو مفسوخة' : flt.term === 'none' ? 'سارية' : flt.term), flt.flag && FLAGS[flt.flag], flt.group && `${GROUPS.find((g) => g[0] === flt.group.by)[1]}: ${flt.group.val}`].filter(Boolean);
    const draw = () => {
      rows = all.filter(matches);
      const n = (st) => rows.filter((r) => r.status === st).length;
      sum.replaceChildren(h('span', { class: 'chip chip-none' }, `المعروض: ${rows.length} من ${all.length}`),
        ...STATUSES.filter((st) => n(st)).map((st) => h('button', { type: 'button', class: `chip linkchip ${STATUS_CHIP[st]}`, onclick: () => go({ ...flt, status: st }) }, `${st}: ${n(st)}`)));
      drawTable(box);
    };
    const tools = h('div', { class: 'tools' },
      h('input', { type: 'search', class: 'search', placeholder: 'بحث بالاسم أو الهوية أو المشروع', 'aria-label': 'بحث', value: flt.q, oninput: (e) => { flt.q = e.target.value.trim(); draw(); } }),
      h('select', { 'aria-label': 'الحالة', onchange: (e) => go({ ...flt, status: e.target.value }) }, h('option', { value: '' }, 'كل الحالات'), STATUSES.map((st) => h('option', { value: st, selected: st === flt.status }, st))),
      active.length ? h('span', { class: 'ct-flt' }, 'التصفية: ', ...active.map((t) => h('span', { class: 'chip chip-none' }, t)), h('button', { type: 'button', class: 'btn btn-sm', onclick: () => go({}) }, 'مسح التصفية')) : null);
    draw();
    return h('div', null, tools, sum, box);
  }

  const open = (c = null) => contractDialog({ c, lists, onDone: load });

  function drawHead() {
    head.replaceChildren(
      h('div', null, h('h1', null, 'العقود'), h('p', { class: 'sub' }, 'سجل عقود اتفاق تقديم الخدمة التربوية: كل عقد يغذّي قائمة مزوّدي الخدمة')),
      h('div', { class: 'date-nav' },
        user?.role === 'admin' ? h('button', { type: 'button', class: 'btn', onclick: () => importDialog({ onDone: load }) }, icon('upload'), 'استيراد من القديم') : null,
        user?.role === 'admin' ? h('button', { type: 'button', class: 'btn', onclick: () => dedupeDialog({ onDone: load }) }, icon('check'), 'فحص المكرّرات') : null,
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => open() }, icon('plus'), 'عقد جديد')));
  }
  function drawTable(box) {
    clear(box);
    if (!rows.length) { box.append(h('p', { class: 'empty' }, 'لا عقود مطابقة.')); return; }
    const heads = ['م', 'الاسم', 'الهوية', 'فترة التنفيذ', 'الأيام', 'سعر اليوم', 'القيمة المعتمدة', 'التغيّر', 'الحالة', ''];
    box.append(h('table', { class: 'tbl ct-list' },
      h('thead', null, h('tr', null, heads.map((t) => h('th', null, t)))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('td', null, r.seq ?? '—'),
        h('td', null, h('strong', null, r.name), h('div', { class: 'code' }, [r.ctype, r.project].filter(Boolean).join(' — '))),
        h('td', { dir: 'ltr', class: 'ltr-cell' }, r.idno || '—'),
        h('td', null, `${dmy(r.dFrom)} ← ${dmy(r.dTo)}`),
        h('td', null, `${r.daysBase ?? '—'} / ${r.daysAct ?? '—'}`),
        h('td', null, r.calc.dayRate !== null ? money(r.calc.dayRate) : '—'),
        h('td', null, r.calc.appr !== null ? money(r.calc.appr) : '—'),
        h('td', null, r.calc.delta !== null ? pct(r.calc.delta) : '—'),
        h('td', null, h('span', { class: `chip ${STATUS_CHIP[r.status] || 'chip-none'}` }, r.status), ' ',
          r.warnings.length ? h('span', { class: 'chip chip-late', title: r.warnings.join('\n') }, `${r.warnings.length} ملاحظة`) : h('span', { class: 'chip chip-present' }, 'سليم')),
        h('td', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn btn-sm', onclick: () => open(r) }, 'تعديل'),
          h('button', { type: 'button', class: 'btn btn-sm', title: 'طباعة العقد A4', onclick: () => printContract(r) }, 'طباعة'),
          h('button', { type: 'button', class: 'btn btn-sm', title: 'تنزيل العقد بصيغة Word', onclick: () => wordContract(r) }, 'Word')))))));
  }
  async function load() {
    try {
      all = (await get('/api/contracts')).contracts;
      drawTabs();
      drawPane();
    } catch (e) {
      pane.replaceChildren(h('div', { class: 'notice notice-err' }, e.message));
    }
  }

  lists = await get('/api/contracts/lists');
  try { tab = sessionStorage.getItem('ct-tab') || 'dash'; } catch { /* اختياري */ }
  drawHead();
  await load();
  return page;
}
