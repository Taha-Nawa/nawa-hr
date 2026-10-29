import { h, clear, todayLocal, dayName, AR_MONTHS, hrs, dash, toast, confirmBox, field } from '../dom.js';
import { get, post } from '../api.js';
import { statusChip, groupOf } from './today.js';
import { employeeForm } from './employees.js';

const monthRange = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
};
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export default async function render({ user, params }) {
  const id = Number(params.id);
  const { employees } = await get('/api/employees');
  const emp = employees.find((e) => e.id === id);
  if (!emp) return h('div', { class: 'notice notice-err' }, 'الموظف غير موجود أو لا تملك صلاحية عرضه.');
  const canEdit = ['hr', 'admin'].includes(user.role);

  let ym = todayLocal().slice(0, 7);
  const info = h('dl', { class: 'info' });
  const monthBar = h('div', { class: 'date-nav' });
  const sums = h('div', { class: 'sums' });
  const tableBox = h('div', { class: 'table-wrap' });
  const badgeBox = h('section', { class: 'panel' });

  const manager = employees.find((e) => e.id === emp.managerId);
  const row = (k, v) => [h('dt', null, k), h('dd', null, dash(v))];
  info.append(
    ...row('الكود', emp.code), ...row('البريد', emp.email), ...row('المركز', emp.center), ...row('المسمى', emp.jobTitle),
    ...row('القسم', emp.department), ...row('المدير المباشر', manager ? manager.name : emp.managerLabel), ...row('التعاقد', emp.contractType),
    ...row('المشروع', emp.project), ...row('التعيين', emp.startDate), ...row('الحالة', emp.status === 'active' ? 'على رأس العمل' : 'متوقف'),
  );

  async function loadMonth() {
    const { from, to } = monthRange(ym);
    const [y, m] = ym.split('-').map(Number);
    clear(monthBar).append(
      h('button', { type: 'button', class: 'btn', onclick: () => { ym = shiftMonth(ym, -1); loadMonth(); } }, 'السابق'),
      h('strong', { class: 'month-name' }, `${AR_MONTHS[m - 1]} ${y}`),
      h('button', { type: 'button', class: 'btn', onclick: () => { ym = shiftMonth(ym, 1); loadMonth(); } }, 'التالي'));
    clear(tableBox).append(h('p', { class: 'loading' }, 'جارٍ التحميل…'));
    let days;
    try {
      days = (await get(`/api/employees/${id}/days?from=${from}&to=${to}`)).days;
    } catch (e) {
      clear(tableBox).append(h('div', { class: 'notice notice-err' }, e.message));
      return;
    }
    const work = days.filter((d) => d.dayType === 'عمل');
    const sum = (k) => Math.round(days.reduce((s, d) => s + (d[k] || 0), 0) * 100) / 100;
    const count = (g) => days.filter((d) => groupOf(d.status) === g).length;
    clear(sums).append(
      ...[['أيام العمل المحسوبة', work.length], ['حاضر', count('present')], ['متأخر', count('late')], ['غياب', count('absent')], ['إجازة أو مهمة', count('leave')], ['ساعات صافية', hrs(sum('netHours'))], ['ساعات عجز', hrs(sum('deficitHours'))], ['ساعات إضافية', hrs(sum('overtimeHours'))]]
        .map(([k, v]) => h('div', { class: 'sum' }, h('b', null, v), h('span', null, k))));
    clear(tableBox);
    if (!days.length) {
      tableBox.append(h('p', { class: 'empty' }, 'لا نتائج محسوبة لهذا الشهر بعد.'));
      return;
    }
    tableBox.append(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['اليوم', 'الحالة', 'حضور', 'خروج', 'عودة', 'انصراف', 'الصافي', 'المطلوب', 'تأخر', 'عجز', 'إضافي'].map((t, i) => h('th', { class: i >= 2 ? 'num' : '' }, t)))),
      h('tbody', null, days.map((d) => h('tr', { class: d.dayType === 'عمل' ? '' : 'row-off' },
        h('td', null, d.date.slice(8), ' ', h('span', { class: 'muted' }, dayName(d.date))),
        h('td', null, statusChip(d.status), d.alert ? h('div', { class: 'alert-text' }, d.alert) : null),
        h('td', { class: 'num' }, dash(d.checkIn)), h('td', { class: 'num' }, dash(d.exitFirst)), h('td', { class: 'num' }, dash(d.returnLast)), h('td', { class: 'num' }, dash(d.departure)),
        h('td', { class: 'num' }, d.netHours ? hrs(d.netHours) : '—'), h('td', { class: 'num' }, d.requiredHours ? hrs(d.requiredHours) : '—'),
        h('td', { class: 'num' }, d.lateMinutes ? `${d.lateMinutes} د` : '—'), h('td', { class: 'num' }, d.deficitHours ? hrs(d.deficitHours) : '—'), h('td', { class: 'num' }, d.overtimeHours ? hrs(d.overtimeHours) : '—'))))));
  }

  async function loadBadges() {
    if (!canEdit) return;
    const { badges } = await get(`/api/employees/${id}/badges`);
    const cardInput = h('input', { dir: 'ltr', placeholder: `${emp.code}-B`, autocomplete: 'off', 'aria-label': 'محتوى البطاقة' });
    clear(badgeBox).append(
      h('h2', null, 'البطاقات'),
      badges.length
        ? h('ul', { class: 'plain' }, badges.map((b) => h('li', { class: 'badge-row' },
          h('code', null, b.card), h('span', { class: `chip ${b.status === 'active' ? 'chip-present' : 'chip-absent'}` }, b.status === 'active' ? 'سارية' : 'ملغاة'),
          b.status === 'active' ? h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost', onclick: async () => {
            if (!(await confirmBox(`إلغاء البطاقة ${b.card}؟ ستُرفض حركاتها فوراً عند المسح.`, 'إلغاء البطاقة', true))) return;
            try {
              await post(`/api/badges/${encodeURIComponent(b.card)}/revoke`);
              toast('أُلغيت البطاقة');
              loadBadges();
            } catch (e) {
              toast(e.message, 'err');
            }
          } }, 'إلغاء') : null)))
        : h('p', { class: 'muted' }, 'لا بطاقات مسجّلة لهذا الموظف.'),
      h('form', { class: 'inline-form', onsubmit: async (e) => {
        e.preventDefault();
        try {
          await post('/api/badges', { card: cardInput.value, employeeId: id });
          toast('أُضيفت البطاقة');
          loadBadges();
        } catch (ex) {
          toast(ex.message, 'err');
        }
      } }, field('بطاقة جديدة (بدل فاقدة أو إضافية)', cardInput), h('button', { type: 'submit', class: 'btn' }, 'إضافة البطاقة')));
  }

  const page = h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', null, h('a', { href: '#/employees', class: 'back' }, 'كل الموظفين'), h('h1', null, emp.name)),
      canEdit ? h('button', { type: 'button', class: 'btn', onclick: () => employeeForm({ emp, onSaved: () => location.reload() }) }, 'تعديل البيانات') : null),
    h('section', { class: 'panel' }, info),
    badgeBox,
    h('section', { class: 'panel-plain' }, h('div', { class: 'page-head' }, h('h2', null, 'سجل الدوام'), monthBar), sums, tableBox));
  await Promise.all([loadMonth(), loadBadges()]);
  return page;
}
