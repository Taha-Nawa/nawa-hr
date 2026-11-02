// أدوات مشتركة لصفحات الطباعة (النماذج الورقية): تصغير المعاينة على الشاشات الضيقة، وتنبيه الخط.
import { h } from './dom.js';

const MM_PX = 96 / 25.4;

/** على الشاشات الضيقة تُصغَّر الورقة كاملة للمعاينة فقط؛ الطباعة دائماً بالحجم الحقيقي (انظر @media print). widthMm: عرض الورقة. */
export function fitToScreen(frame, widthMm = 210) {
  const full = widthMm * MM_PX;
  const apply = () => frame.style.setProperty('--fit', String(Math.min(1, (frame.clientWidth || full) / full).toFixed(4)));
  if (typeof ResizeObserver === 'function') new ResizeObserver(apply).observe(frame);
  else window.addEventListener('resize', apply);
  requestAnimationFrame(apply);
}

/** Sakkal Majalla خط مايكروسوفت: نكتشف وجوده بقياس العرض مقابل خط احتياطي. */
function hasMajalla() {
  try {
    const c = document.createElement('canvas').getContext('2d');
    const w = (font) => { c.font = font; return c.measureText('جمعية نوى للثقافة والفنون 0123').width; };
    return ['serif', 'monospace'].some((f) => w(`40px "Sakkal Majalla", ${f}`) !== w(`40px ${f}`));
  } catch {
    return true;
  }
}

export const fontNote = () => hasMajalla() ? null
  : h('div', { class: 'notice no-print' }, 'خط النموذج الأصلي (Sakkal Majalla) غير مثبّت على هذا الجهاز، فيُستعمل خط قريب بحجم مكافئ. للحصول على الخط نفسه اطبع من جهاز ويندوز أو فيه Microsoft Office.');
