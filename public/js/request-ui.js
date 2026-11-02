// نافذة تقديم الطلب ونافذة تفاصيله/اعتماده. تُستعمل من صفحة الطلبات ومن أي مكان يحتاج «طلباً جديداً».
import { h, clear, dialog, confirmBox, field, select, toast, addDays, dash, icon } from './dom.js';
import { get, post } from './api.js';
import { KIND, purposeLabels, purposeText, statusChip, fmtDate, fmtPeriod, fmtLength, calcLines } from './requests-lib.js';

const PURPOSE_ORDER = ['annual', 'emergency', 'sick', 'other'];

/** تلميح قاعدة التوقيت تحت اختيار الغرض (القاعدة الحقيقية يفرضها الخادم). */
function ruleHint(kind, purpose, meta, behalf) {
  if (behalf) return 'إدخال إداري: لا تُطبَّق مهلة التقديم.';
  const r = meta.rules;
  if (purpose === 'annual') {
    return kind === 'leave'
      ? `تُقدَّم قبل موعدها ${r.annual.minNoticeDays === 1 ? 'بيوم' : `بـ ${r.annual.minNoticeDays} أيام`} على الأقل.`
      : 'يُقدَّم قبل وقته.';
  }
  const back = r[purpose].maxBackdateDays;
  return `يمكن تقديمه في يوم الحالة أو خلال ${back} ${back === 1 ? 'يوم' : 'أيام'} بعدها.`;
}

/**
 * kind: leave | exit | late.  meta: ناتج /api/requests/meta.  user: المستخدم الحالي.
 * بعد الحفظ يُستدعى onSaved().
 */
