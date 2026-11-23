// مستندات العقد داخل النموذج: العقد الموقّع، الهوية، عرض السعر… تُحفظ في النظام لتراها الإدارة.
import { h, field, toast, confirmBox } from '../dom.js';
import { get, del } from '../api.js';

const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} م.ب` : `${Math.max(1, Math.round(n / 1024))} ك.ب`);

export function filesPanel(c, onChange) {
  const box = h('div', { class: 'ct-files' });
  const kindSel = h('select', { 'aria-label': 'نوع المستند' });
  let kinds = [];
  async function draw() {
    try {
      const d = await get(`/api/contracts/${c.id}/files`);
      kinds = d.kinds;
      kindSel.replaceChildren(...kinds.map((k) => h('option', { value: k }, k)));
      box.replaceChildren(
        d.files.length ? h('ul', { class: 'ct-file-list' }, d.files.map((f) => h('li', null,
          h('span', { class: 'chip chip-none' }, f.kind),
          h('a', { href: `/api/contracts/files/${f.id}${f.mime === 'application/pdf' || f.mime.startsWith('image/') ? '?inline=1' : ''}`, target: '_blank', rel: 'noopener' }, f.name),
          h('span', { class: 'sub' }, `${size(f.size)} · ${String(f.at).slice(0, 10)} · ${f.by || ''}`),
          h('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: async () => {
            if (!(await confirmBox(`حذف «${f.name}» نهائياً؟`, 'حذف', true))) return;
            try { await del(`/api/contracts/files/${f.id}`); toast('حُذف المستند'); draw(); onChange?.(); } catch (e) { toast(e.message, 'err'); }
          } }, 'حذف')))) : h('p', { class: 'hint' }, 'لا توجد مستندات مرفوعة لهذا العقد بعد.'),
        h('div', { class: 'ct-file-add' },
          field('نوع المستند', kindSel),
          h('label', { class: 'btn' }, 'رفع ملف (PDF أو صورة أو Word — حتى 8 م.ب)',
            h('input', { type: 'file', accept: '.pdf,.png,.jpg,.jpeg,.doc,.docx', class: 'sr-only', onchange: async (e) => {
              const f = e.target.files[0];
              e.target.value = '';
              if (!f) return;
              try {
                const res = await fetch(`/api/contracts/${c.id}/files?kind=${encodeURIComponent(kindSel.value)}&name=${encodeURIComponent(f.name)}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream' }, body: f });
                const j = await res.json().catch(() => ({}));
                if (!res.ok || j.ok === false) throw new Error(j.error || 'تعذّر رفع الملف');
                toast('رُفع المستند');
                draw(); onChange?.();
              } catch (ex) { toast(ex.message, 'err'); }
            } }))));
    } catch (e) { box.replaceChildren(h('div', { class: 'notice notice-err' }, e.message)); }
  }
  draw();
  return h('fieldset', { class: 'ct-group' }, h('legend', null, 'مستندات العقد'), box);
}
