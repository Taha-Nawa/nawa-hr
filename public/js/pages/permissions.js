// مصفوفة الصلاحيات: من يستطيع ماذا، مقروءة من الخادم نفسه (authz.ACTIONS). للمراجعة فقط.
import { h } from '../dom.js';
import { get } from '../api.js';

const ROLES = [['employee', 'موظف'], ['manager', 'مدير مباشر'], ['hr', 'موارد بشرية'], ['director', 'مدير عام'], ['admin', 'مسؤول النظام']];
const LABELS = {
  'employee.create': 'إضافة موظف', 'employee.update': 'تعديل بيانات موظف وتوزيعه', 'badge.manage': 'إدارة البطاقات', 'center.manage': 'إدارة المراكز',
  'day.correct': 'تصحيح حضور يوم', 'holiday.write': 'تعديل العطل الرسمية', 'import.run': 'استيراد بيانات', 'recompute.run': 'إعادة حساب الأيام',
  'settings.read': 'قراءة الإعدادات', 'settings.write': 'تعديل الإعدادات', 'device.manage': 'أجهزة البوابة', 'user.manage': 'المستخدمون وأدوارهم',
  'audit.read': 'سجل التدقيق', 'volunteer.manage': 'إدارة المتطوعين', 'volunteer.read': 'عرض المتطوعين', 'provider.manage': 'إدارة مزوّدي الخدمة',
  'provider.read': 'عرض مزوّدي الخدمة', 'gates.read': 'حالة البوابات', 'backup.export': 'النسخة الاحتياطية', 'links.manage': 'الروابط', 'balance.manage': 'أرصدة الإجازات',
  'insights.read': 'تسوية الممولين وسلامة البيانات', 'exception.manage': 'الدوام الاستثنائي', 'emergency.manage': 'إعلان طارئ أثناء الدوام',
};

export default async function render() {
  const { actions } = await get('/api/permissions');
  const rows = Object.entries(actions);
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, 'مصفوفة الصلاحيات')),
    h('p', { class: 'muted' }, 'تُقرأ من الخادم مباشرة، فهي ما يُطبَّق فعلاً. يضاف إليها أن الموظف يرى بياناته فقط، والمدير المباشر يرى فريقه، والموارد البشرية والمدير العام والمسؤول يرون الجميع.'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, h('th', null, 'الإجراء'), ROLES.map(([, t]) => h('th', null, t)))),
      h('tbody', null, rows.map(([k, roles]) => h('tr', null, h('td', null, LABELS[k] || k), ROLES.map(([r]) => h('td', null, roles.includes(r) ? '✔' : '—'))))))));
}
