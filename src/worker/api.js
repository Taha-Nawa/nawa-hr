/**
 * واجهة الإدارة (بجلسة كوكي). كل معالج يبدأ بالتفويض عبر authz.js ويكتب سجل تدقيق مع كل تعديل.
 * لا يصل أي شيء إلى القاعدة قبل التحقق من الدور والنطاق.
 */
import { json, isDate, clip, randomToken, sha256hex } from './util.js';
import {
  ssoConfig, verifyIdToken, emailOf, issueNonce, consumeNonce, createSession, cookieHeader, currentUser, destroySession,
  userForEmail, COOKIE,
} from './auth.js';
import { can, canReadEmployee, employeeScope, ROLES } from './authz.js';
import { loadWorkSettings, validateWorkSettings } from './settings.js';
import { ingestMoves, MAX_MOVES } from './gate.js';
import { recomputeSlice } from './close.js';

const MAX_BODY = 64 * 1024;
const MAX_RANGE_DAYS = 366;

const forbidden = () => json({ ok: false, error: 'لا تملك صلاحية هذا الإجراء' }, 403);
const notFound = (what = 'العنصر') => json({ ok: false, error: `${what} غير موجود` }, 404);
const bad = (msg, status = 400) => json({ ok: false, error: msg }, status);

function auditStmt(db, user, action, entity, entityId, detail) {
  return db
    .prepare('INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(user?.email || 'system', action, entity ?? null, entityId == null ? null : String(entityId), detail == null ? null : JSON.stringify(detail).slice(0, 2000));
}

async function readJson(request) {
  const ct = request.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return { error: bad('نوع المحتوى يجب أن يكون JSON', 415) };
  const text = await request.text();
  if (text.length > MAX_BODY) return { error: bad('الطلب أكبر من المسموح', 413) };
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? { body: v } : { error: bad('صيغة الطلب غير صالحة') };
  } catch {
    return { error: bad('صيغة الطلب غير صالحة') };
  }
}

const isUnique = (e) => /UNIQUE/i.test(String(e?.message || e));
const isForeignKey = (e) => /FOREIGN KEY/i.test(String(e?.message || e));
const badRef = () => bad('المركز أو المدير أو الموظف المشار إليه غير موجود');

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,19}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------- المسارات
const routes = [];
const add = (method, pattern, handler, { auth = true } = {}) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler, auth });

/** يُرجع Response أو null إن لم يطابق أي مسار. */
export async function handleApi(request, env, url) {
  const route = routes.find((r) => r.method === request.method && r.re.test(url.pathname));
  if (!route) {
    return routes.some((r) => r.re.test(url.pathname)) ? json({ ok: false, error: 'طريقة غير مدعومة' }, 405) : null;
  }
  const params = url.pathname.match(route.re).groups || {};

  // حماية CSRF للتعديلات: الأصل يجب أن يطابق نطاقنا (الكوكي SameSite=Lax تكمّلها).
  if (request.method !== 'GET') {
    const origin = request.headers.get('origin');
    if (!origin || origin !== url.origin) return json({ ok: false, error: 'أصل الطلب غير مسموح' }, 403);
  }

  const ctx = { request, env, db: env.DB, url, params, user: null };
  if (route.auth) {
    ctx.user = await currentUser(env.DB, request);
    if (!ctx.user) return json({ ok: false, error: 'سجّل الدخول أولاً' }, 401);
  }
  return route.handler(ctx);
}

// ---------------------------------------------------------------- الدخول
add('POST', '/api/auth/start', async ({ env, db }) => {
  const cfg = ssoConfig(env);
  if (!cfg) return bad('الدخول الموحّد غير مُعدّ بعد', 503);
  return json({ ok: true, nonce: await issueNonce(db), tenant: cfg.tenant, clientId: cfg.clientId });
}, { auth: false });

