import { h, clear, icon, todayLocal, dayName, AR_MONTHS, hrs, dash, toast, confirmBox, field, dialog } from '../dom.js';
import { get, post, put, patch, del } from '../api.js';
import { allocationCheck, MAX_CONCURRENT } from '../allocations-lib.js';
import { statusChip, groupOf } from './today.js';
import { employeeForm } from './employees.js';
import { openLifecycleDialog, historyPanel } from './lifecycle.js';
import { openManualDialog } from './manual.js';
import { mySummary } from './my-summary.js';
import { fmt12 } from '../time12.js';
import { initials, serviceSpan, activeAllocations, projectSummary, dmy } from '../employee-lib.js';

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

/** الصورة الشخصية من رابطها إن وُجد (تُحمَّل من مصدرها ولا نخزّنها)؛ ما دامت لم تُحمَّل أو تعذّر تحميلها تبقى حروف الاسم. */
function avatarEl(emp) {
  const box = h('div', { class: 'ec-avatar', 'aria-hidden': 'true' }, initials(emp.name));
  if (/^https:\/\//.test(emp.photo || '')) {
    const img = h('img', { alt: '', referrerpolicy: 'no-referrer', decoding: 'async' });
    img.addEventListener('load', () => { box.classList.add('has-photo'); box.replaceChildren(img); });
    img.src = emp.photo;
  }
  return box;
}

