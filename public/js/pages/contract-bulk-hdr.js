// تطبيق مجموعة ترويسة على العقود المعروضة دفعة واحدة (مثلاً كل عقود مشروع أو ممول).
import { h, dialog, toast, confirmBox, field } from '../dom.js';
import { get, patch } from '../api.js';

export async function applyHeaderDialog(rows, onDone) {
  let sets = [];
  try { sets = (await get('/api/contracts/templates')).headers.sets; } catch (e) { return toast(e.message, 'err'); }
  if (!sets.length) return toast('لا توجد مجموعات ترويسة بعد — أنشئها من تبويب «الصيغ والترويسة»', 'err');
  const sel = h('select', null, h('option', { value: '' }, '— إزالة الاختيار اليدوي (تلقائي) —'), sets.map((s) => h('option', { value: s.name }, s.name)));
  const out = h('p', { class: 'hint' });
  const d = dialog({ title: `تطبيق ترويسة على ${rows.length} عقداً`, content: h('div', null,
    h('p', { class: 'dlg-text' }, 'تُطبَّق المجموعة على العقود المعروضة حالياً في القائمة (بعد التصفية) فقط. لا يتغيّر نص العقود.'),
    field('مجموعة الترويسة', sel), out,
    h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'إلغاء'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: async (e) => {
        if (!(await confirmBox(`تغيير ترويسة ${rows.length} عقداً؟`, 'طبّق'))) return;
        e.target.disabled = true;
        let n = 0;
        try {
          for (const r of rows) { await patch(`/api/contracts/${r.id}`, { hdr: sel.value || null }); n += 1; out.textContent = `جارٍ التطبيق… ${n} / ${rows.length}`; }
          toast(`طُبّقت الترويسة على ${n} عقداً`);
          d.close();
          onDone?.();
        } catch (ex) { out.textContent = `توقّف بعد ${n} عقداً: ${ex.message}`; e.target.disabled = false; }
      } }, 'تطبيق')))});
}
