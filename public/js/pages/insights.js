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

export default async function render({ user }) {
  const full = ['hr', 'director', 'admin'].includes(user.role);
  let ym = shiftMonth(todayLocal().slice(0, 7), -1);
  const fundBox = h('div');
  const intBox = h('div');
  const trendBox = h('div');
  const patBox = h('div');
  const monthSel = select(
    Array.from({ length: 12 }, (_, i) => shiftMonth(todayLocal().slice(0, 7), -i)).map((m) => [m, m]),
    ym,
    { 'aria-label': 'الشهر', onchange: (e) => { ym = e.target.value; if (full) loadFunders(); loadTrends(); } },
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

  const arrow = (cur, prev, goodUp) => {
    if (prev === null || prev === undefined || cur === null || cur === undefined) return '';
    const d = cur - prev;
    if (Math.abs(d) < 1e-9) return ' ＝';
    const good = goodUp ? d > 0 : d < 0;
    return h('span', { class: good ? 'trend-up' : 'trend-down' }, d > 0 ? ' ▲' : ' ▼');
  };
  async function loadTrends() {
    try {
      const d = await get(`/api/insights/trends?month=${ym}`);
      clear(trendBox).append(d.rows.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, ['المركز', 'نسبة الحضور', 'مرات التأخر', 'أيام الغياب', 'ساعات الإضافي'].map((t) => h('th', null, t)))),
          h('tbody', null, d.rows.map((r) => h('tr', null,
            h('td', null, r.center),
            h('td', null, r.rate === null ? '—' : pct(r.rate), arrow(r.rate, r.prevRate, true)),
            h('td', null, String(r.late), arrow(r.late, r.prevLate, false)),
            h('td', null, String(r.absent), arrow(r.absent, r.prevAbsent, false)),
            h('td', null, hrs(r.overtime), arrow(r.overtime, r.prevOvertime, false)))))))
        : h('div', { class: 'empty' }, h('b', null, 'لا بيانات في هذا الشهر')),
      h('p', { class: 'muted' }, 'الأسهم مقارنة بالشهر السابق (أخضر = تحسّن). نسبة الحضور = أيام الحضور ÷ (الحضور + الغياب)، والإجازات المعتمدة خارج الحساب.'));
    } catch (e) {
      clear(trendBox).append(h('div', { class: 'notice notice-err' }, e.message));
    }
  }
  async function loadPatterns() {
    try {
      const d = await get('/api/insights/patterns');
      clear(patBox).append(d.employees.length
        ? h('ul', { class: 'plain' }, d.employees.map((p) => h('li', null,
          h('a', { href: `#/employees/${p.id}` }, `${p.code} — ${p.name}`),
          p.absentFlag ? h('span', { class: 'chip chip-absent' }, `غياب ${p.absent}`) : null, ' ',
          p.lateFlag ? h('span', { class: 'chip chip-late' }, `تأخر ${p.late}`) : null)))
        : h('div', { class: 'empty' }, h('b', null, 'لا أنماط مقلقة'), h('p', { class: 'muted' }, `لا أحد تأخر ${d.thresholds.late} مرات أو غاب ${d.thresholds.absent} في آخر 30 يوماً.`)),
      h('p', { class: 'muted' }, `من يتأخر ${d.thresholds.late} مرات فأكثر أو يغيب بلا إجازة ${d.thresholds.absent} فأكثر خلال 30 يوماً.`));
    } catch (e) {
      clear(patBox).append(h('div', { class: 'notice notice-err' }, e.message));
    }
  }

  const locBox = h('div');
  async function loadLocations() {
    try {
      const d = await get('/api/insights/locations?days=14');
      const flagChips = (f) => [f.outside ? h('span', { class: 'chip chip-absent' }, 'خارج النطاق') : null, f.spread ? h('span', { class: 'chip chip-late' }, 'تغيّر الموقع') : null, f.partial ? h('span', { class: 'chip chip-none' }, 'بعض الحركات بلا موقع') : null];
      clear(locBox).append(d.days.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, ['الموظف', 'اليوم', 'العلامات', 'التفاصيل'].map((t) => h('th', null, t)))),
          h('tbody', null, d.days.map((r) => h('tr', null,
            h('td', null, h('a', { href: `#/employees/${r.id}` }, `${r.code} — ${r.name}`)),
            h('td', null, r.date),
            h('td', null, ...flagChips(r.flags)),
            h('td', { class: 'muted' }, [r.maxFromCenter !== null ? `أبعد حركة ${r.maxFromCenter} م عن ${r.center} (المسموح ${r.radius})` : (r.noCenterLocation ? `موقع ${r.center} غير محدَّد` : ''), r.maxSpread ? `أقصى تباعد بين حركاته ${r.maxSpread} م` : ''].filter(Boolean).join(' — '))))))
        : h('div', { class: 'empty' }, h('b', null, 'لا مواقع مشبوهة'), h('p', { class: 'muted' }, 'لا حركات خرجت عن النطاق أو تغيّر موقعها في آخر 14 يوماً.')));
    } catch (e) {
      clear(locBox).append(h('div', { class: 'notice notice-err' }, e.message));
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
    h('div', { class: 'page-head' }, h('h1', null, full ? 'المراجعة والتسوية' : 'اتجاهات فريقي')),
    h('section', { class: 'panel' }, h('div', { class: 'page-head' }, h('h2', null, 'اتجاهات الدوام'), monthSel), trendBox),
    h('section', { class: 'panel' }, h('h2', null, 'يحتاجون انتباهاً مبكراً'), patBox),
    h('section', { class: 'panel' }, h('h2', null, 'مراجعة المواقع (آخر 14 يوماً)'), h('p', { class: 'muted' }, 'تُعلَّم الأيام التي خرجت فيها حركة عن نطاق المركز، أو تباعدت فيها حركات الموظف بعضها عن بعض. إن بقي الموقع نفسه فلا علامة.'), locBox),
    full ? h('section', { class: 'panel' }, h('h2', null, 'تسوية الممولين'), h('p', { class: 'muted' }, 'ساعات كل ممول في الشهر المختار أعلاه كما تخرج في التايم شيت نفسه (المعتمدة موزّعة بنسب كل موظف).'), fundBox) : null,
    full ? h('section', { class: 'panel-plain' }, h('h2', null, 'سلامة البيانات'), h('p', { class: 'muted' }, 'نواقص إن تُركت عطّلت التقارير أو الحضور.'), intBox) : null);
  await Promise.all([loadTrends(), loadPatterns(), loadLocations(), full ? loadFunders() : null, full ? loadIntegrity() : null]);
  return page;
}
