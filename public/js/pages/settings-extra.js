// بطاقات إضافية في صفحة الإعدادات: قواعد الطلبات والأرصدة الافتراضية، ساعات التايم شيت لكل فترة، وطوارئ الدوام.
import { h, clear, field, select, toast, confirmBox, todayLocal } from '../dom.js';
import { get, put, post } from '../api.js';

const num = (value, attrs = {}) => h('input', { type: 'number', inputmode: 'decimal', value: value ?? '', ...attrs });
const val = (el) => (el.value === '' ? null : Number(el.value));

// ---------------------------------------------------------------- قواعد الطلبات
export async function requestRulesPanel() {
  const [{ rules, canEdit }, conf] = await Promise.all([get('/api/settings/requests'), get('/api/auth/config').catch(() => ({}))]);
  const dis = !canEdit;
  const ent = {};
  const entRow = [['annual', 'الاعتيادية (السنوية)'], ['sick', 'المرضية'], ['emergency', 'الطارئة'], ['other', 'أخرى']].map(([p, label]) => {
    ent[p] = num(rules.entitlement[p], { min: '0', max: '366', step: '0.5', disabled: dis, placeholder: 'بلا رصيد' });
    return field(label, ent[p]);
  });
  const notice = num(rules.annual.minNoticeDays, { min: '0', max: '60', step: '1', required: true, disabled: dis });
  const back = {
    emergency: num(rules.emergency.maxBackdateDays, { min: '0', max: '365', step: '1', required: true, disabled: dis }),
    sick: num(rules.sick.maxBackdateDays, { min: '0', max: '365', step: '1', required: true, disabled: dis }),
    other: num(rules.other.maxBackdateDays, { min: '0', max: '365', step: '1', required: true, disabled: dis }),
  };
  const span = num(rules.maxSpanDays, { min: '1', max: '366', step: '1', required: true, disabled: dis });
  const free = num(rules.medical.freeDays, { min: '0', max: '30', step: '1', required: true, disabled: dis });
  const exempt = h('input', { type: 'checkbox', checked: rules.permits.exempt, disabled: dis });
  const notify = h('input', { type: 'checkbox', checked: rules.notify.enabled, disabled: dis });
  const release = h('input', { type: 'checkbox', checked: rules.leave.cancelOnCheckIn, disabled: dis });
  const err = h('div', { class: 'notice notice-err', hidden: true, role: 'alert' });

  return h('form', { class: 'panel', onsubmit: async (e) => {
    e.preventDefault();
    err.hidden = true;
    const entitlement = {};
    for (const p of Object.keys(ent)) if (val(ent[p]) !== null) entitlement[p] = val(ent[p]);
    const next = {
      ...rules, // يحفظ ما لا حقل له هنا (سقف المغادرات المعطَّل)
      annual: { minNoticeDays: val(notice) },
      emergency: { maxBackdateDays: val(back.emergency) },
      sick: { maxBackdateDays: val(back.sick) },
      other: { maxBackdateDays: val(back.other) },
      maxSpanDays: val(span),
      medical: { freeDays: val(free) },
      permits: { exempt: exempt.checked },
      notify: { enabled: notify.checked },
      leave: { cancelOnCheckIn: release.checked },
      entitlement,
    };
    try {
      const r = await put('/api/settings/requests', { rules: next });
      toast(r.recomputed ? `حُفظت القواعد وأُعيد حساب ${r.recomputed} يوماً${r.partial ? ' (الأحدث فقط، شغّل «إعادة حساب الأيام» للباقي)' : ''}` : 'حُفظت قواعد الطلبات');
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  } },
  h('h2', null, 'قواعد الطلبات والأرصدة'),
  canEdit ? null : h('p', { class: 'muted' }, 'للعرض فقط. يعدّل القواعد مسؤول النظام.'),
  h('fieldset', { class: 'fieldset' }, h('legend', null, 'الرصيد السنوي الافتراضي (أيام)'),
    h('div', { class: 'form-grid' }, entRow),
    h('p', { class: 'field-hint' }, 'يسري على كل موظف لم يُحدَّد له رصيد خاص. الحقل الفارغ = بلا رصيد (يُعرض المستهلك فقط). الأرصدة الفردية أو لعدة موظفين تُحدَّد من صفحة «أرصدة الإجازات».')),
  h('fieldset', { class: 'fieldset' }, h('legend', null, 'مهل التقديم (أيام)'),
    h('div', { class: 'form-grid' },
      field('الاعتيادية: التقديم قبل الموعد بـ', notice, '0 = يجوز في اليوم نفسه'),
      field('الطارئة: التقديم بعد الحالة خلال', back.emergency),
      field('المرضية: التقديم بعد الحالة خلال', back.sick),
      field('أخرى: التقديم بعد الحالة خلال', back.other),
      field('أطول إجازة في طلب واحد', span))),
  h('fieldset', { class: 'fieldset' }, h('legend', null, 'الإجازة المرضية'),
    h('div', { class: 'form-grid' }, field('أيام تُقبل بلا ورقة طبية', free, 'ما زاد عليها تلزمها ورقة طبية تؤكّدها الموارد البشرية أو المفوَّض'))),
  h('div', { class: 'span-all' },
    h('label', { class: 'check' }, exempt, h('span', null, 'تُعفى الأذونات المعتمدة (مغادرة/تأخير) من العجز والتأخير بقدرها')),
    h('p', { class: 'field-hint' }, 'عند الإيقاف تُحسب المغادرة والتأخير كما لو لم يكن هناك إذن. يُعاد حساب الأيام المتأثرة فور الحفظ.')),
  h('div', { class: 'span-all' },
    h('label', { class: 'check' }, release, h('span', null, 'تسجيل دخول فعلي على البوابة يلغي الإجازة المعتمدة لذلك اليوم')),
    h('p', { class: 'field-hint' }, 'إن اعتُمدت إجازة ثم غيّر الموظف رأيه وسجّل دخوله، يُحذف ذلك اليوم وحده من إجازته (ويعود إلى رصيده) ويُحتسب يوم حضور مرهوناً بانصرافه؛ وإن كانت الإجازة يوماً واحداً أُلغي الطلب. يُسجَّل في سجل التدقيق ويُشعَر الموظف ومعتمِدها.')),
  h('div', { class: 'span-all' },
    h('label', { class: 'check' }, notify, h('span', null, 'إرسال إشعارات بريد عند تقديم الطلب (للمعتمِد) وعند اعتماده أو رفضه أو إلغائه (للموظف)')),
    conf.code === false
      ? h('div', { class: 'notice notice-warn' }, 'إرسال البريد غير مُفعَّل بعد، فلن يصل بريد لأحد حتى يكتمل إعداده (docs/EMAIL-SETUP.md).')
      : h('p', { class: 'field-hint' }, 'إرسال البريد مُفعَّل. الإشعار لا يعطّل الطلب إن تعذّر إرساله.')),
  err,
  canEdit ? h('div', { class: 'dlg-actions' }, h('button', { type: 'submit', class: 'btn btn-primary' }, 'حفظ قواعد الطلبات')) : null);
}

// ---------------------------------------------------------------- ساعات التايم شيت لكل فترة
export async function timesheetPanel() {
  const { config, dayHours, defaultExtraHours, canEdit } = await get('/api/settings/timesheet');
  const dis = !canEdit;
  const periods = config.periods.length
    ? config.periods.map((p) => ({ ...p }))
    : [{ from: '', attendanceHours: null, extraHours: defaultExtraHours, extraRow: 'emergency' }];
  const list = h('div', { class: 'emg-list' });
  const err = h('div', { class: 'notice notice-err', hidden: true, role: 'alert' });
  const r2 = (n) => Math.round(n * 100) / 100;

  function draw() {
    clear(list).append(...periods.map((p, i) => {
      const total = h('b', null);
      const upd = () => {
        const att = p.attendanceHours === null ? dayHours : p.attendanceHours;
        total.textContent = att === null || att === undefined ? '—' : `${r2(att)} + ${r2(p.extraHours || 0)} = ${r2(att + (p.extraHours || 0))} ساعة`;
      };
      const from = h('input', { type: 'date', value: p.from, disabled: dis || p.from === '', 'aria-label': 'تبدأ من', onchange: (e) => { p.from = e.target.value; } });
      const att = num(p.attendanceHours, { min: '0', max: '24', step: '0.25', disabled: dis, placeholder: dayHours === null ? 'الدوام الرسمي' : `${dayHours} (الدوام الرسمي)`, 'aria-label': 'ساعات الدوام الموزّعة', oninput: (e) => { p.attendanceHours = val(e.target); upd(); } });
      const extra = num(p.extraHours, { min: '0', max: '24', step: '0.25', required: true, disabled: dis, 'aria-label': 'الساعات الإضافية', oninput: (e) => { p.extraHours = val(e.target) ?? 0; upd(); } });
      const row = select([['emergency', 'طارئة (Emergency leave)'], ['other', 'أخرى (Others)']], p.extraRow, { disabled: dis, 'aria-label': 'صف الإضافي', onchange: (e) => { p.extraRow = e.target.value; } });
      upd();
      return h('div', { class: 'period-row' },
        field(p.from === '' ? 'من البداية' : 'تبدأ من', from),
        field('ساعات الدوام الموزّعة', att),
        field('ساعات إضافية', extra),
        field('تُسجَّل في', row),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'يوم التايم شيت'), total),
        canEdit && periods.length > 1 ? h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost', onclick: () => { periods.splice(i, 1); draw(); } }, 'حذف') : null);
    }));
  }
  draw();

  return h('section', { class: 'panel' },
    h('h2', null, 'ساعات التايم شيت لكل فترة'),
    h('p', { class: 'muted' }, 'يوم التايم شيت = ساعات الدوام الموزّعة على مشاريع الموظف بنسبها + ساعات إضافية تُسجَّل في صف «طارئة» أو «أخرى». الافتراضي: الدوام الرسمي'
      + `${dayHours === null ? '' : ` (${dayHours})`} + ساعة طارئة. يسري كل إعداد من تاريخ بدايته حتى بداية الفترة التالية، ويُطبَّق على التقارير فوراً دون إعادة حساب.`),
    list,
    canEdit ? h('div', { class: 'dlg-actions' },
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { periods.push({ from: todayLocal().slice(0, 8) + '01', attendanceHours: null, extraHours: defaultExtraHours, extraRow: 'emergency' }); draw(); } }, 'إضافة فترة'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
        err.hidden = true;
        try {
          const r = await put('/api/settings/timesheet', { config: { periods: periods.map((p) => ({ from: p.from || '', attendanceHours: p.attendanceHours, extraHours: p.extraHours, extraRow: p.extraRow })) } });
          periods.splice(0, periods.length, ...r.config.periods.map((p) => ({ ...p })));
          draw();
          toast('حُفظت ساعات التايم شيت');
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
        }
      } }, 'حفظ ساعات التايم شيت')) : h('p', { class: 'muted' }, 'للعرض فقط. يعدّلها مسؤول النظام.'),
    err);
}

