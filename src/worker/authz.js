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
  'center.manage': ['hr', 'admin'],
  'day.correct': ['hr', 'admin'],
  'holiday.write': ['hr', 'admin'],
  'import.run': ['hr', 'admin'],
  'recompute.run': ['hr', 'admin'],
  'settings.read': ['hr', 'director', 'admin'],
  'settings.write': ['admin'],
  'device.manage': ['admin'],
  'user.manage': ['admin'],
  'audit.read': ['hr', 'director', 'admin'],
  'volunteer.manage': ['hr', 'admin'], // المتطوعون وحضورهم الشهري
  'volunteer.read': ['hr', 'director', 'admin'],
  'provider.manage': ['hr', 'admin'], // مزوّدو الخدمة: عقود، جداول، بطاقات، تصحيح الحركات
  'provider.read': ['manager', 'hr', 'director', 'admin'], // المدير المباشر يرى من يشرف عليه أو من في مركزه فقط (providerScope)
  'gates.read': ['hr', 'director', 'admin'], // حالة اتصال البوابات (لوحة اليوم)
  'backup.export': ['admin'], // النسخة الاحتياطية الكاملة (تحوي بيانات شخصية)
  'links.manage': ['admin'],
  'balance.manage': ['hr', 'admin'], // توزيع أرصدة الإجازات على الموظفين
  'header.manage': ['hr', 'admin'], // ترويسة الشعارات للتقرير الشهري
  'insights.read': ['hr', 'director', 'admin'], // تسوية الممولين وسلامة البيانات (قراءة)
  'exception.manage': ['hr', 'admin'], // تسجيل دوام استثنائي في يوم عطلة وإلغاؤه
  'org.read': ['hr', 'director', 'admin'], // الهيكلية الإدارية وفحص سلامتها
  'employee.lifecycle': ['hr', 'admin'], // نقل موظف أو إنهاء خدمته أو إعادة تفعيله (يغلق الحساب والبطاقة ويعيد إسناد مرؤوسيه)
  'maternity.manage': ['hr', 'admin'], // الجنس وإجازة الوضع وساعة الأمومة للموظفات
  'special.manage': ['hr', 'admin'], // الإجازات الخاصة: حج، وفاة قريب، علاج طويل
  'emergency.manage': ['hr', 'admin'], // إعلان طارئ أثناء الدوام (إخلاء فوري / احتساب اليوم كاملاً) وإلغاؤه
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

// ---------------------------------------------------------------- الطلبات (إجازة / مغادرة / تأخير)

/** target: { id, manager_id } — من يُدخل الطلب نيابة عن موظف ويعتمده: الموارد البشرية والمدير العام والمسؤول للجميع، والمدير المباشر لمرؤوسيه. */
export function canManageRequests(user, target) {
  if (!user || !target) return false;
  if (READ_ALL.has(user.role)) return true;
  return user.role === 'manager' && user.employeeId != null && target.manager_id === user.employeeId;
}

/** الاعتماد والرفض: الصلاحية نفسها لكن لا أحد يقرّر طلبه بنفسه (يقرّره من فوقه). */
export function canDecideRequest(user, target) {
  return canManageRequests(user, target) && !(user.employeeId != null && user.employeeId === target.id);
}

/** ملاحظات المدير المباشر على تقرير شهري مُقدَّم: من يدير الموظف (مدير مباشر، موارد بشرية، مدير عام، مسؤول) وليس صاحب التقرير. */
export function canReviewReport(user, target) {
  return canDecideRequest(user, target);
}

/** إلغاء طلب معتمد بعد اعتماده: الموارد البشرية والمدير العام والمسؤول فقط، وليس لطلبهم هم. */
export function canRevokeRequest(user, target) {
  return !!user && READ_ALL.has(user.role) && !(user.employeeId != null && user.employeeId === target.id);
}
