// فحص المكرّرات (مسؤول النظام): معاينة ثم حذف نهائي للنسخ المكرّرة مع الإبقاء على الأكمل.
import { h, dialog, toast } from '../dom.js';
import { post } from '../api.js';

export function dedupeDialog({ onDone }) {
  const out = h('div', null, h('p', null, 'جارٍ الفحص…'));
  const go = h('button', { type: 'button', class: 'btn btn-danger', disabled: true }, 'احذف المكرّر نهائياً');
  const dlg = dialog({ title: 'فحص العقود المكرّرة', content: h('div', { class: 'ct-form' }, out,
    h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'إغلاق'), go)) });
  post('/api/contracts/dedupe', { commit: false }).then((r) => {
    if (!r.duplicates) { out.replaceChildren(h('p', null, `لا مكرّرات: ${r.total} عقداً كلها مختلفة.`)); return; }
    out.replaceChildren(
      h('p', null, `في السجل ${r.total} عقداً، فيها ${r.duplicates} نسخة مكرّرة. سيبقى ${r.total - r.duplicates} عقداً.`),
      h('p', { class: 'muted' }, `من كل عقد مكرّر تُبقى أكمل نسخة برقمها الأقدم، وتُحذف البقية نهائياً ولا يمكن التراجع.`));
    go.disabled = false;
  }).catch((e) => out.replaceChildren(h('div', { class: 'notice notice-err' }, e.message)));
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      const r = await post('/api/contracts/dedupe', { commit: true });
      out.replaceChildren(h('p', null, `تم: حُذفت ${r.duplicates} نسخة مكرّرة، وبقي ${r.total - r.duplicates} عقداً.`));
      toast('تم حذف المكرّر');
      onDone?.();
    } catch (e) {
      out.replaceChildren(h('div', { class: 'notice notice-err' }, e.message));
    }
  });
}