add('POST', '/api/auth/session', async ({ request, env, db }) => {
  const cfg = ssoConfig(env);
  if (!cfg) return bad('الدخول الموحّد غير مُعدّ بعد', 503);
  const { body, error } = await readJson(request);
  if (error) return error;
  let claims;
  try {
    claims = await verifyIdToken(body.idToken, cfg);
  } catch (e) {
    console.warn('login rejected:', e.message);
    return bad('تعذّر التحقق من حساب Microsoft', 401);
  }
  if (!(await consumeNonce(db, claims.nonce))) return bad('انتهت صلاحية طلب الدخول، أعد المحاولة', 401);
  const email = emailOf(claims);
  const user = email && (await userForEmail(db, email));
  if (!user) return json({ ok: false, error: 'حسابك غير مسجّل في النظام، راجع الموارد البشرية', code: 'not_registered' }, 403);
  const s = await createSession(db, user.id);
  await auditStmt(db, user, 'login', 'user', user.id, null).run();
  const res = json({ ok: true, user: { email: user.email, role: user.role } });
  res.headers.append('set-cookie', cookieHeader(s.token, s.maxAge));
  return res;
}, { auth: false });

add('POST', '/api/auth/logout', async ({ request, db }) => {
  await destroySession(db, request);
  const res = json({ ok: true });
  res.headers.append('set-cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return res;
}, { auth: false });

add('GET', '/api/me', async ({ user }) => json({ ok: true, user }));

// ---------------------------------------------------------------- الموظفون
const EMP_COLS = `e.id, e.code, e.name, e.email, e.center_id AS centerId, c.name AS center, e.manager_id AS managerId,
  e.status, e.photo_url AS photo, e.start_date AS startDate, e.end_date AS endDate,
  e.job_title AS jobTitle, e.department, e.contract_type AS contractType, e.project, e.manager_label AS managerLabel`;
const TEXT_FIELDS = { jobTitle: 'job_title', department: 'department', contractType: 'contract_type', project: 'project', managerLabel: 'manager_label' };

add('GET', '/api/employees', async ({ db, user }) => {
  const scope = employeeScope(user);
  const r = await db
    .prepare(`SELECT ${EMP_COLS} FROM employees e LEFT JOIN centers c ON c.id = e.center_id WHERE ${scope.sql} ORDER BY e.code`)
    .bind(...scope.params)
    .all();
  return json({ ok: true, employees: r.results });
});

add('POST', '/api/employees', async ({ request, db, user }) => {
  if (!can(user, 'employee.create')) return forbidden();
  const { body, error } = await readJson(request);
  if (error) return error;
  const code = clip(body.code, 20);
  const name = clip(body.name, 120);
  const email = clip(body.email, 200);
  const card = clip(body.card, 120);
  if (!code || !CODE_RE.test(code)) return bad('الكود غير صالح (حروف وأرقام وشرطة، 2–20)');
  if (!name || name.length < 2) return bad('الاسم مطلوب');
  if (email && !EMAIL_RE.test(email)) return bad('البريد غير صالح');
  const centerId = body.centerId ?? null;
  const managerId = body.managerId ?? null;
  const stmts = [
    db.prepare(
      `INSERT INTO employees (code, name, email, center_id, manager_id, start_date, job_title, department, contract_type, project, manager_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(code, name, email, centerId, managerId, isDate(body.startDate) ? body.startDate : null,
      clip(body.jobTitle, 120), clip(body.department, 120), clip(body.contractType, 60), clip(body.project, 160), clip(body.managerLabel, 120)),
  ];
  if (card) stmts.push(db.prepare('INSERT INTO badges (card, employee_id) VALUES (?, (SELECT id FROM employees WHERE code = ?))').bind(card, code));
  stmts.push(auditStmt(db, user, 'employee.create', 'employee', code, { name, email, card: !!card }));
  try {
    await db.batch(stmts);
  } catch (e) {
    if (isUnique(e)) return bad('الكود أو البريد أو البطاقة مستخدمة من قبل', 409);
    return isForeignKey(e) ? badRef() : Promise.reject(e);
  }
  const row = await db.prepare(`SELECT ${EMP_COLS} FROM employees e LEFT JOIN centers c ON c.id = e.center_id WHERE e.code = ?`).bind(code).first();
  return json({ ok: true, employee: row }, 201);
});

const PATCHABLE = {
  name: (v) => (clip(v, 120)?.length >= 2 ? clip(v, 120) : undefined),
  email: (v) => (v === null || v === '' ? null : EMAIL_RE.test(String(v)) ? clip(v, 200) : undefined),
  centerId: (v) => (v === null || Number.isInteger(v) ? v : undefined),
  managerId: (v) => (v === null || Number.isInteger(v) ? v : undefined),
  status: (v) => (v === 'active' || v === 'inactive' ? v : undefined),
  photo: (v) => (v === null || v === '' ? null : /^https:\/\//.test(String(v)) ? clip(v, 500) : undefined),
  startDate: (v) => (v === null || isDate(v) ? v : undefined),
  endDate: (v) => (v === null || isDate(v) ? v : undefined),
  jobTitle: (v) => (v === null ? null : clip(v, 120)),
  department: (v) => (v === null ? null : clip(v, 120)),
  contractType: (v) => (v === null ? null : clip(v, 60)),
  project: (v) => (v === null ? null : clip(v, 160)),
  managerLabel: (v) => (v === null ? null : clip(v, 120)),
};
const COLUMN = { name: 'name', email: 'email', centerId: 'center_id', managerId: 'manager_id', status: 'status', photo: 'photo_url', startDate: 'start_date', endDate: 'end_date', ...TEXT_FIELDS };

add('PATCH', '/api/employees/:id', async ({ request, db, user, params }) => {
  if (!can(user, 'employee.update')) return forbidden();
  const id = Number(params.id);
  const { body, error } = await readJson(request);
  if (error) return error;
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(body)) {
    if (!(k in PATCHABLE)) return bad(`الحقل غير قابل للتعديل: ${k}`);
    const clean = PATCHABLE[k](v);
    if (clean === undefined) return bad(`قيمة غير صالحة: ${k}`);
    sets.push(`${COLUMN[k]} = ?`);
    vals.push(clean);
  }
  if (!sets.length) return bad('لا تعديلات');
  if (body.managerId === id) return bad('لا يمكن أن يكون الموظف مديراً لنفسه');
  if (Number.isInteger(body.managerId)) {
    // سلسلة المديرين لا تدور: الموظف لا يجوز أن يكون فوق مديره (مباشرة أو غير مباشرة)
    const loop = await db
      .prepare(
        `WITH RECURSIVE up(id) AS (SELECT ? UNION SELECT e.manager_id FROM employees e JOIN up ON e.id = up.id WHERE e.manager_id IS NOT NULL)
         SELECT 1 AS x FROM up WHERE id = ?`,
      )
      .bind(body.managerId, id)
      .first();
    if (loop) return bad('هذا التعيين يُنشئ حلقة في سلسلة المديرين');
  }
  const before = await db.prepare('SELECT * FROM employees WHERE id = ?').bind(id).first();
  if (!before) return notFound('الموظف');
  try {
    await db.batch([
      db.prepare(`UPDATE employees SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id),
      auditStmt(db, user, 'employee.update', 'employee', id, { changed: Object.keys(body) }),
    ]);
  } catch (e) {
    if (isUnique(e)) return bad('البريد مستخدم من قبل', 409);
    return isForeignKey(e) ? badRef() : Promise.reject(e);
  }
  const row = await db.prepare(`SELECT ${EMP_COLS} FROM employees e LEFT JOIN centers c ON c.id = e.center_id WHERE e.id = ?`).bind(id).first();
  return json({ ok: true, employee: row });
});

