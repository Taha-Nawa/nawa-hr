import { h, $, clear, toast, icon, dialog } from './dom.js';
import { get, setUnauthorizedHandler } from './api.js';
import { hasCallback, finishLogin, logout, authConfig, deviceInfo, resumeDevice } from './auth.js';
import { showLogin as renderLogin } from './login-ui.js';
import './pwa.js';
import { withPhoto } from './avatar.js';

const ROLE_LABEL = { employee: 'موظف', manager: 'مدير مباشر', hr: 'موارد بشرية', director: 'مدير عام', admin: 'مسؤول النظام' };
const ALL = ['employee', 'manager', 'hr', 'director', 'admin'];

// tab: تظهر في شريط الأزرار السفلي على الجوال؛ الباقي في ورقة «المزيد».
const PAGES = [
  { path: 'today', group: 'main', title: 'لوحة اليوم', short: 'اليوم', icon: 'today', tab: true, roles: ALL, load: () => import('./pages/today.js') },
  { path: 'requests', group: 'main', title: 'الطلبات', short: 'الطلبات', icon: 'inbox', tab: true, roles: ALL, load: () => import('./pages/requests.js') },
  { path: 'requests/:id/print', title: 'طباعة النموذج', roles: ALL, nav: 'requests', load: () => import('./pages/request-print.js') },
  { path: 'plans', group: 'main', title: 'الإجازات المتوقعة', icon: 'calendar', roles: ALL, load: () => import('./pages/plans.js') },
  { path: 'balances', group: 'main', title: 'أرصدة الإجازات', icon: 'calendar', roles: ['manager', 'hr', 'director', 'admin'], load: () => import('./pages/balances.js') },
  { path: 'employees', group: 'main', title: 'الموظفون', short: 'الموظفون', icon: 'users', tab: true, roles: ALL, load: () => import('./pages/employees.js') },
  { path: 'employees/:id', title: 'الموظف', roles: ALL, nav: 'employees', load: () => import('./pages/employee.js') },
  { path: 'manual', group: 'work', title: 'الحضور اليدوي', icon: 'clock', roles: ['hr', 'admin'], load: () => import('./pages/manual.js') },
  { path: 'attendance-sheet', group: 'work', title: 'كشف الحضور الأسبوعي', icon: 'printer', roles: ['manager', 'hr', 'director', 'admin'], load: () => import('./pages/attendance-sheet.js') },
  { path: 'monthly-report', group: 'work', title: 'التقرير الشهري', icon: 'report', roles: ALL, load: () => import('./pages/monthly-reports.js') },
  { path: 'monthly-report/:id/:month', title: 'التقرير الشهري', roles: ALL, nav: 'monthly-report', load: () => import('./pages/monthly-report.js') },
  { path: 'monthly-report/:id/:month/print', title: 'طباعة التقرير الشهري', roles: ALL, nav: 'monthly-report', load: () => import('./pages/monthly-report-print.js') },
  { path: 'work-log', group: 'work', title: 'ماذا أنجزت اليوم', icon: 'check', roles: ALL, load: () => import('./pages/work-log.js') },
  { path: 'work-log/:month', title: 'ماذا أنجزت اليوم', roles: ALL, nav: 'work-log', load: () => import('./pages/work-log.js') },
  { path: 'reports', group: 'work', title: 'التقارير', short: 'التقارير', icon: 'report', tab: true, roles: ALL, load: () => import('./pages/reports.js') },
  { path: 'timesheet-preview', title: 'معاينة التايم شيت', roles: ALL, nav: 'reports', load: () => import('./pages/timesheet-preview.js') },
  { path: 'volunteers', group: 'work', title: 'المتطوعون', icon: 'users', roles: ['hr', 'director', 'admin'], load: () => import('./pages/volunteers.js') },
  { path: 'volunteers/:id/:month', title: 'حضور متطوع', roles: ['hr', 'director', 'admin'], nav: 'volunteers', load: () => import('./pages/volunteer-month.js') },
  { path: 'volunteers/:id/:month/print', title: 'كشف المتطوع', roles: ['hr', 'director', 'admin'], nav: 'volunteers', load: () => import('./pages/volunteer-print.js') },
  { path: 'providers', group: 'work', title: 'مزوّدو الخدمة', icon: 'briefcase', roles: ['manager', 'hr', 'director', 'admin'], load: () => import('./pages/providers.js') },
  { path: 'providers/:id/card', title: 'بطاقة مزوّد الخدمة', roles: ['hr', 'admin'], nav: 'providers', load: () => import('./pages/provider-card.js') },
  { path: 'providers/:id/:month/print', title: 'كشف مزوّد الخدمة', roles: ['manager', 'hr', 'director', 'admin'], nav: 'providers', load: () => import('./pages/provider-print.js') },
  { path: 'providers/:id', title: 'مزوّد الخدمة', roles: ['manager', 'hr', 'director', 'admin'], nav: 'providers', load: () => import('./pages/provider.js') },
  { path: 'providers/:id/:month', title: 'حضور مزوّد الخدمة', roles: ['manager', 'hr', 'director', 'admin'], nav: 'providers', load: () => import('./pages/provider.js') },
  { path: 'settings', group: 'admin', title: 'الإعدادات والعطل', icon: 'sliders', roles: ['hr', 'director', 'admin'], load: () => import('./pages/settings.js') },
  { path: 'import', group: 'admin', title: 'الاستيراد من إكسل', icon: 'upload', roles: ['hr', 'admin'], load: () => import('./pages/import.js') },
  { path: 'devices', group: 'admin', title: 'أجهزة البوابة', icon: 'tablet', roles: ['admin'], load: () => import('./pages/devices.js') },
  { path: 'users', group: 'admin', title: 'المستخدمون', icon: 'shield', roles: ['admin'], load: () => import('./pages/users.js') },
  { path: 'backup', group: 'admin', title: 'النسخ الاحتياطي', icon: 'download', roles: ['admin'], load: () => import('./pages/backup.js') },
  { path: 'audit', group: 'admin', title: 'سجل التدقيق', icon: 'audit', roles: ['hr', 'director', 'admin'], load: () => import('./pages/audit.js') },
  { path: 'links', group: 'me', title: 'الروابط', icon: 'link', roles: ALL, load: () => import('./pages/links.js') },
  { path: 'account', group: 'me', title: 'حسابي والأمان', icon: 'key', roles: ALL, load: () => import('./pages/account.js') },
];

