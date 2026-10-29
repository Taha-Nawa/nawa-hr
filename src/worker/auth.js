/**
 * الدخول الموحّد عبر Microsoft Entra ID (حسابات nawaculture.org) بلا أي سر نحفظه:
 *
 *   1) المتصفح يطلب nonce من الخادم  (POST /api/auth/start)
 *   2) المتصفح يعمل Authorization Code + PKCE مع Microsoft (عميل عام SPA: لا client secret)
 *   3) المتصفح يرسل id_token إلى الخادم (POST /api/auth/session) فيتحقق من التوقيع (RS256 + مفاتيح Microsoft) والمطالبات
 *      (iss, aud, tid, exp, nbf, nonce المستعمل مرة واحدة)، ثم يطابق البريد مع جدول users (الدور يُمنح عندنا لا من Microsoft)
 *   4) الخادم يصدر جلسة بكوكي HttpOnly؛ نخزّن بصمة الرمز فقط.
 *
 * القيم العامة (ليست أسراراً) في wrangler.jsonc → vars: ENTRA_TENANT_ID, ENTRA_CLIENT_ID.
 */
import { sha256hex, randomToken } from './util.js';

export const SESSION_HOURS = 12;
export const COOKIE = '__Host-nawa';
const NONCE_MINUTES = 10;
const SKEW_SECONDS = 120;

const b64urlToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const b64urlToJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

export function ssoConfig(env) {
  const tenant = (env.ENTRA_TENANT_ID || '').trim();
  const clientId = (env.ENTRA_CLIENT_ID || '').trim();
  const ok = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenant) && /^[0-9a-f-]{36}$/i.test(clientId);
  return ok ? { tenant, clientId } : null;
}

// ---- مفاتيح Microsoft العامة (JWKS) ----
const keyCache = { at: 0, tenant: null, keys: new Map() };

export async function fetchMicrosoftKeys(tenant) {
  const r = await fetch(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`);
  if (!r.ok) throw new Error(`jwks ${r.status}`);
  return (await r.json()).keys;
}

async function getKey(kid, tenant, getKeys, now) {
  const fresh = keyCache.tenant === tenant && now - keyCache.at < 3600_000;
  if (!fresh || !keyCache.keys.has(kid)) {
    // لا نعيد الجلب أكثر من مرة كل 5 دقائق (حماية من إغراق Microsoft بـ kid مزوّر)
    if (keyCache.tenant !== tenant || now - keyCache.at > 300_000 || !keyCache.keys.size) {
      const keys = await getKeys(tenant);
      keyCache.keys = new Map(keys.filter((k) => k.kty === 'RSA' && k.kid).map((k) => [k.kid, k]));
      keyCache.tenant = tenant;
      keyCache.at = now;
    }
  }
  const jwk = keyCache.keys.get(kid);
  if (!jwk) return null;
  return crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

export function resetKeyCache() {
  keyCache.at = 0;
  keyCache.tenant = null;
  keyCache.keys = new Map();
}

/** يتحقق من id_token ويُرجع المطالبات أو يرمي خطأ بسبب مفهوم. */
export async function verifyIdToken(idToken, { tenant, clientId }, { now = Date.now(), getKeys = fetchMicrosoftKeys } = {}) {
  if (typeof idToken !== 'string' || idToken.length > 8192) throw new Error('bad_token');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('bad_token');
  let header, claims;
  try {
    header = b64urlToJson(parts[0]);
    claims = b64urlToJson(parts[1]);
  } catch {
    throw new Error('bad_token');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('bad_alg'); // يمنع alg=none وخلط الخوارزميات
  const key = await getKey(header.kid, tenant, getKeys, now);
  if (!key) throw new Error('unknown_key');
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new Error('bad_signature');

  const sec = Math.floor(now / 1000);
  if (claims.iss !== `https://login.microsoftonline.com/${tenant}/v2.0`) throw new Error('bad_issuer');
  if (claims.tid !== tenant) throw new Error('bad_tenant');
  if (claims.aud !== clientId) throw new Error('bad_audience');
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_SECONDS < sec) throw new Error('expired');
  if (typeof claims.nbf === 'number' && claims.nbf - SKEW_SECONDS > sec) throw new Error('not_yet_valid');
  if (typeof claims.nonce !== 'string' || !claims.nonce) throw new Error('no_nonce');
  return claims;
}

export function emailOf(claims) {
  const e = claims.preferred_username || claims.email || claims.upn;
  return typeof e === 'string' && e.includes('@') ? e.trim().toLowerCase() : null;
}

// ---- nonce ----
export async function issueNonce(db) {
  const nonce = randomToken(16);
  const exp = new Date(Date.now() + NONCE_MINUTES * 60000).toISOString().replace('T', ' ').slice(0, 19);
  // تنظيف المنتهي مع كل إصدار: يبقي الجدول صغيراً بلا مهمة مجدولة.
  await db.batch([
    db.prepare("DELETE FROM auth_nonces WHERE expires_at < datetime('now')"),
    db.prepare('INSERT INTO auth_nonces (nonce, expires_at) VALUES (?, ?)').bind(nonce, exp),
  ]);
  return nonce;
}

/** يستهلك الـ nonce (مرة واحدة). */
export async function consumeNonce(db, nonce) {
  const r = await db.prepare("DELETE FROM auth_nonces WHERE nonce = ? AND expires_at >= datetime('now') RETURNING nonce").bind(nonce).all();
  return r.results.length === 1;
}

// ---- الجلسات ----
export async function createSession(db, userId) {
  const token = randomToken(32);
  const exp = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256hex(token), userId, exp).run();
  return { token, maxAge: SESSION_HOURS * 3600 };
}

export function cookieHeader(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function readCookie(request, name = COOKIE) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** المستخدم الحالي من الكوكي، أو null. لا يمنح شيئاً إن كان الحساب معطّلاً أو الجلسة منتهية. */
export async function currentUser(db, request) {
  const token = readCookie(request);
  if (!token || token.length < 32 || token.length > 200) return null;
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.role, u.employee_id AS employeeId, e.name AS employeeName
       FROM sessions s JOIN users u ON u.id = s.user_id AND u.active = 1
       LEFT JOIN employees e ON e.id = u.employee_id
       WHERE s.token_hash = ? AND s.expires_at >= datetime('now')`,
    )
    .bind(await sha256hex(token))
    .first();
  return row || null;
}

export async function destroySession(db, request) {
  const token = readCookie(request);
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256hex(token)).run();
}

/** يطابق مطالبات Microsoft مع مستخدم مسجّل. لا ينشئ مستخدمين تلقائياً: من لا يملك سجلاً لا يدخل. */
export async function userForEmail(db, email) {
  return db.prepare('SELECT id, email, role FROM users WHERE email = ? AND active = 1').bind(email).first();
}