export async function openRequestForm({ kind, meta, user, onSaved }) {
  const isLeave = kind === 'leave';
  const labels = purposeLabels(kind);
  let employees = [];
  if (meta.canBehalf) {
    try {
      employees = (await get('/api/employees')).employees.filter((e) => e.status === 'active');
    } catch { /* نكمل بدون قائمة */ }
  }
  const linked = meta.linked;

  // ---- الموظف المعني (للمسؤولين فقط)
  const empSel = meta.canBehalf
    ? select([...(linked ? [['', 'نفسي']] : [['', '— اختر الموظف —']]), ...employees.filter((e) => e.id !== user.employeeId).map((e) => [e.id, `${e.code} — ${e.name}`])], '', { 'aria-label': 'الموظف المعني' })
    : null;
  const behalf = () => !!empSel && empSel.value !== '';

  // ---- الغرض
  const radios = PURPOSE_ORDER.map((p) => h('input', { type: 'radio', name: `purpose-${kind}`, value: p, checked: p === (isLeave ? 'annual' : 'annual'), onchange: sync }));
  const purposeRow = h('div', { class: 'choice-row', role: 'radiogroup', 'aria-label': 'الغرض' },
    PURPOSE_ORDER.map((p, i) => h('label', { class: 'choice' }, radios[i], h('span', null, labels[p]))));
  const purposeVal = () => radios.find((r) => r.checked).value;
  const otherIn = h('input', { type: 'text', maxlength: '80', placeholder: 'حدّد الغرض', 'aria-label': 'حدّد الغرض', oninput: refresh });
  const otherBox = h('div', { hidden: true }, field('حدّد', otherIn));
  const hint = h('p', { class: 'field-hint' });
  // الإجازة المرضية: بلا ورقة طبية تُقبل يوماً واحداً فقط (الخادم يفرض ذلك ويؤكّده المعتمِد)
  const medIn = h('input', { type: 'checkbox', onchange: refresh });
  const free = meta.rules.medical?.freeDays ?? 1;
  const medBox = h('div', { class: 'fieldset', hidden: true },
    h('label', { class: 'check' }, medIn, h('span', null, 'توجد ورقة طبية تثبت الإجازة')),
    h('p', { class: 'field-hint' }, `بلا ورقة طبية تُقبل الإجازة المرضية ${free === 1 ? 'يوماً واحداً' : `${free} أيام`} فقط. للمدة الأطول تُسلَّم الورقة للموارد البشرية وتؤكّدها هي قبل الاعتماد.`));

  const reason = h('textarea', { rows: '2', maxlength: '300', placeholder: isLeave ? 'مثال: زيارة عائلية' : 'مثال: مراجعة طبيب', oninput: refresh });
  const dFrom = h('input', { type: 'date', required: true, onchange: refresh });
  const dTo = h('input', { type: 'date', required: true, onchange: () => refresh() });
  const tFrom = h('input', { type: 'time', required: true, value: kind === 'late' ? meta.work?.start || '' : '', onchange: refresh });
  const tTo = h('input', { type: 'time', required: true, onchange: refresh });

  // ---- اعتماد مباشر
  const approveNow = h('input', { type: 'checkbox', onchange: sync });
  const leaveSel = isLeave ? select([['', 'حسب الغرض (تلقائي)'], ...meta.leaveTypes.map((t) => [t, t])], '') : null;
  const approveBox = h('div', { class: 'fieldset', hidden: true },
    h('label', { class: 'check' }, approveNow, h('span', null, 'اعتمد الطلب مباشرة (منح)')),
    h('p', { class: 'field-hint' }, 'يُسجَّل الطلب ويُعتمد في خطوة واحدة، ثم تطبع النموذج للتوقيع.'),
    isLeave ? h('div', { hidden: true }, field('نوع الإجازة في السجل', leaveSel)) : null);

  const calcBox = h('div', { class: 'calc-slot', 'aria-live': 'polite' });
  const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'تقديم الطلب');

  const lead = h('div', { class: 'form-grid' },
    empSel ? h('div', { class: 'span-all' }, field('لمن هذا الطلب؟', empSel, 'اختر موظفاً لتُدخل الطلب نيابة عنه أو لتمنحه الإجازة.')) : null,
    h('div', { class: 'span-all' }, h('span', { class: 'field-label' }, isLeave ? 'نوع الإجازة' : 'الغرض'), purposeRow, hint),
    h('div', { class: 'span-all' }, otherBox),
    isLeave ? h('div', { class: 'span-all' }, medBox) : null,
    h('div', { class: 'span-all' }, field(isLeave ? 'الغرض من الإجازة' : `الغرض من ${kind === 'exit' ? 'المغادرة' : 'التأخير'}`, reason)),
    isLeave
      ? [field('تاريخ بدء الإجازة', dFrom), field('تاريخ انتهاء الإجازة', dTo)]
      : [field('التاريخ', dFrom), h('span'), field('من الساعة', tFrom), field('إلى الساعة', tTo)]);

  let seq = 0;
  let timer = 0;
  let valid = false;

  function sync() {
    const p = purposeVal();
    otherBox.hidden = p !== 'other';
    medBox.hidden = !(isLeave && p === 'sick');
    hint.textContent = ruleHint(kind, p, meta, behalf());
    const canApprove = meta.canDecide && behalf();
    approveBox.hidden = !canApprove;
    if (!canApprove) approveNow.checked = false;
    if (leaveSel) leaveSel.parentElement.parentElement.hidden = !approveNow.checked;
    saveBtn.textContent = approveNow.checked ? 'إدخال واعتماد' : behalf() ? 'إدخال الطلب' : 'تقديم الطلب';
    // حدود التقويم تساعد المستخدم؛ الحكم للخادم
    const today = meta.today;
    let min = '';
    if (!behalf()) {
      if (p === 'annual') min = isLeave ? addDays(today, meta.rules.annual.minNoticeDays) : today;
      else min = addDays(today, -meta.rules[p].maxBackdateDays);
    }
    dFrom.min = min;
    dTo.min = dFrom.value || min;
    refresh();
  }

  function payload() {
    const p = {
      kind, purpose: purposeVal(), purposeOther: otherIn.value, reason: reason.value, fromDate: dFrom.value,
      ...(isLeave ? { toDate: dTo.value || dFrom.value } : { fromTime: tFrom.value, toTime: tTo.value }),
    };
    if (isLeave && p.purpose === 'sick') p.medicalProof = medIn.checked;
    if (behalf()) p.employeeId = Number(empSel.value);
    return p;
  }

  function refresh() {
    if (isLeave && dFrom.value && (!dTo.value || dTo.value < dFrom.value)) dTo.value = dFrom.value;
    if (isLeave) dTo.min = dFrom.value || dFrom.min;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const mine = ++seq;
      const p = payload();
      const ready = p.fromDate && (isLeave ? p.toDate : p.fromTime && p.toTime) && (!meta.canBehalf || linked || behalf());
      if (!ready) {
        valid = false;
        saveBtn.disabled = false;
        clear(calcBox);
        return;
      }
      try {
        const { calc } = await post('/api/requests/preview', p);
        if (mine !== seq) return;
        valid = true;
        saveBtn.disabled = false;
        clear(calcBox).append(h('div', { class: 'calc' },
          calcLines(calc).map(([k, v]) => h('div', { class: 'calc-row' }, h('span', null, k), h('b', null, v))),
          calc.warnings.map((w) => h('div', { class: 'notice notice-warn' }, w))));
      } catch (e) {
        if (mine !== seq) return;
        valid = false;
        clear(calcBox).append(h('div', { class: 'notice notice-err', role: 'alert' }, e.message));
      }
    }, 250);
  }

  const form = h('form', { class: 'request-form', onsubmit: async (e) => {
    e.preventDefault();
    if (!meta.canBehalf && !linked) return toast('حسابك غير مرتبط بموظف، راجع الموارد البشرية', 'err');
    saveBtn.disabled = true;
    try {
      const body = payload();
      if (approveNow.checked && !approveBox.hidden) {
        body.approve = true;
        if (leaveSel?.value) body.leaveType = leaveSel.value;
      }
      const { id } = await post('/api/requests', body);
      toast(body.approve ? 'أُدخل الطلب واعتُمد' : 'تم تقديم الطلب');
      d.close();
      onSaved?.(id, !!body.approve);
    } catch (ex) {
      toast(ex.message, 'err');
      saveBtn.disabled = false;
    }
  } },
  lead,
  approveBox,
  calcBox,
  h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'تراجع'), saveBtn));

  const d = dialog({ title: KIND[kind].label, content: form, wide: true });
  if (empSel) empSel.addEventListener('change', sync);
  sync();
  if (meta.canBehalf && !linked) empSel.focus();
}

