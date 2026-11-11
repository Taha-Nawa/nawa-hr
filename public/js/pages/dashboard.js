// لوحة اليوم الذكية: تتغير حسب الدور. الموظف: يومه وإجراءاته. المدير: فريقه والمعلّق عنده. الموارد البشرية والمدير العام: المؤسسة والتنبيهات. مسؤول النظام: وصحة النظام.
import { h, clear, longDate, icon } from '../dom.js';
import { get } from '../api.js';
import { donut, COLORS } from '../charts-lib.js';
import { groupOf } from './today.js';

const ROLE_LABEL = { employee: 'موظف', manager: 'مدير مباشر', hr: 'موارد بشرية', director: 'مدير عام', admin: 'مسؤول النظام' };
const GROUP_LABEL = { present: 'حاضر', late: 'متأخر', absent: 'غياب', leave: 'إجازة أو مهمة', off: 'عطلة', none: 'بلا تسجيل' };
const ORDER = ['present', 'late', 'absent', 'leave', 'off', 'none'];
const dm = (d) => d.slice(5).split('-').reverse().join('/');
const greeting = () => { const hr = new Date().getHours(); return hr < 12 ? 'صباح الخير' : hr < 18 ? 'مساء الخير' : 'مساء النور'; };
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';

const ACTIONS = {
  employee: [['خطتي للإجازات', '#/plans']],
  manager: [['طلبات فريقي', '#/requests', true], ['متابعة الفريق', '#/work-log/team'], ['سجلي اليومي', '#/work-log']],
  hr: [['الموظفون', '#/employees', true], ['طلبات الإجازة', '#/requests'], ['التقارير', '#/reports']],
  director: [['التقارير', '#/reports', true], ['طلبات الإجازة', '#/requests'], ['المؤشرات', '#/insights']],
  admin: [['الموظفون', '#/employees', true], ['الإعدادات', '#/settings'], ['النسخ الاحتياطي', '#/backup']],
};

function attention(label, n, href, tone, keep = false) {
  return h('a', { class: `dg-att${n ? ` dg-att-${tone}` : ''}`, href, 'data-n': String(n), ...(keep ? { 'data-keep': '1' } : {}) }, h('strong', null, String(n)), h('span', null, label));
}