const root = document.getElementById('app');
let me = null;

function match(path) {
  for (const p of PAGES) {
    const names = [];
    const re = new RegExp(`^${p.path.replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)'))}$`);
    const m = path.match(re);
    if (m) return { page: p, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

// ---------------------------------------------------------------- شاشة الدخول
async function showLogin(message, known) {
  me = null;
  const [config, device] = await Promise.all([authConfig(), known ?? deviceInfo()]);
  renderLogin({ root, message, config, device, onDone: startApp });
}

// ---------------------------------------------------------------- الإطار
const listed = () => PAGES.filter((p) => p.icon && !p.path.includes(':') && p.roles.includes(me.role));
const initial = () => ((me.employeeName || me.email || '؟').trim()[0] || '؟').toUpperCase();

async function signOut() {
  await logout();
  showLogin();
}

// تلميح لمرة واحدة بعد دخول قوي: أنشئ PIN لدخول أسرع. يُخفى بالإغلاق ويبقى مخفياً على هذا الجهاز.
const TIP_KEY = 'nawa-pin-tip';
function maybeTip(view) {
  let dismissed = false;
  try { dismissed = localStorage.getItem(TIP_KEY) === '1'; } catch { /* غير متاح */ }
  if (dismissed || me.pin || !['microsoft', 'code'].includes(me.via)) return;
  const hide = () => { try { localStorage.setItem(TIP_KEY, '1'); } catch { /* غير متاح */ } tip.remove(); };
  const tip = h('div', { class: 'tip', role: 'note' },
    icon('key'),
    h('span', null, 'ادخل أسرع المرة القادمة: أنشئ رقم PIN من 6 أرقام وتذكّر هذا الجهاز.'),
    h('a', { class: 'btn btn-sm btn-primary', href: '#/account', onclick: hide }, 'إنشاء PIN'),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'إخفاء التلميح', onclick: hide }, '✕'));
  view.prepend(tip);
}

function openMore() {
  const rest = listed().filter((p) => !p.tab);
  const sheet = dialog({
    title: 'القائمة',
    sheet: true,
    content: h('div', null,
      h('div', { class: 'sheet-user' },
        withPhoto(h('span', { class: 'avatar', 'aria-hidden': 'true' }, initial()), me.photo),
        h('div', null, h('div', { class: 'who-name' }, me.employeeName || me.email), h('div', { class: 'who-role' }, ROLE_LABEL[me.role] || me.role))),
      h('div', { class: 'sheet-list' },
        rest.map((p) => h('a', { href: `#/${p.path}`, class: 'sheet-link', onclick: () => sheet.close() }, icon(p.icon), p.title)),
        h('button', { type: 'button', class: 'sheet-link', onclick: () => { sheet.close(); signOut(); } }, icon('out'), 'تسجيل الخروج'))),
  });
}

const GROUPS = [['main', 'الرئيسية'], ['work', 'المتابعة والتقارير'], ['admin', 'الإدارة والإعدادات'], ['me', 'حسابي']];
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* التخزين غير متاح */ } };
const closedGroups = () => { try { return new Set(JSON.parse(lsGet('nawa-nav-closed') || '[]')); } catch { return new Set(); } };

