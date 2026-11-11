// «إجراء وظيفي»: نقل / إنهاء خدمة / إعادة تفعيل — مع معاينة الأثر قبل التنفيذ، والسجل الوظيفي.
import { h, clear, dialog, field, select, toast, todayLocal } from '../dom.js';
import { get, post } from '../api.js';

export const KIND_LABEL = { transfer: 'نقل', resign: 'استقالة', terminate: 'إنهاء خدمة', contract_end: 'انتهاء عقد', separate_other: 'إنهاء لسبب آخر', reinstate: 'إعادة تفعيل' };

const li = (t) => h('li', null, t);

/** يعرض أثر الإجراء المتوقع من المعاينة (dryRun). */
function impactList(act, im, names) {
  const items = [];
  if (act === 'separate') {
    items.push(li('يُوقَف دخوله إلى النظام فوراً وتُحذف جلساته وأجهزته الموثوقة.'));
    items.push(li('يتوقف وصول أي بريد من النظام إليه (إشعارات، تذكيرات، تقارير).'));
    if (im.accounts.filter((a) => a.active).length) items.push(li(`حسابات تُوقَف: ${im.accounts.filter((a) => a.active).map((a) => a.email).join('، ')}`));
    items.push(li(im.activeBadges ? `بطاقات تُلغى فلا تُقبل على البوابة: ${im.activeBadges}` : 'لا بطاقات سارية.'));
    if (im.pendingRequests) items.push(li(`طلبات معلّقة تُلغى دون بريد: ${im.pendingRequests}`));
    if (im.pendingPlans) items.push(li(`خطط إجازات معلّقة تُلغى: ${im.pendingPlans}`));
    if (im.futureApprovedLeave) items.push(li(`تنبيه: لديه ${im.futureApprovedLeave} إجازة معتمدة مستقبلية تبقى في السجل — راجعها.`));
    if (im.reports.length) items.push(li(`مرؤوسون يُنقلون إلى البديل المختار: ${im.reports.map((r) => r.name).join('، ')}`));
    items.push(li('حضوره السابق وأيامه المحتسبة وتقاريره تبقى كما هي.'));
  } else if (act === 'transfer') {
    items.push(li(im.reports.length ? `مرؤوسوه (${im.reports.length}) يبقون تحته: ${im.reports.map((r) => r.name).join('، ')}` : 'لا مرؤوسين تحته.'));
    items.push(li('حركاته السابقة تبقى مسجلة على مركزها وقت الحدوث؛ الجديدة تُحتسب على المركز الجديد.'));
  } else {
    items.push(li('يعود فعّالاً وتُمسح نهاية خدمته.'));
    items.push(li('حسابه وبطاقاته لا تعود إلا إذا اخترت ذلك أدناه.'));
  }
  return h('ul', { class: 'plain lc-impact' }, items);
}

