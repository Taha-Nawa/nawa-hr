// بطاقة هوية الحضور (85.6×54 مم) بتصميم موحّد للموظف والمتطوع ومزوّد الخدمة.
// الشريط العلوي بهوية نوى، يمين البطاقة صورة (أو أول حرف) والاسم والمسمى، ويسارها رمز QR، وتحتها شريط الرمز والصلاحية.
import { h } from './dom.js';

const KIND = { employee: 'بطاقة موظف', volunteer: 'بطاقة متطوع', provider: 'بطاقة مزوّد خدمة' };

function face(name, photo) {
  const box = h('div', { class: 'id-photo', 'aria-hidden': 'true' }, [...String(name || '؟').trim()][0] || '؟');
  if (/^https:\/\//.test(photo || '')) {
    const img = h('img', { alt: '', referrerpolicy: 'no-referrer' });
    img.addEventListener('load', () => { box.classList.add('has-img'); box.replaceChildren(img); });
    img.src = photo;
  }
  return box;
}

/** kind: employee|volunteer|provider — line: المسمى/الخدمة والمركز — valid: نص الصلاحية (اختياري) */
export function idCard({ kind, name, line, code, valid, photo, qr }) {
  return h('article', { class: `id-card id-${kind}`, 'aria-label': `بطاقة ${name}` },
    h('header', { class: 'id-head' },
      h('img', { src: '/logo.png', alt: '' }),
      h('div', null, h('strong', null, 'جمعية نوى للثقافة والفنون'), h('span', null, 'Nawa Association for Culture and Arts')),
      h('em', { class: 'id-kind' }, KIND[kind] || 'بطاقة')),
    h('div', { class: 'id-body' },
      h('div', { class: 'id-main' },
        face(name, photo),
        h('div', { class: 'id-who' }, h('h2', { class: 'id-name' }, name), h('p', { class: 'id-meta' }, line || ''))),
      h('div', { class: 'id-qr' }, qr.cloneNode(true))),
    h('footer', { class: 'id-foot' }, h('span', { class: 'id-code', dir: 'ltr' }, code), valid ? h('span', { class: 'id-valid' }, valid) : null));
}
