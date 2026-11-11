// وضع السكون: بعد 5 دقائق بلا استعمال شاشة هادئة (ساعة وتاريخ وفانوس بحكمة جديدة) تزول بأي حركة،
// وبعد ساعة ونصف يُقفل النظام ولا يُفتح إلا بالـ PIN (من دونه تُنهى الجلسة ويُطلب الدخول من جديد).
// القفل هنا حاجز لشاشة المستخدم؛ الحماية الفعلية للجلسة تبقى على الخادم، والتحقق من الـ PIN يتم هناك.
import { h, icon, todayLocal, longDate } from './dom.js';
import { post } from './api.js';
import { fmt12 } from './time12.js';
import { KINDS } from './daily-pop-lib.js';
import { fitLamp } from './daily-pop.js';
import { idleStage, idleItem } from './idle-lib.js';

const LAST_KEY = 'nawa.idle.last';
const LOCK_KEY = 'nawa.idle.lock';
const TZ = 'Asia/Hebron';
const ARM_MS = 1500; // تجاهل اهتزاز الفأرة لحظة ظهور الشاشة
const EVENTS = ['pointerdown', 'mousemove', 'keydown', 'wheel', 'touchstart', 'scroll'];

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* التخزين غير متاح */ } };

function clockParts(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { time: fmt12(`${get('hour')}:${get('minute')}`), hour: Number(get('hour')) };
}

/**
 * يبدأ مراقبة الخمول. user: المستخدم الحالي (id وpin)، onSignOut(message): ينهي الجلسة ويعرض الدخول.
 * يعيد دالة إيقاف تزيل كل شيء (عند تسجيل الخروج).
 */
export function startIdle({ user, onSignOut, now = () => Date.now() }) {
  let last = Number(lsGet(LAST_KEY)) || now();
  let rest = null; // { el, shownAt, timer }
  let lock = null;
  let lastWrite = 0;
  const uid = String(user.id ?? user.email ?? 'u');

  const touch = () => {
    last = now();
    if (last - lastWrite > 1000) { lastWrite = last; lsSet(LAST_KEY, String(last)); }
  };

  // ---------------------------------------------------------------- شاشة السكون
  function showRest() {
    if (rest || lock) return;
    const item = idleItem(todayLocal(), clockParts().hour);
    const time = h('div', { class: 'idle-time' });
    const lamp = h('span', { class: 'dp-lamp' },
      h('span', { class: 'dp-kind' }, KINDS[item.k]),
      h('span', { class: 'dp-text' }, item.t),
      h('span', { class: 'dp-src' }, item.s));
    const pop = h('div', { class: `dp dp-${item.k} dp-s-lantern idle-pop`, role: 'img', 'aria-label': `${KINDS[item.k]}: ${item.t}` },
      h('span', { class: 'dp-str', 'aria-hidden': 'true' }), h('span', { class: 'dp-cap', 'aria-hidden': 'true' }), lamp, h('span', { class: 'dp-base', 'aria-hidden': 'true' }));
    const el = h('div', { class: 'idle', role: 'status' },
      h('div', { class: 'idle-clock' }, time, h('div', { class: 'idle-date' }, longDate(todayLocal()))), pop);
    const paint = () => { time.textContent = clockParts().time; };
    paint();
    document.body.append(el);
    fitLamp(lamp);
    rest = { el, shownAt: now(), timer: setInterval(paint, 15_000) };
  }
  function hideRest() {
    if (!rest) return;
    const { el, timer } = rest;
    rest = null;
    clearInterval(timer);
    el.classList.add('idle-gone');
    setTimeout(() => el.remove(), 500);
  }

  // ---------------------------------------------------------------- شاشة القفل
  function showLock() {
    if (lock) return;
    if (!user.pin) { // لا PIN لهذا الحساب: نُنهي الجلسة فيُطلب الدخول بإحدى الطرق المعتادة
      stop();
      onSignOut('طال الخمول أكثر من ساعة ونصف، سجّل الدخول من جديد.');
      return;
    }
    hideRest();
    lsSet(LOCK_KEY, uid);
    const input = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'current-password', maxlength: '6', class: 'code-input idle-pin', dir: 'ltr', 'aria-label': 'رقم PIN', placeholder: '••••••' });
    const err = h('p', { class: 'idle-err', role: 'alert' });
    let busy = false;
    const submit = async () => {
      if (busy || input.value.length !== 6) return;
      busy = true;
      err.textContent = '';
      try {
        await post('/api/auth/unlock', { pin: input.value });
        unlock();
      } catch (e) {
        err.textContent = e.message || 'الـ PIN غير صحيح';
        input.value = '';
        input.focus();
      } finally {
        busy = false;
      }
    };
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 6);
      if (input.value.length === 6) submit();
    });
    const out = h('button', { type: 'button', class: 'idle-out', onclick: () => { stop(); onSignOut(); } }, icon('out'), 'تسجيل الخروج');
    const el = h('div', { class: 'idle idle-lock', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'النظام مقفل' },
      h('div', { class: 'idle-card' },
        h('span', { class: 'idle-key', 'aria-hidden': 'true' }, icon('key')),
        h('div', { class: 'idle-who' }, user.employeeName || user.email),
        h('form', { class: 'idle-form', onsubmit: (e) => { e.preventDefault(); submit(); } }, input, err),
        out));
    document.body.append(el);
    document.getElementById('app')?.setAttribute('inert', '');
    lock = { el };
    input.focus();
  }
  function unlock() {
    if (!lock) return;
    lock.el.remove();
    lock = null;
    lsSet(LOCK_KEY, null);
    document.getElementById('app')?.removeAttribute('inert');
    touch();
  }

  // ---------------------------------------------------------------- المراقبة
  const onActivity = () => {
    if (lock) return;
    if (rest) {
      if (now() - rest.shownAt < ARM_MS) return;
      hideRest();
    }
    touch();
  };
  const tick = () => {
    if (lock) return;
    // نشاط في تبويب آخر يُحسب (آخر نشاط مشترك عبر التخزين المحلي)
    const shared = Number(lsGet(LAST_KEY));
    if (shared > last) last = shared;
    const stage = idleStage(now() - last);
    if (stage === 'lock') showLock();
    else if (stage === 'rest') showRest();
    else if (rest) hideRest();
  };

  for (const ev of EVENTS) window.addEventListener(ev, onActivity, { passive: true, capture: true });
  document.addEventListener('visibilitychange', tick);
  const timer = setInterval(tick, 5000);

  function stop() {
    clearInterval(timer);
    for (const ev of EVENTS) window.removeEventListener(ev, onActivity, { capture: true });
    document.removeEventListener('visibilitychange', tick);
    hideRest();
    lock?.el.remove();
    lock = null;
    document.getElementById('app')?.removeAttribute('inert');
    lsSet(LOCK_KEY, null);
  }

  // إعادة تحميل الصفحة أثناء القفل لا تتجاوزه
  if (lsGet(LOCK_KEY) === uid) showLock();
  else { touch(); tick(); }
  return stop;
}
