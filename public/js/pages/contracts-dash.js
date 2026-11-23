// لوحة متابعة العقود (كما في سجل العقود القديم): بطاقات، توزيعات، تنبيهات، وتقرير الالتزامات بالتجميع.
import { h } from '../dom.js';
import { money, STATUSES, NONE_TERM, LUMP, BID, TENDER } from '../contracts-lib.js';
import { xlsxBlob, toCSV } from '../contract-export.js';
import { saveBlob } from './contract-actions.js';

const sum = (rows, f) => rows.reduce((s, r) => s + (f(r) || 0), 0);
const tile = (k, v, s, accent, onclick) => h(onclick ? 'button' : 'div', { class: `ct-tile${accent ? ' accent' : ''}${onclick ? ' link' : ''}`, ...(onclick ? { type: 'button', onclick, title: 'اضغط لعرض هذه العقود' } : {}) }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, String(v)), h('div', { class: 's' }, s));
function bars(pairs, max, warn) {
  return h('div', { class: 'ct-bars' }, pairs.map(([k, v, go]) => h(go && v ? 'button' : 'div', { class: `ct-bar${go && v ? ' link' : ''}`, ...(go && v ? { type: 'button', onclick: go, title: 'اضغط لعرض هذه العقود' } : {}) },
    h('span', null, k),
    h('div', { class: 'track' }, h('i', { style: `width:${Math.round(100 * Math.min(1, v / Math.max(1, max)))}%${warn && v > 0 ? ';background:var(--red)' : ''}` })),
    h('b', null, v))));
}
const panel = (title, body) => h('section', { class: 'ct-panel' }, h('h3', null, title), body);

export const GROUPS = [['project', 'المشروع'], ['donor', 'الممول'], ['csubject', 'موضوع العقد'], ['status', 'حالة العقد'], ['area', 'المنطقة'], ['siteName', 'موقع التنفيذ']];

const daysTo = (d) => { if (!d) return null; const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(`${d}T00:00:00`) - t) / 86400000); };
/** «ما يحتاجك اليوم»: بنود مرتبة بالأهم، يفتح كل منها قائمة العقود المعنية. extra: بنود إضافية (المزوّدون). */
export function todoItems(rows, go, extra = []) {
  const closed = (r) => r.status === 'منجز ومكتمل' || r.status === 'منتهٍ / مفسوخ' || r.calc.terminated;
  const ended = rows.filter((r) => { const d = daysTo(r.dTo); return d !== null && d < 0 && !closed(r); });
  const soon = rows.filter((r) => { const d = daysTo(r.dTo); return d !== null && d >= 0 && d <= 30 && !closed(r); });
  const noAct = rows.filter((r) => closed(r) && r.pricing !== LUMP && (r.daysAct === null || r.daysAct === undefined || r.daysAct === ''));
  const over = rows.filter((r) => r.calc.delta !== null && Math.abs(r.calc.delta) > 0.2501);
  const noPrice = rows.filter((r) => !r.pricing || r.rate === null || r.rate === undefined || r.rate === '');
  const noRfq = rows.filter((r) => (r.ctype === BID || r.ctype === TENDER) && (!r.rfqno || !r.dRfq));
  const noBank = rows.filter((r) => !r.bank || !r.iban);
  const noFile = rows.filter((r) => ['موقّع', 'قيد التنفيذ', 'منجز ومكتمل'].includes(r.status) && !r.filesN);
  const termBad = rows.filter((r) => r.calc.terminated && (!r.termReason || r.termReason === 'لا يوجد' || !r.dTerm));
  return [
    { k: 'انتهت مدتها ولم تُغلق', c: ended.length, hot: 1, s: 'فترة التنفيذ انقضت والحالة ما زالت سارية — تُغلق أو تُمدَّد بملحق', go: () => go({ adv: { ending: 'past' } }) },
    { k: 'تنتهي خلال 30 يوماً', c: soon.length, warm: 1, s: 'جهّز التمديد أو إجراءات الإغلاق', go: () => go({ adv: { ending: '30' } }) },
    { k: 'منتهية بلا أيام معتمدة', c: noAct.length, hot: 1, s: 'لا يمكن احتساب المستحق ولا الصرف قبل اعتماد أيام التنفيذ', go: () => go({ audit: 'bad' }) },
    { k: 'تجاوزت حد الـ25٪', c: over.length, hot: 1, s: 'المادة 2-4 — تحتاج اعتماداً خطياً أو تصحيح الأيام', go: () => go({ adv: { over: 'yes' } }) },
    ...extra,
    { k: 'بلا تسعير', c: noPrice.length, hot: 1, s: 'أساس التسعير أو السعر فارغ — العقد غير قابل للاحتساب', go: () => go({ audit: 'bad' }) },
    { k: 'بلا رقم عطاء', c: noRfq.length, warm: 1, s: 'نوع العقد عطاء أو استدراج عروض ورقم الإعلان أو تاريخه ناقص', go: () => go({ audit: 'bad' }) },
    { k: 'بلا حساب بنكي', c: noBank.length, hot: 1, s: 'لا يمكن الصرف — المادة 8-1', go: () => go({ flag: 'nobank' }) },
    { k: 'بلا مستند موقّع مرفوع', c: noFile.length, warm: 1, s: 'عقود موقّعة أو منفّذة بلا نسخة موقّعة مرفوعة في النظام', go: () => go({ flag: 'nofile' }) },
    { k: 'إنهاء ناقص البيانات', c: termBad.length, warm: 1, s: 'سبب الإنهاء أو تاريخه فارغ', go: () => go({ status: 'منتهٍ / مفسوخ' }) },
  ].filter((x) => x.c > 0).sort((a, b) => (b.hot ? 1 : 0) - (a.hot ? 1 : 0) || b.c - a.c);
}