export default async function render({ user, params }) {
  const id = Number(params.id);
  // سجل الشهر الحالي يُطلب مع قائمة الموظفين معاً بدل أن ينتظرها (رحلة ذهاب وإياب أقل)
  const ym0 = todayLocal().slice(0, 7);
  const r0 = monthRange(ym0);
  let firstDays = get(`/api/employees/${id}/days?from=${r0.from}&to=${r0.to}`);
  firstDays.catch(() => {});
  const { employees } = await get('/api/employees');
  const emp = employees.find((e) => e.id === id);
  if (!emp) return h('div', { class: 'notice notice-err' }, 'الموظف غير موجود أو لا تملك صلاحية عرضه.');
  const canEdit = ['hr', 'admin'].includes(user.role);

  let ym = todayLocal().slice(0, 7);
  const today = todayLocal();
  const monthBar = h('div', { class: 'date-nav' });
  const sums = h('div', { class: 'sums' });
  const tableBox = h('div', { class: 'table-wrap' });
  const badgeBox = h('section', { class: 'panel' });

  // ---- بطاقة التعريف المجمّعة (تصميم أ): بطاقة رئيسية ثم ثلاث بطاقات بحسب موضوعها ثم الإنجليزية
  const manager = employees.find((e) => e.id === emp.managerId);
  const kv = (label, value, cls = '') => h('div', { class: `ec-f ${cls}`.trim() }, h('dt', null, label), h('dd', null, value === null || value === undefined || value === '' ? '—' : value));
  const group = (title, ico, tone, ...fields) => h('section', { class: 'ec-card', 'aria-label': title },
    h('h2', null, h('span', { class: `ec-ico ec-ico-${tone}`, 'aria-hidden': 'true' }, icon(ico)), title),
    h('dl', { class: 'ec-fields' }, fields));
  const allocField = kv('توزيع الدوام على المشاريع', '', 'ec-stack');
  allocField.hidden = true;
  // «المشروع الأساسي» وشارته يُشتقّان من التوزيع الساري اليوم متى وُجد (يُحدَّثان بعد تحميله)، وإلا يبقى النص المكتوب في بيانات الموظف
  const projKv = kv('المشروع الأساسي', emp.project);
  const projChip = h('span', { class: 'ec-chip ec-chip-project ec-d', hidden: !emp.project }, emp.project || '');
  let allocs = null;
  const active = emp.status === 'active';
  const span = serviceSpan(emp.startDate, emp.endDate, today);

  const hero = h('section', { class: 'ec-hero' },
    avatarEl(emp),
    h('div', { class: 'ec-id' },
      h('a', { href: '#/employees', class: 'back' }, 'كل الموظفين'),
      h('h1', null, emp.name),
      h('p', { class: 'ec-sub' }, [emp.jobTitle, emp.department].filter(Boolean).join(' · ')),
      h('div', { class: 'ec-chips' },
        h('span', { class: 'ec-chip ec-chip-code', dir: 'ltr' }, emp.code),
        h('span', { class: `ec-chip ${active ? 'ec-chip-on' : 'ec-chip-off'}` }, active ? icon('check') : null, active ? 'على رأس العمل' : 'متوقف'),
        emp.contractType ? h('span', { class: 'ec-chip ec-chip-contract ec-m' }, emp.contractType) : null,
        emp.center ? h('span', { class: 'ec-chip ec-chip-center ec-d' }, icon('door'), emp.center) : null,
        projChip)),
    h('div', { class: 'ec-actions' },
      h('a', { href: `#/reports?employee=${emp.id}`, class: 'btn' }, 'التايم شيت'),
      canEdit ? h('button', { type: 'button', class: 'btn btn-primary', onclick: () => employeeForm({ emp, allocations: allocs, onSaved: () => location.reload() }) }, 'تعديل البيانات') : null,
      canEdit ? h('a', { href: `#/employees/${emp.id}/card`, class: 'btn' }, icon('qr'), 'البطاقة') : null,
      canEdit ? h('button', { type: 'button', class: 'btn', onclick: async () => {
        try {
          const o = await get('/api/org');
          openLifecycleDialog({ emp, centers: o.centers, people: o.employees, onDone: () => location.reload() });
        } catch (e) { toast(e.message, 'err'); }
      } }, 'إجراء وظيفي') : null));

  const cards = h('div', { class: 'ec-grid' },
    group('الوظيفة', 'briefcase', 'red',
      kv('المسمى الوظيفي', emp.jobTitle), kv('القسم / الإدارة', emp.department), kv('المدير المباشر', manager ? manager.name : emp.managerLabel),
      kv('نوع التعاقد', emp.contractType ? h('span', { class: 'ec-pill' }, emp.contractType) : '')),
    group('المركز والمشروع', 'door', 'olive',
      kv('المركز', emp.center ? h('span', { class: 'ec-center' }, emp.center) : ''), projKv, allocField),
    group('التواصل والتعيين', 'mail', 'blue',
      kv('البريد المؤسسي', emp.email ? h('span', { class: 'ec-mail', dir: 'ltr' }, emp.email) : '', 'ec-stack'),
      kv('تاريخ التعيين', dmy(emp.startDate)),
      emp.endDate ? kv('تاريخ انتهاء الخدمة', dmy(emp.endDate)) : null,
      kv('مدة الخدمة', span)));

  // بالإنجليزية (للتايم شيت المرسل للممولين)
  const enRow = (k, v) => h('div', null, h('dt', null, k), h('dd', null, dash(v)));
  const hasEn = [emp.nameEn, emp.jobTitleEn, emp.departmentEn, emp.centerEn, emp.managerLabelEn].some(Boolean);
  const enBox = hasEn ? h('section', { class: 'ec-en', 'aria-label': 'البيانات بالإنجليزية' },
    h('h2', null, 'بالإنجليزية (للتايم شيت المرسل للممولين)'),
    h('dl', { dir: 'ltr', lang: 'en' },
      h('div', { class: 'ec-en-name' }, h('dt', null, 'Name'), h('dd', null, dash(emp.nameEn))),
      enRow('Job title', emp.jobTitleEn), enRow('Department', emp.departmentEn), enRow('Center', emp.centerEn), enRow('Line manager', emp.managerLabelEn))) : null;

  // شريط توزيع الدوام الساري اليوم داخل بطاقة «المركز والمشروع» (يُملأ بعد تحميل التوزيعات)
  function drawAllocSummary(allocations) {
    allocs = allocations;
    const ps = projectSummary(allocations, today);
    if (ps.count) {
      projChip.hidden = false;
      projChip.textContent = ps.short;
      projChip.title = ps.full;
      projKv.querySelector('dd').textContent = ps.short;
    }
    const segs = activeAllocations(allocations, today);
    allocField.hidden = !segs.length;
    const dd = allocField.querySelector('dd');
    clear(dd);
    if (!segs.length) return;
    dd.append(
      h('div', { class: 'ec-bar', role: 'img', 'aria-label': segs.map((x) => `${x.funder} ${x.percent}%`).join('، ') },
        segs.map((x, i) => h('span', { class: `ec-seg ec-c${i % 6}`, style: { flexGrow: String(x.percent) } }))),
      h('ul', { class: 'ec-legend' }, segs.map((x, i) => h('li', null, h('span', { class: `ec-dot ec-c${i % 6}`, 'aria-hidden': 'true' }), h('span', { class: 'ec-fund', dir: 'auto' }, x.funder), h('b', null, `${x.percent}%`)))));
  }
  const allocBox = h('section', { class: 'panel' });
  let work = null;
  const editDay = async (date) => {
    work ||= (await get('/api/settings').catch(() => null))?.work || null;
    if (!work) return toast('أدخل إعدادات الدوام أولاً', 'err');
    openManualDialog({ employees: [{ id: emp.id, name: emp.name }], date, work, onDone: loadMonth });
  };

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
      const pre = firstDays && ym === ym0 ? firstDays : null;
      firstDays = null;
      days = (await (pre || get(`/api/employees/${id}/days?from=${from}&to=${to}`))).days;
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
      h('thead', null, h('tr', null, ['اليوم', 'الحالة', 'حضور', 'خروج', 'عودة', 'انصراف', 'الصافي', 'المطلوب', 'تأخر', 'عجز', 'إضافي', ...(canEdit ? [''] : [])].map((t, i) => h('th', { class: i >= 2 && i <= 10 ? 'num' : '' }, t)))),
      h('tbody', null, days.map((d) => h('tr', { class: d.dayType === 'عمل' ? '' : 'row-off' },
        h('td', null, d.date.slice(8), ' ', h('span', { class: 'muted' }, dayName(d.date))),
        h('td', null, statusChip(d.status), d.alert ? h('div', { class: 'alert-text' }, d.alert) : null),
        h('td', { class: 'num' }, dash(fmt12(d.checkIn))), h('td', { class: 'num' }, dash(fmt12(d.exitFirst))), h('td', { class: 'num' }, dash(fmt12(d.returnLast))), h('td', { class: 'num' }, dash(fmt12(d.departure))),
        h('td', { class: 'num' }, d.netHours ? hrs(d.netHours) : '—'), h('td', { class: 'num' }, d.requiredHours ? hrs(d.requiredHours) : '—'),
        h('td', { class: 'num' }, d.lateMinutes ? `${d.lateMinutes} د` : '—'), h('td', { class: 'num' }, d.deficitHours ? hrs(d.deficitHours) : '—'), h('td', { class: 'num' }, d.overtimeHours ? hrs(d.overtimeHours) : '—'),
        canEdit ? h('td', { class: 'row-actions' }, d.date <= todayLocal() ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => editDay(d.date) }, 'تعديل') : null) : null)))));
  }

  async function loadAllocations() {
    const { allocations } = await get(`/api/employees/${id}/projects`);
    drawAllocSummary(allocations);
    clear(allocBox).append(h('div', { class: 'page-head' },
      h('h2', null, 'توزيع الموظف على المشاريع والممولين'),
      canEdit ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => allocationDialog(allocations) }, allocations.length ? 'تعديل التوزيع' : 'إضافة توزيع') : null));
    if (!allocations.length) {
      allocBox.append(h('p', { class: 'muted' }, 'لا توزيع مسجّل (يظهر «مشروع غير محدد» في التايم شيت حتى يُحدَّد).'));
      return;
    }
    allocBox.append(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['الممول / المشروع', 'النسبة', 'من', 'إلى'].map((t, i) => h('th', { class: i ? 'num' : '' }, t)))),
      h('tbody', null, allocations.map((a) => h('tr', null,
        h('td', { dir: 'ltr', lang: 'en' }, a.funder), h('td', { class: 'num' }, `${Math.round(a.share * 10000) / 100}%`), h('td', { class: 'num' }, a.from), h('td', { class: 'num' }, a.to))))));
  }

  // تحرير التوزيع: من 1 إلى MAX_CONCURRENT مشاريع متزامنة، ومجموع النسب 100% في كل فترة (فحص فوري، والخادم يراجع)
  function allocationDialog(current) {
    const year = todayLocal().slice(0, 4);
    const rows = current.length
      ? current.map((a) => ({ funder: a.funder, percent: Math.round(a.share * 10000) / 100, from: a.from, to: a.to }))
      : [{ funder: '', percent: 100, from: `${year}-01-01`, to: `${year}-12-31` }];
    const list = h('div', { class: 'bal-assign' });
    const status = h('div', { class: 'alloc-seg', 'aria-live': 'polite' });
    const err = h('div', { class: 'notice notice-err', hidden: true, role: 'alert' });
    const save = h('button', { type: 'submit', class: 'btn btn-primary' }, 'حفظ التوزيع');

    function check() {
      const c = allocationCheck(rows);
      clear(status).append(...c.segments.map((s) => h('span', { class: `chip ${s.ok ? 'chip-present' : 'chip-absent'}` }, `${s.from} → ${s.to}: ${s.total}%${s.reason ? ` — ${s.reason}` : ' ✓'}`)),
        ...c.problems.map((p) => h('span', { class: 'chip chip-absent' }, p)));
      save.disabled = !c.valid;
    }
    function drawRows() {
      clear(list).append(...rows.map((r, i) => h('div', { class: 'alloc-row' },
        h('input', { dir: 'ltr', lang: 'en', value: r.funder, placeholder: 'اسم المشروع / الممول', maxlength: '300', 'aria-label': 'المشروع', oninput: (e) => { r.funder = e.target.value; check(); } }),
        h('input', { type: 'number', min: '0.01', max: '100', step: '0.01', inputmode: 'decimal', value: r.percent, 'aria-label': 'النسبة %', title: 'النسبة %', oninput: (e) => { r.percent = Number(e.target.value); check(); } }),
        h('input', { type: 'date', value: r.from, 'aria-label': 'من', onchange: (e) => { r.from = e.target.value; check(); } }),
        h('input', { type: 'date', value: r.to, 'aria-label': 'إلى', onchange: (e) => { r.to = e.target.value; check(); } }),
        rows.length > 1 ? h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost', onclick: () => { rows.splice(i, 1); drawRows(); } }, 'حذف') : h('span'))));
      check();
    }
    drawRows();
    const dlg = dialog({
      title: `توزيع ${emp.name} على المشاريع`,
      wide: true,
      content: h('form', { class: 'form-grid', onsubmit: async (ev) => {
        ev.preventDefault();
        err.hidden = true;
        try {
          await put(`/api/employees/${id}/projects`, { allocations: rows.map((r) => ({ funder: r.funder.trim(), share: Math.round(r.percent * 100) / 10000, from: r.from, to: r.to })) });
          toast('حُفظ التوزيع');
          dlg.close();
          loadAllocations();
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
        }
      } },
      h('p', { class: 'field-hint span-all' }, `وزّع الدوام على مشروعين أو أكثر (حتى ${MAX_CONCURRENT}) بنسب مجموعها 100% في كل فترة. مثال: مشروع أ 50% ومشروع ب 50%، أو ثلاثة أو أربعة مشاريع. يُقسَّم الدوام على التايم شيت بهذه النسب. لتغيير النسب في منتصف السنة أنهِ الصف الحالي في تاريخ وأضف صفوفاً من اليوم التالي.`),
      h('div', { class: 'span-all' }, list),
      h('div', { class: 'span-all' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => {
        const last = rows[rows.length - 1];
        rows.push({ funder: '', percent: 0, from: last?.from || `${year}-01-01`, to: last?.to || `${year}-12-31` });
        drawRows();
      } }, 'إضافة مشروع')),
      h('div', { class: 'span-all' }, status),
      h('div', { class: 'span-all' }, err),
      h('div', { class: 'dlg-actions span-all' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'إلغاء'), save)),
    });
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

  const excBox = h('section', { class: 'panel' });
  const COMP = { none: 'بلا تعويض', paid: 'أجر إضافي', leave: 'يوم إجازة بديل' };
  async function loadExceptions() {
    if (!canEdit) return;
    const { exceptions } = await get(`/api/work-exceptions?employeeId=${id}`);
    const date = h('input', { type: 'date', required: true, max: today, 'aria-label': 'تاريخ اليوم' });
    const comp = h('select', { 'aria-label': 'التعويض' }, Object.entries(COMP).map(([v, t]) => h('option', { value: v }, t)));
    const counted = h('input', { type: 'checkbox', checked: true });
    const note = h('input', { maxlength: '300', placeholder: 'السبب (اختياري)', 'aria-label': 'السبب' });
    clear(excBox).append(
      h('h2', null, 'الدوام الاستثنائي (يوم عطلة)'),
      h('p', { class: 'muted' }, 'إذا داوم الموظف في عطلة أسبوعية أو رسمية بتكليف: سجّل اليوم هنا فتُحتسب ساعاته المعتمدة في التايم شيت على مشاريعه ويزول تظليل العمود. ألغِ التسجيل لتعود الساعات إضافياً فقط.'),
      exceptions.length
        ? h('ul', { class: 'plain' }, exceptions.map((x) => h('li', { class: 'badge-row' },
          h('strong', null, dmy(x.date)),
          h('span', { class: `chip ${x.counted ? 'chip-present' : 'chip-absent'}` }, x.counted ? 'محتسب' : 'تسجيل فقط'),
          h('span', { class: 'muted' }, `${hrs(x.counted ? x.approvedHours : x.overtimeHours)} ساعة · ${COMP[x.comp]}${x.note ? ` · ${x.note}` : ''}`),
          h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost', onclick: async () => {
            if (!(await confirmBox('إلغاء تسجيل هذا اليوم الاستثنائي؟', 'إلغاء التسجيل', true))) return;
            try {
              await post('/api/work-exceptions/cancel', { employeeId: id, date: x.date });
              toast('أُلغي التسجيل');
              loadExceptions();
              loadMonth();
            } catch (e) {
              toast(e.message, 'err');
            }
          } }, 'إلغاء'))))
        : h('p', { class: 'muted' }, 'لا أيام استثنائية مسجّلة لهذا الموظف.'),
      h('form', { class: 'inline-form', onsubmit: async (e) => {
        e.preventDefault();
        try {
          await post('/api/work-exceptions', { employeeId: id, date: date.value, counted: counted.checked, comp: comp.value, note: note.value });
          toast('سُجّل اليوم الاستثنائي');
          loadExceptions();
          loadMonth();
        } catch (ex) {
          toast(ex.message, 'err');
        }
      } }, field('اليوم (عطلة)', date), field('التعويض', comp), field('السبب', note),
      h('label', { class: 'check' }, counted, ' يُحتسب في التايم شيت'),
      h('button', { type: 'submit', class: 'btn' }, 'تسجيل')));
  }

  // إجازة الوضع وساعة الأمومة: للموظفات فقط؛ تحدّدها الموارد البشرية والمسؤول
  const matBox = h('section', { class: 'panel' });
  const POS = { start: 'بداية الدوام (تحضر متأخرة ساعة)', end: 'نهاية الدوام (تنصرف مبكرة ساعة)' };
  async function loadMaternity() {
    if (!canEdit) return;
    const { gender, records } = await get(`/api/employees/${id}/maternity`);
    const sel = h('select', { 'aria-label': 'الجنس', onchange: async (e) => {
      try {
        await put(`/api/employees/${id}/gender`, { gender: e.target.value || null });
        toast('حُفظ');
      } catch (ex) {
        toast(ex.message, 'err');
      }
      loadMaternity();
    } }, h('option', { value: '' }, 'غير محدّد'), h('option', { value: 'F', selected: gender === 'F' }, 'أنثى'), h('option', { value: 'M', selected: gender === 'M' }, 'ذكر'));
    const head = [h('h2', null, 'إجازة الوضع وساعة الأمومة'), h('div', { class: 'inline-form' }, field('الجنس', sel))];
    if (gender !== 'F') {
      clear(matBox).append(...head, h('p', { class: 'muted' }, 'تُتاح إجازة الوضع وساعة الأمومة للموظفات فقط؛ حدّد الجنس «أنثى» لتفعيلها.'));
      return;
    }
    const delivery = h('input', { type: 'date', required: true, 'aria-label': 'تاريخ الولادة' });
    const days = h('input', { type: 'number', min: '1', max: '365', value: '70', inputmode: 'numeric', 'aria-label': 'عدد الأيام' });
    const note = h('input', { maxlength: '200', placeholder: 'ملاحظة (اختياري)', 'aria-label': 'ملاحظة' });
    const posSel = (cur) => h('select', { 'aria-label': 'موضع ساعة الأمومة' }, h('option', { value: '' }, 'لم تُحدَّد بعد'), Object.entries(POS).map(([v, t]) => h('option', { value: v, selected: cur === v }, t)));
    clear(matBox).append(
      ...head,
      h('p', { class: 'muted' }, 'إجازة الوضع تُحسب بالأيام التقويمية من يوم الولادة (70 يوماً عادةً) وتظهر في صف Others بالتايم شيت. بعد العودة تسري ساعة الأمومة سنة تقويمية كاملة: يُقصَّر الدوام ساعة في بدايته أو نهايته وتظهر الساعة في Others.'),
      records.length
        ? h('ul', { class: 'plain' }, records.map((r) => {
          const ps = posSel(r.hourPos);
          return h('li', { class: 'badge-row' },
            h('strong', null, `ولادة ${dmy(r.deliveryDate)}`),
            h('span', { class: 'muted' }, `${r.leaveDays} يوماً · حتى ${dmy(r.leaveEnd)} · العودة ${dmy(r.returnDate)}${r.hourPos ? ` · الساعة حتى ${dmy(r.hourEnd)}` : ''}`),
            ps,
            h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => {
              try {
                await patch(`/api/maternity/${r.id}`, { hourPos: ps.value || null });
                toast('حُفظ موضع الساعة');
                loadMaternity();
                loadMonth();
              } catch (e) {
                toast(e.message, 'err');
              }
            } }, 'حفظ الساعة'),
            h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost', onclick: async () => {
              if (!(await confirmBox('حذف سجل إجازة الوضع؟ تُزال أيام الإجازة وساعة الأمومة ويُعاد حساب الأيام.', 'حذف', true))) return;
              try {
                await del(`/api/maternity/${r.id}`);
                toast('حُذف السجل');
                loadMaternity();
                loadMonth();
              } catch (e) {
                toast(e.message, 'err');
              }
            } }, 'حذف'));
        }))
        : h('p', { class: 'muted' }, 'لا سجلات لهذه الموظفة.'),
      h('form', { class: 'inline-form', onsubmit: async (e) => {
        e.preventDefault();
        try {
          await post(`/api/employees/${id}/maternity`, { deliveryDate: delivery.value, leaveDays: Number(days.value), note: note.value });
          toast('سُجّلت إجازة الوضع');
          loadMaternity();
          loadMonth();
        } catch (ex) {
          toast(ex.message, 'err');
        }
      } }, field('تاريخ الولادة', delivery), field('عدد الأيام التقويمية', days), field('ملاحظة', note), h('button', { type: 'submit', class: 'btn' }, 'تسجيل إجازة الوضع')));
  }

  // الإجازات الخاصة: حج / وفاة قريب من الدرجة الأولى / علاج طويل (للموارد البشرية والمسؤول)
  const spBox = h('section', { class: 'panel' });
  const RELS = ['أب', 'أم', 'ابن', 'ابنة', 'زوج', 'زوجة'];
  async function loadSpecial() {
    if (!canEdit) return;
    const { records, kinds } = await get(`/api/employees/${id}/special-leaves`);
    const kind = h('select', { 'aria-label': 'نوع الإجازة' }, kinds.map((k) => h('option', { value: k.kind }, k.label)));
    const from = h('input', { type: 'date', required: true, 'aria-label': 'تاريخ البداية' });
    const days = h('input', { type: 'number', min: '1', max: '365', inputmode: 'numeric', 'aria-label': 'عدد الأيام' });
    const rel = h('select', { 'aria-label': 'صلة القرابة' }, RELS.map((r) => h('option', { value: r }, r)));
    const relField = field('صلة القرابة (الدرجة الأولى)', rel);
    const note = h('input', { maxlength: '200', placeholder: 'ملاحظة / رقم القرار (اختياري)', 'aria-label': 'ملاحظة' });
    const sync = () => {
      const k = kinds.find((x) => x.kind === kind.value);
      relField.hidden = kind.value !== 'bereavement';
      days.value = k?.defaultDays ?? '';
      days.placeholder = k?.defaultDays ? '' : 'حدّد العدد';
    };
    kind.onchange = sync;
    sync();
    clear(spBox).append(
      h('h2', null, 'إجازات خاصة (حج / وفاة / علاج طويل)'),
      h('p', { class: 'muted' }, 'أيام تقويمية من تاريخ البداية، لا تُخصم من أي رصيد، وتظهر كاملة في صف Others بالتايم شيت. الوفاة لقريب من الدرجة الأولى، وعدد أيام الحج يحدَّد عند التسجيل، والعلاج الطويل بقرار الموارد البشرية والإدارة.'),
      records.length
        ? h('ul', { class: 'plain' }, records.map((r) => h('li', { class: 'badge-row' },
          h('strong', null, r.label),
          h('span', { class: 'muted' }, `${dmy(r.fromDate)} ← ${dmy(r.toDate)} · ${r.days} يوماً${r.relation ? ` · ${r.relation}` : ''}${r.note ? ` · ${r.note}` : ''}`),
          h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost', onclick: async () => {
            if (!(await confirmBox('حذف هذه الإجازة؟ تُزال أيامها ويُعاد حساب الأيام.', 'حذف', true))) return;
            try {
              await del(`/api/special-leaves/${r.id}`);
              toast('حُذفت الإجازة');
              loadSpecial();
              loadMonth();
            } catch (e) {
              toast(e.message, 'err');
            }
          } }, 'حذف'))))
        : h('p', { class: 'muted' }, 'لا إجازات خاصة مسجّلة.'),
      h('form', { class: 'inline-form', onsubmit: async (e) => {
        e.preventDefault();
        try {
          await post(`/api/employees/${id}/special-leaves`, { kind: kind.value, fromDate: from.value, days: Number(days.value), relation: rel.value, note: note.value });
          toast('سُجّلت الإجازة');
          loadSpecial();
          loadMonth();
        } catch (ex) {
          toast(ex.message, 'err');
        }
      } }, field('النوع', kind), field('من تاريخ', from), field('عدد الأيام التقويمية', days), relField, field('ملاحظة', note), h('button', { type: 'submit', class: 'btn' }, 'تسجيل الإجازة')));
  }

  // نائب المدير المعتمد: تعيّنه الموارد البشرية بتاريخ من/إلى فيعتمد طلبات وخطط فريق هذا المدير خلال المدة
  const depBox = h('section', { class: 'panel' });
  async function loadDeputies() {
    if (!canEdit) return;
    const { deputies } = await get(`/api/employees/${id}/deputies`);
    const who = h('select', { 'aria-label': 'النائب', required: true }, h('option', { value: '' }, 'اختر النائب'), employees.filter((x) => x.id !== id && x.status === 'active').map((x) => h('option', { value: x.id }, x.name)));
    const from = h('input', { type: 'date', required: true, 'aria-label': 'من تاريخ' });
    const to = h('input', { type: 'date', required: true, 'aria-label': 'إلى تاريخ' });
    const note = h('input', { maxlength: '200', placeholder: 'السبب (اختياري)', 'aria-label': 'السبب' });
    clear(depBox).append(
      h('h2', null, 'نائب المدير المعتمد'),
      h('p', { class: 'muted' }, 'عند غياب المدير يعتمد النائب طلبات وخطط إجازات فريقه خلال المدة المحدّدة فقط، ويصله إشعار الطلبات الجديدة. يجب أن يكون للنائب حساب فعّال في النظام.'),
      deputies.length
        ? h('ul', { class: 'plain' }, deputies.map((d) => h('li', { class: 'badge-row' },
          h('strong', null, d.deputyName),
          h('span', { class: 'muted' }, `${dmy(d.fromDate)} ← ${dmy(d.toDate)}${d.note ? ` · ${d.note}` : ''}`),
          h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost', onclick: async () => {
            if (!(await confirmBox('إلغاء هذا التعيين؟ تنتهي صلاحية النائب فوراً.', 'إلغاء التعيين', true))) return;
            try {
              await del(`/api/deputies/${d.id}`);
              toast('أُلغي التعيين');
              loadDeputies();
            } catch (e) {
              toast(e.message, 'err');
            }
          } }, 'إلغاء'))))
        : h('p', { class: 'muted' }, 'لا نائب معيَّن لهذا المدير.'),
      h('form', { class: 'inline-form', onsubmit: async (e) => {
        e.preventDefault();
        try {
          await post(`/api/employees/${id}/deputies`, { deputyId: Number(who.value), fromDate: from.value, toDate: to.value, note: note.value });
          toast('عُيّن النائب');
          loadDeputies();
        } catch (ex) {
          toast(ex.message, 'err');
        }
      } }, field('النائب', who), field('من تاريخ', from), field('إلى تاريخ', to), field('السبب', note), h('button', { type: 'submit', class: 'btn' }, 'تعيين النائب')));
  }

  const histBox = canEdit ? await historyPanel(emp.id) : null;
  const page = h('div', { class: 'page' },
    hero,
    mySummary({ employeeId: id, own: user.employeeId === id, title: user.employeeId === id ? 'أدائي هذا الشهر' : `أداء ${emp.name} هذا الشهر` }),
    cards,
    enBox,
    allocBox,
    canEdit ? badgeBox : null,
    canEdit ? excBox : null,
    canEdit ? matBox : null,
    canEdit ? spBox : null,
    canEdit && employees.some((x) => x.managerId === id) ? depBox : null,
    histBox,
    h('section', { class: 'panel-plain' }, h('div', { class: 'page-head' }, h('h2', null, 'سجل الدوام'), monthBar), sums, tableBox));
  await Promise.all([loadMonth(), loadBadges(), loadExceptions().catch(() => {}), loadMaternity().catch(() => {}), loadSpecial().catch(() => {}), loadDeputies().catch(() => {}), loadAllocations().catch(() => {})]);
  return page;
}
