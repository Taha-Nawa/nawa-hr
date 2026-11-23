// وحدة العقود: قائمة عقود اتفاق تقديم الخدمة التربوية (الشكل والأعمدة كما في سجل العقود القديم).
import { h, icon } from '../dom.js';
import { get } from '../api.js';
import { contractDialog } from './contract-form.js';
import { importDialog } from './contract-import.js';
import { dedupeDialog, renumberDialog } from './contract-dedupe.js';
import { drawOverview, drawReport } from './contracts-dash.js';
import { drawList, emptyFilter } from './contracts-list.js';
import { drawPeople, peopleTodo } from './contracts-people-view.js';
import { buildPeople } from '../contracts-people.js';
import { drawDoc } from './contract-doc-view.js';
import { drawLog } from './contract-log-view.js';
import { drawTemplates } from './contract-tpl-view.js';

export default async function render({ user } = {}) {
  let all = [];
  let rows = [];
  let lists = null;
  let tab = 'dash';
  let flt = emptyFilter();
  let peopleMode = '';
  let docId = null;
  const head = h('header', { class: 'page-head' });
  const tabs = h('nav', { class: 'ct-tabs', 'aria-label': 'أقسام العقود' });
  const pane = h('div', null);
  const page = h('div', { class: 'page' }, head, tabs, pane);

  const openPeople = (m) => { peopleMode = m; setTab('people'); };
  const go = (patch) => { flt = { ...emptyFilter(), ...patch }; setTab('list'); };
  async function setTab(t) {
    if (tab === 'tpl' && t !== 'tpl' && pane.firstChild?.guardLeave && !(await pane.firstChild.guardLeave())) return;
    tab = t;
    try { sessionStorage.setItem('ct-tab', t); } catch { /* اختياري */ }
    drawTabs();
    drawPane();
  }
  function drawTabs() {
    tabs.replaceChildren(...[['dash', 'لوحة المتابعة'], ['list', `سجل العقود (${all.length})`], ['people', 'مزوّدو الخدمات'], ['doc', 'نص العقد والطباعة'], ['tpl', 'الصيغ والترويسة'], ['log', 'الحركات'], ['report', 'تقرير الالتزامات']].map(([k, t]) =>
      h('button', { type: 'button', class: `ct-tab${tab === k ? ' on' : ''}`, 'aria-current': tab === k ? 'page' : null, onclick: () => (k === 'list' ? go({}) : setTab(k)) }, t)));
  }
  function drawPane(keepFocus) {
    if (tab === 'dash') pane.replaceChildren(drawOverview(all, go, peopleTodo(all, openPeople)));
    else if (tab === 'log') { pane.replaceChildren(h('p', { class: 'empty' }, 'جارٍ التحميل…')); drawLog().then((el) => { if (tab === 'log') pane.replaceChildren(el); }).catch((e) => pane.replaceChildren(h('div', { class: 'notice notice-err' }, e.message))); }
    else if (tab === 'tpl') pane.replaceChildren(drawTemplates({ lists, all }));
    else if (tab === 'doc') pane.replaceChildren(drawDoc(all, { onEdit: (r) => open(r), selected: docId, onPick: (id) => { docId = id; } }));
    else if (tab === 'people') pane.replaceChildren(drawPeople(all, go, peopleMode));
    else if (tab === 'report') pane.replaceChildren(drawReport(all, go));
    else {
      const { el } = drawList({ all, f: flt, user, onEdit: (r) => open(r), redraw: (kf) => drawPane(kf), onChanged: load });
      pane.replaceChildren(el);
      if (keepFocus) { const i = pane.querySelector('input[type=search]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
    }
  }

  const open = async (c = null) => {
    let tpls = null;
    try { tpls = await get('/api/contracts/templates'); } catch { /* النموذج يعمل بدون الصيغ */ }
    contractDialog({ c, lists, people: buildPeople(all), tpls, onDone: load });
  };

  function drawHead() {
    head.replaceChildren(
      h('div', null, h('h1', null, 'العقود'), h('p', { class: 'sub' }, 'سجل عقود اتفاق تقديم الخدمة التربوية: كل عقد يغذّي قائمة مزوّدي الخدمة')),
      h('div', { class: 'date-nav' },
        user?.role === 'admin' ? h('button', { type: 'button', class: 'btn', onclick: () => importDialog({ onDone: load }) }, icon('upload'), 'استيراد من القديم') : null,
        user?.role === 'admin' ? h('button', { type: 'button', class: 'btn', onclick: () => dedupeDialog({ onDone: load }) }, icon('check'), 'فحص المكرّرات') : null,
        user?.role === 'admin' ? h('button', { type: 'button', class: 'btn', onclick: () => renumberDialog({ onDone: load }) }, icon('check'), 'إعادة الترقيم') : null,
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => open() }, icon('plus'), 'عقد جديد')));
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
