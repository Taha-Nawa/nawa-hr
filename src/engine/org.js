/**
 * تحليل الهيكلية الإدارية: يبني الشجرة والمستويات ونطاق الإشراف من employees.manager_id، ويفحص سلامتها ويعطيها درجة ضبط.
 * دالة نقية (بلا قاعدة بيانات) كي تُختبر وحدها ويستعملها الخادم والواجهة بنتيجتها نفسها.
 *
 * المدخلات
 *   employees : [{ id, code, name, jobTitle, centerId, center, managerId, status('active'|'inactive'), email, contractType, endDate }]
 *   users     : [{ employeeId, email, role, active }]
 *   centers   : [{ id, name, active }]
 *   badges    : [{ employeeId, status('active'|'revoked') }]   (اختياري: لكشف بطاقة فعّالة لمنتهي الخدمة)
 *
 *   dismissed : [{ employeeId, checkId }]  (اختياري: ملاحظات مقصودة تُستثنى من الفحوص والدرجة وتُعاد في ignored)
 *
 * المخرجات: { nodes, roots, stats, checks, score, grade, ignored }
 *   nodes[i] = { id, parent (المدير الفعلي الفعّال أو null), depth (0 للقمة), reports (مرؤوسون فعّالون مباشرون), team (كل من تحته)، flags:[…] }
 *   checks[i] = { id, level('high'|'mid'|'low'), title, why, fix, items:[{ id|null, name, detail }] }
 */

export const LIMITS = { wideSpan: 10, deepLevels: 5 };
export const APPROVER_ROLES = new Set(['manager', 'hr', 'director', 'admin']);

const WEIGHT = { high: 1, mid: 1, low: 0 };

