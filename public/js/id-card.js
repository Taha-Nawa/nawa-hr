// بطاقة هوية الحضور (85.6×54 مم) بتصميم موحّد للموظف والمتطوع ومزوّد الخدمة (اعتُمد 2026-11-11):
// رمز QR كبير على لوحة ملوّنة تميّز النوع (موظف رملي، متطوع زيتوني غامق، مزوّد أحمر)، والبيانات على أرضية فاتحة.
import { h } from './dom.js';

const KIND = { employee: 'موظف', volunteer: 'متطوع', provider: 'مزوّد خدمة' };

/** الاسم على البطاقة مقطعان: الأول والأخير (يبقى كما هو إن كان مقطعين أو أقل). */
export function shortName(name) {
  const t = String(name || '').trim().split(/\s+/).filter(Boolean);
  return t.length > 2 ? `${t[0]} ${t[t.length - 1]}` : t.join(' ');
}

/** حجم خط الاسم (مم) ليبقى في سطر واحد: يبدأ من الحجم المعتاد ويصغر بقدر طول الاسم والعرض المتاح. */
export function nameSize(text, orientation) {
  const base = orientation === 'portrait' ? 8.2 : 7.8;
  const avail = orientation === 'portrait' ? 45 : 35;
  const len = Math.max(1, [...String(text)].length);
  return Math.round(Math.min(base, avail / (len * 0.5)) * 100) / 100;
}

/**
 * ملاءمة سطر المسمى أو المركز مع عرض البطاقة: يصغر الخط حتى يتسع في سطر واحد، فإن لم يتسع بحجم مقروء
 * التفّ على سطرين متوازنين بخط مقروء، وإن طال أكثر صغر الخط ليبقى في سطرين كحدّ أقصى (لا قصّ ولا خروج عن البطاقة).
 * @returns {{size:number, wrap:boolean}} size بالمليمتر.
 */
export function lineFit(text, orientation, { base, min, avail = orientation === 'portrait' ? 46 : 36 }) {
  const len = Math.max(1, [...String(text)].length);
  const W = 0.52; // متوسط عرض الحرف العربي الغليظ نسبة إلى حجم الخط
  const one = avail / (len * W);
  if (one >= min) return { size: Math.round(Math.min(base, one) * 100) / 100, wrap: false };
  const two = avail / ((Math.ceil(len / 2) + 2) * W); // سطران مع هامش لكسر الكلمات
  return { size: Math.round(Math.max(Math.min(base, two), min * 0.85) * 100) / 100, wrap: true };
}

/** خيارات اتجاه البطاقة للطباعة: عرضية 85.6×54 مم، طولية 54×85.6 مم، أو الاثنتان معاً. */
export const ORIENT_OPTIONS = [['landscape', 'عرضية'], ['portrait', 'طولية'], ['both', 'الاثنتان معاً']];

/** يقلّص الهامش الأبيض المدمج في الرمز من 4 وحدات إلى 2 فيكبر الرمز نفسه داخل المربع الأبيض. */
function tightQr(qr) {
  const el = qr.cloneNode(true);
  const vb = (el.getAttribute('viewBox') || '').split(/\s+/).map(Number);
  if (vb.length === 4 && vb[2] > 8) el.setAttribute('viewBox', `2 2 ${vb[2] - 4} ${vb[3] - 4}`);
  return el;
}

/** عناصر الورقة: لكل نسخة بطاقة بالاتجاه المختار (أو الاثنتان). make(orientation) يبني البطاقة. */
export function cardSheet(make, copies, orient) {
  const kinds = orient === 'both' ? ['landscape', 'portrait'] : [orient === 'portrait' ? 'portrait' : 'landscape'];
  return Array.from({ length: copies }, () => kinds.map((o) => make(o))).flat();
}

/** kind: employee|volunteer|provider — line: نص أو مصفوفة أسطر (المسمى/الخدمة في سطر والمركز في سطر) — valid: نص الصلاحية (اختياري) */
export function idCard({ kind, name, line, code, valid, qr, orientation = 'landscape' }) {
  return h('article', { class: `id-card id-${kind}${valid ? ' id-tall' : ''}${orientation === 'portrait' ? ' id-portrait' : ''}`, 'aria-label': `بطاقة ${name}` },
    h('div', { class: 'id-qrp' }, h('div', { class: 'id-qr' }, tightQr(qr))),
    h('div', { class: 'id-bd' },
      h('header', { class: 'id-brand' }, h('img', { src: '/logo.png', alt: '' }), h('span', null, 'جمعية نوى للثقافة والفنون')),
      h('div', { class: 'id-who' },
        h('h2', { class: 'id-name', style: { fontSize: `${nameSize(shortName(name), orientation)}mm` } }, shortName(name)),
        ...[].concat(line || []).filter(Boolean).map((l, i) => {
          const f = i ? lineFit(l, orientation, { base: orientation === 'portrait' ? 1.9 : 1.8, min: 1.5 }) : lineFit(l, orientation, { base: orientation === 'portrait' ? 3.2 : 3, min: 2.4 });
          return h('p', { class: `id-meta${i ? ' id-place' : ''}`, style: { fontSize: `${f.size}mm`, ...(f.wrap ? { whiteSpace: 'normal', textWrap: 'balance', lineHeight: '1.32' } : {}) } }, l);
        }),
        valid ? h('p', { class: 'id-valid' }, valid) : null),
      h('footer', { class: `id-foot${code ? '' : ' id-nocode'}` }, h('em', { class: 'id-kind' }, KIND[kind] || ''), code ? h('span', { class: 'id-code', dir: 'ltr' }, code) : null)));
}
