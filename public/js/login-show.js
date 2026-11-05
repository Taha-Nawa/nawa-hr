// شرائح شاشة الدخول: أربع شرائح بأيقونات حيّة (CSS فقط، بلا مكتبات). تتبدّل كل 3.8 ثانية بحركة انزلاق.
// الأيقونات SVG تُبنى هنا؛ القيم المتغيّرة (طول الخط، التأخير) تُمرَّر بـ data-* ثم CSSOM لأن CSP يمنع style في الوسوم.
import { h } from './dom.js';

const SLIDES = [
  { cls: 'g1', title: 'الحضور بالمركز', text: 'تسجيل الدخول والخروج من بوابة المركز، وتقرير يومي لكل مركز.', svg:
    '<circle class="fill" cx="32" cy="32" r="26"/><circle class="d" data-l="165" cx="32" cy="32" r="26"/><g class="hand hh"><path d="M32 32V19"/></g><g class="hand hm"><path d="M32 32V12"/></g><g class="badge"><circle cx="52" cy="50" r="10" fill="#e6a901" stroke="none"/><path d="M47 50l3.5 3.5L57 46" stroke="#2a1410"/></g>' },
  { cls: 'g2', title: 'الإجازات والطلبات', text: 'رصيد الإجازات والطلبات والموافقات في مكان واحد.', svg:
    '<rect class="fill" x="8" y="12" width="48" height="44" rx="7"/><rect class="d" data-l="190" x="8" y="12" width="48" height="44" rx="7"/><path d="M8 26h48M21 6v11M43 6v11"/><circle class="dot" data-dl=".6" cx="20" cy="36" r="2" fill="#fff"/><circle class="dot" data-dl=".8" cx="32" cy="36" r="2" fill="#fff"/><circle class="dot" data-dl="1" cx="44" cy="36" r="2" fill="#fff"/><path class="d" data-l="40" data-dl="1.2" d="M22 46l7 7 14-14" stroke="#e6a901" stroke-width="4"/>' },
  { cls: 'g3', title: 'التقرير الشهري', text: 'كشف الدوام ينزل جاهزاً بحسب توزيع المشاريع.', svg:
    '<path class="fill" d="M14 8h26l12 12v36H14z"/><path class="d" data-l="190" d="M14 8h26l12 12v36H14z"/><path class="d" data-l="20" data-dl=".5" d="M22 28h14"/><path class="d" data-l="30" data-dl=".7" d="M22 36h22"/><rect class="bar1" data-dl=".9" x="24" y="42" width="5" height="9" fill="#fff" stroke="none"/><rect class="bar1" data-dl="1.05" x="32" y="38" width="5" height="13" fill="#e6a901" stroke="none"/><rect class="bar1" data-dl="1.2" x="40" y="33" width="5" height="18" fill="#fff" stroke="none"/>' },
  { cls: 'g4', title: 'المشاريع والتوزيع', text: 'كل موظف على مشروع أو أكثر بنسب واضحة تُحسب تلقائياً.', svg:
    '<circle cx="32" cy="32" r="20" stroke="rgba(255,255,255,.2)" stroke-width="11"/><circle class="seg" data-s="63" data-dl=".2" cx="32" cy="32" r="20" stroke="#fff" stroke-width="11"/><circle class="seg r1" data-s="38" data-dl=".6" cx="32" cy="32" r="20" stroke="#e6a901" stroke-width="11"/><circle class="seg r2" data-s="25" data-dl="1" cx="32" cy="32" r="20" stroke="#ff9798" stroke-width="11"/>' },
];
const SLIDE_MS = 3800;

function iconSvg(inner) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">${inner}</svg>`; // نص ثابت من هذا الملف فقط
  const svg = wrap.firstChild;
  for (const el of svg.querySelectorAll('[data-l],[data-dl],[data-s]')) {
    if (el.dataset.l) el.style.setProperty('--l', el.dataset.l);
    if (el.dataset.dl) el.style.setProperty('--dl', `${el.dataset.dl}s`);
    if (el.dataset.s) el.style.setProperty('--s', el.dataset.s);
  }
  return svg;
}

/** يبني لوحة الشرائح ويشغّلها؛ يتوقف المؤقّت وحده حين تغادر اللوحة الصفحة. */
export function loginShow() {
  const slides = SLIDES.map((s) => h('div', { class: `slide ${s.cls}` }, h('div', { class: 'ico' }, iconSvg(s.svg)), h('h2', null, s.title), h('p', null, s.text)));
  const dots = SLIDES.map(() => h('i'));
  const box = h('aside', { class: 'login-show', 'aria-label': 'ما يقدّمه النظام' },
    h('div', { class: 'show-brand' }, h('img', { src: '/logo.png', alt: '' }), h('span', null, 'جمعية نوى للثقافة والفنون')),
    ...slides, h('div', { class: 'dn', 'aria-hidden': 'true' }, dots));
  let i = 0;
  const show = (n) => {
    slides.forEach((s, k) => {
      if (k === n) { s.classList.remove('leave', 'act'); void s.offsetWidth; s.classList.add('act'); } else if (s.classList.contains('act')) { s.classList.remove('act'); s.classList.add('leave'); } else s.classList.remove('leave');
    });
    dots.forEach((d, k) => { d.classList.remove('act'); if (k === n) { void d.offsetWidth; d.classList.add('act'); } });
  };
  show(0);
  const timer = setInterval(() => {
    if (!box.isConnected) { clearInterval(timer); return; }
    i = (i + 1) % SLIDES.length;
    show(i);
  }, SLIDE_MS);
  return box;
}
