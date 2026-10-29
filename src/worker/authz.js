/**
 * الصلاحيات في مكان واحد. D1 لا يملك Row Level Security، فكل وصول للبيانات يمرّ من هنا:
 * أي معالج API يستدعي can()/canReadEmployee() قبل قراءة أو كتابة، وكل قاعدة لها اختبار آلي (test/authz.test.js).
 *
 * الأدوار:
 *   employee : نفسه فقط
 *   manager  : نفسه + مرؤوسوه المباشرون (employees.manager_id = موظفه)
 *   hr       : كل الموظفين (قراءة وكتابة)
 *   director : قراءة كل الموظفين (+ الاعتماد المتصاعد في مرحلة الطلبات)
 *   admin    : كل شيء + المستخدمون والأجهزة والإعدادات
 */
export const ROLES = ['employee', 'manager', 'hr', 'director', 'admin'];

const READ_ALL = new Set(['hr', 'director', 'admin']);

/** إجراءات عامة (غير مرتبطة بموظف محدّد) -> الأدوار المسموحة */
export const ACTIONS = {
  'employee.create': ['hr', 'admin'],
  'employee.update': ['hr', 'admin'],
  'badge.manage': ['hr', 'admin'],
  'day.correct': ['hr', 'admin'],
  'holiday.write': ['hr', 'admin'],
  'settings.read': ['hr', 'director', 'admin'],
  'settings.write': ['admin'],
  'device.manage': ['admin'],
  'user.manage': ['admin'],
  'audit.read': ['hr', 'director', 'admin'],
};

export function can(user, action) {
  const roles = ACTIONS[action];
  return !!user && !!roles && roles.includes(user.role);
}

/** target: { id, manager_id } */
export function canReadEmployee(user, target) {
  if (!user || !target) return false;
  if (READ_ALL.has(user.role)) return true;
  if (user.employeeId != null && user.employeeId === target.id) return true;
  return user.role === 'manager' && user.employeeId != null && target.manager_id === user.employeeId;
}

/** شرط SQL (مع متغيّراته) يحصر قائمة الموظفين بما يحق للمستخدم رؤيته. */
export function employeeScope(user, alias = 'e') {
  if (READ_ALL.has(user.role)) return { sql: '1 = 1', params: [] };
  if (user.employeeId == null) return { sql: '0 = 1', params: [] };
  if (user.role === 'manager') return { sql: `(${alias}.id = ? OR ${alias}.manager_id = ?)`, params: [user.employeeId, user.employeeId] };
  return { sql: `${alias}.id = ?`, params: [user.employeeId] };
}