/** تفاصيل الطلب: للقراءة، وللمعتمِد: الاحتساب والتعديل والاعتماد/الرفض، وللجميع الطباعة. */
export async function openRequestDetail({ id, meta, onChanged }) {
  const body = h('div', { class: 'req-detail' }, h('p', { class: 'loading' }, 'جارٍ التحميل…'));
  const d = dialog({ title: 'تفاصيل الطلب', content: body, wide: true });

  async function render() {
    let data;
    try {
      data = await get(`/api/requests/${id}`);
    } catch (e) {
      clear(body).append(h('div', { class: 'notice notice-err' }, e.message));
      return;
    }
    const r = data.request;
    const changed = () => { onChanged?.(); window.dispatchEvent(new CustomEvent('requests:changed')); };
    const row = (k, v, wide) => h('div', { class: wide ? 'kv wide' : 'kv' }, h('dt', null, k), h('dd', null, v ?? '—'));
    const info = h('dl', { class: 'req-info' },
      row('الموظف', h('a', { href: `#/employees/${r.employeeId}`, onclick: () => d.close() }, `${r.employeeName} (${r.employeeCode})`)),
      row('المسمى', dash(r.jobTitle)), row('مكان العمل', dash(r.center)), row('المدير المباشر', dash(r.managerName)),
      row('نوع الطلب', KIND[r.kind].label), row('الغرض', purposeText(r)),
      row(r.kind === 'leave' ? 'الفترة' : 'الوقت', fmtPeriod(r)), row('المدة', fmtLength(r)),
      row('تاريخ التقديم', fmtDate(r.requestDate)),
      row('أدخله', r.createdByName || r.createdBy),
      r.needsMedical || r.medicalBy ? row('الورقة الطبية', r.medicalBy ? `مؤكَّدة من ${r.medicalBy}` : r.medicalProof ? 'أفاد مقدّم الطلب بوجودها (لم تُؤكَّد بعد)' : 'غير مُقرّ بها') : null,
      r.reason ? row('التفاصيل', r.reason, true) : null);
    const head = h('div', { class: 'req-head' }, h('span', { class: 'req-kind' }, KIND[r.kind].label, ' #', r.id), statusChip(r.status));
    const parts = [head, info];

    // من يعتمد هذا الطلب؟ (يُعرض ما دام معلّقاً كي يعرف الجميع أين وصل)
    if (r.status === 'pending' && r.needsMedical) {
      parts.push(h('div', { class: 'notice notice-warn' },
        r.medicalProof ? 'إجازة مرضية لأكثر من يوم: أفاد مقدّم الطلب بوجود ورقة طبية. تؤكّدها الموارد البشرية أو مديرة الشؤون الإدارية والمالية عند الاعتماد، ولا يكفي اعتماد المدير المباشر.'
          : 'إجازة مرضية لأكثر من يوم بلا إقرار بورقة طبية. يقرّرها الموارد البشرية أو مديرة الشؤون الإدارية والمالية.'));
    } else if (r.status === 'pending') {
      const hr = 'الموارد البشرية أو المدير العام';
      const who = !r.managerId ? `لا مدير مباشر مسجّل لهذا الموظف، فيعتمد طلبه ${hr}.`
        : !data.managerCanDecide ? `المدير المباشر (${r.managerName}) بلا حساب دخول بدور «مدير مباشر»، فيعتمد الطلب ${hr}.`
          : `ينتظر اعتماد المدير المباشر (${r.managerName})، ويستطيع ${hr} اعتماده أيضاً.`;
      parts.push(h('div', { class: `notice${r.managerId && data.managerCanDecide ? '' : ' notice-warn'}` }, who));
    }

    if (r.original) {
      const o = r.original;
      parts.push(h('div', { class: 'notice notice-warn' }, `عدّل المعتمِد ما طلبه الموظف. المطلوب أصلاً: ${fmtPeriod({ kind: r.kind, ...o })}.`));
    }
    if (r.status !== 'pending') {
      parts.push(h('div', { class: 'notice' },
        r.status === 'approved' ? `اعتُمد بواسطة ${r.decidedByName || r.decidedBy}` : r.status === 'rejected' ? `رُفض بواسطة ${r.decidedByName || r.decidedBy}` : `أُلغي بواسطة ${r.decidedByName || r.decidedBy}`,
        r.decisionNote ? h('div', null, `الملاحظة: ${r.decisionNote}`) : null,
        r.leaveType ? h('div', { class: 'small muted' }, `نوع الإجازة في السجل: ${r.leaveType}`) : null));
    }

    // ---- الاحتساب
    const calcHost = h('div', { class: 'calc-slot', 'aria-live': 'polite' });
    const showCalc = (c) => clear(calcHost).append(h('div', { class: 'calc' },
      h('strong', { class: 'calc-title' }, 'الاحتساب'),
      calcLines(c).map(([k, v]) => h('div', { class: 'calc-row' }, h('span', null, k), h('b', null, v))),
      (c.overlaps || []).map((o) => h('div', { class: 'notice notice-warn' }, `تقاطع مع طلب #${o.id} (${o.status === 'approved' ? 'معتمد' : 'معلّق'})`)),
      (c.warnings || []).filter((w) => !/يتقاطع/.test(w)).map((w) => h('div', { class: 'notice notice-warn' }, w))));
    showCalc(data.calc);
    parts.push(calcHost);

    // ---- القرار
    if (r.can.decide) {
      const isLeave = r.kind === 'leave';
      const dFrom = h('input', { type: 'date', value: r.fromDate });
      const dTo = h('input', { type: 'date', value: r.toDate, min: r.fromDate });
      const tFrom = h('input', { type: 'time', value: r.fromTime || '' });
      const tTo = h('input', { type: 'time', value: r.toTime || '' });
      const leaveSel = isLeave ? select(data.leaveTypes.map((t) => [t, t]), data.suggestedLeaveType || '') : null;
      if (leaveSel && !data.suggestedLeaveType) leaveSel.prepend(h('option', { value: '', selected: true }, '— اختر نوع الإجازة —'));
      const note = h('textarea', { rows: '2', maxlength: '300', placeholder: 'ملاحظة (اختيارية عند الاعتماد، مطلوبة عند الرفض)' });
      // الإجازة المرضية لأكثر من يوم: لا اعتماد قبل أن يؤكّد المعتمِد استلام الورقة الطبية (يتحقق الخادم من ذلك)
      const medOk = r.needsMedical ? h('input', { type: 'checkbox' }) : null;
      let t = 0;
      const recalc = () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          try {
            const { calc } = await post('/api/requests/preview', isLeave
              ? { kind: r.kind, purpose: r.purpose, purposeOther: r.purposeOther, reason: r.reason || 'x', fromDate: dFrom.value, toDate: dTo.value || dFrom.value, employeeId: r.employeeId, exceptId: r.id, medicalProof: true }
              : { kind: r.kind, purpose: r.purpose, purposeOther: r.purposeOther, reason: r.reason || 'x', fromDate: r.fromDate, fromTime: tFrom.value, toTime: tTo.value, employeeId: r.employeeId, exceptId: r.id });
            showCalc(calc);
          } catch (e) {
            clear(calcHost).append(h('div', { class: 'notice notice-err', role: 'alert' }, e.message));
          }
        }, 250);
      };
      dFrom.addEventListener('change', () => { if (dTo.value < dFrom.value) dTo.value = dFrom.value; dTo.min = dFrom.value; recalc(); });
      dTo.addEventListener('change', recalc);
      tFrom.addEventListener('change', recalc);
      tTo.addEventListener('change', recalc);

      const busy = (b, on) => { b.disabled = on; };
      const approveBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
        busy(approveBtn, true);
        try {
          await post(`/api/requests/${r.id}/approve`, {
            note: note.value,
            ...(medOk ? { medicalConfirmed: medOk.checked } : {}),
            ...(isLeave ? { fromDate: dFrom.value, toDate: dTo.value || dFrom.value, leaveType: leaveSel.value } : { fromTime: tFrom.value, toTime: tTo.value }),
          });
          toast('اعتُمد الطلب، يمكنك الآن طباعته للتوقيع');
          changed();
          await render();
        } catch (e) {
          toast(e.message, 'err');
          busy(approveBtn, false);
        }
      } }, h('span', null, 'اعتماد'));
      const rejectBtn = h('button', { type: 'button', class: 'btn btn-danger-ghost', onclick: async () => {
        if (note.value.trim().length < 2) {
          note.focus();
          return toast('اكتب سبب الرفض في خانة الملاحظة', 'err');
        }
        busy(rejectBtn, true);
        try {
          await post(`/api/requests/${r.id}/reject`, { note: note.value });
          toast('رُفض الطلب');
          changed();
          await render();
        } catch (e) {
          toast(e.message, 'err');
          busy(rejectBtn, false);
        }
      } }, 'رفض');
      parts.push(h('section', { class: 'decide' },
        h('h3', null, 'قرار المسؤول'),
        h('div', { class: 'form-grid' },
          isLeave ? [field('تاريخ بدء الإجازة', dFrom), field('تاريخ انتهاء الإجازة', dTo), h('div', { class: 'span-all' }, field('نوع الإجازة في السجل (يحدد أثرها في الحضور والتايم شيت)', leaveSel))]
            : [field('من الساعة', tFrom), field('إلى الساعة', tTo)],
          medOk ? h('div', { class: 'span-all' }, h('label', { class: 'check' }, medOk, h('span', null, 'استلمتُ الورقة الطبية وهي تثبت مدة الإجازة المرضية'))) : null,
          h('div', { class: 'span-all' }, field('ملاحظة', note))),
        h('p', { class: 'field-hint' }, 'يمكنك تعديل التواريخ أو الأوقات قبل الاعتماد؛ يُحفظ ما طلبه الموظف للمراجعة.'),
        h('div', { class: 'dlg-actions' }, rejectBtn, approveBtn)));
    }

    // ---- أزرار أسفل
    const actions = [h('a', { class: 'btn', href: `#/requests/${r.id}/print`, onclick: () => d.close() }, icon('printer'), r.status === 'approved' ? 'طباعة النموذج للتوقيع' : 'طباعة النموذج')];
    if (r.can.cancel) {
      const revoke = r.status === 'approved';
      actions.unshift(h('button', { type: 'button', class: 'btn btn-danger-ghost', onclick: async () => {
        const ok = await confirmBox(revoke ? 'إلغاء الاعتماد؟ ستُزال أيام هذه الإجازة من سجل الحضور ويُعاد حساب أيامها.' : 'إلغاء هذا الطلب؟', revoke ? 'إلغاء الاعتماد' : 'إلغاء الطلب', true);
        if (!ok) return;
        try {
          await post(`/api/requests/${r.id}/cancel`, {});
          toast(revoke ? 'أُلغي الاعتماد' : 'أُلغي الطلب');
          changed();
          await render();
        } catch (e) {
          toast(e.message, 'err');
        }
      } }, revoke ? 'إلغاء الاعتماد' : 'إلغاء الطلب'));
    }
    parts.push(h('div', { class: 'dlg-actions req-actions' }, actions));
    clear(body).append(...parts);
  }

  await render();
  return d;
}
