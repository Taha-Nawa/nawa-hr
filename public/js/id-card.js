// بطاقة هوية الحضور (85.6×54 مم) بتصميم موحّد للموظف والمتطوع ومزوّد الخدمة (اعتُمد 2026-11-11):
// رمز QR كبير على لوحة ملوّنة تميّز النوع (موظف رملي، متطوع زيتوني غامق، مزوّد أحمر)، والبيانات على أرضية فاتحة.
import { h } from './dom.js';

const KIND = { employee: 'موظف', volunteer: 'متطوع', provider: 'مزوّد خدمة' };

/** الاسم على البطاقة مقطعان: الأول والأخير (يبقى كما هو إن كان مقطعين أو أقل). */
export function shortName(name) {
  const t = String(name || '').trim().split(/\s+/).filter(Boolean);
  return t.length > 2 ? `${t[0]} ${t[t.length - 1]}` : t.join(' ');
}

/** خيارات اتجاه البطاقة للطباعة: عرضية 85.6×54 مم، طولية 54×85.6 مم، أو الاثنتان معاً. */
export const ORIENT_OPTIONS = [['landscape', 'عرضية'], ['portrait', 'طولية'], ['both', 'الاثنتان معاً']];

/** عناصر الورقة: لكل نسخة بطاقة بالاتجاه المختار (أو الاثنتان). make(orientation) يبني البطاقة. */
export function cardSheet(make, copies, orient) {
  const kinds = orient === 'both' ? ['landscape', 'portrait'] : [orient === 'portrait' ? 'portrait' : 'landscape'];
  return Array.from({ length: copies }, () => kinds.map((o) => make(o))).flat();
}

/** kind: employee|volunteer|provider — line: نص أو مصفوفة أسطر (المسمى/الخدمة في سطر والمركز في سطر) — valid: نص الصلاحية (اختياري) */
export function idCard({ kind, name, line, code, valid, qr, orientation = 'landscape' }) {
  return h('article', { class: `id-card id-${kind}${valid ? ' id-tall' : ''}${orientation === 'portrait' ? ' id-portrait' : ''}`, 'aria-label': `بطاقة ${name}` },
    h('div', { class: 'id-qrp' }, h('div', { class: 'id-qr' }, qr.cloneNode(true))),
    h('div', { class: 'id-bd' },
      h('header', { class: 'id-brand' }, h('img', { src: '/logo.png', alt: '' }), h('span', null, 'جمعية نوى للثقافة والفنون')),
      h('div', { class: 'id-who' },
        h('h2', { class: 'id-name' }, shortName(name)),
        ...[].concat(line || []).filter(Boolean).map((l, i) => h('p', { class: `id-meta${i ? ' id-place' : ''}` }, l)),
        valid ? h('p', { class: 'id-valid' }, valid) : null),
      h('footer', { class: `id-foot${code ? '' : ' id-nocode'}` }, h('em', { class: 'id-kind' }, KIND[kind] || ''), code ? h('span', { class: 'id-code', dir: 'ltr' }, code) : null)));
}
