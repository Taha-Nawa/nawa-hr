import worker from '../../src/worker/index.js';
import { createSession, COOKIE } from '../../src/worker/auth.js';
import { freshEnv, addEmployee } from './seed.js';
import { TENANT, CLIENT } from './oidc.js';

export const ORIGIN = 'https://hr.test';

export async function apiEnv({ sso = true } = {}) {
  const base = await freshEnv();
  const env = { ...base.env, ...(sso ? { ENTRA_TENANT_ID: TENANT, ENTRA_CLIENT_ID: CLIENT } : {}) };
  return { db: base.db, env };
}

export async function addUser(db, email, role, employeeId = null, active = 1) {
  const r = await db.prepare('INSERT INTO users (email, role, employee_id, active) VALUES (?, ?, ?, ?)').bind(email, role, employeeId, active).run();
  return r.meta.last_row_id;
}

/** مستخدم + جلسة صالحة، يُرجع ترويسة الكوكي. */
export async function login(db, email, role, employeeId = null) {
  const id = await addUser(db, email, role, employeeId);
  const s = await createSession(db, id);
  return { id, cookie: `${COOKIE}=${s.token}`, token: s.token };
}

export async function call(env, method, path, { body, cookie, origin = ORIGIN, headers = {}, raw } = {}) {
  env.DB.resetCount?.();
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  if (origin && method !== 'GET') h.origin = origin;
  if (body !== undefined || raw !== undefined) h['content-type'] = h['content-type'] || 'application/json';
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }), env);
  let data = null;
  try {
    data = await res.clone().json();
  } catch {}
  return { status: res.status, body: data, res };
}

/** هيكل مؤسسة صغير: مدير (1) له مرؤوسان (2،3)، وموظف مستقل (4) */
export async function seedOrg(db) {
  await addEmployee(db, { id: 1, code: 'NW-001', name: 'المديرة' });
  await addEmployee(db, { id: 2, code: 'NW-002', name: 'موظف أ' });
  await addEmployee(db, { id: 3, code: 'NW-003', name: 'موظف ب' });
  await addEmployee(db, { id: 4, code: 'NW-004', name: 'موظف ج' });
  await db.prepare('UPDATE employees SET manager_id = 1 WHERE id IN (2, 3)').run();
}
