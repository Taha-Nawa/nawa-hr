// الصورة الشخصية في الدوائر الصغيرة (الشريط العلوي، بطاقة «مرحباً بعودتك»): تُحمَّل من رابطها إن وُجد، وإلا يبقى الحرف.
// لا رفع ولا تخزين: الرابط محفوظ نصاً في بيانات الموظف والمتصفح يحمّلها من مصدرها.
import { h } from './dom.js';

/** يضيف الصورة فوق الحرف بعد نجاح تحميلها فقط؛ فشلها يترك الحرف كما هو. */
export function withPhoto(box, photo) {
  if (!/^https:\/\//.test(photo || '')) return box;
  const img = h('img', { alt: '', referrerpolicy: 'no-referrer', decoding: 'async' });
  img.addEventListener('load', () => { box.classList.add('has-photo'); box.replaceChildren(img); });
  img.src = photo;
  return box;
}
