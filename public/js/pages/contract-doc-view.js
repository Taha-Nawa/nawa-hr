// تبويب «نص العقد والطباعة»: اختر عقداً لعرض نصه جاهزاً للطباعة أو التنزيل.
import { h } from '../dom.js';
import { contractNo } from '../contract-doc.js';
import { get } from '../api.js';
import { composeDoc, fmtVars, applyDataStyles } from '../contract-compose.js';
import { printContract, wordContract } from './contract-actions.js';

export function drawDoc(all, { onEdit, selected, onPick }) {
  const sorted = all.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
  if (!sorted.length) return h('p', { class: 'empty' }, 'لا يوجد عقد لعرضه — أضف عقداً أولاً.');
  let cur = sorted.find((r) => r.id === selected) || sorted[0];
  const paper = h('article', { class: 'ct-paper' });
  let token = 0;
  const draw = async () => {
    const t = ++token;
    onPick?.(cur.id);
    paper.textContent = 'جارٍ التحضير…';
    try {
      const d = await get(`/api/contracts/${cur.id}/doc`);
      if (t !== token) return;
      const doc = composeDoc(d);
      paper.innerHTML = doc.body;
      for (const [k, v] of Object.entries(fmtVars(doc.fmt))) paper.style.setProperty(k, v);
      applyDataStyles(paper);
    } catch (e) { if (t === token) paper.textContent = e.message; }
  };
  const pick = h('select', { 'aria-label': 'اختر العقد', onchange: (e) => { cur = sorted.find((r) => String(r.id) === e.target.value); draw(); } },
    sorted.map((r) => h('option', { value: r.id, selected: r.id === cur.id }, `${contractNo(r)} — ${r.name}`)));
  draw();
  return h('div', null,
    h('div', { class: 'tools' }, pick,
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => printContract(cur) }, 'طباعة / حفظ PDF'),
      h('button', { type: 'button', class: 'btn', onclick: () => wordContract(cur) }, 'تنزيل Word لهذا العقد'),
      h('button', { type: 'button', class: 'btn', onclick: () => onEdit(cur) }, 'تعديل البيانات')),
    paper);
}
