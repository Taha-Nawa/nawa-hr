// بطاقة هوية الحضور (85.6×54 مم) بتصميم موحّد للموظف والمتطوع ومزوّد الخدمة (اعتُمد 2026-11-11):
// رمز QR كبير على لوحة ملوّنة تميّز النوع (موظف رملي، متطوع زيتوني غامق، مزوّد أحمر)، والبيانات على أرضية فاتحة.
import { h } from './dom.js';

const KIND = { employee: 'موظف', volunteer: 'متطوع', provider: 'مزوّد خدمة' };

/** الاسم على البطاقة مقطعان: الأول والأخير (يبقى كما هو إن كان مقطعين أو أقل). */
export function shortName(name) {
  const t = String(name || '').trim().split(/\s+/).filter(Boolean);
  return t.length > 2 ? `${t[0]} ${t[t.length - 1]}` : t.join(' ');
}

/** kind: employee|volunteer|provider — line: المسمى/الخدمة والمركز — valid: نص الصلاحية (اختياري) */
export function idCard({ kind, name, line, code, valid, qr }) {
  return h('article', { class: `id-card id-${kind}${valid ? ' id-tall' : ''}`, 'aria-label': `بطاقة ${name}` },
    h('div', { class: 'id-qrp' }, h('div', { class: 'id-qr' }, qr.cloneNode(true))),
    h('div', { class: 'id-bd' },
      h('header', { class: 'id-brand' }, h('img', { src: '/logo.png', alt: '' }), h('span', null, 'جمعية نوى للثقافة والفنون')),
      h('div', { class: 'id-who' },
        h('h2', { class: 'id-name' }, shortName(name)),
        h('p', { class: 'id-meta' }, line || ''),
        valid ? h('p', { class: 'id-valid' }, valid) : null),
      h('footer', { class: 'id-foot' }, h('em', { class: 'id-kind' }, KIND[kind] || ''), h('span', { class: 'id-code', dir: 'ltr' }, code))));
}