export async function openLifecycleDialog({ emp, centers, people, onDone }) {
  const active = emp.status === 'active';
  const acts = active ? [['transfer', 'نقل إلى مركز / مدير آخر'], ['separate', 'إنهاء خدمة (استقالة / انتهاء عقد)']] : [['reinstate', 'إعادة تفعيل']];
  const others = people.filter((p) => p.id !== emp.id && p.status === 'active');
  const mgrOptions = [['', '— بلا مدير —'], ...others.map((p) => [String(p.id), `${p.code} — ${p.name}`])];
  const centerOptions = centers.filter((c) => c.active || c.id === emp.centerId).map((c) => [String(c.id), c.name]);

  const act = select(acts, acts[0][0], { 'aria-label': 'الإجراء' });
  const kind = select([['resign', 'استقالة'], ['terminate', 'إنهاء خدمة'], ['contract_end', 'انتهاء عقد'], ['separate_other', 'سبب آخر']], 'resign');
  const center = select(centerOptions, String(emp.centerId ?? ''));
  const mgr = select(mgrOptions, emp.managerId == null ? '' : String(emp.managerId));
  const reassign = select(mgrOptions, emp.managerId == null ? '' : String(emp.managerId));
  const date = h('input', { type: 'date', value: todayLocal(), max: todayLocal() });
  const reason = h('textarea', { rows: 2, maxlength: 300, placeholder: 'السبب (يُحفظ في السجل الوظيفي وسجل التدقيق)' });
  const reAcc = h('input', { type: 'checkbox' });
  const reBadge = h('input', { type: 'checkbox' });
  const impactBox = h('div', { class: 'lc-box' });
  const err = h('div', { class: 'notice notice-err', hidden: true });
  const okBtn = h('button', { type: 'button', class: 'btn btn-primary' }, 'تنفيذ');

  const rows = {
    kind: field('نوع الإنهاء', kind),
    date: field('التاريخ الفعلي (لا يكون في المستقبل)', date),
    center: field('المركز', center),
    mgr: field('المدير المباشر', mgr),
    reassign: field('من يتولى مرؤوسيه؟', reassign, 'الافتراضي: مديره المباشر'),
    reason: field('السبب', reason),
    reAcc: h('label', { class: 'lc-check' }, reAcc, ' إعادة تفعيل حسابه (دخول وبريد)'),
    reBadge: h('label', { class: 'lc-check' }, reBadge, ' إعادة تفعيل بطاقاته'),
  };
  const bodyOf = (dryRun) => {
    const a = act.value;
    const b = { action: a, dryRun, reason: reason.value.trim() };
    if (a === 'transfer') Object.assign(b, { centerId: Number(center.value) || null, managerId: mgr.value === '' ? null : Number(mgr.value), effectiveDate: date.value });
    if (a === 'separate') Object.assign(b, { kind: kind.value, endDate: date.value, reassignTo: reassign.value === '' ? null : Number(reassign.value) });
    if (a === 'reinstate') Object.assign(b, { centerId: Number(center.value) || null, managerId: mgr.value === '' ? null : Number(mgr.value), startDate: date.value, reactivateAccount: reAcc.checked, restoreBadges: reBadge.checked });
    return b;
  };
  let seq = 0;
  async function preview() {
    const my = ++seq;
    const a = act.value;
    rows.kind.hidden = a !== 'separate';
    rows.reassign.hidden = a !== 'separate';
    rows.center.hidden = a === 'separate';
    rows.mgr.hidden = a === 'separate';
    rows.reAcc.hidden = rows.reBadge.hidden = a !== 'reinstate';
    okBtn.className = a === 'separate' ? 'btn btn-danger' : 'btn btn-primary';
    okBtn.textContent = a === 'separate' ? 'إنهاء الخدمة وإغلاق الوصول' : a === 'transfer' ? 'تنفيذ النقل' : 'إعادة التفعيل';
    err.hidden = true;
    clear(impactBox);
    try {
      const r = await post(`/api/employees/${emp.id}/lifecycle`, bodyOf(true));
      if (my !== seq) return;
      impactBox.append(h('b', null, 'ما سيحدث'), impactList(a, r.impact, null));
      okBtn.disabled = false;
    } catch (e) {
      if (my !== seq) return;
      impactBox.append(h('p', { class: 'muted' }, e.message));
      okBtn.disabled = a !== 'reinstate' ? true : false;
    }
  }
  for (const el of [act, kind, center, mgr, reassign, date, reAcc, reBadge]) el.addEventListener('change', preview);

  okBtn.onclick = async () => {
    err.hidden = true;
    okBtn.disabled = true;
    try {
      const r = await post(`/api/employees/${emp.id}/lifecycle`, bodyOf(false));
      const msg = r.action === 'separate'
        ? `تم إنهاء الخدمة: أُغلق ${r.accountsClosed} حساب و${r.badgesRevoked} بطاقة${r.reassigned ? `، وانتقل ${r.reassigned} مرؤوس` : ''}`
        : r.action === 'transfer' ? 'تم النقل وسُجّل في السجل الوظيفي' : 'أُعيد تفعيل الموظف';
      toast(msg);
      d.close();
      onDone?.();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      okBtn.disabled = false;
    }
  };

  const form = h('div', { class: 'form-grid' },
    field('الإجراء', act), rows.kind, rows.center, rows.mgr, rows.reassign, rows.date, rows.reason,
    h('div', { class: 'span-all' }, rows.reAcc, rows.reBadge), h('div', { class: 'span-all' }, impactBox), h('div', { class: 'span-all' }, err),
    h('div', { class: 'span-all dlg-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'تراجع'), okBtn));
  const d = dialog({ title: `إجراء وظيفي — ${emp.name}`, content: form, wide: true });
  reason.addEventListener('input', () => { /* السبب مطلوب عند التنفيذ فقط */ });
  preview();
}

/** لوحة «السجل الوظيفي» للموظف. */
export async function historyPanel(empId) {
  const box = h('section', { class: 'panel' }, h('h2', null, 'السجل الوظيفي'));
  try {
    const { history } = await get(`/api/employees/${empId}/history`);
    box.append(history.length
      ? h('ul', { class: 'plain lc-hist' }, history.map((x) => h('li', null,
        h('b', null, KIND_LABEL[x.kind] || x.kind), h('span', { class: 'muted' }, `  ${x.date}`),
        x.kind === 'transfer' ? h('div', null, [x.fromCenter !== x.toCenter ? `المركز: ${x.fromCenter || '—'} ← ${x.toCenter || '—'}` : '', x.fromManager !== x.toManager ? `المدير: ${x.fromManager || '—'} ← ${x.toManager || '—'}` : ''].filter(Boolean).join(' • ')) : null,
        x.reason ? h('div', { class: 'muted' }, x.reason) : null,
        h('div', { class: 'muted' }, `بواسطة ${x.by}`))))
      : h('p', { class: 'muted' }, 'لا إجراءات مسجلة.'));
  } catch {
    return null;
  }
  return box;
}