function drawTodo(rows, go, extra) {
  const items = todoItems(rows, go, extra);
  if (!items.length) return panel('ما يحتاجك اليوم', h('p', { class: 'empty' }, '✔ لا يوجد ما يحتاج معالجة — كل العقود مكتملة ومتسقة.'));
  return panel('ما يحتاجك اليوم', h('div', { class: 'ct-todo' }, items.map((it) => h('button', { type: 'button', class: `todo${it.hot ? ' hot' : it.warm ? ' warm' : ''}`, onclick: it.go },
    h('span', { class: 'cnt' }, String(it.c)), h('span', { class: 'txt' }, it.k, h('small', null, it.s))))));
}

export function drawOverview(rows, go, extra = []) {
  const n = rows.length;
  const done = rows.filter((r) => !r.warnings.length).length;
  const term = rows.filter((r) => r.calc.terminated).length;
  const over = rows.filter((r) => r.calc.delta !== null && Math.abs(r.calc.delta) > 0.2501).length;
  const tiles = h('div', { class: 'ct-tiles' },
    tile('عدد العقود', n, 'في السجل', true, () => go({})),
    tile('عقود سارية', n - term, 'غير منتهية أو مفسوخة', false, () => go({ term: 'none' })),
    tile('عقود منتهية / مفسوخة', term, 'بإنهاء أو فسخ', false, () => go({ term: 'any' })),
    tile('إجمالي القيمة المعتمدة', money(sum(rows, (r) => r.calc.appr)), 'بالدولار الأمريكي', true),
    tile('إجمالي أيام التنفيذ', sum(rows, (r) => Number(r.daysAct)), 'يوم عمل معتمد'),
    tile('بيانات مكتملة', `${done} / ${n}`, over ? `تجاوز حد 25٪: ${over}` : 'لا تجاوزات لحد 25٪', false, () => go({ flag: 'incomplete' })));
  const terms = [...new Set(rows.map((r) => r.termType).filter((t) => t && t !== NONE_TERM))].map((t) => [t, rows.filter((r) => r.termType === t).length, () => go({ term: t })]);
  const panels = h('div', { class: 'ct-panels' },
    panel('توزيع العقود حسب الحالة', bars(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length, () => go({ status: s })]), n)),
    panel('حالات الإنهاء والفسخ', bars(terms.length ? terms : [['لا توجد عقود منتهية أو مفسوخة', 0]], Math.max(1, term))),
    panel('تنبيهات تحتاج معالجة', bars([
      ['صفوف ناقصة البيانات', n - done, () => go({ flag: 'incomplete' })], ['تجاوز حد الـ25٪', over, () => go({ flag: 'over' })],
      ['عقود بلا حساب بنكي', rows.filter((r) => !r.bank || !r.iban).length, () => go({ flag: 'nobank' })], ['عقود بلا تاريخ توقيع', rows.filter((r) => !r.dSign).length, () => go({ flag: 'nosign' })]], Math.max(1, n), true)));
  return h('div', { class: 'ct-dash' }, tiles, panels, drawTodo(rows, go, extra));
}

