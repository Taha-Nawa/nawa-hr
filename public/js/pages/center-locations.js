// مواقع المراكز والنقاط: إحداثيات كل مركز ونصف قطر النطاق المسموح (150 م افتراضياً). تُقارن بها مواقع حركات الحضور.
import { h, clear, field, toast, icon } from '../dom.js';
import { get, post } from '../api.js';

async function patch(id, body) {
  const r = await fetch(`/api/centers/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || 'تعذّر الحفظ');
  return j;
}

export default async function render() {
  const { centers } = await get('/api/centers');
  const box = h('div', { class: 'rh-edit-list' });
  const draw = () => clear(box).append(...centers.filter((c) => c.active).map((c) => {
    const lat = h('input', { dir: 'ltr', inputmode: 'decimal', value: c.lat ?? '', placeholder: '31.4167', 'aria-label': 'خط العرض' });
    const lng = h('input', { dir: 'ltr', inputmode: 'decimal', value: c.lng ?? '', placeholder: '34.3500', 'aria-label': 'خط الطول' });
    const rad = h('input', { type: 'number', min: '30', max: '2000', step: '10', value: c.radiusM ?? 150, 'aria-label': 'نصف القطر' });
    const status = h('span', { class: 'muted' }, c.lat === null ? 'لم يُحدَّد الموقع بعد' : 'محدَّد');
    const save = async (body) => {
      try {
        await patch(c.id, body);
        if ('lat' in body) { c.lat = body.lat; c.lng = body.lng; }
        if ('radiusM' in body) c.radiusM = body.radiusM;
        status.textContent = c.lat === null ? 'لم يُحدَّد الموقع بعد' : 'محدَّد';
        toast('حُفظ');
      } catch (e) {
        toast(e.message, 'err');
      }
    };
    const here = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => {
      if (!navigator.geolocation) return toast('المتصفح لا يدعم تحديد الموقع', 'err');
      navigator.geolocation.getCurrentPosition((p) => {
        lat.value = p.coords.latitude.toFixed(6);
        lng.value = p.coords.longitude.toFixed(6);
        toast(`الدقة التقريبية ${Math.round(p.coords.accuracy)} م — اضغط حفظ`);
      }, () => toast('تعذّر تحديد موقعك: اسمح بالموقع في المتصفح', 'err'), { enableHighAccuracy: true, timeout: 20000 });
    } }, 'استخدم موقعي الحالي (وأنا في المركز)');
    return h('div', { class: 'rh-item' },
      h('div', null, h('b', null, c.name), h('div', null, status)),
      h('div', { class: 'rh-item-f' }, field('خط العرض', lat), field('خط الطول', lng), field('نصف القطر (م)', rad)),
      here,
      h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => {
        const a = Number(lat.value);
        const b = Number(lng.value);
        if (lat.value.trim() === '' && lng.value.trim() === '') return save({ lat: null, lng: null, radiusM: Number(rad.value) });
        if (!Number.isFinite(a) || !Number.isFinite(b)) return toast('أدخل رقمين صحيحين للموقع', 'err');
        save({ lat: a, lng: b, radiusM: Number(rad.value) });
      } }, icon('check'), 'حفظ'));
  }));
  draw();
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, 'مواقع المراكز والنقاط')),
    h('p', { class: 'muted' }, 'افتح هذه الصفحة من هاتفك وأنت واقف في المركز أو النقطة، ثم اضغط «استخدم موقعي الحالي» ثم «حفظ». تُقارَن بها مواقع حركات الحضور، ويُعلَّم اليوم إن خرجت الحركة عن نصف القطر أو تباعدت حركات الموظف الواحد.'),
    box);
}