// ---------------------------------------------------------------- طوارئ الدوام
export async function emergencyPanel({ work }) {
  const [{ emergencies, canManage }, { centers }] = await Promise.all([get('/api/emergencies'), get('/api/centers').catch(() => ({ centers: [] }))]);
  const box = h('section', { class: 'panel' });
  const today = todayLocal();
  const nowHM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hebron', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const types = work ? Object.entries(work.leaveTypes) : [];
  const countedTypes = types.filter(([, counted]) => counted).map(([n]) => n);
  const preferred = countedTypes.find((n) => n.includes('طارئ')) || countedTypes[0] || types[0]?.[0] || '';

  const date = h('input', { type: 'date', value: today, max: today, required: true });
  const scope = select([['', 'كل المراكز'], ...centers.map((c) => [String(c.id), c.name])], '');
  const dismiss = h('input', { type: 'checkbox', checked: true });
  const time = h('input', { type: 'time', value: work && nowHM > work.start && nowHM < work.end ? nowHM : work?.start || '', required: true });
  const full = h('input', { type: 'checkbox' });
  const kind = select(types.map(([n, counted]) => [n, `${n}${counted ? '' : ' (لا تُحتسب كدوام)'}`]), preferred, { disabled: true });
  const note = h('input', { maxlength: '300', placeholder: 'مثال: حريق في المبنى المجاور' });
  const err = h('div', { class: 'notice notice-err', hidden: true, role: 'alert' });
  dismiss.onchange = () => { time.disabled = !dismiss.checked; };
  full.onchange = () => { kind.disabled = !full.checked; };

  function drawList() {
    const items = emergencies.map((e) => {
      const what = [e.dismissTime ? `إخلاء فوري عند ${e.dismissTime}` : 'إغلاق اليوم', e.leaveType ? `اليوم كاملاً: ${e.leaveType}` : 'بلا احتساب كامل'].join(' · ');
      return h('div', { class: `emg-item${e.status === 'active' ? '' : ' off'}` },
        h('div', { class: 'emg-what' }, h('b', null, `${e.date} — ${e.center || 'كل المراكز'}`), h('span', { class: 'muted' }, what), e.note ? h('div', { class: 'muted small' }, e.note) : null),
        h('span', { class: `chip ${e.status === 'active' ? 'chip-late' : 'chip-off'}` }, e.status === 'active' ? 'نشط' : 'ملغى'),
        canManage && e.status === 'active' ? h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost', onclick: async () => {
          if (!(await confirmBox('يُلغى الإعلان ويعود حساب ذلك اليوم لموظفي النطاق كما كان قبله.', 'إلغاء الإعلان', true))) return;
          try {
            await post(`/api/emergencies/${e.id}/cancel`);
            toast('أُلغي الإعلان وأُعيد الحساب');
            reload();
          } catch (ex) {
            toast(ex.message, 'err');
          }
        } }, 'إلغاء') : null);
    });
    return h('div', { class: 'emg-list' }, items.length ? items : h('p', { class: 'muted' }, 'لا إعلانات طوارئ مسجّلة.'));
  }

  const form = h('form', { class: 'form-grid', onsubmit: async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (!dismiss.checked && !full.checked) {
      err.textContent = 'اختر إخلاءً فورياً أو احتساب اليوم كاملاً (أو الاثنين).';
      err.hidden = false;
      return;
    }
    const where = scope.value ? scope.selectedOptions[0].textContent : 'كل المراكز';
    const lines = [`${date.value} — ${where}`, dismiss.checked ? `إخلاء فوري عند ${time.value}: ينتهي الدوام الفعلي عندها فلا عجز ولا انصراف مبكر لمن كان حاضراً.` : null, full.checked ? `احتساب اليوم كاملاً بنوع «${kind.value}» لكل موظف فعّال في النطاق (لا يُستبدل ما عليه إجازة معتمدة).` : null].filter(Boolean);
    if (!(await confirmBox(`${lines[0]}: ${lines.slice(1).join(' ')}`, 'إعلان الطارئ'))) return;
    try {
      const r = await post('/api/emergencies', { date: date.value, centerId: scope.value || null, dismissTime: dismiss.checked ? time.value : null, leaveType: full.checked ? kind.value : null, note: note.value });
      toast(`أُعلن الطارئ وأُعيد حساب ${r.employees} موظفاً`);
      note.value = '';
      reload();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  } },
  field('اليوم', date), field('المركز', scope, 'اختر مركزاً أو كل المراكز'),
  h('div', { class: 'span-all' }, h('label', { class: 'check' }, dismiss, h('span', null, 'إخلاء فوري عند الساعة')), ' ', time),
  h('div', { class: 'span-all' }, h('label', { class: 'check' }, full, h('span', null, 'احتساب اليوم كاملاً بنوع')), ' ', kind,
    h('p', { class: 'field-hint' }, 'يُسجَّل لكل موظف في النطاق، كإجازة طارئة أو «أخرى» أو أي نوع تختاره من أنواع الإجازات. لا يمسّ إجازة معتمدة ولا تصحيحاً يدوياً على اليوم.')),
  h('div', { class: 'span-all' }, field('ملاحظة', note)),
  h('div', { class: 'span-all' }, err),
  h('div', { class: 'dlg-actions span-all' }, h('button', { type: 'submit', class: 'btn btn-primary' }, 'إعلان الطارئ')));

  async function reload() {
    const r = await get('/api/emergencies');
    emergencies.splice(0, emergencies.length, ...r.emergencies);
    draw();
  }
  function draw() {
    clear(box).append(
      h('h2', null, 'طوارئ أثناء الدوام'),
      h('p', { class: 'muted' }, 'إذا وقع طارئ في أحد المراكز والدوام قائم: أعلن إخلاءً فورياً عند ساعة محددة (ينتهي الدوام الفعلي عندها ولا يُحتسب على من كان حاضراً عجز ولا انصراف مبكر)، و/أو احتسب اليوم كاملاً بنوع إجازة تختاره. الإلغاء يعيد الحساب كما كان.'),
      ...[work ? (canManage ? form : null) : h('div', { class: 'notice notice-warn' }, 'أدخل قواعد الدوام أولاً.'),
        canManage ? null : h('p', { class: 'muted' }, 'للعرض فقط. يعلن الطوارئ المسؤول والموارد البشرية.'),
        drawList()].filter(Boolean)); // append الأصلية تكتب null نصاً
  }
  draw();
  return box;
}