/** user: من /api/me. يعيد { el, setRows(rows, date), setHealth({gates, backup}) }. */
export function dashboard({ user, today, onPick = () => {}, onCenter = () => {} }) {
  const role = user.role;
  const isOrg = ['hr', 'director', 'admin'].includes(role);
  const lead = role !== 'employee';
  const el = h('section', { class: 'dg', 'aria-label': 'لوحة المعلومات' });
  const hero = h('div', { class: 'dg-hero' });
  const attBox = h('div', { class: 'dg-atts' });
  const todayCard = h('div', { class: 'dg-card' });
  const watchCard = h('div', { class: 'dg-card' });
  const centersCard = h('div', { class: 'dg-card dg-wide' });
  const alertsCard = h('div', { class: 'dg-card dg-wide' });
  const state = { rows: [], date: today, att: {}, alerts: null, watch: null, health: {} };

  // أيقونة «فانوس جديد»: للموارد البشرية والمسؤول، ولمن له فريق يراسله (يُعرف من الخادم)
  let lanternHref = ['hr', 'admin'].includes(role) ? '#/announcements' : null;
  if (!lanternHref && lead) {
    get('/api/announcements/scope').then((r) => { if (r.all || r.team) { lanternHref = ['manager', 'director'].includes(role) ? '#/announcements' : '#/team-message'; drawHero(); } }).catch(() => {});
  }

  function drawHero() {
    clear(hero).append(
      h('div', null,
        h('p', { class: 'dg-hello' }, `${greeting()}${user.employeeName ? `، ${firstName(user.employeeName)}` : ''}`),
        h('p', { class: 'dg-sub' }, `${ROLE_LABEL[role] || role} · ${longDate(state.date)}`)),
      h('div', { class: 'dg-actions' }, (ACTIONS[role] || ACTIONS.employee).map(([t, href, main]) => h('a', { class: `btn${main ? ' btn-primary' : ''}`, href }, t)),
        lanternHref ? h('a', { class: 'dg-lantern', href: lanternHref, title: 'فانوس جديد', 'aria-label': 'إنشاء فانوس جديد' }, icon('lantern')) : null));
  }

  function drawAtt() {
    const a = state.att, al = state.alerts;
    const items = [];
    if (['manager', 'hr', 'director', 'admin'].includes(role)) {
      items.push(attention('طلب إجازة بانتظار قرارك', a.requests || 0, '#/requests', 'warn', true));
      items.push(attention('خطة إجازات بانتظار قرارك', a.plans || 0, '#/plans', 'warn', true));
    }
    if (a.review != null && lead) items.push(attention('تعديل في سجل الفريق لتراجعه', a.review, '#/work-log/team', 'info'));
    if (al) {
      items.push(attention('عودة من إجازة أمومة أو ساعة أمومة', al.maternity.length, '#/employees', 'info'));
      items.push(attention('عقد مزوّد ينتهي خلال 30 يوماً', al.providersEnding.length, '#/providers', 'warn'));
      items.push(attention('موظف تنتهي خدمته خلال 30 يوماً', al.staffEnding.length, '#/employees', 'warn'));
    }
    // الإداري الفارغ يُخفى (الأصفار ضجيج)، أما طلبات القرار فتبقى ظاهرة ليعرف المدير أنه لا شيء معلّق
    const shown = items.filter((it) => it.dataset.n !== '0' || it.dataset.keep);
    clear(attBox).append(...shown);
    attBox.hidden = !shown.length;
  }

  function drawToday() {
    const counts = Object.fromEntries(ORDER.map((g) => [g, 0]));
    for (const r of state.rows) counts[groupOf(r.status)]++;
    const total = state.rows.length;
    const working = counts.present + counts.late;
    const expected = total - counts.off;
    const pct = expected > 0 ? Math.round((working / expected) * 100) : null;
    clear(todayCard).append(
      h('h3', null, state.date === today ? (isOrg ? 'المؤسسة اليوم' : 'فريقك اليوم') : 'الحضور في اليوم المحدد'),
      h('div', { class: 'dg-today' },
        donut(ORDER.map((id) => ({ id, label: GROUP_LABEL[id], value: counts[id] })), { big: pct === null ? '—' : `${pct}%`, small: 'نسبة الحضور' }, 168, onPick),
        h('ul', { class: 'dg-legend' }, ORDER.filter((g) => counts[g]).map((g) => h('li', null,
          h('button', { type: 'button', class: 'dg-pick', title: 'اعرض هؤلاء في الجدول', onclick: () => onPick(g) }, h('i', { style: { background: COLORS[g] } }), h('span', null, GROUP_LABEL[g]), h('b', null, String(counts[g]))))))),
      h('p', { class: 'dg-hint' }, 'اضغط على أي فئة لعرض أسمائها في الجدول'));
    todayCard.hidden = !total;
  }

  function drawWatch() {
    const w = state.watch;
    if (!w) { watchCard.hidden = true; return; }
    watchCard.hidden = false;
    clear(watchCard).append(
      h('h3', null, 'يحتاج متابعة هذا الشهر'),
      w.totals.pct !== null ? h('div', { class: 'dg-commit' },
        h('div', { class: 'dg-commit-top' }, h('span', null, 'الالتزام بالساعات'), h('b', null, `${w.totals.pct}%`)),
        h('div', { class: 'ms-bar', role: 'progressbar', 'aria-valuenow': String(w.totals.pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('span', { class: 'ms-bar-fill', style: { width: `${Math.min(100, w.totals.pct)}%` } }))) : null,
      w.people.length ? h('ul', { class: 'plain dg-watch' }, w.people.map((p) => h('li', null,
        h('a', { href: `#/employees/${p.id}` }, h('b', null, p.name), p.center ? h('span', { class: 'muted' }, ` · ${p.center}`) : null),
        h('span', { class: 'dg-badges' },
          p.absent ? h('span', { class: 'chip chip-absent' }, `غياب ${p.absent}`) : null,
          p.late ? h('span', { class: 'chip chip-late' }, `تأخر ${p.late} · ${p.lateMinutes} د`) : null))))
        : h('p', { class: 'muted' }, 'لا غياب ولا تأخر متكرر حتى أمس. التزام ممتاز.'));
  }

  function drawCenters() {
    const by = new Map();
    for (const r of state.rows) {
      const c = r.center || 'بلا مركز';
      if (!by.has(c)) by.set(c, Object.fromEntries(ORDER.map((g) => [g, 0])));
      by.get(c)[groupOf(r.status)]++;
    }
    if (!isOrg || by.size < 2) { centersCard.hidden = true; return; }
    centersCard.hidden = false;
    clear(centersCard).append(h('h3', null, 'المراكز'),
      h('div', { class: 'dg-centers' }, [...by.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ar')).map(([name, c]) => {
        const tot = ORDER.reduce((s, g) => s + c[g], 0);
        return h('button', { type: 'button', class: 'dg-center dg-pick', title: 'اعرض موظفي هذا المركز في الجدول', onclick: () => onCenter(name === 'بلا مركز' ? '' : name) },
          h('div', { class: 'dg-center-top' }, h('b', null, name), h('span', { class: 'muted' }, `${c.present + c.late} من ${tot} حاضر`)),
          h('div', { class: 'strip-bar dg-bar', role: 'img', 'aria-label': ORDER.map((g) => `${GROUP_LABEL[g]} ${c[g]}`).join('، ') },
            ORDER.filter((g) => c[g]).map((g) => h('span', { class: `seg seg-${g}`, style: { flex: `${c[g]} 1 0` } }))));
      })));
  }

  function drawAlerts() {
    const al = state.alerts;
    const lines = [];
    if (al) {
      for (const m of al.maternity) lines.push([m.state === 'returning' ? `تعود ${m.name} من إجازة الأمومة في ${dm(m.returnDate)}` : m.state === 'needs_hour' ? `${m.name}: لم تُحدَّد ساعة الأمومة بعد` : `تنتهي ساعة الأمومة لـ ${m.name} في ${dm(m.hourEnd)}`, `#/employees/${m.employeeId}`]);
      for (const p of al.providersEnding) lines.push([`ينتهي عقد المزوّد ${p.name} في ${dm(p.endDate)}`, `#/providers/${p.id}`]);
      for (const s of al.staffEnding) lines.push([`تنتهي خدمة ${s.name} في ${dm(s.endDate)}`, `#/employees/${s.id}`]);
    }
    const hl = state.health;
    if (role === 'admin') {
      if (hl.gates?.length) lines.push([`${hl.gates.length} بوابة غير متصلة`, '#/devices']);
      if (hl.backup?.due) lines.push([hl.backup.last ? `مضى ${hl.backup.daysSince} يوماً على آخر نسخة احتياطية` : 'لم تُؤخذ نسخة احتياطية بعد', '#/backup']);
    }
    if (!lines.length) { alertsCard.hidden = true; return; }
    alertsCard.hidden = false;
    clear(alertsCard).append(h('h3', null, 'تنبيهات إدارية'), h('ul', { class: 'plain dg-alerts' }, lines.slice(0, 8).map(([t, href]) => h('li', null, h('a', { href }, t)))));
  }

  function redraw() { drawHero(); drawAtt(); drawToday(); drawWatch(); drawCenters(); drawAlerts(); }

  el.append(hero, attBox, h('div', { class: 'dg-grid' }, todayCard, watchCard), centersCard, alertsCard);
  redraw();

  // البيانات المساندة تصل متفرقة ولا تعطّل اللوحة إن تعذّرت
  if (lead) {
    get('/api/dashboard/watch').then((r) => { state.watch = r; drawWatch(); }).catch(() => {});
    const req = get('/api/requests/meta').then((r) => { state.att.requests = r.pending || 0; }).catch(() => {});
    const pl = get('/api/plans/meta').then((r) => { state.att.plans = r.pending || 0; }).catch(() => {});
    const wl = user.employeeId != null ? get(`/api/work-log/team?month=${today.slice(0, 7)}`).then((r) => { if (r.members.length) state.att.review = r.members.reduce((s, m) => s + m.toReview, 0); }).catch(() => {}) : Promise.resolve();
    Promise.all([req, pl, wl]).then(drawAtt);
  }
  if (['hr', 'director', 'admin'].includes(role)) get('/api/dashboard/alerts').then((r) => { state.alerts = r; drawAtt(); drawAlerts(); }).catch(() => {});

  return {
    el,
    setRows(rows, date) { state.rows = rows; state.date = date; drawHero(); drawToday(); drawCenters(); },
    setHealth(hl) { state.health = { ...state.health, ...hl }; drawAlerts(); },
  };
}
