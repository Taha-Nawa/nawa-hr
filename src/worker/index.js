import { handleGate } from './gate.js';
import { handleApi } from './api.js';
import { json } from './util.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') {
        const r = await env.DB.prepare('SELECT 1 AS ok').first();
        return json({ ok: r?.ok === 1, service: 'nawa-hr' });
      }
      if (url.pathname === '/api/gate') return await handleGate(request, env);
      if (url.pathname.startsWith('/api/')) {
        return (await handleApi(request, env, url)) || json({ ok: false, error: 'غير موجود' }, 404);
      }
      // ما عدا /api يُخدَّم من الملفات الثابتة (لا يصل إلى هنا عادةً: run_worker_first يحصر الاستدعاء في /api/*)
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    } catch (err) {
      console.error('unhandled', err?.stack || err);
      return json({ ok: false, error: 'خطأ داخلي في الخادم' }, 500);
    }
  },
};
