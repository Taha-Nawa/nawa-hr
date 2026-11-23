// استيراد العقود من ملف النسخة الاحتياطية (JSON) لسجل العقود القديم. للمسؤول فقط. معاينة أولاً ثم حفظ على دفعات.
import { h, dialog, toast } from '../dom.js';
import { post } from '../api.js';

const CHUNK = 20;

export function importDialog({ onDone }) {
  const file = h('input', { type: 'file', accept: '.json,application/json' });
  const out = h('div', { class: 'ct-import-out' });
  const go = h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, 'استيراد');
  let records = [];

  async function run(commit) {
    const tot = { added: 0, existing: 0, invalid: [] };
    for (let i = 0; i < records.length; i += CHUNK) {
      const r = await post('/api/contracts/import', { records: records.slice(i, i + CHUNK), commit });
      tot.added += r.added;
      tot.existing += r.existing;
      tot.invalid.push(...r.invalid.map((x) => ({ index: x.index + i, reason: x.reason })));
      out.textContent = `${commit ? 'جارٍ الحفظ' : 'جارٍ الفحص'}… ${Math.min(i + CHUNK, records.length)} من ${records.length}`;
    }
    return tot;
  }
  const summary = (t, done) => h('div', null,
    h('p', null, done ? `تم استيراد ${t.added} عقداً.` : `سيُستورد ${t.added} عقداً جديداً.`),
    t.existing ? h('p', { class: 'muted' }, `${t.existing} عقداً موجود مسبقاً (لن يُكرَّر ولن يُعدَّل).`) : null,
    t.invalid.length ? h('div', { class: 'notice notice-warn' }, `${t.invalid.length} سجلاً لا يُستورد: `, t.invalid.slice(0, 8).map((x) => `رقم ${x.index + 1} (${x.reason})`).join('، ')) : null);

  file.addEventListener('change', async () => {
    go.disabled = true;
    out.textContent = '';
    try {
      const data = JSON.parse(await file.files[0].text());
      records = (Array.isArray(data) ? data : data.records || []).filter((r) => r && typeof r === 'object');
      if (!records.length) throw new Error('لا عقود في الملف');
      out.textContent = `الملف فيه ${records.length} سجلاً. جارٍ الفحص…`;
      const t = await run(false);
      out.replaceChildren(summary(t, false));
      go.disabled = t.added === 0;
    } catch (e) {
      out.replaceChildren(h('div', { class: 'notice notice-err' }, e instanceof SyntaxError ? 'ملف JSON غير صالح' : e.message));
    }
  });
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      const t = await run(true);
      out.textContent = 'جارٍ تحديث قائمة مزوّدي الخدمة…';
      const sync = { created: 0, linked: 0, skipped: 0 };
      for (let offset = 0, more = true; more;) {
        const r = await post('/api/contracts/sync', { offset });
        for (const k of Object.keys(sync)) sync[k] += r[k];
        offset = r.next;
        more = !r.done;
      }
      out.replaceChildren(summary(t, true), h('p', null, `مزوّدو الخدمة: أُنشئ ${sync.created}، وربط بمزوّدين قائمين ${sync.linked}${sync.skipped ? `، وتعذّر ${sync.skipped} (بلا هوية أو فترة تنفيذ)` : ''}.`));
      toast('تم الاستيراد');
      onDone?.();
    } catch (e) {
      out.replaceChildren(h('div', { class: 'notice notice-err' }, e.message));
    }
  });
  const dlg = dialog({ title: 'استيراد من سجل العقود القديم', content: h('div', { class: 'ct-form' },
    h('p', null, 'اختر ملف النسخة الاحتياطية الذي صدّرته من سجل العقود القديم (nawa-contracts-backup.json).'),
    file, out,
    h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'إغلاق'), go)) });
  return dlg;
}