/** القائمة الجانبية مجمَّعة بالأهمية: كل مجموعة تُطوى وتُفتح وتُحفظ حالتها على الجهاز. */
function navTree(pages) {
  const closed = closedGroups();
  return h('nav', { class: 'nav', 'aria-label': 'التنقل الرئيسي' }, GROUPS.map(([key, label]) => {
    const list = pages.filter((p) => p.group === key);
    if (!list.length) return null;
    const body = h('div', { class: 'nav-items', id: `navg-${key}` }, list.map((p) => h('a', { href: `#/${p.path}`, class: 'nav-link', title: p.title, dataset: { path: p.path, icon: p.icon } }, icon(p.icon), h('span', null, p.title))));
    const head = h('button', { type: 'button', class: 'nav-head', 'aria-controls': `navg-${key}`, 'aria-expanded': String(!closed.has(key)), onclick: () => setGroup(key, head.getAttribute('aria-expanded') === 'true') }, h('span', null, label));
    const grp = h('div', { class: 'nav-group', dataset: { group: key } }, head, body);
    if (closed.has(key)) grp.classList.add('shut');
    return grp;
  }));
}

function setGroup(key, shut) {
  const grp = document.querySelector(`.nav-group[data-group="${key}"]`);
  if (!grp) return;
  grp.classList.toggle('shut', shut);
  grp.querySelector('.nav-head').setAttribute('aria-expanded', String(!shut));
  const set = closedGroups();
  if (shut) set.add(key); else set.delete(key);
  lsSet('nawa-nav-closed', JSON.stringify([...set]));
}

function applyRail(on) {
  document.querySelector('.shell')?.classList.toggle('rail', on);
  const b = document.getElementById('railToggle');
  if (b) { b.setAttribute('aria-expanded', String(!on)); b.setAttribute('aria-label', on ? 'إظهار القائمة الجانبية' : 'إخفاء القائمة الجانبية'); }
}
function toggleRail() {
  const on = !document.querySelector('.shell')?.classList.contains('rail');
  lsSet('nawa-rail', on ? '1' : '0');
  applyRail(on);
}

function showShell() {
  const pages = listed();
  clear(root).append(
    h('div', { class: 'shell' },
      h('header', { class: 'topbar' },
        h('img', { src: '/logo.png', alt: 'جمعية نوى' }),
        h('div', { class: 'topbar-title' }, 'نظام نوى للشؤون الإدارية', h('small', null, 'جمعية نوى للثقافة والفنون')),
        withPhoto(h('span', { class: 'avatar', 'aria-hidden': 'true' }, initial()), me.photo)),
      h('aside', { class: 'side' },
        h('button', { type: 'button', class: 'rail-toggle', id: 'railToggle', 'aria-label': 'إخفاء القائمة الجانبية', 'aria-expanded': 'true', onclick: toggleRail }, h('i')),
        h('a', { href: '#/today', class: 'brand', title: 'نظام نوى للشؤون الإدارية' }, h('img', { src: '/logo.png', alt: '' }), h('span', null, 'نظام نوى للشؤون الإدارية', h('small', null, 'جمعية نوى للثقافة والفنون'))),
        navTree(pages),
        h('div', { class: 'who' },
          h('div', { class: 'who-name' }, me.employeeName || me.email),
          h('div', { class: 'who-role' }, ROLE_LABEL[me.role] || me.role),
          h('button', { type: 'button', class: 'link-btn', title: 'تسجيل الخروج', onclick: signOut }, icon('out'), h('span', null, 'تسجيل الخروج')))),
      h('main', { class: 'main', id: 'view', tabindex: '-1' }),
      h('nav', { class: 'tabbar', 'aria-label': 'التنقل السريع' },
        pages.filter((p) => p.tab).map((p) => h('a', { href: `#/${p.path}`, class: 'tab', dataset: { path: p.path } }, h('span', { class: 'pill' }, icon(p.icon)), h('span', null, p.short))),
        h('button', { type: 'button', class: 'tab', id: 'tabMore', onclick: openMore }, h('span', { class: 'pill' }, icon('more')), h('span', null, 'المزيد')))),
  );
  applyRail(lsGet('nawa-rail') === '1');
  watchTables($('#view'));
  refreshPending();
}

