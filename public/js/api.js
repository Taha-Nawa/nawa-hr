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

export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b) => api('PUT', p, b);
export const patch = (p, b) => api('PATCH', p, b);
