// بطاقة حضور المتطوع للطباعة (85.6×54 مم): رمز QR سرّي يُمسح على البوابة كبطاقة الموظف، فيُملأ كشفه الشهري تلقائياً.
import { h, icon, select, toast, confirmBox } from '../dom.js';
import { get, post } from '../api.js';
import { qrSvg } from '../qr.js';

function cardEl(v, qr) {
  return h('article', { class: 'id-card', 'aria-label': `بطاقة ${v.name}` },
    h('div', { class: 'id-main' },
      h('header', { class: 'id-head' }, h('img', { src: '/logo.png', alt: '' }), h('div', null, h('strong', null, 'جمعية نوى للثقافة والفنون'), h('span', null, 'بطاقة متطوع'))),
      h('h2', { class: 'id-name' }, v.name),
      h('p', { class: 'id-meta' }, [v.project, v.center].filter(Boolean).join(' · ')),
      h('p', { class: 'id-code', dir: 'ltr' }, v.code)),
    h('div', { class: 'id-qr' }, qr.cloneNode(true), h('span', null, 'امسحها على البوابة عند الحضور والانصراف')));
}

export default async function render({ params }) {
  const id = Number(params.id);
  let d;
  try {
    d = await get(`/api/volunteers/${id}/card`);
  } catch (e) {
    return h('div', { class: 'page' }, h('div', { class: 'notice notice-err' }, e.message));
  }
  let qr = await qrSvg(d.card);
  let copies = 1;
  const sheet = h('div', { class: 'id-sheet' });
  const draw = () => sheet.replaceChildren(...Array.from({ length: copies }, () => cardEl(d.volunteer, qr)));
  draw();
  const count = select([['1', 'نسخة واحدة'], ['2', 'نسختان'], ['4', '4 نسخ'], ['8', '8 نسخ']], '1', { 'aria-label': 'عدد النسخ على الورقة', onchange: (e) => { copies = Number(e.target.value); draw(); } });
  const reissue = async () => {
    if (!(await confirmBox('تُلغى البطاقة الحالية فوراً وتصدر بطاقة جديدة (للضياع أو التلف). متابعة؟', 'أصدر بطاقة جديدة', true))) return;
    try {
      const r = await post(`/api/volunteers/${id}/card`);
      qr = await qrSvg(r.card);
      draw();
      toast('صدرت بطاقة جديدة');
    } catch (e) {
      toast(e.message, 'err');
    }
  };
  return h('div', { class: 'page print-page' },
    h('header', { class: 'page-head no-print' },
      h('div', null, h('a', { href: '#/volunteers', class: 'back' }, 'المتطوعون'), h('h1', null, `بطاقة ${d.volunteer.name}`)),
      h('div', { class: 'row-actions' }, count, h('button', { type: 'button', class: 'btn', onclick: reissue }, icon('key'), 'بطاقة جديدة (ضاعت)'), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => window.print() }, icon('printer'), 'طباعة'))),
    h('div', { class: 'notice no-print' }, h('b', null, 'للمتطوع: '), 'يمسح رمز بطاقته على البوابة: «حضور» عند الوصول و«انصراف» عند النهاية، فيُملأ كشفه الشهري تلقائياً. أي تصحيح تدخله الموارد البشرية يدوياً له الأولوية على المسح.'),
    sheet);
}
