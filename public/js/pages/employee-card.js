// بطاقة حضور الموظف للطباعة (85.6×54 مم): رمز QR يُمسح على البوابة. إعادة الإصدار تُلغي البطاقة السابقة فوراً.
import { h, icon, select, toast, confirmBox } from '../dom.js';
import { get, post } from '../api.js';
import { qrSvg } from '../qr.js';
import { idCard } from '../id-card.js';

const cardEl = (e, qr) => idCard({ kind: 'employee', name: e.name, line: [e.jobTitle, e.center].filter(Boolean).join(' · '), code: e.code, qr });

export default async function render({ params }) {
  const id = Number(params.id);
  let d;
  try {
    d = await get(`/api/employees/${id}/card`);
  } catch (e) {
    return h('div', { class: 'page' }, h('div', { class: 'notice notice-err' }, e.message));
  }
  let qr = d.card ? await qrSvg(d.card) : null;
  let copies = 1;
  const sheet = h('div', { class: 'id-sheet' });
  const draw = () => {
    if (!qr) { sheet.replaceChildren(h('div', { class: 'empty' }, h('b', null, 'لا بطاقة سارية'), h('p', { class: 'muted' }, 'اضغط «إصدار بطاقة جديدة» لإنشائها.'))); return; }
    sheet.replaceChildren(...Array.from({ length: copies }, () => cardEl(d.employee, qr)));
  };
  draw();
  const count = select([['1', 'نسخة واحدة'], ['2', 'نسختان'], ['4', '4 نسخ'], ['8', '8 نسخ']], '1', { 'aria-label': 'عدد النسخ على الورقة', onchange: (e) => { copies = Number(e.target.value); draw(); } });
  const reissue = async () => {
    const msg = d.card ? 'تُلغى البطاقة الحالية فوراً (فتُرفض عند المسح) وتصدر بطاقة جديدة، للضياع أو التلف. متابعة؟' : 'إصدار بطاقة جديدة لهذا الموظف؟';
    if (!(await confirmBox(msg, 'أصدر بطاقة جديدة', !!d.card))) return;
    try {
      const r = await post(`/api/employees/${id}/card`);
      d.card = r.card;
      qr = await qrSvg(r.card);
      draw();
      toast('صدرت بطاقة جديدة؛ اطبعها الآن');
    } catch (e) {
      toast(e.message, 'err');
    }
  };
  return h('div', { class: 'page print-page' },
    h('header', { class: 'page-head no-print' },
      h('div', null, h('a', { href: `#/employees/${id}`, class: 'back' }, d.employee.name), h('h1', null, `بطاقة ${d.employee.name}`)),
      h('div', { class: 'row-actions' }, count, h('button', { type: 'button', class: 'btn', onclick: reissue }, icon('key'), d.card ? 'بطاقة جديدة (ضاعت)' : 'إصدار بطاقة جديدة'), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => window.print() }, icon('printer'), 'طباعة'))),
    sheet);
}
