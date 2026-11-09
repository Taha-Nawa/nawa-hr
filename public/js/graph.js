// بحث في دليل Microsoft 365 (الاسم والبريد والصورة) لقائمة اقتراح البريد في «مستخدم جديد».
// الرمز يُجلب من نافذة منبثقة بتدفق Authorization Code + PKCE بإذن User.ReadBasic.All فقط، ويبقى في ذاكرة الصفحة (ساعة)،
// ولا يمس دخول المستخدمين العاديين: لا يُطلب هذا الإذن عند الدخول بل عند أول استعمال لهذه القائمة.
import { post } from './api.js';

const SCOPE = 'https://graph.microsoft.com/User.ReadBasic.All';
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

/** نص البحث الآمن لـ $search (يُزال كل ما قد يكسر الاستعلام) */
export function cleanTerm(t) {
  return String(t || '').replace(/["\\*()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}
export function searchUrl(term) {
  const t = cleanTerm(term);
  const q = new URLSearchParams({
    $search: `"displayName:${t}" OR "mail:${t}"`,
    $select: 'id,displayName,mail,userPrincipalName,jobTitle',
    $top: '8',
  });
  return `https://graph.microsoft.com/v1.0/users?${q}`;
}

let token = null; // { value, exp }
let pending = null;
export const graphReady = () => !!(token && token.exp > Date.now() + 60000);

/** يفتح نافذة Microsoft للموافقة/التحقق الصامت ويُرجع رمز Graph. يجب استدعاؤه من حدث مستخدم (نقر أو ضغط مفتاح). */
export function connectGraph(email) {
  if (graphReady()) return Promise.resolve(token.value);
  if (pending) return pending;
  pending = (async () => {
    const cfg = await post('/api/auth/start');
    const verifier = rand(48);
    const state = `graph.${rand(16)}`;
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const q = new URLSearchParams({
      client_id: cfg.clientId, response_type: 'code', redirect_uri: location.origin, response_mode: 'fragment',
      scope: SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256', login_hint: email || '',
    });
    const popup = window.open(`https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/authorize?${q}`, 'nawa-graph', 'width=520,height=680');
    if (!popup) throw new Error('منع المتصفح النافذة المنبثقة، اسمح بها لهذا الموقع ثم حاول مجدداً');
    const hash = await new Promise((resolve, reject) => {
      const done = (fn, v) => { window.removeEventListener('message', onMsg); clearInterval(timer); fn(v); };
      const onMsg = (e) => { if (e.origin === location.origin && e.data?.type === 'nawa-graph') done(resolve, e.data.hash); };
      window.addEventListener('message', onMsg);
      const timer = setInterval(() => { if (popup.closed) done(reject, new Error('أُغلقت نافذة Microsoft قبل اكتمال الموافقة')); }, 600);
    });
    const p = new URLSearchParams(String(hash).replace(/^#/, ''));
    if (p.get('state') !== state) throw new Error('استجابة غير متوقعة من Microsoft');
    if (p.get('error')) {
      throw new Error(/consent|AADSTS65001|admin/i.test(`${p.get('error')} ${p.get('error_description')}`)
        ? 'لم تُمنح موافقة المسؤول على إذن الدليل بعد'
        : 'رفضت Microsoft الطلب، حاول مجدداً');
    }
    const r = await fetch(`https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cfg.clientId, grant_type: 'authorization_code', code: p.get('code'), redirect_uri: location.origin, code_verifier: verifier, scope: SCOPE }),
    });
    const t = await r.json();
    if (!t.access_token) throw new Error('تعذّر الحصول على إذن قراءة الدليل');
    token = { value: t.access_token, exp: Date.now() + (Number(t.expires_in) || 3000) * 1000 };
    return token.value;
  })().finally(() => { pending = null; });
  return pending;
}

/** نتائج الدليل: [{ id, name, email, title }] */
export async function searchDirectory(term) {
  if (!graphReady() || cleanTerm(term).length < 1) return [];
  const r = await fetch(searchUrl(term), { headers: { authorization: `Bearer ${token.value}`, ConsistencyLevel: 'eventual' } });
  if (r.status === 401) { token = null; return []; }
  if (!r.ok) return [];
  const j = await r.json();
  return (j.value || []).filter((u) => u.mail || u.userPrincipalName).map((u) => ({
    id: u.id, name: u.displayName || '', email: String(u.mail || u.userPrincipalName).toLowerCase(), title: u.jobTitle || '',
  }));
}

const photos = new Map();
/** صورة المستخدم كـ data URL (الصفحة لا تسمح بـ blob:)، أو null إن لم تكن له صورة */
export async function photoOf(id) {
  if (photos.has(id)) return photos.get(id);
  let out = null;
  try {
    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(id)}/photos/48x48/$value`, { headers: { authorization: `Bearer ${token.value}` } });
    if (r.ok) {
      const blob = await r.blob();
      out = await new Promise((res) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => res(null); f.readAsDataURL(blob); });
    }
  } catch { /* بلا صورة */ }
  photos.set(id, out);
  return out;
}
