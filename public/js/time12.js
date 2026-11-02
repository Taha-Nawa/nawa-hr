// الوقت بنظام 12 ساعة (ص/م) للعرض والإدخال. التخزين والحساب والتبادل مع الإكسل وجوجل يبقى بصيغة HH:MM (24 ساعة).
import { h } from './dom.js';

const AM = 'ص';
const PM = 'م';
const TZ = 'Asia/Hebron';

/** '14:05' ← '2:05 م'. أي قيمة غير صالحة تُعاد كما هي. */
export function fmt12(hhmm) {
  if (hhmm === null || hhmm === undefined || hhmm === '') return '';
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(hhmm));
  if (!m) return String(hhmm);
  const hr = Number(m[1]);
  if (hr > 23 || Number(m[2]) > 59) return String(hhmm);
  return `${hr % 12 === 0 ? 12 : hr % 12}:${m[2]} ${hr < 12 ? AM : PM}`;
}

export const fmtRange12 = (from, to) => `${fmt12(from)} – ${fmt12(to)}`;

/** (12 ساعة، دقائق، ص|م) ← 'HH:MM'؛ '' إن نقص شيء. */
export function to24(hour12, minute, ap) {
  const hr = Number(hour12);
  const mi = Number(minute);
  if (!hour12 || minute === '' || minute === null || !(ap === AM || ap === PM)) return '';
  if (!Number.isInteger(hr) || hr < 1 || hr > 12 || !Number.isInteger(mi) || mi < 0 || mi > 59) return '';
  const h24 = (hr % 12) + (ap === PM ? 12 : 0);
  return `${String(h24).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/** 'HH:MM' ← { hour, minute, ap } أو null. */
export function from24(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? ''));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  const hr = Number(m[1]);
  return { hour: String(hr % 12 === 0 ? 12 : hr % 12), minute: m[2], ap: hr < 12 ? AM : PM };
}

/** تاريخ ووقت (UTC من قاعدة البيانات أو ISO) بتوقيت فلسطين: '2026-11-02 2:23 م'. */
export function fmtStamp(s, tz = TZ) {
  if (!s) return '';
  const raw = String(s).trim();
  const iso = raw.replace(' ', 'T');
  const t = Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(t)) return raw;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${fmt12(`${parts.hour}:${parts.minute}`)}`;
}

/** ساعة الآن بصيغة HH:MM بتوقيت فلسطين (للقيم الافتراضية في النماذج). */
export function nowHM(tz = TZ) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute}`;
}

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

// تخمين معقول لوقت الدوام عند اختيار الساعة أولاً: 6–11 صباحاً، و12 و1–5 مساءً. يظهر في الحقل فيصحّحه المستخدم.
const guessAp = (hr) => (Number(hr) >= 6 && Number(hr) <= 11 ? AM : PM);

/**
 * حقل وقت بنظام 12 ساعة: ثلاث قوائم (ساعة، دقيقة، ص/م) بدل <input type="time"> الذي يتبع إعدادات الجهاز
 * فيظهر 24 ساعة على بعض الأجهزة. يحمل الحقل value بصيغة 'HH:MM' (قراءة وكتابة) وdisabled وrequired كحقل عادي،
 * ويُطلق حدث change عند أي تغيير.
 */
export function timeField({ value = '', required = false, disabled = false, onchange, label = '' } = {}) {
  const blank = (t) => h('option', { value: '' }, t);
  const hourSel = h('select', { 'aria-label': `${label ? `${label} — ` : ''}الساعة`, class: 't12-h' }, blank('--'), HOURS.map((x) => h('option', { value: x }, x)));
  const minSel = h('select', { 'aria-label': `${label ? `${label} — ` : ''}الدقائق`, class: 't12-m' }, blank('--'), MINUTES.map((x) => h('option', { value: x }, x)));
  const apSel = h('select', { 'aria-label': `${label ? `${label} — ` : ''}صباحاً أو مساءً`, class: 't12-ap' }, blank('--'), h('option', { value: AM }, AM), h('option', { value: PM }, PM));
  const box = h('span', { class: 't12', role: 'group', dir: 'ltr' }, hourSel, h('span', { class: 't12-sep', 'aria-hidden': 'true' }, ':'), minSel, apSel);
  if (label) box.setAttribute('aria-label', label);

  const set = (v) => {
    const p = from24(v);
    hourSel.value = p ? p.hour : '';
    minSel.value = p ? p.minute : '';
    apSel.value = p ? p.ap : '';
  };
  hourSel.addEventListener('change', () => {
    if (hourSel.value && !minSel.value) minSel.value = '00';
    if (hourSel.value && !apSel.value) apSel.value = guessAp(hourSel.value);
  });

  let isRequired = false;
  Object.defineProperties(box, {
    value: { get: () => to24(hourSel.value, minSel.value, apSel.value), set, configurable: true },
    disabled: { get: () => hourSel.disabled, set: (v) => { for (const s of [hourSel, minSel, apSel]) s.disabled = !!v; }, configurable: true },
    required: { get: () => isRequired, set: (v) => { isRequired = !!v; for (const s of [hourSel, minSel, apSel]) s.required = isRequired; }, configurable: true },
  });
  set(value);
  box.required = required;
  box.disabled = disabled;
  if (onchange) box.addEventListener('change', onchange);
  return box;
}
