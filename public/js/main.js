import { h, $, clear, toast } from './dom.js';
import { get, setUnauthorizedHandler } from './api.js';
import { startLogin, hasCallback, finishLogin, logout } from './auth.js';

const ROLE_LABEL = { employee: 'موظف', manager: 'مدير مباشر', hr: 'موارد بشرية', director: 'مدير عام', admin: 'مسؤول النظام' };
const ALL = ['employee', 'manager', 'hr', 'director', 'admin'];

const PAGES = [
  { path: 'today', title: 'لوحة اليوم', roles: ALL, load: () => import('./pages/today.js') },
  { path: 'employees', title: 'الموظفون', roles: ALL, load: () => import('./pages/employees.js') },
  { path: 'employees/:id', title: 'الموظف', roles: ALL, nav: 'employees', load: () => import('./pages/employee.js') },
  { path: 'settings', title: 'الإعدادات والعطل', roles: ['hr', 'director', 'admin'], load: () => import('./pages/settings.js') },
  { path: 'import', title: 'الاستيراد من إكسل', roles: ['hr', 'admin'], load: () => import('./pages/import.js') },
  { path: 'devices', title: 'أجهزة البوابة', roles: ['admin'], load: () => import('./pages/devices.js') },
  { path: 'users', title: 'المستخدمون', roles: ['admin'], load: () => import('./pages/users.js') },
  { path: 'audit', title: 'سجل التدقيق', roles: ['hr', 'director', 'admin'], load: () => import('./pages/audit.js') },
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
function showLogin(message) {
  me = null;
  document.title = 'الدخول — نظام الحضور والطلبات';
  const btn = h('button', { type: 'button', class: 'btn btn-ms', onclick: async () => {
    btn.disabled = true;
    try {
      await startLogin();
    } catch (e) {
      btn.disabled = false;
      toast(e.message, 'err');
    }
  } },
  h('span', { class: 'ms-logo', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')), 'الدخول بحساب Microsoft');
  clear(root).append(
    h('main', { class: 'login' },
      h('section', { class: 'arch' },
        h('img', { src: '/logo.png', alt: 'جمعية نوى للثقافة والفنون', class: 'arch-logo' }),
        h('h1', null, 'الحضور والطلبات'),
        h('p', { class: 'arch-sub' }, 'ادخل بحسابك المؤسسي على nawaculture.org'),
        message ? h('p', { class: 'login-msg', role: 'alert' }, message) : null,
        btn)),
  );
}

// ---------------------------------------------------------------- الإطار
function navLinks() {
  return PAGES.filter((p) => !p.path.includes(':') && p.roles.includes(me.role)).map((p) => h('a', { href: `#/${p.path}`, class: 'nav-link', dataset: { path: p.path } }, p.title));
}

function showShell() {
  clear(root).append(
    h('div', { class: 'shell' },
      h('aside', { class: 'side' },
        h('a', { href: '#/today', class: 'brand' }, h('img', { src: '/logo.png', alt: '' }), h('span', null, 'الحضور والطلبات')),
        h('nav', { class: 'nav', 'aria-label': 'التنقل الرئيسي' }, navLinks()),
        h('div', { class: 'who' },
          h('div', { class: 'who-name' }, me.employeeName || me.email),
          h('div', { class: 'who-role' }, ROLE_LABEL[me.role] || me.role),
          h('button', { type: 'button', class: 'link-btn', onclick: async () => { await logout(); showLogin(); } }, 'تسجيل الخروج'))),
      h('main', { class: 'main', id: 'view', tabindex: '-1' })),
  );
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
  document.querySelectorAll('.nav-link').forEach((a) => a.classList.toggle('on', a.dataset.path === active));
  document.title = `${found.page.title} — الحضور والطلبات`;
  clear(view).append(h('p', { class: 'loading' }, 'جارٍ التحميل…'));
  try {
    const mod = await found.page.load();
    const node = await mod.default({ user: me, params: found.params });
    if (location.hash.replace(/^#\/?/, '').split('?')[0] === path) {
      clear(view).append(node);
      view.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  } catch (e) {
    console.error(e);
    clear(view).append(h('div', { class: 'notice notice-err', role: 'alert' }, e.message || 'حدث خطأ غير متوقع'));
  }
}

// ---------------------------------------------------------------- الإقلاع
async function boot() {
  setUnauthorizedHandler(() => {
    if (me) showLogin('انتهت جلسة العمل، سجّل الدخول من جديد.');
  });

  let loginError = null;
  if (hasCallback()) {
    const r = await finishLogin();
    if (r.error) loginError = r.error;
    else location.hash = '#/today';
  }

  try {
    me = (await get('/api/me')).user;
  } catch {
    me = null;
  }
  if (!me) return showLogin(loginError);
  showShell();
  window.addEventListener('hashchange', route);
  route();
}

boot();