// عدّاد «بانتظار قراري» بجانب الطلبات والإجازات المتوقعة في القائمة الجانبية والشريط السفلي
async function refreshPending() {
  if (!me) return;
  const count = async (path) => {
    try {
      return (await get(path)).pending || 0;
    } catch {
      return 0; // العدّاد تحسين؛ لا يعطّل شيئاً
    }
  };
  const [reqs, plans] = await Promise.all([count('/api/requests/meta'), ['manager', 'hr', 'director', 'admin'].includes(me.role) ? count('/api/plans/meta') : 0]);
  for (const [path, n, what] of [['requests', reqs, 'طلب'], ['plans', plans, 'خطة إجازات']]) {
    document.querySelectorAll(`[data-path="${path}"]`).forEach((a) => {
      a.querySelector('.count')?.remove();
      if (n > 0) (a.querySelector('.pill') || a).append(h('b', { class: 'count', 'aria-label': `${n} ${what} بانتظار قرارك` }, n));
    });
  }
}

// على الجوال تتحول الجداول إلى بطاقات: نكتب عنوان العمود على كل خلية (data-label) كلما رُسم جدول جديد.
// الجداول العريضة (معاينة التايم شيت) تبقى جداول قابلة للتمرير الأفقي.
function stackTables(view) {
  for (const t of view.querySelectorAll('table.tbl')) {
    if (t.closest('.table-wrap[dir="ltr"]') || t.classList.contains('stack')) continue;
    const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    for (const tr of t.querySelectorAll('tbody tr')) {
      [...tr.children].forEach((td, i) => {
        td.dataset.label = heads[i] ?? '';
        if (td.textContent.trim() === '—') td.classList.add('blank'); // خانة فارغة: تُخفى في عرض البطاقات فتبقى البطاقة قصيرة
      });
    }
    t.classList.add('stack');
  }
}
function watchTables(view) {
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; stackTables(view); });
  }).observe(view, { childList: true, subtree: true });
}

async function route() {
  if (!me) return;
  const path = (location.hash.replace(/^#\/?/, '') || 'today').split('?')[0];
  const found = match(path);
  const view = $('#view');
  if (!found || !found.page.roles.includes(me.role)) {
    location.replace('#/today');
    return;
  }
  const active = found.page.nav || found.page.path;
  document.querySelectorAll('.nav-link, .tab[data-path]').forEach((a) => a.classList.toggle('on', a.dataset.path === active));
  const g = document.querySelector(`.nav-link[data-path="${active}"]`)?.closest('.nav-group');
  if (g?.classList.contains('shut')) setGroup(g.dataset.group, false); // الصفحة الحالية لا تُخفى داخل مجموعة مطوية
  $('#tabMore')?.classList.toggle('on', !PAGES.some((p) => p.tab && p.path === active));
  document.title = `${found.page.title} — نظام نوى للشؤون الإدارية`;
  clear(view).append(h('p', { class: 'loading' }, 'جارٍ التحميل…'));
  try {
    const mod = await found.page.load();
    const node = await mod.default({ user: me, params: found.params });
    if (location.hash.replace(/^#\/?/, '').split('?')[0] === path) {
      clear(view).append(node);
      if (found.page.path === 'today') maybeTip(view);
      view.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  } catch (e) {
    console.error(e);
    clear(view).append(h('div', { class: 'notice notice-err', role: 'alert' }, e.message || 'حدث خطأ غير متوقع'));
  }
}

// ---------------------------------------------------------------- الإقلاع
async function startApp() {
  try {
    me = (await get('/api/me')).user;
  } catch {
    me = null;
  }
  if (!me) return showLogin();
  showShell();
  route();
}

// انتهت الجلسة أثناء الاستعمال: نحاول الاستئناف الصامت من الجهاز المتذكَّر قبل أن نُظهر شاشة الدخول.
let recovering = false;
async function recover() {
  if (!me || recovering) return;
  recovering = true;
  try {
    const dev = await deviceInfo();
    if (dev.known && dev.auto) {
      await resumeDevice();
      location.reload();
      return;
    }
    showLogin('انتهت جلسة العمل، سجّل الدخول من جديد.', dev);
  } catch {
    showLogin('انتهت جلسة العمل، سجّل الدخول من جديد.');
  } finally {
    recovering = false;
  }
}

async function boot() {
  setUnauthorizedHandler(recover);
  window.addEventListener('hashchange', route);
  window.addEventListener('requests:changed', refreshPending);

  let loginError = null;
  if (hasCallback()) {
    const r = await finishLogin();
    if (r.error) loginError = r.error;
    else location.hash = '#/today';
  }

  let user = null;
  try {
    user = (await get('/api/me')).user;
  } catch { /* لا جلسة */ }
  if (user) return startApp();

  // بلا جلسة: جهاز متذكَّر يدخل تلقائياً، وإلا نعرض شاشة الدخول (مع «متابعة كـ…» إن عُرف الجهاز).
  const dev = await deviceInfo();
  if (dev.known && dev.auto && !loginError) {
    try {
      await resumeDevice();
      return startApp();
    } catch { /* انتهى الجهاز أو أُوقف: شاشة الدخول */ }
  }
  showLogin(loginError, dev);
}

boot();
