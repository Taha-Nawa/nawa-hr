// «بوب اليوم»: فقاعة عائمة بتوهج هادئ تظهر مرة واحدة كل يوم عند أول فتح للنظام، وتختفي بالنقر عليها.
import { h, todayLocal } from './dom.js';
import { itemFor, KINDS } from './daily-pop-lib.js';

const memory = new Set(); // احتياط إن تعذّر التخزين المحلي (وضع خاص): تظهر مرة لكل جلسة صفحة

function seen(key) {
  try { return localStorage.getItem(key) === '1' || memory.has(key); } catch { return memory.has(key); }
}
function markSeen(key) {
  memory.add(key);
  try {
    localStorage.setItem(key, '1');
    // تنظيف أيام قديمة حتى لا يتراكم التخزين
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('nawa.pop.') && k !== key && !k.endsWith(key.slice(-10))) localStorage.removeItem(k);
    }
  } catch { /* لا مشكلة */ }
}

/** يعرض بوب اليوم إن لم يُعرض اليوم لهذا المستخدم. forceDate للمعاينة والاختبار. */
export function dailyPop(user, { force = false } = {}) {
  if (!user) return null;
  const date = todayLocal();
  const key = `nawa.pop.${user.id ?? user.email ?? 'u'}.${date}`;
  if (!force && seen(key)) return null;
  const item = itemFor(date);
  const close = () => {
    markSeen(key);
    pop.classList.add('dp-out');
    setTimeout(() => backdrop.remove(), 380);
  };
  const pop = h('button', { type: 'button', class: `dp dp-${item.k}`, 'aria-label': `${KINDS[item.k]}: ${item.t}. اضغط للإغلاق`, onclick: close },
    h('span', { class: 'dp-kind' }, KINDS[item.k]),
    h('span', { class: 'dp-text' }, item.t),
    h('span', { class: 'dp-src' }, item.s),
    h('span', { class: 'dp-hint' }, 'اضغط لإغلاق'));
  const backdrop = h('div', { class: 'dp-layer', role: 'status' }, pop);
  document.body.append(backdrop);
  return backdrop;
}