add('GET', '/api/employees/:id/days', async ({ db, user, params, url }) => {
  const id = Number(params.id);
  const target = await db.prepare('SELECT id, manager_id FROM employees WHERE id = ?').bind(id).first();
  if (!target) return notFound('الموظف');
  if (!canReadEmployee(user, target)) return forbidden();
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!isDate(from) || !isDate(to) || from > to) return bad('المدى الزمني غير صالح');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 >= MAX_RANGE_DAYS) return bad(`المدى الأقصى ${MAX_RANGE_DAYS} يوماً`);
  const r = await db
    .prepare(
      `SELECT date, day_type AS dayType, check_in AS checkIn, exit_first AS exitFirst, return_last AS returnLast, departure, source,
              presence_hours AS presenceHours, exit_hours AS exitHours, net_hours AS netHours, required_hours AS requiredHours,
              approved_hours AS approvedHours, late_minutes AS lateMinutes, early_leave_minutes AS earlyLeaveMinutes,
              deficit_hours AS deficitHours, overtime_hours AS overtimeHours, status, alert
       FROM daily_results WHERE employee_id = ? AND date BETWEEN ? AND ? ORDER BY date`,
    )
    .bind(id, from, to)
    .all();
  return json({ ok: true, days: r.results });
});

// ---------------------------------------------------------------- البطاقات
add('POST', '/api/badges', async ({ request, db, user }) => {
  if (!can(user, 'badge.manage')) return forbidden();
  const { body, error } = await readJson(request);
  if (error) return error;
  const card = clip(body.card, 120);
  if (!card || !Number.isInteger(body.employeeId)) return bad('البطاقة والموظف مطلوبان');
  if (!(await db.prepare('SELECT 1 AS x FROM employees WHERE id = ?').bind(body.employeeId).first())) return notFound('الموظف');
  try {
    await db.batch([
      db.prepare('INSERT INTO badges (card, employee_id) VALUES (?, ?)').bind(card, body.employeeId),
      auditStmt(db, user, 'badge.add', 'badge', card, { employeeId: body.employeeId }),
    ]);
  } catch (e) {
    return isUnique(e) ? bad('البطاقة مسجّلة من قبل', 409) : Promise.reject(e);
  }
  return json({ ok: true }, 201);
});

