// لوحة الأداء الشهري المبسّطة للموظف: الحضور والتأخر والغياب والساعات، أرصدة الإجازات، وطلباته.
import { h, clear, todayLocal, hrs } from '../dom.js';
import { get } from '../api.js';
import { summarize, balanceCards } from '../month-summary-lib.js';
import { monthLabel } from '../monthly-report-lib.js';

const KIND = { leave: 'إجازة', exit: 'مغادرة', late: 'تأخير' };
const STATUS = { pending: ['بانتظار القرار', 'late'], approved: ['معتمد', 'present'], rejected: ['مرفوض', 'absent'], cancelled: ['ملغى', 'none'] };
const dmy = (d) => d.split('-').reverse().join('/');

const tile = (label, value, sub, tone) => h('div', { class: `ms-tile${tone ? ` ms-${tone}` : ''}` }, h('span', { class: 'ms-label' }, label), h('strong', { class: 'ms-value' }, value), sub ? h('span', { class: 'ms-sub' }, sub) : null);

/** employeeId: الموظف المعروض. own: هل هو المستخدم نفسه (تظهر طلباته). title: عنوان اللوحة. */
export function mySummary({ employeeId, own = false, title = 'أدائي هذا الشهر' }) {
  const box = h('section', { class: 'panel ms-panel', 'aria-label': title });
  const today = todayLocal();
  const ym = today.slice(0, 7);
  const first = `${ym}-01`;
  const last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0)).toISOString().slice(0, 10);
  (async () => {
    const [days, bal, reqs] = await Promise.all([
      get(`/api/employees/${employeeId}/days?from=${first}&to=${last}`).catch(() => null),
      get(`/api/balances?year=${ym.slice(0, 4)}`).catch(() => null),
      own ? get('/api/requests?scope=mine').catch(() => null) : Promise.resolve(null),
    ]);
    if (!days) { box.hidden = true; return; }
    const s = summarize(days.days, today);
    const row = bal?.employees?.find((e) => e.id === employeeId);
    const cards = balanceCards(row);
    const mine = reqs?.requests?.slice(0, 4) || [];
    const pending = reqs?.requests?.filter((r) => r.status === 'pending').length || 0;
    clear(box).append(
      h('div', { class: 'ms-head' }, h('h2', null, title), h('span', { class: 'muted' }, monthLabel(ym))),
      h('div', { class: 'ms-grid' },
        tile('حضور', `${s.present}`, `من ${s.workDays} يوم عمل`, 'ok'),
        tile('تأخر', `${s.late}`, s.late ? `${s.lateMinutes} دقيقة` : 'لا تأخر', s.late ? 'warn' : ''),
        tile('غياب', `${s.absent}`, s.absent ? 'يوم' : 'لا غياب', s.absent ? 'bad' : ''),
        tile('إجازات', `${s.leave}`, 'يوم'),
        tile('إضافي', hrs(s.overtime), 'ساعة')),
      s.pct !== null ? h('div', { class: 'ms-hours' },
        h('div', { class: 'ms-hours-top' }, h('span', null, 'الساعات المعتمدة'), h('strong', null, `${hrs(s.approved)} من ${hrs(s.required)} ساعة`)),
        h('div', { class: 'ms-bar', role: 'progressbar', 'aria-valuenow': String(s.pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('span', { class: 'ms-bar-fill', style: { width: `${s.pct}%` } }))) : null,
      cards.length ? h('div', { class: 'ms-bal' }, h('h3', null, 'رصيد الإجازات'), h('div', { class: 'ms-grid ms-grid-3' }, cards.map((b) => tile(b.label, hrs(b.remaining), `متبقٍ من ${hrs(b.total)}${b.pending ? ` · ${hrs(b.pending)} بانتظار القرار` : ''}`)))) : null,
      own ? h('div', { class: 'ms-req' },
        h('h3', null, 'طلباتي', pending ? h('span', { class: 'chip chip-late' }, `${pending} بانتظار القرار`) : null),
        mine.length ? h('ul', { class: 'plain' }, mine.map((r) => {
          const [t, g] = STATUS[r.status] || [r.status, 'none'];
          return h('li', { class: 'badge-row' }, h('strong', null, KIND[r.kind] || r.kind), h('span', { class: 'muted' }, r.kind === 'leave' ? `${dmy(r.fromDate)} ← ${dmy(r.toDate)}` : dmy(r.fromDate)), h('span', { class: `chip chip-${g}` }, t));
        })) : h('p', { class: 'muted' }, 'لا طلبات بعد.')) : null,
    );
  })();
  return box;
}
