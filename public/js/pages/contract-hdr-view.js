// مجموعات الترويسة: شعارات وتذييل لكل جهة تمويل أو مشروع، وربط تلقائي بحسب المشروع أو الممول.
import { h, field, toast, confirmBox } from '../dom.js';
import { put } from '../api.js';
import { logoEditor } from './contract-logos-ui.js';
import { composeDoc, headerHTML, applyDataStyles } from '../contract-compose.js';
import { FOOT_DEFAULT } from '../contract-tpl-base.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const rid = () => `hdr_${Math.random().toString(36).slice(2, 10)}`;

export function drawHeaders({ headers, all, reload }) {
  const st = clone({ bind: headers.bind || '', map: headers.map || {}, sets: headers.sets || [] });
  const baseline = () => JSON.stringify({ bind: st.bind, map: st.map, sets: st.sets.map(({ usage, ...s }) => s) });
  const start = baseline();
  const root = h('div', { class: 'tp-hdrs' });
  const badge = h('span', { class: 'chip chip-late', hidden: true }, 'تعديلات غير محفوظة');
  const touch = () => { badge.hidden = baseline() === start; };
  let open = null;

  const used = (k) => {
    const m = new Map();
    for (const r of all) { const v = String(r[k] || '').trim(); if (v) m.set(v, (m.get(v) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  async function save() {
    try {
      const names = st.sets.map((s) => s.name.trim());
      if (names.some((n) => !n)) return toast('لكل مجموعة اسم', 'err');
      await put('/api/contracts/headers', { bind: st.bind, map: st.map, sets: st.sets.map(({ usage, ...s }) => ({ ...s, name: s.name.trim() })) });
      toast('حُفظت مجموعات الترويسة');
      await reload();
    } catch (e) { toast(e.message, 'err'); }
  }

  function card(s) {
    const prev = h('div', { class: 'hdr tp-hdr-prev' });
    const drawPrev = () => {
      prev.innerHTML = headerHTML(composeDoc({ contract: {}, rev: { blocks: [], fmt: {}, foot: {} }, header: s }).logos);
      applyDataStyles(prev);
    };
    drawPrev();
    const isOpen = open === s.id;
    s.foot ||= { ...FOOT_DEFAULT };
    return h('div', { class: 'tp-card' },
      h('div', { class: 'tp-card-h' },
        h('input', { type: 'text', value: s.name, maxlength: 80, 'aria-label': 'اسم المجموعة', oninput: (e) => { s.name = e.target.value; touch(); } }),
        h('span', { class: 'sub' }, `${s.usage || 0} عقداً مختاراً لها يدوياً`),
        h('button', { type: 'button', class: 'btn', onclick: () => { open = isOpen ? null : s.id; draw(); } }, isOpen ? 'إغلاق' : 'تحرير الشعارات والتذييل'),
        h('button', { type: 'button', class: 'btn', onclick: () => { st.sets.push({ ...clone(s), id: rid(), name: `${s.name} — نسخة`, usage: 0 }); touch(); draw(); } }, 'نسخ'),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: async () => {
          if (!(await confirmBox(`حذف مجموعة «${s.name}»؟ العقود المرتبطة بها تعود للربط التلقائي.`, 'حذف', true))) return;
          st.sets = st.sets.filter((x) => x.id !== s.id);
          for (const k of Object.keys(st.map)) if (st.map[k] === s.id) delete st.map[k];
          touch(); draw();
        } }, 'حذف')),
      prev,
      isOpen ? h('div', null,
        logoEditor(s, () => { drawPrev(); touch(); }),
        h('h4', null, 'تذييل هذه المجموعة'),
        h('div', { class: 'form-grid' },
          ...[['ar1', 'العنوان (عربي)'], ['ar2', 'تلفاكس (عربي)'], ['en1', 'العنوان (إنجليزي)'], ['en2', 'Telefax']].map(([k, l]) => field(l, h('input', { type: 'text', value: s.foot[k] ?? '', maxlength: 200, dir: k.startsWith('en') ? 'ltr' : null, oninput: (e) => { s.foot[k] = e.target.value; touch(); } }))))) : null);
  }

  function draw() {
    const vals = st.bind ? used(st.bind) : [];
    root.replaceChildren(
      h('div', { class: 'tp-head' }, h('div', null, h('h2', null, 'مجموعات الترويسة'), h('p', { class: 'sub' }, 'لكل جهة ممولة أو مشروع شعاراتها وتذييلها. تُختار للعقد يدوياً (حقل «مجموعة الترويسة» في نموذج العقد) أو تلقائياً بالربط أدناه.')),
        h('div', { class: 'tp-act' }, badge, h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, 'حفظ'))),
      ...st.sets.map(card),
      h('button', { type: 'button', class: 'btn', onclick: () => { const s = { id: rid(), name: `مجموعة ${st.sets.length + 1}`, logos: [], logoCfg: {}, foot: { ...FOOT_DEFAULT }, usage: 0 }; st.sets.push(s); open = s.id; touch(); draw(); } }, '＋ مجموعة ترويسة جديدة'),
      h('h3', null, 'الربط التلقائي'),
      h('div', { class: 'form-grid' }, field('اربط حسب', h('select', { onchange: (e) => { st.bind = e.target.value; touch(); draw(); } }, [['', 'بلا ربط تلقائي'], ['donor', 'اسم الممول'], ['project', 'اسم المشروع']].map(([v, t]) => h('option', { value: v, selected: st.bind === v }, t))))),
      st.bind ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, [st.bind === 'donor' ? 'الممول' : 'المشروع', 'عقود', 'مجموعة الترويسة'].map((x) => h('th', null, x)))),
        h('tbody', null, vals.map(([v, n]) => h('tr', null, h('td', null, v), h('td', null, String(n)),
          h('td', null, h('select', { 'aria-label': `ترويسة ${v}`, onchange: (e) => { if (e.target.value) st.map[v] = e.target.value; else delete st.map[v]; touch(); } },
            h('option', { value: '' }, '— الافتراضية (شعارات الصيغة) —'), st.sets.map((s) => h('option', { value: s.id, selected: st.map[v] === s.id }, s.name))))))))) : null,
      h('p', { class: 'hint' }, 'الأسبقية: مجموعة اختارها العقد نفسه، ثم الربط التلقائي، ثم شعارات الصيغة.'));
  }
  draw();
  return root;
}