add('POST', '/api/badges/:card/revoke', async ({ db, user, params }) => {
  if (!can(user, 'badge.manage')) return forbidden();
  const card = decodeURIComponent(params.card);
  const [r] = await db.batch([
    db.prepare("UPDATE badges SET status = 'revoked' WHERE card = ?").bind(card),
    auditStmt(db, user, 'badge.revoke', 'badge', card, null),
  ]);
  return r.meta.changes ? json({ ok: true }) : notFound('البطاقة');
});

// ---------------------------------------------------------------- الإعدادات
add('GET', '/api/settings', async ({ db, user }) => {
  if (!can(user, 'settings.read')) return forbidden();
  return json({ ok: true, work: await loadWorkSettings(db) });
});

add('PUT', '/api/settings/work', async ({ request, db, user }) => {
  if (!can(user, 'settings.write')) return forbidden();
  const { body, error } = await readJson(request);
  if (error) return error;
  if (!validateWorkSettings(body)) return bad('الإعدادات غير صالحة (الدوام، السماحية، أيام الأسبوع السبعة، أنواع الإجازات)');
  const clean = {
    start: body.start, end: body.end, toleranceMinutes: body.toleranceMinutes, weekdays: body.weekdays, leaveTypes: body.leaveTypes,
    ...(Number.isFinite(body.monthlyExitCapHours) ? { monthlyExitCapHours: body.monthlyExitCapHours } : {}),
  };
  await db.batch([
    db
      .prepare("INSERT INTO settings (key, value) VALUES ('work', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')")
      .bind(JSON.stringify(clean)),
    auditStmt(db, user, 'settings.work', 'settings', 'work', clean),
  ]);
  // تغيير القواعد يغيّر نتائج الأيام المحسوبة سابقاً؛ إعادة الحساب الشاملة خطوة منفصلة (المرحلة 2).
  return json({ ok: true, needsRecompute: true });
});

// ---------------------------------------------------------------- الأجهزة
add('GET', '/api/devices', async ({ db, user }) => {
  if (!can(user, 'device.manage')) return forbidden();
  const r = await db.prepare('SELECT d.id, d.name, d.center_id AS centerId, c.name AS center, d.active, d.last_seen AS lastSeen FROM devices d LEFT JOIN centers c ON c.id = d.center_id ORDER BY d.id').all();
  return json({ ok: true, devices: r.results });
});

add('POST', '/api/devices', async ({ request, db, user }) => {
  if (!can(user, 'device.manage')) return forbidden();
  const { body, error } = await readJson(request);
  if (error) return error;
  const id = clip(body.id, 20)?.toUpperCase();
  if (!id || !/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(id)) return bad('معرّف الجهاز غير صالح (مثل DEV-01)');
  const token = randomToken(24);
  try {
    await db.batch([
      db.prepare('INSERT INTO devices (id, name, center_id, token_hash) VALUES (?, ?, ?, ?)').bind(id, clip(body.name, 120), body.centerId ?? null, await sha256hex(token)),
      auditStmt(db, user, 'device.create', 'device', id, null),
    ]);
  } catch (e) {
    return isUnique(e) ? bad('معرّف الجهاز مستخدم', 409) : Promise.reject(e);
  }
  // الرمز يظهر هذه المرة فقط ولا يمكن استرجاعه لاحقاً (نخزّن بصمته).
  return json({ ok: true, device: { id }, token }, 201);
});

