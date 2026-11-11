// «بوب اليوم»: فانوس مضيء يهبط ويتأرجح ويشعّ ثم يخفت، يظهر عند أول فتح للنظام كل يوم، ويصعد ويختفي بالنقر عليه.
// الرسائل الإدارية الموجَّهة للموظف (من الموارد البشرية أو المسؤول، محدّدة المدة) تظهر أولاً بفانوس ياقوتي، ثم حكمة اليوم.
import { h, todayLocal } from './dom.js';
import { get, post } from './api.js';
import { itemFor, KINDS, SHAPES, DEFAULT_SHAPE } from './daily-pop-lib.js';

const memory = new Set(); // احتياط إن تعذّر التخزين المحلي (وضع خاص): تظهر مرة لكل جلسة صفحة

function seen(key) {
  try { return localStorage.getItem(key) === '1' || memory.has(key); } catch { return memory.has(key); }
}
function markSeen(key, date) {
  memory.add(key);
  try {
    localStorage.setItem(key, '1');
    for (let i = localStorage.length - 1; i >= 0; i--) { // تنظيف أيام قديمة
      const k = localStorage.key(i);
      if (k && k.startsWith('nawa.pop.') && !k.endsWith(`.${date}`)) localStorage.removeItem(k);
    }
  } catch { /* لا مشكلة */ }
}

/** يلفّ الفانوس نصّه تماماً: يقيس أعرض سطر فعلي بعد الالتفاف (text-wrap: balance لا يقلّص الصندوق) فلا يبقى فراغ جانبي. */
export function fitLamp(lamp) {
  const t = lamp.querySelector('.dp-text');
  const fit = () => {
    const r = document.createRange();
    r.selectNodeContents(t);
    const w = Math.max(...[...r.getClientRects()].map((x) => x.width));
    if (Number.isFinite(w) && w > 0) t.style.width = `${Math.ceil(w) + 2}px`;
  };
  requestAnimationFrame(fit);
  document.fonts?.ready?.then(() => { t.style.width = ''; requestAnimationFrame(fit); });
}

/** فانوس واحد: يعيد وعداً يُحلّ عند إغلاقه بالنقر. */
function lantern({ kind, label, title, text, source, hint, shape = DEFAULT_SHAPE }) {
  const sh = SHAPES.some(([id]) => id === shape) ? shape : DEFAULT_SHAPE;
  return new Promise((resolve) => {
    const lamp = h('span', { class: 'dp-lamp' },
      h('span', { class: 'dp-kind' }, label),
      title ? h('span', { class: 'dp-title' }, title) : null,
      h('span', { class: 'dp-text' }, text),
      source ? h('span', { class: 'dp-src' }, source) : null);
    const pop = h('button', { type: 'button', class: `dp dp-${kind} dp-s-${sh}`, 'aria-label': `${label}: ${text}. اضغط للإغلاق` },
      h('span', { class: 'dp-str', 'aria-hidden': 'true' }), h('span', { class: 'dp-cap', 'aria-hidden': 'true' }), lamp, h('span', { class: 'dp-base', 'aria-hidden': 'true' }));
    const layer = h('div', { class: `dp-layer${sh === 'lantern' ? '' : ' dp-center'}`, role: 'status' }, pop);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      pop.classList.add('dp-out');
      layer.classList.add('dp-gone');
      setTimeout(() => { layer.remove(); document.removeEventListener('keydown', onKey); resolve(); }, 720);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    pop.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.append(layer);
    fitLamp(lamp);
  });
}

// الفوانيس تُعرض واحداً بعد واحد: لا يتزاحم فانوس الحكمة مع رسالة وصلت للتوّ.
let chain = Promise.resolve();
let running = 0;
const exclusive = (fn) => {
  running++;
  const p = chain.then(fn).finally(() => { running--; });
  chain = p.catch(() => {});
  return p;
};

/** رسائل الإدارة والفريق الواجبة الآن (غير مشاهَدة، أو متكررة حان موعد تكرارها): تُعرض ثم تُسجَّل مشاهدتها. */
async function showPending(items, shape) {
  for (const m of items) {
    await lantern({ kind: 'msg', label: m.from ? `رسالة من ${m.from}` : 'رسالة من الإدارة', title: m.title, text: m.body, hint: 'اضغط لإغلاق الرسالة', shape });
    post(`/api/announcements/${m.id}/seen`, {}).catch(() => {});
  }
}

/** يعرض الرسائل الإدارية الواجبة ثم حكمة اليوم (مرة واحدة يومياً لكل مستخدم). force للمعاينة. */
export async function dailyPop(user, { force = false, messages = null, preview = false, shape = null } = {}) {
  if (!user) return;
  if (preview) { // معاينة قبل النشر أو الاعتماد: لا تُسجَّل مشاهدة ولا تظهر حكمة اليوم. كل عنصر قد يحمل kind/label/source
    for (const m of messages || []) await lantern({ kind: m.kind || 'msg', label: m.label || 'رسالة من الإدارة', title: m.title, text: m.body, source: m.source, hint: 'اضغط للإغلاق', shape: shape || m.shape });
    return;
  }
  const date = todayLocal();
  let items = messages;
  let chosen = shape;
  if (!items) { try { const r = await get('/api/announcements/active'); items = r.items || []; chosen = chosen || r.shape; } catch { items = []; } }
  await exclusive(async () => {
    await showPending(items, chosen);
    const key = `nawa.pop.${user.id ?? user.email ?? 'u'}.${date}`;
    if (!force && seen(key)) return;
    const item = itemFor(date);
    markSeen(key, date);
    await lantern({ kind: item.k, label: KINDS[item.k], text: item.t, source: item.s, hint: 'اضغط لإغلاق', shape: chosen });
  });
}

const POLL_MS = 30_000;

/**
 * متابعة الرسائل أثناء بقاء النظام مفتوحاً: تظهر الرسالة للموظف فور إرسالها دون تحديث الصفحة، وتعود المتكررة في موعدها.
 * تفحص كل 30 ثانية، وفور عودة التبويب للظهور. تتخطى الفحص إن كان فانوس معروضاً الآن. تعيد دالة إيقاف.
 */
export function watchAnnouncements(user) {
  if (!user) return () => {};
  let checking = false;
  const check = async () => {
    if (checking || running || document.hidden) return;
    checking = true;
    try {
      const r = await get('/api/announcements/active');
      if ((r.items || []).length) await exclusive(() => showPending(r.items, r.shape));
    } catch { /* انقطاع شبكة مؤقت: نحاول في الدورة التالية */ } finally { checking = false; }
  };
  const timer = setInterval(check, POLL_MS);
  const onVisible = () => { if (!document.hidden) check(); };
  document.addEventListener('visibilitychange', onVisible);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
}
