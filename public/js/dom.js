// أدوات صغيرة لبناء الواجهة بأمان: النصوص تُدرج دائماً كنص (textContent) فلا مجال لحقن HTML.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v); // CSSOM مسموح بالـ CSP بخلاف سمة style النصية
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'required') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) {
  el.replaceChildren();
  return el;
}

// ---- تنسيق ----
export const AR_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const AR_MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];

export function todayLocal(tz = 'Asia/Hebron') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDays(date, n) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

export function dayName(date) {
  return AR_DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

export function longDate(date) {
  const d = new Date(`${date}T00:00:00Z`);
  return `${AR_DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${AR_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** ساعات عشرية -> "6.5" (أو "—") */
export function hrs(n) {
  return n === null || n === undefined ? '—' : String(Math.round(n * 100) / 100);
}

export const dash = (v) => (v === null || v === undefined || v === '' ? '—' : v);

// ---- إشعارات قصيرة ----
let toastBox;
export function toast(message, kind = 'ok') {
  toastBox ||= document.body.appendChild(h('div', { class: 'toasts', 'aria-live': 'polite' }));
  const t = h('div', { class: `toast toast-${kind}`, role: kind === 'err' ? 'alert' : 'status' }, message);
  toastBox.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3500);
}

// ---- نوافذ حوار ----
/**
 * يفتح نافذة حوار. content: عقدة DOM. يُرجع { close, el }.
 * onClose يُستدعى عند الإغلاق بأي طريقة.
 */
export function dialog({ title, content, wide = false, onClose }) {
  const dlg = h('dialog', { class: `dlg${wide ? ' dlg-wide' : ''}`, 'aria-label': title });
  const closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'إغلاق', onclick: () => dlg.close() }, '✕');
  dlg.append(h('header', { class: 'dlg-head' }, h('h2', null, title), closeBtn), h('div', { class: 'dlg-body' }, content));
  dlg.addEventListener('close', () => {
    dlg.remove();
    onClose?.();
  });
  document.body.append(dlg);
  dlg.showModal();
  return { el: dlg, close: () => dlg.close() };
}

export function confirmBox(message, okLabel = 'تأكيد', danger = false) {
  return new Promise((resolve) => {
    let answer = false;
    const d = dialog({
      title: 'تأكيد',
      content: h('div', null,
        h('p', { class: 'dlg-text' }, message),
        h('div', { class: 'dlg-actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'تراجع'),
          h('button', { type: 'button', class: danger ? 'btn btn-danger' : 'btn btn-primary', onclick: () => { answer = true; d.close(); } }, okLabel))),
      onClose: () => resolve(answer),
    });
  });
}

// ---- عناصر نماذج ----
export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export function select(options, value, attrs = {}) {
  const el = h('select', attrs);
  for (const [v, label] of options) el.append(h('option', { value: v, selected: String(v) === String(value ?? '') }, label));
  return el;
}

export function copyText(text) {
  return navigator.clipboard.writeText(text).then(() => toast('نُسخ'), () => toast('تعذّر النسخ، انسخه يدوياً', 'err'));
}
