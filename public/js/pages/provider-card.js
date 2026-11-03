// بطاقة حضور مزوّد الخدمة للطباعة (85.6×54 مم): رمز QR سرّي يُمسح على بوابة المركز كبطاقة الموظف.
// تُطبع على ورق عادي وتُقصّ، أو تُحفظ PDF وتُرسل لهاتف المزوّد ليعرضها على الكاميرا.
import { h, icon, select } from '../dom.js';
import { get } from '../api.js';
import { qrSvg } from '../qr.js';
import { dmy, scheduleLines } from '../providers-lib.js';

function cardEl(p, qr) {
  return h('article', { class: 'id-card', 'aria-label': `بطاقة ${p.name}` },
    h('div', { class: 'id-main' },
      h('header', { class: 'id-head' }, h('img', { src: '/logo.png', alt: '' }), h('div', null, h('strong', null, 'جمعية نوى للثقافة والفنون'), h('span', null, 'بطاقة مزوّد خدمة'))),
      h('h2', { class: 'id-name' }, p.name),
      h('p', { class: 'id-meta' }, [p.service, p.center].filter(Boolean).join(' · ')),
      h('p', { class: 'id-code', dir: 'ltr' }, p.code),
      h('p', { class: 'id-valid' }, `صالحة حتى ${dmy(p.contractEnd)}`)),
    h('div', { class: 'id-qr' }, qr.cloneNode(true), h('span', null, 'امسحها على البوابة عند الحضور والانصراف')));
}

export default async function render({ params }) {
  const id = Number(params.id);
  const d = await get(`/api/providers/${id}`);
  const p = d.provider;
  if (!d.card) return h('div', { class: 'page' }, h('div', { class: 'notice notice-err' }, 'لا تملك صلاحية طباعة بطاقة المزوّد.'));
  const qr = await qrSvg(d.card.card);
  qr.setAttribute('aria-label', `رمز بطاقة ${p.name}`); // لا نكشف سرّ البطاقة لقارئ الشاشة
  let copies = 1;
  const sheet = h('div', { class: 'id-sheet' });
  const draw = () => sheet.replaceChildren(...Array.from({ length: copies }, () => cardEl(p, qr)));
  draw();
  const count = select([['1', 'نسخة واحدة'], ['2', 'نسختان'], ['4', '4 نسخ'], ['8', '8 نسخ']], '1', { 'aria-label': 'عدد النسخ على الورقة', onchange: (e) => { copies = Number(e.target.value); draw(); } });
  return h('div', { class: 'page print-page' },
    h('header', { class: 'page-head no-print' },
      h('div', null, h('a', { href: `#/providers/${id}`, class: 'back' }, 'ملف المزوّد'), h('h1', null, `بطاقة ${p.name}`),
        h('p', { class: 'sub' }, `صالحة حتى ${dmy(p.contractEnd)} — بعدها تتوقف تلقائياً عن العمل على البوابة`)),
      h('div', { class: 'row-actions' }, count, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => window.print() }, icon('printer'), 'طباعة'))),
    h('div', { class: 'notice no-print' },
      h('b', null, 'للمزوّد: '), 'يحتفظ بالبطاقة ويمسح رمزها على تابلت البوابة في المركز: «حضور» عند الوصول، «خروج» و«عودة» عند الخروج المؤقت، «انصراف» عند النهاية. ',
      p.contractStart ? `الجدول: ${scheduleLines(d.schedule).join(' — ')}.` : ''),
    sheet,
    h('p', { class: 'field-hint no-print' }, 'إن ضاعت البطاقة أو تلفت أصدر بطاقة جديدة من ملف المزوّد فتُلغى القديمة فوراً.'));
}
