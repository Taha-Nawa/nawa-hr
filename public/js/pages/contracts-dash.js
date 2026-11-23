// لوحة متابعة العقود (كما في سجل العقود القديم): بطاقات، توزيعات، تنبيهات، وتقرير الالتزامات بالتجميع.
import { h } from '../dom.js';
import { money, STATUSES, NONE_TERM } from '../contracts-lib.js';

const sum = (rows, f) => rows.reduce((s, r) => s + (f(r) || 0), 0);
const tile = (k, v, s, accent) => h('div', { class: `ct-tile${accent ? ' accent' : ''}` }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, String(v)), h('div', { class: 's' }, s));
function bars(pairs, max, warn) {
  return h('div', { class: 'ct-bars' }, pairs.map(([k, v]) => h('div', { class: 'ct-bar' },
    h('span', null, k),
    h('div', { class: 'track' }, h('i', { style: `width:${Math.round(100 * Math.min(1, v / Math.max(1, max)))}%${warn && v > 0 ? ';background:var(--red)' : ''}` })),
    h('b', null, v))));
}
const panel = (title, body) => h('section', { class: 'ct-panel' }, h('h3', null, title), body);

export const GROUPS = [['project', 'المشروع'], ['donor', 'الممول'], ['csubject', 'موضوع العقد'], ['status', 'حالة العقد'], ['area', 'المنطقة'], ['siteName', 'موقع التنفيذ']];

export function drawDash(rows) {
  const n = rows.length;
  const done = rows.filter((r) => !r.warnings.length).length;
  const term = rows.filter((r) => r.calc.terminated).length;
  const over = rows.filter((r) => r.calc.delta !== null && Math.abs(r.calc.delta) > 0.2501).length;
  const tiles = h('div', { class: 'ct-tiles' },
    tile('عدد العقود', n, 'في السجل', true),
    tile('عقود سارية', n - term, 'غير منتهية أو مفسوخة'),
    tile('عقود منتهية / مفسوخة', term, 'بإنهاء أو فسخ'),
    tile('إجمالي القيمة المعتمدة', money(sum(rows, (r) => r.calc.appr)), 'بالدولار الأمريكي', true),
    tile('إجمالي أيام التنفيذ', sum(rows, (r) => Number(r.daysAct)), 'يوم عمل معتمد'),
    tile('بيانات مكتملة', `${done} / ${n}`, over ? `تجاوز حد 25٪: ${over}` : 'لا تجاوزات لحد 25٪'));
  const terms = [...new Set(rows.map((r) => r.termType).filter((t) => t && t !== NONE_TERM))].map((t) => [t, rows.filter((r) => r.termType === t).length]);
  const panels = h('div', { class: 'ct-panels' },
    panel('توزيع العقود حسب الحالة', bars(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]), n)),
    panel('حالات الإنهاء والفسخ', bars(terms.length ? terms : [['لا توجد عقود منتهية أو مفسوخة', 0]], Math.max(1, term))),
    panel('تنبيهات تحتاج معالجة', bars([
      ['صفوف ناقصة البيانات', n - done], ['تجاوز حد الـ25٪', over],
      ['عقود بلا حساب بنكي', rows.filter((r) => !r.bank || !r.iban).length], ['عقود بلا تاريخ توقيع', rows.filter((r) => !r.dSign).length]], Math.max(1, n), true)));

  // تقرير الالتزامات
  let by = 'project';
  const body = h('div', { class: 'table-wrap' });
  const label = (r) => r[by] || '— غير محدد —';
  function drawReport() {
    const keys = [...new Set(rows.map(label))].sort((a, b) => a.localeCompare(b, 'ar'));
    const line = (list) => [list.length, new Set(list.map((r) => r.idno)).size,
      list.filter((r) => r.status === 'قيد التنفيذ').length, list.filter((r) => r.status === 'منجز ومكتمل').length, list.filter((r) => r.status === 'منتهٍ / مفسوخ').length,
      list.filter((r) => !['قيد التنفيذ', 'منجز ومكتمل', 'منتهٍ / مفسوخ'].includes(r.status)).length,
      money(sum(list, (r) => r.calc.base)), money(sum(list, (r) => r.calc.appr)), sum(list, (r) => Number(r.daysAct))];
    const heads = ['م', GROUPS.find((g) => g[0] === by)[1], 'العقود', 'مزوّدو الخدمات', 'قيد التنفيذ', 'منجزة', 'منتهية / مفسوخة', 'أخرى', 'القيمة التعاقدية', 'القيمة المعتمدة', 'أيام التنفيذ'];
    body.replaceChildren(h('table', { class: 'tbl stack' },
      h('thead', null, h('tr', null, heads.map((t) => h('th', null, t)))),
      h('tbody', null, keys.map((k, i) => h('tr', null, h('td', null, i + 1), h('td', null, k), line(rows.filter((r) => label(r) === k)).map((x) => h('td', { class: 'num' }, x))))),
      h('tfoot', null, h('tr', null, h('td', null, ''), h('td', null, h('strong', null, 'الإجمالي')), line(rows).map((x) => h('td', { class: 'num' }, h('strong', null, x)))))));
  }
  drawReport();
  const report = panel('تقرير الالتزامات', h('div', null,
    h('div', { class: 'tools' }, h('label', { class: 'check-inline' }, 'التجميع حسب ',
      h('select', { 'aria-label': 'التجميع', onchange: (e) => { by = e.target.value; drawReport(); } }, GROUPS.map(([k, t]) => h('option', { value: k }, t))))),
    body));
  return h('div', { class: 'ct-dash' }, h('p', { class: 'sub' }, `إجمالي ${n} عقد في السجل.`), tiles, panels, report);
}