const DONE = ['قيد التنفيذ', 'منجز ومكتمل', 'منتهٍ / مفسوخ'];
export function drawReport(rows, go) {
  let by = 'project';
  const body = h('div', { class: 'table-wrap' });
  const label = (r) => r[by] || '— غير محدد —';
  function drawIt() {
    const keys = [...new Set(rows.map(label))].sort((a, b) => a.localeCompare(b, 'ar'));
    const link = (v, patch) => (v ? h('button', { type: 'button', class: 'linkish', title: 'عرض هذه العقود', onclick: () => go(patch) }, String(v)) : String(v));
    const line = (list, g) => {
      const G = g ? { group: { by, val: g } } : {};
      return [
        link(list.length, G),
        new Set(list.map((r) => r.idno)).size,
        link(list.filter((r) => r.status === 'قيد التنفيذ').length, { ...G, status: 'قيد التنفيذ' }),
        link(list.filter((r) => r.status === 'منجز ومكتمل').length, { ...G, status: 'منجز ومكتمل' }),
        link(list.filter((r) => r.status === 'منتهٍ / مفسوخ').length, { ...G, status: 'منتهٍ / مفسوخ' }),
        list.filter((r) => !DONE.includes(r.status)).length,
        money(sum(list, (r) => r.calc.base)), money(sum(list, (r) => r.calc.appr)), sum(list, (r) => Number(r.daysAct))];
    };
    const heads = ['م', GROUPS.find((g) => g[0] === by)[1], 'العقود', 'مزوّدو الخدمات', 'قيد التنفيذ', 'منجزة', 'منتهية / مفسوخة', 'أخرى', 'القيمة التعاقدية', 'القيمة المعتمدة', 'أيام التنفيذ', 'ملاحظات'];
    const notes = (list) => { const o = list.filter((r) => r.calc.delta !== null && Math.abs(r.calc.delta) > 0.2501).length; return o ? `${o} عقداً تجاوز حد 25٪` : ''; };
    body.replaceChildren(h('table', { class: 'tbl stack' },
      h('thead', null, h('tr', null, heads.map((t) => h('th', null, t)))),
      h('tbody', null, keys.map((k, i) => h('tr', null, h('td', null, i + 1), h('td', null, link(k, { group: { by, val: k } })), line(rows.filter((r) => label(r) === k), k).map((x) => h('td', { class: 'num' }, x)), h('td', null, notes(rows.filter((r) => label(r) === k)))))),
      h('tfoot', null, h('tr', null, h('td', null, ''), h('td', null, h('strong', null, 'الإجمالي')), line(rows, null).map((x) => h('td', { class: 'num' }, x)), h('td', null, notes(rows))))));
  }
  drawIt();
  const exportIt = () => {
    const keys = [...new Set(rows.map(label))].sort((a, b) => a.localeCompare(b, 'ar'));
    const val = (list) => [list.length, new Set(list.map((r) => r.idno)).size, list.filter((r) => r.status === 'قيد التنفيذ').length, list.filter((r) => r.status === 'منجز ومكتمل').length, list.filter((r) => r.status === 'منتهٍ / مفسوخ').length, list.filter((r) => !DONE.includes(r.status)).length, sum(list, (r) => r.calc.base), sum(list, (r) => r.calc.appr), sum(list, (r) => Number(r.daysAct))];
    const names = ['العقود', 'مزوّدو الخدمات', 'قيد التنفيذ', 'منجزة', 'منتهية / مفسوخة', 'أخرى', 'القيمة التعاقدية', 'القيمة المعتمدة', 'أيام التنفيذ'];
    const data = [...keys.map((k) => [k, val(rows.filter((r) => label(r) === k))]), ['الإجمالي', val(rows)]];
    const cols = [[GROUPS.find((g) => g[0] === by)[1], (x) => x[0]], ...names.map((t, i) => [t, (x) => x[1][i]])];
    saveBlob(xlsxBlob(cols, data), `تقرير الالتزامات — ${GROUPS.find((g) => g[0] === by)[1]}.xlsx`);
  };
  return h('div', { class: 'ct-dash' }, h('div', { class: 'tools' }, h('label', { class: 'check-inline' }, 'التجميع حسب ',
    h('select', { 'aria-label': 'التجميع', onchange: (e) => { by = e.target.value; drawIt(); } }, GROUPS.map(([k, t]) => h('option', { value: k }, t)))),
  h('button', { type: 'button', class: 'btn btn-sm', onclick: exportIt }, 'تصدير التقرير Excel')), body);
}
