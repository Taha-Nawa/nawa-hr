// الدخول بحساب Microsoft: Authorization Code + PKCE من المتصفح (تطبيق SPA بلا سرّ).
// الخادم هو من يتحقق من توقيع الرمز ويقرر الصلاحيات؛ المتصفح هنا ينقل الرمز فقط.
import { get, post } from './api.js';

const KEY = 'nawa-login';
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function startLogin({ remember = false } = {}) {
  const cfg = await post('/api/auth/start');
  const verifier = rand(48);
  const state = rand(24);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const saved = JSON.stringify({ verifier, state, tenant: cfg.tenant, clientId: cfg.clientId, remember, at: Date.now() });
  sessionStorage.setItem(KEY, saved);
  // نسخة احتياطية قصيرة العمر: على الآيفون قد تُفتح صفحة Microsoft في نافذة منفصلة داخل التطبيق المثبّت فلا تصل إليها sessionStorage.
  try { localStorage.setItem(KEY, saved); } catch { /* التخزين غير متاح */ }
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: location.origin,
    response_mode: 'fragment',
    scope: 'openid profile email',
    state,
    nonce: cfg.nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  location.assign(`https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/authorize?${q}`);
}

/** هل العودة من Microsoft موجودة في العنوان؟ */
export function hasCallback() {
  return /[#&](code|error)=/.test(location.hash);
}

/** يُكمل الدخول بعد العودة من Microsoft. يُرجع { ok } أو { error }. */
export async function finishLogin() {
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname); // لا نُبقي الرمز في العنوان
  let saved = null;
  for (const store of [sessionStorage, localStorage]) {
    try {
      saved ||= JSON.parse(store.getItem(KEY) || 'null');
    } catch { /* تالف: نتجاهله */ }
  }
  sessionStorage.removeItem(KEY);
  try { localStorage.removeItem(KEY); } catch { /* غير متاح */ }
  if (saved && Date.now() - (saved.at || 0) > 15 * 60 * 1000) saved = null; // محاولة قديمة

  if (p.get('error')) return { error: p.get('error') === 'access_denied' ? 'أُلغي تسجيل الدخول.' : 'رفضت Microsoft طلب الدخول، حاول مرة أخرى.' };
  if (!saved || !p.get('code') || p.get('state') !== saved.state) return { error: 'انتهت صلاحية محاولة الدخول، ابدأ من جديد.' };

  let tokens;
  try {
    const r = await fetch(`https://login.microsoftonline.com/${saved.tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: saved.clientId,
        grant_type: 'authorization_code',
        code: p.get('code'),
        redirect_uri: location.origin,
        code_verifier: saved.verifier,
        scope: 'openid profile email',
      }),
    });
    tokens = await r.json();
  } catch {
    return { error: 'تعذّر الاتصال بـ Microsoft، تحقق من الإنترنت.' };
  }
  if (!tokens.id_token) return { error: 'لم تُرجع Microsoft رمز الدخول، حاول مرة أخرى.' };

  try {
    await post('/api/auth/session', { idToken: tokens.id_token, remember: saved.remember === true });
  } catch (e) {
    return { error: e.body?.code === 'not_registered' ? e.message : e.message || 'تعذّر الدخول.' };
  }
  return { ok: true };
}

/** forget: ينسى هذا الجهاز أيضاً (وإلا يبقى متذكَّراً ويعرض «متابعة» في المرة القادمة). */
export async function logout({ forget = false } = {}) {
  try {
    await post('/api/auth/logout', { forget });
  } catch {
    /* الكوكي ينتهي بكل الأحوال */
  }
}

// ---- طرق الدخول الأخرى (كلها تُنشئ الجلسة في الخادم؛ المتصفح لا يحتفظ بأي سرّ سوى كوكي HttpOnly)
export const authConfig = () => get('/api/auth/config').catch(() => ({ sso: true, pin: true, code: false, rememberDays: 30 }));
export const deviceInfo = () => get('/api/auth/device').catch(() => ({ known: false }));
export const resumeDevice = (pin) => post('/api/auth/resume', pin ? { pin } : {});
export const requestCode = (email) => post('/api/auth/code/request', { email });
export const verifyCode = (email, code, remember) => post('/api/auth/code/verify', { email, code, remember });
export const loginWithPin = (email, pin, remember) => post('/api/auth/pin', { email, pin, remember });
