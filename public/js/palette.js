// البحث العام (Ctrl+K أو زر البحث): صفحات النظام المتاحة لدورك + الموظفون الذين يحق لك رؤيتهم. مفاتيح الأسهم والإدخال والهروب.
import { h, clear, icon } from './dom.js';
import { get } from './api.js';

const norm = (s) => String(s || '').toLowerCase()
  .replace(/[ً-ٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');

let employees = null;
async function loadEmployees() {
  if (employees) return employees;
  try {
    employees = (await get('/api/employees')).employees.filter((e) => e.status !== 'inactive');
  } catch {
    employees = [];
  }
  return employees;
}

/** pages: صفحات القائمة المتاحة للمستخدم ({path,title,icon}) */
export function openPalette(pages) {
  if (document.getElementById('palette')) return;
  const input = h('input', { type: 'search', placeholder: 'ابحث عن صفحة أو موظف…', autocomplete: 'off', 'aria-label': 'بحث عام', role: 'combobox', 'aria-controls': 'palette-list', 'aria-expanded': 'true' });
  const list = h('ul', { class: 'pal-list', id: 'palette-list', role: 'listbox' });
  const dlg = h('dialog', { class: 'dlg pal', id: 'palette', 'aria-label': 'بحث عام' },
    h('div', { class: 'pal-box' }, icon('search'), input, h('kbd', null, 'Esc')), list);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();

  let items = [];
  let sel = 0;
  const go = (it) => { dlg.close(); location.hash = it.href; };
  function draw() {
    clear(list);
    if (items.length === 0) list.append(h('li', { class: 'pal-empty' }, 'لا نتائج مطابقة'));
    items.forEach((it, i) => list.append(h('li', { role: 'option', 'aria-selected': String(i === sel), class: i === sel ? 'on' : '', onclick: () => go(it), onmousemove: () => { if (sel !== i) { sel = i; draw(); } } },
      icon(it.icon), h('span', { class: 'pal-t' }, it.title), h('small', null, it.sub))));
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }
  async function search() {
    const q = norm(input.value.trim());
    const pg = pages.filter((p) => !q || norm(p.title).includes(q)).map((p) => ({ icon: p.icon || 'check', title: p.title, sub: 'صفحة', href: `#/${p.path}` }));
    let emps = [];
    if (q.length >= 2) {
      emps = (await loadEmployees()).filter((e) => norm(e.name).includes(q) || norm(e.code).includes(q) || norm(e.nameEn).includes(q))
        .slice(0, 8).map((e) => ({ icon: 'user', title: e.name, sub: `${e.code}${e.center ? ` · ${e.center}` : ''}`, href: `#/employees/${e.id}` }));
    }
    items = [...pg.slice(0, q ? 6 : 8), ...emps];
    sel = 0;
    draw();
  }
  input.addEventListener('input', search);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === 'Escape') { e.preventDefault(); dlg.close(); }
    else if (e.key === 'Enter' && items[sel]) { e.preventDefault(); go(items[sel]); }
  });
  search();
  input.focus();
}

/** اختصار لوحة المفاتيح: Ctrl/⌘ + K */
export function bindPaletteShortcut(getPages) {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette(getPages());
    }
  });
}