add('POST', '/api/devices/:id/rotate', async ({ db, user, params }) => {
  if (!can(user, 'device.manage')) return forbidden();
  const token = randomToken(24);
  const [r] = await db.batch([
    db.prepare('UPDATE devices SET token_hash = ?, active = 1 WHERE id = ?').bind(await sha256hex(token), params.id),
    auditStmt(db, user, 'device.rotate', 'device', params.id, null),
  ]);
  return r.meta.changes ? json({ ok: true, token }) : notFound('الجهاز');
});

add('POST', '/api/devices/:id/deactivate', async ({ db, user, params }) => {
  if (!can(user, 'device.manage')) return forbidden();
  const [r] = await db.batch([db.prepare('UPDATE devices SET active = 0 WHERE id = ?').bind(params.id), auditStmt(db, user, 'device.deactivate', 'device', params.id, null)]);
  return r.meta.changes ? json({ ok: true }) : notFound('الجهاز');
});

// ---------------------------------------------------------------- المستخدمون
add('GET', '/api/users', async ({ db, user }) => {
  if (!can(user, 'user.manage')) return forbidden();
  const r = await db.prepare('SELECT id, email, role, employee_id AS employeeId, active FROM users ORDER BY email').all();
  return json({ ok: true, users: r.results });
});

add('POST', '/api/users', async ({ request, db, user }) => {
  if (!can(user, 'user.manage')) return forbidden();
  const { body, error } = await readJson(request);
  if (error) return error;
  const email = clip(body.email, 200)?.toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return bad('البريد غير صالح');
  if (!ROLES.includes(body.role)) return bad('الدور غير صالح');
  try {
    await db.batch([
      db.prepare('INSERT INTO users (email, role, employee_id) VALUES (?, ?, ?)').bind(email, body.role, body.employeeId ?? null),
      auditStmt(db, user, 'user.create', 'user', email, { role: body.role }),
    ]);
  } catch (e) {
    if (isUnique(e)) return bad('المستخدم مسجّل من قبل', 409);
    return isForeignKey(e) ? badRef() : Promise.reject(e);
  }
  return json({ ok: true }, 201);
});

add('PATCH', '/api/users/:id', async ({ request, db, user, params }) => {
  if (!can(user, 'user.manage')) return forbidden();
  const id = Number(params.id);
  const { body, error } = await readJson(request);
  if (error) return error;
  const target = await db.prepare('SELECT id, role, active, employee_id AS employeeId FROM users WHERE id = ?').bind(id).first();
  if (!target) return notFound('المستخدم');
  const role = body.role ?? target.role;
  const active = body.active === undefined ? target.active : body.active ? 1 : 0;
  if (!ROLES.includes(role)) return bad('الدور غير صالح');
  // لا نسمح بترك النظام بلا مسؤول فعّال.
  const losesAdmin = target.role === 'admin' && target.active === 1 && (role !== 'admin' || active === 0);
  if (losesAdmin) {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").first('n');
    if (n <= 1) return bad('لا يمكن إزالة آخر مسؤول فعّال', 409);
  }
  await db.batch([
    db.prepare('UPDATE users SET role = ?, active = ?, employee_id = ? WHERE id = ?').bind(role, active, body.employeeId === undefined ? target.employeeId : body.employeeId, id),
    // إيقاف الحساب أو تغيير الدور يُنهي جلساته فوراً
    ...(active === 0 || role !== target.role ? [db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id)] : []),
    auditStmt(db, user, 'user.update', 'user', id, { role, active }),
  ]);
  return json({ ok: true });
});

// ---------------------------------------------------------------- التدقيق
add('GET', '/api/audit', async ({ db, user, url }) => {
  if (!can(user, 'audit.read')) return forbidden();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500);
  const r = await db.prepare('SELECT id, at, actor, action, entity, entity_id AS entityId, detail FROM audit_log ORDER BY id DESC LIMIT ?').bind(limit).all();
  return json({ ok: true, entries: r.results });
});

