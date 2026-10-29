import { h, clear, field, toast, AR_DAYS, todayLocal, addDays } from '../dom.js';
import { get, put, post } from '../api.js';

export default async function render({ user }) {
  const canWorkEdit = user.role === 'admin';
  const canHolidayEdit = ['hr', 'admin'].includes(user.role);
  const canRecompute = ['hr', 'admin'].includes(user.role);
  const { work } = await get('/api/settings');

  const page = h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'الإعدادات والعطل'), h('p', { class: 'sub' }, 'هذه القيم هي مصدر كل حساب في النظام، لا توجد أرقام مكتوبة في الكود.'))),
  );

  // ------------------------------------------------------------ قواعد الدوام
  const cur = work || { start: '08:00', end: '15:00', toleranceMinutes: 10, weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'], leaveTypes: {}, monthlyExitCapHours: undefined };
  const weekdays = [...cur.weekdays];
  const leaveTypes = Object.entries(cur.leaveTypes).map(([name, counted]) => ({ name, counted }));

  const startIn = h('input', { type: 'time', value: cur.start, required: true, disabled: !canWorkEdit });
  const endIn = h('input', { type: 'time', value: cur.end, required: true, disabled: !canWorkEdit });
  const tolIn = h('input', { type: 'number', min: '0', max: '240', step: '1', value: cur.toleranceMinutes, required: true, disabled: !canWorkEdit });
  const capIn = h('input', { type: 'number', min: '0', step: '0.5', value: cur.monthlyExitCapHours ?? '', placeholder: 'بلا سقف', disabled: !canWorkEdit });
  const daysBox = h('div', { class: 'weekdays', role: 'group', 'aria-label': 'أيام الأسبوع' });
  const leaveBox = h('div', { class: 'leave-list' });
  const workErr = h('div', { class: 'notice notice-err', hidden: true, role: 'alert' });

  function drawDays() {
    clear(daysBox).append(...weekdays.map((v, i) => h('button', {
      type: 'button', class: `day-toggle${v === 'عمل' ? ' work' : ' off'}`, disabled: !canWorkEdit, 'aria-pressed': String(v === 'عمل'),
      onclick: () => { weekdays[i] = v === 'عمل' ? 'عطلة أسبوعية' : 'عمل'; drawDays(); },
    }, h('b', null, AR_DAYS[i]), h('span', null, v === 'عمل' ? 'دوام' : 'عطلة'))));
  }

  function drawLeaves() {
    clear(leaveBox);
    leaveTypes.forEach((t, i) => leaveBox.append(h('div', { class: 'leave-row' },
      h('input', { value: t.name, 'aria-label': 'اسم النوع', disabled: !canWorkEdit, oninput: (e) => { t.name = e.target.value; } }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: t.counted, disabled: !canWorkEdit, onchange: (e) => { t.counted = e.target.checked; } }), 'تُحتسب كدوام كامل'),
      canWorkEdit ? h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost', onclick: () => { leaveTypes.splice(i, 1); drawLeaves(); } }, 'حذف') : null)));
    if (!leaveTypes.length) leaveBox.append(h('p', { class: 'muted' }, 'لا أنواع إجازات.'));
  }
  drawDays();
  drawLeaves();

  const workForm = h('form', { class: 'panel', onsubmit: async (e) => {
    e.preventDefault();
    workErr.hidden = true;
    const names = leaveTypes.map((t) => t.name.trim());
    if (names.some((n) => !n) || new Set(names).size !== names.length) {
      workErr.textContent = 'أسماء أنواع الإجازات يجب أن تكون غير فارغة وغير مكررة.';
      workErr.hidden = false;
      return;
    }
    const body = {
      start: startIn.value, end: endIn.value, toleranceMinutes: Number(tolIn.value), weekdays,
      leaveTypes: Object.fromEntries(leaveTypes.map((t) => [t.name.trim(), !!t.counted])),
      ...(capIn.value === '' ? {} : { monthlyExitCapHours: Number(capIn.value) }),
    };
    try {
      await put('/api/settings/work', body);
      toast(work ? 'حُفظت القواعد. أعد حساب الأيام السابقة إن لزم.' : 'حُفظت القواعد. صارت حركات البوابة تُحسب.');
      if (!work) setTimeout(() => location.reload(), 900);
    } catch (ex) {
      workErr.textContent = ex.message;
      workErr.hidden = false;
    }
  } },
  h('h2', null, 'قواعد الدوام'),
  work ? null : h('div', { class: 'notice notice-warn' }, 'لم تُدخل القواعد بعد. حتى تُحفظ، تُسجَّل حركات البوابة ولا تُحسب.'),
  canWorkEdit ? null : h('p', { class: 'muted' }, 'للعرض فقط. يعدّل القواعد مسؤول النظام.'),
  h('div', { class: 'form-grid' },
    field('بداية الدوام', startIn), field('نهاية الدوام', endIn),
    field('سماحية التأخير (دقائق)', tolIn, 'يُحسب الموظف «متأخراً» إذا تجاوز هذا الحد بعد بداية الدوام'),
    field('سقف ساعات المغادرة الشهرية', capIn, 'اتركه فارغاً بلا سقف')),
  h('fieldset', { class: 'fieldset' }, h('legend', null, 'أيام الأسبوع'), daysBox, h('p', { class: 'field-hint' }, 'اضغط اليوم لتبديله بين دوام وعطلة أسبوعية.')),
  h('fieldset', { class: 'fieldset' }, h('legend', null, 'أنواع الإجازات'), leaveBox,
    canWorkEdit ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { leaveTypes.push({ name: '', counted: true }); drawLeaves(); } }, 'نوع جديد') : null),
  workErr,
  canWorkEdit ? h('div', { class: 'dlg-actions' }, h('button', { type: 'submit', class: 'btn btn-primary' }, 'حفظ قواعد الدوام')) : null);
  page.append(workForm);

  // ------------------------------------------------------------ العطل الرسمية
  let year = new Date().getFullYear();
  let holidays = [];
  const holBox = h('section', { class: 'panel' });
  const loadHolidays = async () => {
    holidays = (await get(`/api/holidays?year=${year}`)).holidays.map((x) => ({ ...x }));
    drawHolidays();
  };
  function drawHolidays() {
    clear(holBox).append(
      h('div', { class: 'page-head' },
        h('h2', null, 'العطل الرسمية'),
        h('div', { class: 'date-nav' },
          h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { year--; loadHolidays(); } }, 'السنة السابقة'),
          h('strong', null, year),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { year++; loadHolidays(); } }, 'السنة التالية'))),
      holidays.length ? null : h('p', { class: 'muted' }, 'لا عطل مسجّلة لهذه السنة.'),
      ...holidays.map((x, i) => h('div', { class: 'holiday-row' },
        h('input', { type: 'date', value: x.date, min: `${year}-01-01`, max: `${year}-12-31`, 'aria-label': 'التاريخ', disabled: !canHolidayEdit, onchange: (e) => { x.date = e.target.value; } }),
        h('input', { value: x.name || '', placeholder: 'المناسبة', 'aria-label': 'المناسبة', disabled: !canHolidayEdit, oninput: (e) => { x.name = e.target.value; } }),
        canHolidayEdit ? h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost', onclick: () => { holidays.splice(i, 1); drawHolidays(); } }, 'حذف') : null)),
      canHolidayEdit ? h('div', { class: 'dlg-actions' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { holidays.push({ date: `${year}-01-01`, name: '' }); drawHolidays(); } }, 'إضافة عطلة'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
          try {
            await put('/api/holidays', { year, holidays: holidays.map((x) => ({ date: x.date, name: x.name || null })) });
            toast(`حُفظت عطل ${year}`);
          } catch (e) {
            toast(e.message, 'err');
          }
        } }, `حفظ عطل ${year}`)) : null);
  }
  page.append(holBox);
  await loadHolidays();

  // ------------------------------------------------------------ إعادة الحساب
  if (canRecompute) {
    const today = todayLocal();
    const from = h('input', { type: 'date', value: addDays(today, -30) });
    const to = h('input', { type: 'date', value: today });
    const out = h('div', { class: 'recompute-out', 'aria-live': 'polite' });
    const btn = h('button', { type: 'button', class: 'btn', onclick: async () => {
      btn.disabled = true;
      clear(out);
      let offset = 0;
      let done = 0;
      try {
        for (;;) {
          const r = await post('/api/recompute', { from: from.value, to: to.value, offset });
          done += r.processed;
          out.textContent = r.total ? `تمت معالجة ${done} من ${r.total}` : 'لا أيام ضمن هذا المدى.';
          if (r.nextOffset === null) break;
          offset = r.nextOffset;
        }
        out.textContent = `اكتملت إعادة الحساب (${done} يوم-موظف).`;
        toast('اكتملت إعادة الحساب');
      } catch (e) {
        out.textContent = '';
        toast(e.message, 'err');
      } finally {
        btn.disabled = false;
      }
    } }, 'ابدأ إعادة الحساب');
    page.append(h('section', { class: 'panel' },
      h('h2', null, 'إعادة حساب الأيام'),
      h('p', { class: 'muted' }, 'بعد تغيير قواعد الدوام أو العطل، أعد حساب الأيام السابقة لتتوافق نتائجها مع القواعد الجديدة. لا تُحسب أيام لم تأتِ بعد.'),
      h('div', { class: 'form-grid' }, field('من', from), field('إلى', to)),
      h('div', { class: 'dlg-actions' }, btn), out));
  }
  return page;
}
