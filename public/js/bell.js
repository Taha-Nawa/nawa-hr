// مركز التنبيهات (الجرس): يجمع ما يحتاج انتباهك من مصادر النظام الموجودة، حسب دورك، ولا يخزّن شيئاً.
import { h, clear, icon, dialog } from './dom.js';
import { get } from './api.js';

const safe = async (path, pick) => {
  try {
    return pick(await get(path));
  } catch {
    return 0;
  }
};

/** يُرجع قائمة تنبيهات [{n, text, href, level}] لدور المستخدم */
// ذاكرتان: وعد مشترك لمدة 30 ثانية (الجرسان في الصفحة)، ونسخة في sessionStorage لعشر دقائق
// فلا تُعاد الاستعلامات الثقيلة (الأنماط والمواقع وسلامة البيانات) مع كل فتح أو تحديث للصفحة.
const TTL = 10 * 60 * 1000;
const SKEY = 'nawa-bell';
const stored = (me) => {
  try {
    const v = JSON.parse(sessionStorage.getItem(SKEY) || 'null');
    return v && v.role === me.role && Date.now() - v.at < TTL ? v.alerts : null;
  } catch {
    return null;
  }
};
let cache = null;
export function collectAlerts(me, force = false) {
  if (!force) {
    const hit = stored(me);
    if (hit) return Promise.resolve(hit);
  }
  if (!cache || Date.now() - cache.at > 30000) {
    cache = {
      at: Date.now(),
      p: gather(me).then((alerts) => {
        try { sessionStorage.setItem(SKEY, JSON.stringify({ at: Date.now(), role: me.role, alerts })); } catch { /* التخزين اختياري */ }
        return alerts;
      }),
    };
  }
  return cache.p;
}

async function gather(me) {
  const lead = ['manager', 'hr', 'director', 'admin'].includes(me.role);
  const hr = ['hr', 'admin'].includes(me.role);
  const ins = ['hr', 'director', 'admin'].includes(me.role);
  const [reqs, plans, unclosed, pats, locs, integ] = await Promise.all([
    safe('/api/requests/meta', (d) => d.pending || 0),
    lead ? safe('/api/plans/meta', (d) => d.pending || 0) : 0,
    hr ? safe('/api/unclosed?days=7', (d) => d.past || 0) : 0,
    lead ? safe('/api/insights/patterns', (d) => d.employees.length) : 0,
    lead ? safe('/api/insights/locations?days=7', (d) => d.total) : 0,
    ins ? safe('/api/insights/integrity', (d) => d.checks.filter((c) => c.level === 'high').reduce((s, c) => s + c.items.length, 0)) : 0,
  ]);
  return [
    { n: reqs, text: 'طلب بانتظار قرارك', href: '#/requests', level: 'high' },
    { n: plans, text: 'خطة إجازات بانتظار قرارك', href: '#/plans', level: 'high' },
    { n: unclosed, text: 'يوم بلا تسجيل انصراف في آخر 7 أيام', href: '#/today', level: 'mid' },
    { n: pats, text: 'موظف يحتاج انتباهاً (تأخر أو غياب متكرر)', href: '#/insights', level: 'mid' },
    { n: locs, text: 'يوم بموقع مشبوه في آخر 7 أيام', href: '#/insights', level: 'high' },
    { n: integ, text: 'ملاحظة مهمة على سلامة البيانات', href: '#/insights?focus=integrity', level: 'mid' },
  ].filter((a) => a.n > 0);
}

export function bellButton(me) {
  const badge = h('b', { class: 'count', hidden: true });
  const btn = h('button', { type: 'button', class: 'bell no-print', 'aria-label': 'التنبيهات', onclick: open }, icon('bell'), badge);
  let alerts = [];
  async function refresh(force = false) {
    alerts = await collectAlerts(me, force);
    const total = alerts.reduce((s, a) => s + a.n, 0);
    badge.hidden = total === 0;
    badge.textContent = total > 99 ? '99+' : String(total);
    btn.setAttribute('aria-label', total ? `التنبيهات: ${total}` : 'التنبيهات');
  }
  function open() {
    const body = h('div');
    const d = dialog({ title: 'التنبيهات', content: body });
    const draw = () => clear(body).append(alerts.length
      ? h('ul', { class: 'bell-list' }, alerts.map((a) => h('li', null, h('a', { href: a.href, onclick: () => d.close() }, h('b', { class: `chip ${a.level === 'high' ? 'chip-absent' : 'chip-late'}` }, String(a.n)), h('span', null, a.text)))))
      : h('div', { class: 'empty' }, h('b', null, 'لا شيء ينتظرك'), h('p', { class: 'muted' }, 'كل شيء على ما يرام الآن.')));
    draw();
    refresh(true).then(draw);
  }
  // بعد أن تستقر الصفحة: الجرس لا يجوز أن ينافس محتوى الصفحة على الاتصال في الثواني الأولى
  if (stored(me)) refresh();
  else setTimeout(refresh, 4000);
  setInterval(() => { if (!document.hidden) refresh(true); }, TTL);
  return btn;
}
