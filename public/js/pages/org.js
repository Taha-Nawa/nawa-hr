// الهيكلية الإدارية: شجرة الرؤساء والمرؤوسين، التوزيع حسب المراكز، وسلامة الهيكل. للموارد البشرية والمدير العام والمسؤول.
import { h, clear, icon } from '../dom.js';
import { get } from '../api.js';
import { openLifecycleDialog } from './lifecycle.js';

const LEVEL = { high: ['chip-absent', 'مهم'], mid: ['chip-late', 'متوسط'], low: ['chip-none', 'بسيط'] };
const GRADE_CLASS = { 'ممتاز': 'chip-present', 'جيد': 'chip-present', 'يحتاج مراجعة': 'chip-late', 'ضعيف': 'chip-absent' };

export default async function render({ user }) {
  const canAct = ['hr', 'admin'].includes(user.role);
  const data = await get('/api/org');
  const byId = new Map(data.employees.map((e) => [e.id, e]));
  const node = new Map(data.org.nodes.map((n) => [n.id, n]));
  const children = new Map();
  for (const n of data.org.nodes) if (n.parent != null) (children.get(n.parent) || children.set(n.parent, []).get(n.parent)).push(n.id);
  for (const list of children.values()) list.sort((a, b) => (node.get(b).team - node.get(a).team) || byId.get(a).code.localeCompare(byId.get(b).code));

  let tab = 'tree';
  let q = '';
  let centerF = '';
  let showInactive = false;
  const open = new Set(data.org.roots.slice(0, 1)); // القمة مفتوحة، والباقي مطوي
  const body = h('div', { class: 'org-body' });

  const matches = (e) => (!q || `${e.name} ${e.code} ${e.jobTitle || ''}`.toLowerCase().includes(q)) && (!centerF || String(e.centerId) === centerF);

  const cardOf = (e) => {
    const n = node.get(e.id);
    return h('div', { class: `org-card${e.status === 'active' ? '' : ' org-off'}` },
      h('a', { href: `#/employees/${e.id}`, class: 'org-name' }, e.name),
      h('span', { class: 'org-sub' }, [e.jobTitle, e.center].filter(Boolean).join(' · ')),
      n.reports ? h('span', { class: 'chip chip-none', title: 'مرؤوسون مباشرون / إجمالي الفريق' }, `${n.reports} مباشر · ${n.team} فريق`) : null,
      e.status !== 'active' ? h('span', { class: 'chip chip-absent' }, 'غير فعّال') : null,
      e.status === 'active' && !e.role ? h('span', { class: 'chip chip-none', title: 'لا حساب دخول فعّال' }, 'بلا حساب') : null,
      canAct ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openLifecycleDialog({ emp: e, centers: data.centers, people: data.employees, onDone: () => location.reload() }) }, 'إجراء وظيفي') : null);
  };

  // هل في هذا الفرع ما يطابق البحث؟ (يُفتح تلقائياً أثناء البحث)
  const hits = (id) => matches(byId.get(id)) || (children.get(id) || []).some(hits);
  const searching = () => !!(q || centerF);

  function branch(id) {
    const e = byId.get(id);
    const kids = (children.get(id) || []).filter((c) => !searching() || hits(c));
    const isOpen = searching() || open.has(id);
    const row = h('div', { class: 'org-row' },
      kids.length || (children.get(id) || []).length
        ? h('button', { type: 'button', class: 'org-tg', 'aria-expanded': String(isOpen), 'aria-label': isOpen ? 'طيّ' : 'فتح', onclick: () => { if (open.has(id)) open.delete(id); else open.add(id); draw(); } }, isOpen ? '▾' : '◂')
        : h('span', { class: 'org-tg org-leaf' }, '•'),
      cardOf(e));
    return h('li', null, row, isOpen && kids.length ? h('ul', { class: 'org-tree' }, kids.map(branch)) : null);
  }

  function treeView() {
    const roots = data.org.roots.filter((id) => !searching() || hits(id));
    const orphans = showInactive ? data.employees.filter((e) => e.status !== 'active' && matches(e)) : [];
    return h('div', null,
      h('div', { class: 'tools' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { for (const n of data.org.nodes) if (n.reports) open.add(n.id); draw(); } }, 'فتح الكل'),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { open.clear(); for (const r of data.org.roots.slice(0, 1)) open.add(r); draw(); } }, 'طيّ الكل')),
      roots.length ? h('ul', { class: 'org-tree org-root' }, roots.map(branch)) : h('div', { class: 'empty' }, h('b', null, 'لا نتائج')),
      orphans.length ? h('section', { class: 'panel' }, h('h3', null, 'خرجوا من الخدمة'), h('ul', { class: 'plain' }, orphans.map((e) => h('li', null, cardOf(e), e.endDate ? h('span', { class: 'muted' }, `  حتى ${e.endDate}`) : null)))) : null);
  }

  function centersView() {
    return h('div', { class: 'org-centers' }, data.centers.map((c) => {
      const list = data.employees.filter((e) => e.centerId === c.id && e.status === 'active' && matches(e));
      if (!list.length && (searching() || !c.active)) return null;
      const ids = new Set(list.map((e) => e.id));
      const lead = list.filter((e) => ids.has(e.managerId) === false && node.get(e.id).reports > 0);
      return h('section', { class: 'panel' },
        h('h3', null, c.name, h('span', { class: 'muted' }, `  (${list.length})`), c.active ? null : h('span', { class: 'chip chip-absent' }, 'غير فعّال')),
        lead.length ? h('p', { class: 'muted' }, `المسؤولون في المركز: ${lead.map((l) => l.name).join('، ')}`) : (list.length ? h('p', { class: 'notice notice-warn' }, 'لا مسؤول ظاهر في هذا المركز: كل مديري موظفيه من خارجه أو لا مدير لهم') : null),
        list.length ? h('ul', { class: 'plain' }, list.map((e) => h('li', null,
          h('a', { href: `#/employees/${e.id}` }, e.name), h('span', { class: 'muted' }, `  ${e.jobTitle || ''}`),
          e.managerId && byId.get(e.managerId) ? h('span', { class: 'muted' }, `  ← ${byId.get(e.managerId).name}${byId.get(e.managerId).centerId !== e.centerId ? ` (${byId.get(e.managerId).center || 'مركز آخر'})` : ''}`) : h('span', { class: 'chip chip-none' }, 'بلا مدير')))) : h('p', { class: 'muted' }, 'لا موظفين فعّالين'));
    }));
  }

  function checksView() {
    const { checks, score, grade, stats } = data.org;
    return h('div', null,
      h('div', { class: 'sums' },
        h('div', { class: 'sum' }, h('b', null, `${score}%`), h('span', null, 'درجة سلامة الهيكل')),
        h('div', { class: 'sum' }, h('b', null, grade), h('span', null, 'التقييم')),
        h('div', { class: 'sum' }, h('b', null, String(stats.flagged)), h('span', null, 'موظف عليه ملاحظة'))),
      checks.length
        ? checks.map((c) => h('details', { class: 'panel', open: c.level === 'high' },
          h('summary', null, h('span', { class: `chip ${LEVEL[c.level][0]}` }, LEVEL[c.level][1]), ' ', h('b', null, c.title), h('span', { class: 'muted' }, `  (${c.items.length})`)),
          h('p', { class: 'muted' }, c.why),
          h('p', null, h('b', null, 'المعالجة: '), c.fix),
          h('ul', { class: 'plain' }, c.items.slice(0, 60).map((it) => h('li', null, h('a', { href: `#/employees/${it.id}` }, it.name), it.detail ? h('span', { class: 'muted' }, `  ${it.detail}`) : null))),
          c.items.length > 60 ? h('p', { class: 'muted' }, `و${c.items.length - 60} غيرهم…`) : null))
        : h('div', { class: 'empty' }, h('b', null, 'الهيكل سليم'), h('p', { class: 'muted' }, 'لا ملاحظات على التوزيع.')));
  }

  function draw() {
    clear(body).append(tab === 'tree' ? treeView() : tab === 'centers' ? centersView() : checksView());
    for (const b of tabBar.children) b.classList.toggle('on', b.dataset.tab === tab);
  }

  const tabBar = h('div', { class: 'seg-tabs', role: 'tablist', 'aria-label': 'عرض الهيكلية' },
    [['tree', 'الشجرة'], ['centers', 'حسب المركز'], ['checks', 'سلامة الهيكل']].map(([k, t]) =>
      h('button', { type: 'button', role: 'tab', class: 'seg-tab', dataset: { tab: k }, onclick: () => { tab = k; draw(); } }, t, k === 'checks' && data.org.checks.length ? h('span', { class: 'count' }, String(data.org.checks.length)) : null)));

  const search = h('input', { type: 'search', placeholder: 'بحث بالاسم أو الرمز أو المسمى', 'aria-label': 'بحث', oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } });
  const centerSel = h('select', { 'aria-label': 'المركز', onchange: (e) => { centerF = e.target.value; draw(); } },
    h('option', { value: '' }, 'كل المراكز'), data.centers.map((c) => h('option', { value: String(c.id) }, c.name)));
  const inact = h('label', { class: 'lc-check' }, h('input', { type: 'checkbox', onchange: (e) => { showInactive = e.target.checked; draw(); } }), ' إظهار من خرجوا من الخدمة');

  const s = data.org.stats;
  const page = h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, 'الهيكلية الإدارية'), h('span', { class: `chip ${GRADE_CLASS[data.org.grade] || 'chip-none'}` }, icon('check'), `سلامة الهيكل: ${data.org.grade} (${data.org.score}%)`)),
    h('div', { class: 'sums' },
      h('div', { class: 'sum' }, h('b', null, String(s.active)), h('span', null, 'موظف فعّال')),
      h('div', { class: 'sum' }, h('b', null, String(s.managers)), h('span', null, 'يشرفون على فرق')),
      h('div', { class: 'sum' }, h('b', null, String(s.levels)), h('span', null, 'مستويات إدارية')),
      h('div', { class: 'sum' }, h('b', null, String(s.avgSpan)), h('span', null, 'متوسط المرؤوسين')),
      h('div', { class: 'sum' }, h('b', null, String(s.maxSpan)), h('span', null, 'أكبر فريق مباشر')),
      h('div', { class: 'sum' }, h('b', null, String(s.centers)), h('span', null, 'مركز عمل'))),
    h('div', { class: 'tools' }, tabBar, search, centerSel, inact),
    body,
    h('p', { class: 'muted' }, canAct ? 'لنقل موظف أو إنهاء خدمته أو إعادته اضغط «إجراء وظيفي» بجانب اسمه؛ تظهر لك معاينة بما سيتغير قبل التنفيذ.' : 'للعرض فقط؛ الإجراءات الوظيفية من صلاحية الموارد البشرية.'));
  draw();
  return page;
}
