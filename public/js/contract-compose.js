// تركيب وثيقة العقد للطباعة وWord: نص النسخة المثبّتة + الشعارات (مجموعة الترويسة أو شعارات الصيغة) + التذييل + التنسيق.
import { renderBlocks } from './contract-tpl.js';
import { FOOT_DEFAULT, FMT_DEFAULT } from './contract-tpl-base.js';
import { esc } from './contract-doc.js';

export const NAWA_LOGO = { id: 'nawa', name: 'شعار جمعية نوى للثقافة والفنون', src: '/logo.png', h: 26, align: 'center', ord: 2, w: 520, ih: 476 };
export const assetUrl = (id) => `/api/contracts/assets/${id}`;

/** الشعارات الظاهرة مرتّبة: شعار نوى + شعارات إضافية، مع تعديلات الحجم والمحاذاة والإخفاء */
export function logosOf({ logos = [], logoCfg = {} } = {}) {
  return [NAWA_LOGO, ...logos.map((l) => ({ ...l, src: assetUrl(l.asset) }))]
    .map((x) => { const o = logoCfg[x.id] || {}; return { ...x, h: o.h !== undefined ? o.h : x.h, align: o.align || x.align, ord: o.ord !== undefined ? o.ord : x.ord, hidden: !!o.hidden }; })
    .filter((x) => !x.hidden)
    .sort((a, b) => (a.ord - b.ord) || a.name.localeCompare(b.name, 'ar'));
}

/** r: العقد، rev: نسخة الصيغة، header: مجموعة الترويسة الحاكمة أو null (فتُستعمل شعارات الصيغة وتذييلها) */
export function composeDoc({ contract, rev, header = null }) {
  const src = header || rev;
  return {
    body: renderBlocks(rev, contract),
    logos: logosOf(src),
    foot: { ...FOOT_DEFAULT, ...(rev.foot || {}), ...(header?.foot || {}) },
    fmt: { ...FMT_DEFAULT, ...(rev.fmt || {}) },
  };
}

export function headerHTML(logos) {
  if (!logos.length) return '';
  const grp = (a) => logos.filter((x) => x.align === a).map((x) => `<img src="${esc(x.src)}" alt="${esc(x.name)}" data-h="${x.h}">`).join('');
  return `<div class="hdr-grp r">${grp('right')}</div><div class="hdr-grp c">${grp('center')}</div><div class="hdr-grp l">${grp('left')}</div>`;
}

const line = (style, w, color) => (style === 'none' ? 'none' : `${w}px ${style} ${color}`);
/** متغيرات CSS للتنسيق (الخط، الهوامش، خطوط الترويسة والتذييل) */
export function fmtVars(f) {
  return {
    '--fs': `${f.body}pt`, '--lh': String(f.lh), '--jc': f.jc, '--h1s': `${f.h1}pt`, '--h1d': f.h1u ? 'underline' : 'none',
    '--fillbg': f.hi ? '#FBF0A8' : 'transparent', '--hdrb': line(f.hdrLine, f.hdrW, f.hdrColor), '--ftrb': line(f.ftrLine, f.ftrW, f.ftrColor),
    '--mt': `${f.mT}mm`, '--mb': `${f.mB}mm`, '--mr': `${f.mR}mm`, '--ml': `${f.mL}mm`,
  };
}
export function footRows(foot) {
  const rows = [];
  if (foot.ar1 || foot.ar2) rows.push({ en: false, a: foot.ar1 ? `العنوان: ${foot.ar1}` : '', b: foot.ar2 ? `تلفاكس: \u2066${foot.ar2}\u2069` : '' });
  if (foot.en1 || foot.en2) rows.push({ en: true, a: foot.en1 || '', b: foot.en2 || '' });
  return rows;
}

/** يطبّق الأنماط المؤجّلة (data-st، data-h) عبر CSSOM بعد إدراج HTML: CSP تمنع سمة style المضمّنة */
export function applyDataStyles(root) {
  for (const el of root.querySelectorAll('[data-st]')) el.style.cssText = el.dataset.st;
  for (const el of root.querySelectorAll('img[data-h]')) el.style.height = `${el.dataset.h}mm`;
}