export function analyzeOrg({ employees = [], users = [], centers = [], badges = [], dismissed = [] } = {}) {
  const skip = new Set(dismissed.map((d) => `${d.checkId}:${d.employeeId}`));
  const byId = new Map(employees.map((e) => [e.id, e]));
  const active = employees.filter((e) => e.status === 'active');
  const isActive = (id) => byId.get(id)?.status === 'active';

  // ---- المدير الفعلي: المدير المعيَّن إن كان موجوداً وفعّالاً وليس الموظف نفسه
  const parentOf = new Map();
  const selfManaged = [];
  const dangling = []; // مدير غير موجود
  const inactiveManager = [];
  for (const e of active) {
    if (e.managerId == null) { parentOf.set(e.id, null); continue; }
    if (e.managerId === e.id) { selfManaged.push(e); parentOf.set(e.id, null); continue; }
    const m = byId.get(e.managerId);
    if (!m) { dangling.push(e); parentOf.set(e.id, null); continue; }
    if (m.status !== 'active') { inactiveManager.push({ e, m }); parentOf.set(e.id, null); continue; }
    parentOf.set(e.id, m.id);
  }

  // ---- الحلقات: من يعود إلى نفسه عبر سلسلة المديرين
  const cycleIds = new Set();
  for (const e of active) {
    const seen = new Set();
    let cur = e.id;
    while (cur != null && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
    if (cur != null) {
      // cur هو أول عقدة تكرّرت: كل ما في الدورة منها يُسجَّل
      let x = cur;
      do { cycleIds.add(x); x = parentOf.get(x); } while (x !== cur && x != null);
    }
  }
  for (const id of cycleIds) parentOf.set(id, null); // كسر الدورة لتبقى الشجرة قابلة للرسم

  // ---- الأبناء والعمق وحجم الفريق
  const children = new Map(active.map((e) => [e.id, []]));
  for (const e of active) {
    const p = parentOf.get(e.id);
    if (p != null) children.get(p).push(e.id);
  }
  const depth = new Map();
  const team = new Map();
  const roots = active.filter((e) => parentOf.get(e.id) == null).map((e) => e.id);
  const walk = (id, d) => {
    depth.set(id, d);
    let n = 0;
    for (const c of children.get(id)) n += 1 + walk(c, d + 1);
    team.set(id, n);
    return n;
  };
  for (const r of roots) walk(r, 0);
  const levels = active.length ? Math.max(...[...depth.values()]) + 1 : 0;

  const nodes = employees.map((e) => ({
    id: e.id,
    parent: e.status === 'active' ? parentOf.get(e.id) ?? null : null,
    depth: depth.get(e.id) ?? null,
    reports: e.status === 'active' ? children.get(e.id).length : 0,
    team: team.get(e.id) ?? 0,
  }));

  // ---- الحسابات
  const accountsOf = new Map();
  for (const u of users) {
    if (u.employeeId == null) continue;
    (accountsOf.get(u.employeeId) || accountsOf.set(u.employeeId, []).get(u.employeeId)).push(u);
  }
  const activeAccount = (id) => (accountsOf.get(id) || []).find((u) => u.active);
  const approverAccount = (id) => (accountsOf.get(id) || []).find((u) => u.active && APPROVER_ROLES.has(u.role));
  const activeBadge = new Set(badges.filter((b) => b.status === 'active').map((b) => b.employeeId));

  const item = (e, detail) => ({ id: e.id, name: e.name, detail });
  const checks = [];
  const ignored = []; // ملاحظات قرّرت الموارد البشرية تجاهلها: تخرج من الفحوص والدرجة وتبقى للعرض
  const add = (id, level, title, why, fix, all) => {
    const items = all.filter((i) => i.id == null || !skip.has(`${id}:${i.id}`));
    for (const i of all) if (i.id != null && skip.has(`${id}:${i.id}`)) ignored.push({ check: id, level, title, id: i.id, name: i.name, detail: i.detail });
    if (items.length) checks.push({ id, level, title, why, fix, items });
  };

  add('cycle', 'high', 'حلقة في سلسلة المديرين',
    'كل موظف في الحلقة مدير لمن هو مديره، فلا قمة للسلسلة وتتعطل مسارات الاعتماد.',
    'افتح أحدهم وغيّر مديره المباشر.',
    [...cycleIds].map((id) => item(byId.get(id), 'ضمن حلقة')));
  add('self', 'high', 'موظف مديره نفسه', 'لا يمكن أن يعتمد الموظف طلب نفسه.', 'عيّن له مديراً آخر أو اتركه بلا مدير إن كان القمة.',
    selfManaged.map((e) => item(e, 'مديره المسجَّل هو نفسه')));
  add('manager_gone', 'high', 'مديره غير موجود', 'المدير المسجَّل حُذف أو لا وجود له.', 'اختر له مديراً صحيحاً.',
    dangling.map((e) => item(e, `رقم المدير ${e.managerId} غير موجود`)));
  add('manager_inactive', 'high', 'مديره خرج من الخدمة', 'طلباته ومراجعاته لا تجد من يعتمدها، وتذهب إلى الموارد البشرية.', 'عيّن له مديراً فعّالاً.',
    inactiveManager.map(({ e, m }) => item(e, `مديره ${m.name} غير فعّال`)));

  // قمة الهيكل: واحدة متوقعة؛ الزائدة (بلا مدير) تُعرض ما عدا صاحبة أكبر فريق
  const topCandidates = roots.filter((id) => !cycleIds.has(id) && byId.get(id).managerId == null);
  if (topCandidates.length > 1) {
    const head = [...topCandidates].sort((a, b) => team.get(b) - team.get(a))[0];
    add('multi_root', 'mid', 'أكثر من قمة في الهيكل', 'يُتوقع مدير أعلى واحد؛ كل من بلا مدير مباشر يُعامَل كقمة مستقلة.', 'حدد مديراً لكل منهم ما عدا القمة الحقيقية.',
      topCandidates.filter((id) => id !== head).map((id) => item(byId.get(id), `بلا مدير مباشر${team.get(id) ? ` — ويشرف على ${team.get(id)}` : ''}`)));
  }

  add('no_center', 'mid', 'موظف بلا مركز', 'لا يظهر في توزيع المراكز، ويتأثر أي تقرير حسب المركز.', 'اختر مركزه من بيانات الموظف.',
    active.filter((e) => e.centerId == null).map((e) => item(e, 'لا مركز')));

  // المدير الفعلي (من تحته فعّالون) يجب أن يملك حساباً يعتمد: وإلا تذهب طلبات فريقه إلى الموارد البشرية
  const managers = active.filter((e) => children.get(e.id).length > 0);
  add('manager_no_approver', 'high', 'مدير بلا حساب اعتماد', 'طلبات فريقه لا تصله، وتذهب إلى الموارد البشرية.', 'أنشئ له حساباً بدور «مدير» من صفحة المستخدمين.',
    managers.filter((e) => !approverAccount(e.id)).map((e) => item(e, activeAccount(e.id) ? `حسابه بدور «${activeAccount(e.id).role}» ولا يعتمد (${children.get(e.id).length} مرؤوس)` : `لا حساب فعّال (${children.get(e.id).length} مرؤوس)`)));

  add('no_account', 'mid', 'موظف بلا حساب دخول', 'لا يستطيع تقديم طلباته ولا رؤية يومه ولا يصله بريد النظام.', 'أنشئ له حساباً من «مستخدم جديد» أو «إنشاء الحسابات دفعة واحدة».',
    active.filter((e) => !activeAccount(e.id)).map((e) => item(e, e.email ? 'له بريد لكن لا حساب فعّال' : 'بلا بريد في بياناته')));

  // خروج من الخدمة بلا إغلاق الوصول
  add('departed_access', 'high', 'منتهي الخدمة وما زال له وصول', 'يستطيع الدخول أو يصله بريد النظام أو تُقبل بطاقته.', 'افتح ملفه واضغط «إجراء وظيفي» ثم «إنهاء الخدمة» ليُغلق كل شيء.',
    employees.filter((e) => e.status === 'inactive' && (activeAccount(e.id) || activeBadge.has(e.id)))
      .map((e) => item(e, [activeAccount(e.id) ? 'حساب فعّال' : null, activeBadge.has(e.id) ? 'بطاقة فعّالة' : null].filter(Boolean).join(' + '))));

  add('wide_span', 'mid', `نطاق إشراف واسع (أكثر من ${LIMITS.wideSpan})`, 'مدير بعدد كبير من المرؤوسين المباشرين يصعب عليه متابعتهم واعتماد طلباتهم.', 'أضف مستوى إشرافياً وسيطاً.',
    managers.filter((e) => children.get(e.id).length > LIMITS.wideSpan).map((e) => item(e, `${children.get(e.id).length} مرؤوساً مباشراً`)));
  if (levels > LIMITS.deepLevels) {
    add('deep', 'mid', `هيكل عميق (${levels} مستويات)`, 'كثرة المستويات تبطئ الاعتماد وتبعد القمة عن القاعدة.', 'راجع الحاجة لكل مستوى.',
      active.filter((e) => (depth.get(e.id) ?? 0) >= LIMITS.deepLevels).map((e) => item(e, `المستوى ${depth.get(e.id) + 1}`)));
  }
  add('single_report', 'low', 'مدير لمرؤوس واحد فقط', 'قد يكون المستوى غير ضروري.', 'تأكد أنه مقصود.',
    managers.filter((e) => children.get(e.id).length === 1 && parentOf.get(e.id) != null).map((e) => item(e, `مرؤوسه الوحيد: ${byId.get(children.get(e.id)[0]).name}`)));
  add('cross_center', 'low', 'يتبع مديراً من مركز آخر', 'مقبول إن كان مقصوداً (إشراف عابر للمراكز)، لكنه يستحق التأكد.', 'تأكد من المدير أو المركز.',
    active.filter((e) => {
      const p = parentOf.get(e.id);
      const m = p != null ? byId.get(p) : null;
      return m && e.centerId != null && m.centerId != null && e.centerId !== m.centerId;
    }).map((e) => item(e, `${e.center || '—'} ← مديره في ${byId.get(parentOf.get(e.id)).center || '—'}`)));

  // مركز فعّال بلا مشرف من أهله، أو بلا موظفين
  const activeCenters = centers.filter((c) => c.active);
  const centerItems = [];
  const emptyItems = [];
  for (const c of activeCenters) {
    const staff = active.filter((e) => e.centerId === c.id);
    if (!staff.length) { emptyItems.push({ id: null, name: c.name, detail: 'لا موظفين فعّالين' }); continue; }
    if (staff.length >= 2 && !staff.some((e) => children.get(e.id).length > 0)) centerItems.push({ id: null, name: c.name, detail: `${staff.length} موظفين ولا مشرف منهم` });
  }
  add('center_no_lead', 'mid', 'مركز بلا مشرف من أهله', 'لا أحد في المركز يشرف على غيره، فالإشراف من خارجه.', 'عيّن مشرفاً للمركز أو تأكد أن الإشراف المركزي مقصود.', centerItems);
  add('center_empty', 'low', 'مركز فعّال بلا موظفين', 'قد يكون المركز موقوفاً فعلاً أو لم يُوزَّع عليه أحد.', 'أوقف المركز أو انقل إليه موظفين.', emptyItems);

  // ---- الدرجة: نسبة الفعّالين بلا ملاحظة عالية أو متوسطة تخصّهم
  const flagged = new Set();
  for (const c of checks) if (WEIGHT[c.level]) for (const i of c.items) if (i.id != null && isActive(i.id)) flagged.add(i.id);
  const score = active.length ? Math.round(100 * (1 - flagged.size / active.length)) : 100;
  const hasHigh = checks.some((c) => c.level === 'high');
  let grade = score >= 90 ? 'ممتاز' : score >= 75 ? 'جيد' : score >= 50 ? 'يحتاج مراجعة' : 'ضعيف';
  if (hasHigh && grade === 'ممتاز') grade = 'جيد'; // ملاحظة عالية واحدة تمنع «ممتاز»

  const spans = managers.map((e) => children.get(e.id).length);
  const stats = {
    active: active.length,
    inactive: employees.length - active.length,
    levels,
    managers: managers.length,
    avgSpan: spans.length ? Math.round((spans.reduce((a, b) => a + b, 0) / spans.length) * 10) / 10 : 0,
    maxSpan: spans.length ? Math.max(...spans) : 0,
    centers: new Set(active.map((e) => e.centerId).filter((x) => x != null)).size,
    withAccount: active.filter((e) => activeAccount(e.id)).length,
    flagged: flagged.size,
  };
  return { nodes, roots, stats, checks, score, grade, ignored };
}
