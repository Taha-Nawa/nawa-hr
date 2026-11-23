// وحدة العقود: قائمة عقود اتفاق تقديم الخدمة التربوية (الشكل والأعمدة كما في سجل العقود القديم).
import { h, clear, icon } from '../dom.js';
import { get } from '../api.js';
import { money, pct, STATUSES, STATUS_CHIP } from '../contracts-lib.js';
import { contractDialog } from './contract-form.js';
import { importDialog } from './contract-import.js';
import { dedupeDialog } from './contract-dedupe.js';
import { drawDash } from './contracts-dash.js';
import { printContract, wordContract } from './contract-actions.js';

const dmy = (s) => (s ? s.split('-').reverse().join('/') : '—');

export default async function render({ user } = {}) {
  let all = [];
  let rows = [];
  let lists = null;
  let q = '';
  let status = '';
  const head = h('header', { class: 'page-head' });
  const tools = h('div', { class: 'tools' });
  const dash = h('div', null);
  const sum = h('div', { class: 'pv-summary' });
  const box = h('div', { class: 'table-wrap' });
  const page = h('div', { class: 'page' }, head, dash, h('h2', { class: 'section-title' }, 'سجل العقود'), sum, tools, box);

  const open = (c = null) => contractDialog({ c, lists, onDone: load });

  function drawHead() {
    head.replaceChildren(
      h('div', null, h('h1', null, 'العقود'), h('p', { class: 'sub' }, 'سجل عقود اتفاق تقديم الخدمة التربوية: كل عقد يغذّي قائمة مزوّدي الخدمة')),
      h('div', { class: 'date-nav' },
        user?.role === 'admin' ? h('button', { type: 'button', class: 'btn', onclick: () => importDialog({ onDone: load }) }, icon('upload'), 'استيراد من القديم') : null,
        user?.role === 'admin' ? h('button', { type: 'button', class: 'btn', onclick: () => dedupeDialog({ onDone: load }) }, icon('check'), 'فحص المكرّرات') : null,
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => open() }, icon('plus'), 'عقد جديد')));
  }
  function drawTools() {
    tools.replaceChildren(
      h('input', { type: 'search', class: 'search', placeholder: 'بحث بالاسم أو الهوية أو المشروع', 'aria-label': 'بحث', value: q, oninput: (e) => { q = e.target.value.trim(); filter(); } }),
      h('select', { 'aria-label': 'الحالة', onchange: (e) => { status = e.target.value; filter(); } }, h('option', { value: '' }, 'كل الحالات'), STATUSES.map((s) => h('option', { value: s, selected: s === status }, s))));
  }
  function drawSummary() {
    const n = (s) => rows.filter((r) => r.status === s).length;
    sum.replaceChildren(h('span', { class: 'chip chip-none' }, `الإجمالي: ${rows.length}`),
      ...STATUSES.filter((s) => n(s)).map((s) => h('span', { class: `chip ${STATUS_CHIP[s]}` }, `${s}: ${n(s)}`)));
  }
  function drawTable() {
    clear(box);
    if (!rows.length) { box.append(h('p', { class: 'empty' }, 'لا عقود مطابقة.')); return; }
    const heads = ['م', 'الاسم', 'الهوية', 'نوع العقد', 'فترة التنفيذ', 'الأيام (متفق / معتمد)', 'سعر اليوم', 'القيمة المعتمدة', 'التغيّر', 'الحالة', 'التدقيق', ''];
    box.append(h('table', { class: 'tbl ct-list' },
      h('thead', null, h('tr', null, heads.map((t) => h('th', null, t)))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('td', null, r.seq ?? '—'),
        h('td', null, h('strong', null, r.name), r.project ? h('div', { class: 'code' }, r.project) : null),
        h('td', { dir: 'ltr', class: 'ltr-cell' }, r.idno || '—'),
        h('td', null, r.ctype || '—'),
        h('td', null, `${dmy(r.dFrom)} ← ${dmy(r.dTo)}`),
        h('td', null, `${r.daysBase ?? '—'} / ${r.daysAct ?? '—'}`),
        h('td', null, r.calc.dayRate !== null ? money(r.calc.dayRate) : '—'),
        h('td', null, r.calc.appr !== null ? money(r.calc.appr) : '—'),
        h('td', null, r.calc.delta !== null ? pct(r.calc.delta) : '—'),
        h('td', null, h('span', { class: `chip ${STATUS_CHIP[r.status] || 'chip-none'}` }, r.status)),
        h('td', null, r.warnings.length ? h('span', { class: 'chip chip-late', title: r.warnings.join('\n') }, `${r.warnings.length} ملاحظة`) : h('span', { class: 'chip chip-present' }, 'سليم')),
        h('td', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn btn-sm', onclick: () => open(r) }, 'تعديل'),
          h('button', { type: 'button', class: 'btn btn-sm', title: 'طباعة العقد A4', onclick: () => printContract(r) }, 'طباعة'),
          h('button', { type: 'button', class: 'btn btn-sm', title: 'تنزيل العقد بصيغة Word', onclick: () => wordContract(r) }, 'Word')))))));
  }
  function filter() {
    const hay = (r) => `${r.name} ${r.idno || ''} ${r.project || ''}`;
    rows = all.filter((r) => (!status || r.status === status) && (!q || hay(r).includes(q)));
    drawSummary();
    drawTable();
  }
  async function load() {
    try {
      all = (await get('/api/contracts')).contracts;
      const hay = (r) => `${r.name} ${r.idno || ''} ${r.project || ''}`;
      rows = all.filter((r) => (!status || r.status === status) && (!q || hay(r).includes(q)));
      dash.replaceChildren(drawDash(all));
      drawSummary();
      drawTable();
    } catch (e) {
      clear(box).append(h('div', { class: 'notice notice-err' }, e.message));
    }
  }

  lists = await get('/api/contracts/lists');
  drawHead();
  drawTools();
  await load();
  return page;
}
