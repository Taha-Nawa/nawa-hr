// «المراجعة والتسوية»: تسوية الممولين الشهرية + سلامة البيانات. للموارد البشرية والمدير العام والمسؤول.
import { h, clear, select, todayLocal, hrs } from '../dom.js';
import { get } from '../api.js';

const LEVEL = { high: ['chip-absent', 'مهم'], mid: ['chip-late', 'متوسط'], low: ['chip-none', 'بسيط'] };
const pct = (x) => `${(x * 100).toFixed(1)}%`;

function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default async function render() {
  let ym = shiftMonth(todayLocal().slice(0, 7), -1);
  const fundBox = h('div');
  const intBox = h('div');
  const monthSel = select(
    Array.from({ length: 12 }, (_, i) => shiftMonth(todayLocal().slice(0, 7), -i)).map((m) => [m, m]),
    ym,
    { 'aria-label': 'الشهر', onchange: (e) => { ym = e.target.value; loadFunders(); } },
  );

  async function loadFunders() {
    clear(fundBox).append(h('p', { class: 'muted' }, 'جارٍ الحساب…'));
    try {
      const d = await get(`/api/insights/funders?month=${ym}`);
      clear(fundBox).append(
        h('div', { class: 'sums' }, h('div', { class: 'sum' }, h('b', null, hrs(d.totalHours)), h('span', null, 'ساعة موزّعة على الممولين'))),
        d.funders.length
          ? h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
            h('thead', null, h('tr', null, ['الممول / المشروع', 'الساعات', 'النسبة من الإجمالي', 'عدد الموظفين'].map((t) => h('th', null, t)))),
            h('tbody', null, d.funders.map((f) => h('tr', null, h('td', { dir: 'ltr', class: 'start' }, f.funder), h('td', null, hrs(f.hours)), h('td', null, pct(f.percent)), h('td', null, String(f.employees)))))))
          : h('div', { class: 'empty' }, h('b', null, 'لا ساعات موزّعة في هذا الشهر'), h('p', { class: 'muted' }, 'تأكد من إغلاق الشهر وتوزيع الموظفين على المشاريع.')),
        d.problems.length
          ? h('div', { class: 'notice notice-warn' }, h('b', null, 'موظفون يحتاجون مراجعة التوزيع'),
            h('ul', { class: 'plain' }, d.problems.map((p) => h('li', null, h('a', { href: `#/employees/${p.id}` }, `${p.code} — ${p.name}`), ` : ${p.issue}`))))
          : h('p', { class: 'muted' }, 'كل التوزيعات سليمة لهذا الشهر.'));
    } catch (e) {
      clear(fundBox).append(h('div', { class: 'notice notice-err' }, e.message));
    }
  }

  async function loadIntegrity() {
    try {
      const d = await get('/api/insights/integrity');
      const open = d.checks.filter((c) => c.items.length);
      clear(intBox).append(
        open.length === 0
          ? h('div', { class: 'empty' }, h('b', null, 'بياناتك سليمة'), h('p', { class: 'muted' }, 'لا نواقص تعطّل التقارير الآن.'))
          : open.map((c) => h('details', { class: 'panel', open: c.level === 'high' },
            h('summary', null, h('span', { class: `chip ${LEVEL[c.level][0]}` }, LEVEL[c.level][1]), ' ', h('b', null, c.title), h('span', { class: 'muted' }, `  (${c.items.length})`)),
            h('p', { class: 'muted' }, c.why),
            h('ul', { class: 'plain' }, c.items.slice(0, 50).map((it) => h('li', null, typeof it.id === 'number' && c.key !== 'gate' ? h('a', { href: `#/employees/${it.id}` }, it.name) : it.name, it.detail ? h('span', { class: 'muted' }, `  ${it.detail}`) : null))),
            c.items.length > 50 ? h('p', { class: 'muted' }, `و${c.items.length - 50} غيرهم…`) : null)));
    } catch (e) {
      clear(intBox).append(h('div', { class: 'notice notice-err' }, e.message));
    }
  }

  const page = h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, 'المراجعة والتسوية')),
    h('section', { class: 'panel' }, h('div', { class: 'page-head' }, h('h2', null, 'تسوية الممولين'), monthSel), h('p', { class: 'muted' }, 'ساعات كل ممول في الشهر كما تخرج في التايم شيت نفسه (المعتمدة موزّعة بنسب كل موظف).'), fundBox),
    h('section', { class: 'panel-plain' }, h('h2', null, 'سلامة البيانات'), h('p', { class: 'muted' }, 'نواقص إن تُركت عطّلت التقارير أو الحضور.'), intBox));
  await Promise.all([loadFunders(), loadIntegrity()]);
  return page;
}
