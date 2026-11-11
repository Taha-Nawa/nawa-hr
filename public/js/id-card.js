// بطاقة هوية الحضور (85.6×54 مم) بتصميم موحّد للموظف والمتطوع ومزوّد الخدمة: رمز QR كبير على لون الهوية، والبيانات على خلفية داكنة.
// لون وسم الفئة وحده يختلف (موظف وردي، متطوع ذهبي، مزوّد أبيض) والباقي من ألوان هوية نوى.
import { h } from './dom.js';

const KIND = { employee: 'موظف', volunteer: 'متطوع', provider: 'مزوّد خدمة' };

/** kind: employee|volunteer|provider — line: المسمى/الخدمة والمركز — valid: نص الصلاحية (اختياري) */
export function idCard({ kind, name, line, code, valid, qr }) {
  return h('article', { class: `id-card id-${kind}`, 'aria-label': `بطاقة ${name}` },
    h('div', { class: 'id-qrp' }, h('div', { class: 'id-qr' }, qr.cloneNode(true))),
    h('div', { class: 'id-bd' },
      h('header', { class: 'id-brand' }, h('img', { src: '/logo.png', alt: '' }), h('span', null, 'جمعية نوى للثقافة والفنون')),
      h('h2', { class: 'id-name' }, name),
      h('p', { class: 'id-meta' }, line || ''),
      valid ? h('p', { class: 'id-valid' }, valid) : null,
      h('footer', { class: 'id-foot' }, h('span', { class: 'id-code', dir: 'ltr' }, code), h('em', { class: 'id-kind' }, KIND[kind] || ''))));
}