// ---------------------------------------------------------------- لوحة اليوم
const DAY_COLS = `r.status, r.check_in AS checkIn, r.exit_first AS exitFirst, r.return_last AS returnLast, r.departure,
  r.net_hours AS netHours, r.late_minutes AS lateMinutes, r.deficit_hours AS deficitHours, r.overtime_hours AS overtimeHours, r.alert`;

add('GET', '/api/day', async ({ db, user, url }) => {
  const date = url.searchParams.get('date');
  if (!isDate(date)) return bad('التاريخ غير صالح');
  const scope = employeeScope(user);
  const r = await db
    .prepare(
      `SELECT e.id, e.code, e.name, c.name AS center, e.department, ${DAY_COLS}
       FROM employees e LEFT JOIN centers c ON c.id = e.center_id
       LEFT JOIN daily_results r ON r.employee_id = e.id AND r.date = ?
       WHERE e.status = 'active' AND ${scope.sql} ORDER BY e.code`,
    )
    .bind(date, ...scope.params)
    .all();
  return json({ ok: true, date, rows: r.results });
});

// ---------------------------------------------------------------- العطل الرسمية
add('GET', '/api/holidays', async ({ db, url }) => {
  const year = Number(url.searchParams.get('year'));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return bad('السنة غير صالحة');
  const r = await db.prepare('SELECT date, name FROM holidays WHERE date BETWEEN ? AND ? ORDER BY date').bind(`${year}-01-01`, `${year}-12-31`).all();
  return json({ ok: true, year, holidays: r.results });
});

add('PUT', '/api/holidays', async ({ request, db, user }) => {
  if (!can(user, 'holiday.write')) return forbidden();
  const { body, error } = await readJson(request);
  if (error) return error;
  const year = body.year;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return bad('السنة غير صالحة');
  if (!Array.isArray(body.holidays) || body.holidays.length > 60) return bad('قائمة العطل غير صالحة (60 يوماً كحد أقصى)');
  const seen = new Set();
  const list = [];
  for (const h of body.holidays) {
    if (!isDate(h?.date) || !h.date.startsWith(`${year}-`)) return bad(`تاريخ عطلة غير صالح: ${h?.date}`);
    if (seen.has(h.date)) return bad(`تاريخ مكرر: ${h.date}`);
    seen.add(h.date);
    list.push({ date: h.date, name: clip(h.name, 120) });
  }
  await db.batch([
    db.prepare('DELETE FROM holidays WHERE date BETWEEN ? AND ?').bind(`${year}-01-01`, `${year}-12-31`),
    db.prepare("INSERT INTO holidays (date, name) SELECT json_extract(value,'$.date'), json_extract(value,'$.name') FROM json_each(?) WHERE true").bind(JSON.stringify(list)),
    auditStmt(db, user, 'holidays.set', 'holidays', year, { count: list.length }),
  ]);
  return json({ ok: true, count: list.length, needsRecompute: true });
});

// ---------------------------------------------------------------- إعادة الحساب (شرائح)
add('POST', '/api/recompute', async ({ request, env, user }) => {
  if (!can(user, 'recompute.run')) return forbidden();
  const { body, error } = await readJson(request);
  if (error) return error;
  const offset = body.offset ?? 0;
  if (!isDate(body.from) || !isDate(body.to) || body.from > body.to) return bad('المدى الزمني غير صالح');
  if (daysBetweenSafe(body.from, body.to) > MAX_RANGE_DAYS) return bad(`المدى الأقصى ${MAX_RANGE_DAYS} يوماً`);
  if (!Number.isInteger(offset) || offset < 0) return bad('الإزاحة غير صالحة');
  const r = await recomputeSlice(env, { from: body.from, to: body.to, offset });
  if (r.error === 'settings_missing') return bad('أدخل إعدادات الدوام أولاً', 409);
  if (offset === 0) await auditStmt(env.DB, user, 'recompute', 'range', `${body.from}..${body.to}`, null).run();
  return json({ ok: true, ...r });
});

const daysBetweenSafe = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;

