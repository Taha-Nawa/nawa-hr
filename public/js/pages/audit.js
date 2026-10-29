import { h, dash } from '../dom.js';
import { get } from '../api.js';

const LABELS = {
  login: 'تسجيل دخول', 'employee.create': 'إضافة موظف', 'employee.update': 'تعديل موظف', 'badge.add': 'إضافة بطاقة', 'badge.revoke': 'إلغاء بطاقة',
  'settings.work': 'تعديل قواعد الدوام', 'holidays.set': 'تعديل العطل', recompute: 'إعادة حساب', 'device.create': 'إنشاء جهاز', 'device.rotate': 'رمز جديد لجهاز',
  'device.deactivate': 'إيقاف جهاز', 'user.create': 'إضافة مستخدم', 'user.update': 'تعديل مستخدم', 'center.create': 'إضافة مركز',
  'import.employees': 'استيراد موظفين', 'import.badges': 'استيراد بطاقات', 'import.movements': 'استيراد حركات',
};

export default async function render() {
  const { entries } = await get('/api/audit?limit=200');
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'سجل التدقيق'), h('p', { class: 'sub' }, 'آخر 200 عملية على النظام. لا يمكن تعديله أو حذفه من الواجهة.'))),
    h('div', { class: 'table-wrap' }, entries.length
      ? h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['الوقت (UTC)', 'من', 'العملية', 'العنصر', 'التفاصيل'].map((t) => h('th', null, t)))),
        h('tbody', null, entries.map((e) => h('tr', null,
          h('td', { class: 'num muted', dir: 'ltr' }, e.at),
          h('td', { dir: 'ltr', class: 'ltr-cell' }, e.actor),
          h('td', null, LABELS[e.action] || e.action),
          h('td', { class: 'muted', dir: 'ltr' }, dash(e.entityId)),
          h('td', { class: 'muted small', dir: 'ltr' }, e.detail ? e.detail.slice(0, 160) : '—')))))
      : h('p', { class: 'empty' }, 'لا عمليات مسجّلة بعد.')));
}
