// تبويب «الحركات»: من أضاف أو عدّل أو حذف أو استورد، ومتى. (أسماء الحقول فقط، لا بيانات شخصية.)
import { h } from '../dom.js';
import { get } from '../api.js';
import { toCSV } from '../contract-export.js';
import { saveBlob } from './contract-actions.js';

const LABEL = { 'contract.create': 'إضافة عقد', 'contract.update': 'تعديل عقد', 'contract.delete': 'حذف عقد', 'contract.import': 'استيراد عقود', 'contract.dedupe': 'حذف مكرّرات', 'contract.renumber': 'إعادة ترقيم', 'contract.tpl.create': 'إنشاء صيغة', 'contract.tpl.update': 'تعديل صيغة', 'contract.tpl.delete': 'حذف صيغة', 'contract.tpl.rev': 'حفظ نسخة صيغة', 'contract.hdr.save': 'حفظ الترويسات', 'contract.file.add': 'رفع مستند', 'contract.file.delete': 'حذف مستند' };
const when = (s) => { const d = new Date(`${s.replace(' ', 'T')}Z`); return Number.isNaN(d.getTime()) ? s : d.toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Asia/Hebron', dateStyle: 'short', timeStyle: 'short' }); };
const detail = (r) => {
  const d = r.detail || {};
  if (d.fields) return `الحقول: ${d.fields.join('، ')}`;
  return Object.entries(d).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : v}`).join(' · ');
};

export async function drawLog() {
  const { log } = await get('/api/contracts/log');
  let who = '';
  let act = '';
  const body = h('div', { class: 'table-wrap' });
  const filtered = () => log.filter((r) => (!who || r.actor === who) && (!act || r.action === act));
  const draw = () => {
    const rs = filtered();
    body.replaceChildren(rs.length ? h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['التاريخ والوقت', 'الحركة', 'رقم العقد', 'التفاصيل', 'بواسطة'].map((t) => h('th', null, t)))),
      h('tbody', null, rs.map((r) => h('tr', null, h('td', null, when(r.at)), h('td', null, LABEL[r.action] || r.action), h('td', { dir: 'ltr', class: 'ltr-cell' }, r.entityId || '—'), h('td', null, detail(r)), h('td', null, r.actor))))) : h('p', { class: 'empty' }, 'لا توجد حركات مسجّلة بعد.'));
  };
  const actors = [...new Set(log.map((r) => r.actor))];
  draw();
  return h('div', null,
    h('div', { class: 'tools' },
      h('select', { 'aria-label': 'الحركة', onchange: (e) => { act = e.target.value; draw(); } }, h('option', { value: '' }, 'كل الحركات'), Object.entries(LABEL).map(([k, t]) => h('option', { value: k }, t))),
      h('select', { 'aria-label': 'المستخدم', onchange: (e) => { who = e.target.value; draw(); } }, h('option', { value: '' }, 'كل المستخدمين'), actors.map((a) => h('option', { value: a }, a))),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => saveBlob(new Blob([toCSV([['التاريخ', (r) => r.at], ['الحركة', (r) => LABEL[r.action] || r.action], ['رقم العقد', (r) => r.entityId], ['التفاصيل', detail], ['بواسطة', (r) => r.actor]], filtered())], { type: 'text/csv;charset=utf-8' }), 'سجل حركات العقود.csv') }, 'تصدير السجل CSV')),
    h('p', { class: 'sub' }, `آخر ${log.length} حركة. الحذف نهائي ولا توجد سلة محذوفات، وهذا السجل يبيّن من فعل ماذا ومتى.`),
    body);
}
