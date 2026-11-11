// الهيكلية الإدارية: مخطط هرمي تفاعلي (بطاقات، تنبيهات لكل موظف، لوحة تفاصيل)، قائمة، حسب المركز، وسلامة الهيكل.
// للموارد البشرية والمدير العام والمسؤول.
import { h, clear, icon } from '../dom.js';
import { get } from '../api.js';
import { openLifecycleDialog } from './lifecycle.js';
import { initials } from '../employee-lib.js';

const PALETTE = ['#a21008', '#3f5a24', '#34557d', '#b07d00', '#6b3f7a', '#0f766e', '#9a3412', '#475569'];
const SEV = { high: 3, mid: 2, low: 1 };
const SEV_NAME = ['', 'low', 'mid', 'high'];
const SEV_LABEL = { high: 'مهم', mid: 'متوسط', low: 'بسيط' };
const LEVEL = { high: ['chip-absent', 'مهم'], mid: ['chip-late', 'متوسط'], low: ['chip-none', 'بسيط'] };
const GRADE_CLASS = { 'ممتاز': 'chip-present', 'جيد': 'chip-present', 'يحتاج مراجعة': 'chip-late', 'ضعيف': 'chip-absent' };
const SVG = 'http://www.w3.org/2000/svg';

export default async function render({ user }) {
  const canAct = ['hr', 'admin'].includes(user.role);
  const data = await get('/api/org');
  const byId = new Map(data.employees.map((e) => [e.id, e]));
  const node = new Map(data.org.nodes.map((n) => [n.id, n]));
  const children = new Map();
  for (const n of data.org.nodes) if (n.parent != null) (children.get(n.parent) || children.set(n.parent, []).get(n.parent)).push(n.id);
  for (const list of children.values()) list.sort((a, b) => (node.get(b).team - node.get(a).team) || byId.get(a).code.localeCompare(byId.get(b).code));
  const colorOf = (cid) => PALETTE[(Number(cid) || 0) % PALETTE.length];
  const pathUp = (id) => { const out = []; for (let c = id; c != null && out.length < 30; c = node.get(c)?.parent) out.push(c); return out; };

  // تنبيهات كل موظف مشتقة من فحوص سلامة الهيكل
  const flags = new Map();
  for (const c of data.org.checks) for (const it of c.items) {
    if (it.id == null) continue;
    (flags.get(it.id) || flags.set(it.id, []).get(it.id)).push({ level: c.level, title: c.title, why: c.why, fix: c.fix, detail: it.detail, check: c.id });
  }
  const sevOf = (id) => (flags.get(id) || []).reduce((m, f) => Math.max(m, SEV[f.level]), 0);
  const lvlCount = { high: 0, mid: 0, low: 0 };
  for (const fl of flags.values()) for (const l of new Set(fl.map((f) => f.level))) lvlCount[l]++;
  const onLeaveN = data.employees.filter((e) => e.onLeave && e.status === 'active').length;
  const pendingN = data.employees.reduce((s, e) => s + (e.status === 'active' ? e.pendingRequests : 0), 0);

  // ---- الحالة
  let tab = 'chart';
  let q = '';
  let centerF = '';
  let flagF = '';
  let hiC = '';
  let selected = null;
  let focus = null;
  let zoom = 1;
  let showInactive = false;
  let pendingFit = true;
  let scrollTo = null;
  let panelMin = false;
  let panelPos = null;
  try { panelPos = JSON.parse(localStorage.getItem('nawa.org.panel') || 'null'); } catch { panelPos = null; }
  const open = new Set(data.org.nodes.filter((n) => n.depth !== null && n.depth <= 1).map((n) => n.id));
  const seen = new Set();
  const body = h('div', { class: 'org-body' });

  const matches = (e) => (!q || `${e.name} ${e.code} ${e.jobTitle || ''}`.toLowerCase().includes(q)) && (!centerF || String(e.centerId) === centerF);
  const flagOk = (e) => !flagF || (flagF === 'any' ? flags.has(e.id) : (flags.get(e.id) || []).some((f) => f.level === flagF));
  const pass = (e) => matches(e) && flagOk(e);
  const searching = () => !!(q || centerF || flagF);
  const hits = (id) => pass(byId.get(id)) || (children.get(id) || []).some(hits);
  const act = (e) => openLifecycleDialog({ emp: e, centers: data.centers, people: data.employees, onDone: () => location.reload() });

  function select(id, reveal = true) {
    selected = id;
    if (reveal && id != null) { for (const a of pathUp(id).slice(1)) open.add(a); scrollTo = id; }
    draw();
  }

  // ================================================================ المخطط الهرمي
  const cardEls = new Map();
  function photoEl(e) {
    const box = h('span', { class: 'oc-av', 'aria-hidden': 'true' }, initials(e.name));
    if (/^https:\/\//.test(e.photo || '')) {
      const img = h('img', { alt: '', referrerpolicy: 'no-referrer', decoding: 'async' });
      img.addEventListener('load', () => { box.classList.add('has-photo'); box.replaceChildren(img); });
      img.src = e.photo;
    }
    return box;
  }
  function chartNode(id, depth) {
    const e = byId.get(id);
    const n = node.get(id);
    const all = children.get(id) || [];
    const kids = all.filter((c) => !searching() || hits(c));
    const isOpen = searching() || open.has(id);
    const sev = sevOf(id);
    const fl = flags.get(id) || [];
    const hit = searching() && pass(e);
    const fresh = !seen.has(id);
    seen.add(id);
    const card = h('div', {
      class: `oc-card${hit ? ' oc-hit' : ''}${selected === id ? ' oc-sel' : ''}${hiC && String(e.centerId) !== hiC ? ' oc-dim' : ''}${fresh ? ' oc-new' : ''}`,
      tabindex: '0', role: 'button', 'data-id': String(id), 'aria-label': `${e.name}، ${e.jobTitle || ''}${fl.length ? `، ${fl.length} ملاحظة` : ''}`,
      onclick: (ev) => { if (!ev.target.closest('a,.oc-tg,.oc-act')) select(id, false); },
      onkeydown: (ev) => { if (ev.key === 'Enter' && ev.target === ev.currentTarget) select(id, false); },
    },
    sev ? h('button', { type: 'button', class: `oc-pill oc-${SEV_NAME[sev]}`, title: fl.map((f) => f.title).join('\n'), onclick: () => select(id, false) }, String(fl.length)) : null,
    h('span', { class: `oc-ring${e.role ? ' acc' : ''}` }, photoEl(e)),
    h('a', { href: `#/employees/${e.id}`, class: 'oc-name', title: 'فتح ملف الموظف' }, e.name),
    h('span', { class: 'oc-job' }, e.jobTitle || '—'),
    h('span', { class: 'oc-center' }, h('i', { class: 'oc-dot' }), e.center || 'بلا مركز'),
    (e.onLeave || e.pendingRequests || !e.role) ? h('span', { class: 'oc-chips' },
      e.onLeave ? h('span', { class: 'oc-c oc-leave' }, 'في إجازة') : null,
      e.pendingRequests ? h('span', { class: 'oc-c oc-pend' }, `${e.pendingRequests} طلب`) : null,
      !e.role ? h('span', { class: 'oc-c oc-noacc' }, 'بلا حساب') : null) : null,
    canAct ? h('button', { type: 'button', class: 'oc-act', 'aria-label': `إجراء وظيفي لـ ${e.name}`, title: 'إجراء وظيفي', onclick: () => act(e) }, '⋯') : null,
    all.length ? h('button', { type: 'button', class: 'oc-tg', 'aria-expanded': String(isOpen), title: `مباشر ${n.reports} · الفريق كله ${n.team}`, onclick: () => { if (open.has(id)) open.delete(id); else open.add(id); draw(); } }, isOpen ? '▴' : '▾', ` ${n.reports}`, n.team > n.reports ? h('small', null, ` · ${n.team}`) : null) : null);
    card.style.borderTopColor = colorOf(e.centerId);
    card.style.setProperty('--d', String(Math.min(depth, 6)));
    const dot = card.querySelector('.oc-dot');
    dot.style.background = colorOf(e.centerId);
    cardEls.set(id, card);
    return h('li', null, card, isOpen && kids.length ? h('ul', null, kids.map((c) => chartNode(c, depth + 1))) : null);
  }

  let scroller;
  let canvas;
  let zoomLabel;
  function setZoom(z) {
    zoom = Math.min(1.4, Math.max(0.35, Math.round(z * 100) / 100));
    if (canvas) canvas.style.zoom = String(zoom);
    if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }
  function fit() {
    if (!canvas || !scroller) return;
    canvas.style.zoom = '1';
    const w = canvas.scrollWidth;
    const avail = scroller.clientWidth - 24;
    setZoom(w > avail ? Math.max(0.7, avail / w) : 1); // لا يصغر دون 70% كي تبقى البطاقات مقروءة (يُكمل التنقل بالسحب)
    const first = canvas.querySelector('.oc-card');
    if (first) first.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  // الطباعة: A4 أفقي بهامش 10مم، ويُصغَّر المخطط ليتسع عرضه كاملاً
  let savedZoom = null;
  window.addEventListener('beforeprint', () => {
    if (!canvas || !document.body.contains(canvas)) return;
    savedZoom = canvas.style.zoom;
    canvas.style.zoom = '1';
    const w = canvas.scrollWidth;
    canvas.style.zoom = String(Math.min(1, 1040 / Math.max(w, 1)));
  });
  window.addEventListener('afterprint', () => { if (savedZoom != null && canvas) canvas.style.zoom = savedZoom; savedZoom = null; });

  function summaryStrip() {
    const { score, grade } = data.org;
    const ring = document.createElementNS(SVG, 'svg');
    ring.setAttribute('viewBox', '0 0 44 44');
    ring.setAttribute('class', 'oc-score');
    ring.setAttribute('aria-hidden', 'true');
    const r = 18;
    const C = 2 * Math.PI * r;
    const bg = document.createElementNS(SVG, 'circle');
    const fg = document.createElementNS(SVG, 'circle');
    for (const c of [bg, fg]) { c.setAttribute('cx', '22'); c.setAttribute('cy', '22'); c.setAttribute('r', String(r)); c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', '5'); }
    bg.setAttribute('class', 'oc-score-bg');
    fg.setAttribute('class', `oc-score-fg ${score >= 75 ? 'ok' : score >= 50 ? 'mid' : 'bad'}`);
    fg.setAttribute('stroke-linecap', 'round');
    fg.setAttribute('stroke-dasharray', String(C));
    fg.setAttribute('stroke-dashoffset', String(C));
    fg.setAttribute('transform', 'rotate(-90 22 22)');
    ring.append(bg, fg);
    requestAnimationFrame(() => requestAnimationFrame(() => fg.setAttribute('stroke-dashoffset', String(C * (1 - score / 100)))));
    const fbtn = (lvl, label) => h('button', { type: 'button', class: `oc-sum oc-sum-${lvl}${flagF === lvl ? ' on' : ''}`, disabled: !lvlCount[lvl], onclick: () => { flagF = flagF === lvl ? '' : lvl; tab = 'chart'; pendingFit = true; syncFilters(); draw(); } }, h('b', null, String(lvlCount[lvl])), h('span', null, label));
    return h('div', { class: 'oc-strip' },
      h('div', { class: 'oc-health' }, ring, h('div', null, h('b', null, `${score}%`), h('span', null, `سلامة الهيكل: ${grade}`))),
      fbtn('high', 'ملاحظات مهمة'), fbtn('mid', 'متوسطة'), fbtn('low', 'بسيطة'),
      h('div', { class: 'oc-sum oc-sum-info' }, h('b', null, String(onLeaveN)), h('span', null, 'في إجازة اليوم')),
      h('div', { class: 'oc-sum oc-sum-info' }, h('b', null, String(pendingN)), h('span', null, 'طلب معلّق')));
  }

  // بطاقة التفاصيل عائمة: تُسحب من شريطها وتبقى حيث تُترك
  const floatOk = () => window.matchMedia('(min-width: 901px)').matches;
  function placePanel(panel, bar) {
    const W = 340;
    const clampPos = (x, y) => ({ x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - W - 8)), y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - 60)) });
    const apply = (x, y) => { panel.style.left = `${x}px`; panel.style.top = `${y}px`; panel.style.right = 'auto'; panel.style.bottom = 'auto'; };
    if (!floatOk()) return;
    const d = clampPos(panelPos ? panelPos.x : 24, panelPos ? panelPos.y : 96);
    apply(d.x, d.y);
    let g = null;
    bar.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('button')) return;
      g = { dx: ev.clientX - panel.offsetLeft, dy: ev.clientY - panel.offsetTop };
      bar.setPointerCapture(ev.pointerId);
      panel.classList.add('moving');
    });
    bar.addEventListener('pointermove', (ev) => { if (!g) return; const c = clampPos(ev.clientX - g.dx, ev.clientY - g.dy); apply(c.x, c.y); panelPos = c; });
    const end = () => { if (!g) return; g = null; panel.classList.remove('moving'); try { localStorage.setItem('nawa.org.panel', JSON.stringify(panelPos)); } catch { /* التخزين غير متاح */ } };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  }

  function panelEl() {
    if (selected == null) return null;
    const e = byId.get(selected);
    const n = node.get(selected);
    const fl = flags.get(selected) || [];
    const mgr = n.parent != null ? byId.get(n.parent) : null;
    const reps = children.get(selected) || [];
    const chain = pathUp(selected).reverse();
    const link = (id) => h('button', { type: 'button', class: 'oc-link', onclick: () => select(id) }, byId.get(id).name);
    const bar = h('div', { class: 'oc-p-bar', title: 'اسحب لتحريك البطاقة' },
      h('span', { class: 'oc-p-grip', 'aria-hidden': 'true' }, '⠿'),
      h('b', null, panelMin ? e.name : 'تفاصيل الموظف'),
      h('button', { type: 'button', class: 'oc-x', 'aria-label': panelMin ? 'توسيع' : 'تصغير', title: panelMin ? 'توسيع' : 'طيّ', onclick: () => { panelMin = !panelMin; draw(); } }, panelMin ? '▢' : '–'),
      h('button', { type: 'button', class: 'oc-x', 'aria-label': 'إغلاق', title: 'إغلاق (Esc)', onclick: () => select(null) }, '✕'));
    const inner = h('div', { class: 'oc-p-body' },
      h('div', { class: 'oc-p-head' }, h('span', { class: 'oc-ring acc oc-big' }, photoEl(e)),
        h('div', null, h('h3', null, e.name), h('p', { class: 'muted' }, [e.jobTitle, e.center].filter(Boolean).join(' · ')),
          h('div', { class: 'oc-p-chips' }, h('span', { class: 'chip chip-none', dir: 'ltr' }, e.code), e.status === 'active' ? h('span', { class: 'chip chip-present' }, 'على رأس العمل') : h('span', { class: 'chip chip-absent' }, 'غير فعّال'), e.onLeave ? h('span', { class: 'chip chip-late' }, 'في إجازة اليوم') : null))),
      h('div', { class: 'oc-p-actions' },
        h('a', { href: `#/employees/${e.id}`, class: 'btn btn-primary btn-sm' }, 'فتح ملف الموظف'),
        h('a', { href: `#/reports?employee=${e.id}`, class: 'btn btn-sm' }, 'التايم شيت'),
        e.status === 'active' && (children.get(selected) || []).length ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { focus = selected; pendingFit = true; draw(); } }, 'التركيز على فريقه') : null,
        canAct ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => act(e) }, 'إجراء وظيفي') : null),
      h('dl', { class: 'oc-p-dl' },
        h('div', null, h('dt', null, 'المسار الإداري'), h('dd', null, chain.length > 1 ? chain.map((id, i) => [i ? ' ‹ ' : '', id === selected ? h('b', null, byId.get(id).name) : link(id)]) : 'في قمة الهيكل')),
        h('div', null, h('dt', null, 'المدير المباشر'), h('dd', null, mgr ? link(mgr.id) : (e.managerId ? 'مدير غير فعّال أو محذوف' : '—'))),
        h('div', null, h('dt', null, 'المرؤوسون'), h('dd', null, reps.length ? [h('span', { class: 'muted' }, `${reps.length} مباشر · ${n.team} إجمالي — `), reps.map((id, i) => [i ? '، ' : '', link(id)])] : 'لا مرؤوسين')),
        h('div', null, h('dt', null, 'الحساب'), h('dd', null, e.role ? `دور «${e.role}»` : 'لا حساب فعّال')),
        h('div', null, h('dt', null, 'الطلبات المعلّقة'), h('dd', null, String(e.pendingRequests || 0))),
        e.startDate ? h('div', null, h('dt', null, 'المباشرة'), h('dd', null, e.startDate)) : null),
      h('h4', null, fl.length ? `الملاحظات (${fl.length})` : 'لا ملاحظات'),
      fl.length ? fl.map((f) => h('div', { class: `oc-flag-box oc-${f.level}` }, h('div', null, h('span', { class: `chip ${LEVEL[f.level][0]}` }, SEV_LABEL[f.level]), ' ', h('b', null, f.title)), f.detail ? h('p', null, f.detail) : null, h('p', { class: 'muted' }, f.why), h('p', null, h('b', null, 'المعالجة: '), f.fix)))
        : h('p', { class: 'muted' }, 'بيانات هذا الموظف سليمة في الهيكل.'));
    const panel = h('aside', { class: `oc-panel${panelMin ? ' min' : ''}`, 'aria-label': `تفاصيل ${e.name}` }, bar, panelMin ? null : inner);
    placePanel(panel, bar);
    return panel;
  }

  function chartView() {
    let roots = focus != null ? [focus] : data.org.roots;
    roots = roots.filter((id) => !searching() || hits(id));
    cardEls.clear();
    const legend = data.centers.map((c) => ({ c, n: data.employees.filter((e) => e.centerId === c.id && e.status === 'active').length })).filter((x) => x.n)
      .map(({ c, n }) => { const dot = h('i', { class: 'oc-dot' }); dot.style.background = colorOf(c.id); return h('button', { type: 'button', class: `oc-leg${hiC === String(c.id) ? ' on' : ''}`, 'aria-pressed': String(hiC === String(c.id)), onclick: () => { hiC = hiC === String(c.id) ? '' : String(c.id); draw(); } }, dot, `${c.name} (${n})`); });
    canvas = h('div', { class: 'oc-canvas' }, h('ul', { class: 'oc' }, roots.map((id) => chartNode(id, 0))));
    canvas.addEventListener('mouseover', (ev) => {
      const el = ev.target.closest?.('.oc-card');
      canvas.querySelectorAll('.oc-anc,.oc-cur').forEach((x) => x.classList.remove('oc-anc', 'oc-cur'));
      canvas.classList.toggle('oc-trace', !!el);
      if (!el) return;
      const id = Number(el.dataset.id);
      pathUp(id).forEach((a, i) => cardEls.get(a)?.classList.add(i ? 'oc-anc' : 'oc-cur'));
    });
    canvas.addEventListener('mouseleave', () => { canvas.classList.remove('oc-trace'); canvas.querySelectorAll('.oc-anc,.oc-cur').forEach((x) => x.classList.remove('oc-anc', 'oc-cur')); });
    scroller = h('div', { class: 'oc-scroll' }, canvas);
    // سحب بالفأرة للتنقل + ctrl/⌘ مع العجلة للتكبير
    let drag = null;
    let moved = false;
    scroller.addEventListener('pointerdown', (ev) => { if (ev.pointerType === 'mouse' && ev.button === 0) { drag = { x: ev.clientX, y: ev.clientY, l: scroller.scrollLeft, t: scroller.scrollTop }; moved = false; } });
    scroller.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      const dx = ev.clientX - drag.x;
      const dy = ev.clientY - drag.y;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      scroller.classList.add('grabbing');
      scroller.scrollLeft = drag.l - dx;
      scroller.scrollTop = drag.t - dy;
    });
    const endDrag = () => { drag = null; scroller.classList.remove('grabbing'); };
    scroller.addEventListener('pointerup', endDrag);
    scroller.addEventListener('pointerleave', endDrag);
    scroller.addEventListener('click', (ev) => { if (moved) { ev.stopPropagation(); ev.preventDefault(); moved = false; } }, true);
    scroller.addEventListener('wheel', (ev) => { if (ev.ctrlKey || ev.metaKey) { ev.preventDefault(); setZoom(zoom + (ev.deltaY < 0 ? 0.08 : -0.08)); } }, { passive: false });
    zoomLabel = h('span', { class: 'oc-zl' }, `${Math.round(zoom * 100)}%`);
    const wrap = h('div', { class: 'oc-wrap' });
    const tools = h('div', { class: 'tools oc-tools' },
      h('button', { type: 'button', class: 'btn btn-sm', 'aria-label': 'تكبير', onclick: () => setZoom(zoom + 0.1) }, '＋'), zoomLabel,
      h('button', { type: 'button', class: 'btn btn-sm', 'aria-label': 'تصغير', onclick: () => setZoom(zoom - 0.1) }, '－'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: fit }, 'ملاءمة الشاشة'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { for (const nn of data.org.nodes) if (nn.reports) open.add(nn.id); pendingFit = true; draw(); } }, 'فتح الكل'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { open.clear(); for (const nn of data.org.nodes) if (nn.depth === 0 || nn.depth === 1) open.add(nn.id); pendingFit = true; draw(); } }, 'طيّ للمستوى الثاني'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { try { (wrap.requestFullscreen || (() => {})).call(wrap); } catch { /* غير مدعوم */ } } }, 'ملء الشاشة'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => window.print() }, icon('printer'), 'طباعة'));
    const crumbs = focus != null ? h('div', { class: 'oc-crumbs' }, 'عرض فريق: ', pathUp(focus).reverse().map((id, i) => [i ? ' ‹ ' : '', id === focus ? h('b', null, byId.get(id).name) : h('button', { type: 'button', class: 'oc-link', onclick: () => { focus = node.get(id).parent == null ? null : id; pendingFit = true; draw(); } }, byId.get(id).name)]), h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { focus = null; pendingFit = true; draw(); } }, 'عرض الكل')) : null;
    const strayed = data.employees.filter((e) => e.status !== 'active' && sevOf(e.id) >= 3);
    wrap.append(
      h('div', { class: 'oc-main' }, tools, h('div', { class: 'oc-legend' }, legend, hiC ? h('button', { type: 'button', class: 'oc-link', onclick: () => { hiC = ''; draw(); } }, 'إلغاء التمييز') : h('span', { class: 'muted' }, 'اضغط مركزاً لتمييز موظفيه')), crumbs,
        roots.length ? scroller : h('div', { class: 'empty' }, h('b', null, 'لا نتائج'), h('p', { class: 'muted' }, 'غيّر البحث أو المرشحات.')),
        h('p', { class: 'muted oc-hint' }, 'اضغط البطاقة لتفتح تفاصيلها في بطاقة عائمة يمكن تحريكها وطيّها وإغلاقها. السحب للتنقل، وCtrl مع العجلة للتكبير.'),
        strayed.length ? h('div', { class: 'notice notice-err' }, h('b', null, 'خرجوا من الخدمة وما زال لهم وصول: '), strayed.map((e, i) => [i ? '، ' : '', h('button', { type: 'button', class: 'oc-link', onclick: () => select(e.id, false) }, e.name)])) : null),
      ...(selected != null ? [panelEl()] : []));
    return wrap;
  }

  // ================================================================ القائمة
  function cardOf(e) {
    const n = node.get(e.id);
    return h('div', { class: `org-card${e.status === 'active' ? '' : ' org-off'}` },
      h('a', { href: `#/employees/${e.id}`, class: 'org-name' }, e.name),
      h('span', { class: 'org-sub' }, [e.jobTitle, e.center].filter(Boolean).join(' · ')),
      n.reports ? h('span', { class: 'chip chip-none', title: 'مرؤوسون مباشرون / إجمالي الفريق' }, `${n.reports} مباشر · ${n.team} فريق`) : null,
      e.status !== 'active' ? h('span', { class: 'chip chip-absent' }, 'غير فعّال') : null,
      sevOf(e.id) ? h('span', { class: `chip ${LEVEL[SEV_NAME[sevOf(e.id)]][0]}` }, `${flags.get(e.id).length} ملاحظة`) : null,
      canAct ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => act(e) }, 'إجراء وظيفي') : null);
  }
  function branch(id) {
    const e = byId.get(id);
    const all = children.get(id) || [];
    const kids = all.filter((c) => !searching() || hits(c));
    const isOpen = searching() || open.has(id);
    return h('li', null,
      h('div', { class: 'org-row' },
        all.length ? h('button', { type: 'button', class: 'org-tg', 'aria-expanded': String(isOpen), 'aria-label': isOpen ? 'طيّ' : 'فتح', onclick: () => { if (open.has(id)) open.delete(id); else open.add(id); draw(); } }, isOpen ? '▾' : '◂') : h('span', { class: 'org-tg org-leaf' }, '•'),
        cardOf(e)),
      isOpen && kids.length ? h('ul', { class: 'org-tree' }, kids.map(branch)) : null);
  }
  function treeView() {
    const roots = data.org.roots.filter((id) => !searching() || hits(id));
    const orphans = showInactive ? data.employees.filter((e) => e.status !== 'active' && pass(e)) : [];
    return h('div', null,
      h('div', { class: 'tools' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { for (const n of data.org.nodes) if (n.reports) open.add(n.id); draw(); } }, 'فتح الكل'),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { open.clear(); draw(); } }, 'طيّ الكل')),
      roots.length ? h('ul', { class: 'org-tree org-root' }, roots.map(branch)) : h('div', { class: 'empty' }, h('b', null, 'لا نتائج')),
      orphans.length ? h('section', { class: 'panel' }, h('h3', null, 'خرجوا من الخدمة'), h('ul', { class: 'plain' }, orphans.map((e) => h('li', null, cardOf(e), e.endDate ? h('span', { class: 'muted' }, `  حتى ${e.endDate}`) : null)))) : null);
  }

  // ================================================================ حسب المركز
  function centersView() {
    return h('div', { class: 'org-centers' }, data.centers.map((c) => {
      const list = data.employees.filter((e) => e.centerId === c.id && e.status === 'active' && pass(e));
      if (!list.length && (searching() || !c.active)) return null;
      const ids = new Set(list.map((e) => e.id));
      const lead = list.filter((e) => !ids.has(e.managerId) && node.get(e.id).reports > 0);
      return h('section', { class: 'panel' },
        h('h3', null, c.name, h('span', { class: 'muted' }, `  (${list.length})`), c.active ? null : h('span', { class: 'chip chip-absent' }, 'غير فعّال')),
        lead.length ? h('p', { class: 'muted' }, `المسؤولون في المركز: ${lead.map((l) => l.name).join('، ')}`) : (list.length ? h('p', { class: 'notice notice-warn' }, 'لا مسؤول ظاهر في هذا المركز: كل مديري موظفيه من خارجه أو لا مدير لهم') : null),
        list.length ? h('ul', { class: 'plain' }, list.map((e) => h('li', null,
          h('a', { href: `#/employees/${e.id}` }, e.name), h('span', { class: 'muted' }, `  ${e.jobTitle || ''}`),
          e.managerId && byId.get(e.managerId) ? h('span', { class: 'muted' }, `  ← ${byId.get(e.managerId).name}${byId.get(e.managerId).centerId !== e.centerId ? ` (${byId.get(e.managerId).center || 'مركز آخر'})` : ''}`) : h('span', { class: 'chip chip-none' }, 'بلا مدير')))) : h('p', { class: 'muted' }, 'لا موظفين فعّالين'));
    }));
  }

  // ================================================================ سلامة الهيكل
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
          h('ul', { class: 'plain' }, c.items.slice(0, 60).map((it) => h('li', null, it.id != null ? h('button', { type: 'button', class: 'oc-link', onclick: () => { tab = 'chart'; select(it.id); } }, it.name) : it.name, it.detail ? h('span', { class: 'muted' }, `  ${it.detail}`) : null))),
          c.items.length > 60 ? h('p', { class: 'muted' }, `و${c.items.length - 60} غيرهم…`) : null))
        : h('div', { class: 'empty' }, h('b', null, 'الهيكل سليم'), h('p', { class: 'muted' }, 'لا ملاحظات على التوزيع.')));
  }

  function draw() {
    const keepL = scroller?.scrollLeft;
    const keepT = scroller?.scrollTop;
    clear(body).append(tab === 'chart' ? chartView() : tab === 'tree' ? treeView() : tab === 'centers' ? centersView() : checksView());
    for (const b of tabBar.children) b.classList.toggle('on', b.dataset.tab === tab);
    if (tab !== 'chart') return;
    setZoom(zoom);
    requestAnimationFrame(() => {
      if (pendingFit) { pendingFit = false; fit(); } else if (keepL != null && scroller) { scroller.scrollLeft = keepL; scroller.scrollTop = keepT; }
      const target = scrollTo ?? (searching() ? [...cardEls.keys()].find((id) => pass(byId.get(id))) : null);
      scrollTo = null;
      if (target != null) cardEls.get(target)?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    });
  }

  const tabBar = h('div', { class: 'seg-tabs', role: 'tablist', 'aria-label': 'عرض الهيكلية' },
    [['chart', 'المخطط الهرمي'], ['tree', 'القائمة'], ['centers', 'حسب المركز'], ['checks', 'سلامة الهيكل']].map(([k, t]) =>
      h('button', { type: 'button', role: 'tab', class: 'seg-tab', dataset: { tab: k }, onclick: () => { tab = k; pendingFit = true; draw(); } }, t, k === 'checks' && data.org.checks.length ? h('span', { class: 'count' }, String(data.org.checks.length)) : null)));

  const search = h('input', { type: 'search', placeholder: 'بحث بالاسم أو الرمز أو المسمى', 'aria-label': 'بحث', oninput: (e) => { q = e.target.value.trim().toLowerCase(); pendingFit = true; draw(); } });
  const centerSel = h('select', { 'aria-label': 'المركز', onchange: (e) => { centerF = e.target.value; pendingFit = true; draw(); } },
    h('option', { value: '' }, 'كل المراكز'), data.centers.map((c) => h('option', { value: String(c.id) }, c.name)));
  const flagSel = h('select', { 'aria-label': 'الملاحظات', onchange: (e) => { flagF = e.target.value; pendingFit = true; draw(); } },
    [['', 'كل الحالات'], ['any', 'من عليه أي ملاحظة'], ['high', 'ملاحظات مهمة'], ['mid', 'ملاحظات متوسطة'], ['low', 'ملاحظات بسيطة']].map(([v, t]) => h('option', { value: v }, t)));
  const syncFilters = () => { flagSel.value = flagF; };
  const inact = h('label', { class: 'lc-check' }, h('input', { type: 'checkbox', onchange: (e) => { showInactive = e.target.checked; draw(); } }), ' إظهار من خرجوا من الخدمة (القائمة)');
  document.addEventListener('keydown', function esc(ev) {
    if (!document.body.contains(page)) { document.removeEventListener('keydown', esc); return; }
    if (ev.key === 'Escape' && selected != null) select(null);
  });

  const s = data.org.stats;
  const page = h('div', { class: 'page org-page' },
    h('div', { class: 'page-head' }, h('h1', null, 'الهيكلية الإدارية'), h('span', { class: `chip ${GRADE_CLASS[data.org.grade] || 'chip-none'}` }, icon('check'), `${s.active} موظف · ${s.managers} مدير · ${s.levels} مستويات`)),
    summaryStrip(),
    h('div', { class: 'tools' }, tabBar, search, centerSel, flagSel, inact),
    body,
    h('p', { class: 'muted' }, canAct ? 'لنقل موظف أو إنهاء خدمته أو إعادته اضغط «إجراء وظيفي»؛ تظهر لك معاينة بما سيتغير قبل التنفيذ.' : 'للعرض فقط؛ الإجراءات الوظيفية من صلاحية الموارد البشرية.'));
  draw();
  return page;
}