// ---------------------------------------------------------------- الاستيراد (من إكسل عبر المتصفح)
const IMPORT_MAX_ROWS = 100;

add('POST', '/api/import/employees', async ({ request, db, user }) => {
  if (!can(user, 'import.run')) return forbidden();
  const { body, error } = await readJson(request);
  if (error) return error;
  if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > IMPORT_MAX_ROWS) return bad(`الصفوف مطلوبة (1–${IMPORT_MAX_ROWS})`);

  const good = [];
  const rejected = [];
  const seenCodes = new Set();
  for (const [i, r] of body.rows.entries()) {
    const code = clip(r?.code, 20);
    const name = clip(r?.name, 120);
    const email = clip(r?.email, 200);
    let why = null;
    if (!code || !CODE_RE.test(code)) why = 'كود غير صالح';
    else if (seenCodes.has(code.toLowerCase())) why = 'كود مكرر في الملف';
    else if (!name || name.length < 2) why = 'اسم مفقود';
    else if (email && !EMAIL_RE.test(email)) why = 'بريد غير صالح';
    if (why) {
      rejected.push({ row: i + 1, code: code || null, reason: why });
      continue;
    }
    seenCodes.add(code.toLowerCase());
    good.push({
      code, name, email,
      center: clip(r.center, 120),
      jobTitle: clip(r.jobTitle, 120), department: clip(r.department, 120), contractType: clip(r.contractType, 60),
      project: clip(r.project, 160), managerLabel: clip(r.managerLabel, 120),
      startDate: isDate(r.startDate) ? r.startDate : null,
      card: clip(r.card, 120),
    });
  }
  if (good.length) {
    const json1 = JSON.stringify(good);
    const centers = JSON.stringify([...new Set(good.map((g) => g.center).filter(Boolean))]);
    try {
      await db.batch([
        db.prepare('INSERT OR IGNORE INTO centers (name) SELECT value FROM json_each(?) WHERE true').bind(centers),
        db.prepare(
          `INSERT INTO employees (code, name, email, center_id, start_date, job_title, department, contract_type, project, manager_label)
           SELECT json_extract(j.value,'$.code'), json_extract(j.value,'$.name'), json_extract(j.value,'$.email'),
                  (SELECT id FROM centers WHERE name = json_extract(j.value,'$.center')), json_extract(j.value,'$.startDate'),
                  json_extract(j.value,'$.jobTitle'), json_extract(j.value,'$.department'), json_extract(j.value,'$.contractType'),
                  json_extract(j.value,'$.project'), json_extract(j.value,'$.managerLabel')
           FROM json_each(?) j WHERE true
           ON CONFLICT(code) DO UPDATE SET name = excluded.name, center_id = excluded.center_id, job_title = excluded.job_title,
             department = excluded.department, contract_type = excluded.contract_type, project = excluded.project,
             manager_label = excluded.manager_label, start_date = COALESCE(excluded.start_date, employees.start_date),
             email = COALESCE(excluded.email, employees.email)`,
        ).bind(json1),
        db.prepare(
          `INSERT OR IGNORE INTO badges (card, employee_id)
           SELECT json_extract(j.value,'$.card'), e.id FROM json_each(?) j JOIN employees e ON e.code = json_extract(j.value,'$.code')
           WHERE json_extract(j.value,'$.card') IS NOT NULL`,
        ).bind(json1),
        auditStmt(db, user, 'import.employees', 'employees', null, { rows: good.length, rejected: rejected.length }),
      ]);
    } catch (e) {
      return isUnique(e) ? bad('بريد مكرر بين موظفين مختلفين', 409) : Promise.reject(e);
    }
  }
  return json({ ok: true, imported: good.length, rejected });
});

add('POST', '/api/import/movements', async ({ request, db, user }) => {
  if (!can(user, 'import.run')) return forbidden();
  const { body, error } = await readJson(request);
  if (error) return error;
  if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > MAX_MOVES) return bad(`الصفوف مطلوبة (1–${MAX_MOVES})`);
  const out = await ingestMoves(db, 'IMPORT', body.rows);
  await auditStmt(db, user, 'import.movements', 'movements', null, { saved: out.saved, skipped: out.skipped, rejected: out.rejected?.length || 0 }).run();
  return json(out);
});
