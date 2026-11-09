// عميل الـ API: كوكي الجلسة يُرسل تلقائياً (نفس الأصل). أي 401 يُبلَّغ للتطبيق ليعرض شاشة الدخول.

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('تعذّر الاتصال بالخادم، تحقق من الإنترنت', 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* ليس JSON */
  }
  if (res.status === 401 && !path.startsWith('/api/auth/')) onUnauthorized();
  if (!res.ok || data?.ok === false) throw new ApiError(data?.error || `خطأ غير متوقع (${res.status})`, res.status, data);
  return data;
}

// ذاكرة قصيرة لقوائم نادرة التغيّر: كل طلب يكلّف رحلة كاملة، والتنقل بين الصفحات يعيد طلب المراكز والإعدادات مراراً.
// تنتهي بعد 45 ثانية، وتُمسح كلها عند أي تعديل (post/put/patch/del) فلا يرى المستخدم بيانات قديمة بعد حفظه.
const MEMO_PATHS = new Set(['/api/centers', '/api/settings', '/api/employees']);
const MEMO_TTL = 45000;
const memo = new Map();
export const clearMemo = () => memo.clear();

export function get(p) {
  if (!MEMO_PATHS.has(p)) return api('GET', p);
  const hit = memo.get(p);
  if (hit && Date.now() - hit.at < MEMO_TTL) return hit.p.then((d) => structuredClone(d));
  const pr = api('GET', p);
  memo.set(p, { at: Date.now(), p: pr });
  pr.catch(() => memo.delete(p));
  return pr.then((d) => structuredClone(d));
}
const mutate = (m, p, b) => api(m, p, b).finally(clearMemo);
export const post = (p, b = {}) => mutate('POST', p, b);
export const put = (p, b) => mutate('PUT', p, b);
export const patch = (p, b) => mutate('PATCH', p, b);
export const del = (p) => mutate('DELETE', p);
