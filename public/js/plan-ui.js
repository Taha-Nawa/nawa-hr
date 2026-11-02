// نافذة تفاصيل الخطة وقرار المسؤول يوماً يوماً. تُستعمل من صفحة «الإجازات المتوقعة».
import { h, clear, dialog, confirmBox, field, select, toast, icon } from './dom.js';
import { get, post } from './api.js';
import { PLAN_STATUS, PLAN_PURPOSE, fmtLong, fmtShort, runsText, fmtN } from './plans-lib.js';

const DAY_CHIP = {
  planned: ['بانتظار القرار', 'chip-late'],
  approved: ['معتمد', 'chip-present'],
  rejected: ['مرفوض', 'chip-absent'],
  withdrawn: ['مسحوب', 'chip-off'],
};
const stamp = (s) => (s ? s.slice(0, 16).replace('T', ' ') : '');

/**
 * يفتح الخطة ويعرض ما يحق للمستخدم عمله فيها: القرار (للمعتمِد)، الإرسال/السحب/الإلغاء (لصاحبها).
 * onChanged: يُستدعى بعد أي تغيير ليحدّث المستدعي قوائمه.
 */
export async function openPlanDetail({ id, onChanged }) {
  let data;
  try {
    data = await get(`/api/plans/${id}`);
  } catch (e) {
    toast(e.message, 'err');
    return;
  }
  const body = h('div', { class: 'plan-detail' });
  const dlg = dialog({ title: `الإجازات المتوقعة #${id}`, content: body, wide: true });
  draw(data);

  async function act(path, payload, doneMsg, close = true) {
    try {
      await post(`/api/plans/${id}/${path}`, payload);
    } catch (e) {
      toast(e.message, 'err');
      return false;
    }
    toast(doneMsg);
    window.dispatchEvent(new CustomEvent('requests:changed'));
    await onChanged?.();
    if (close) dlg.close();
    else draw(await get(`/api/plans/${id}`));
    return true;
  }

  function draw(d) {
    const p = d.plan;
    const live = d.days.filter((x) => x.status !== 'withdrawn');
    const planned = live.filter((x) => x.status === 'planned').map((x) => x.date);
    const isOff = (date) => !!d.offDays?.[date];
    const decision = Object.fromEntries(planned.map((date) => [date, d.offDays?.[date] ? 'rejected' : 'approved']));
    const [stLabel, stCls] = PLAN_STATUS[p.status] || [p.status, ''];

    const info = h('dl', { class: 'info' },
      h('div', null, h('dt', null, 'الموظف'), h('dd', null, p.employeeName, h('span', { class: 'muted' }, ` · ${p.employeeCode}${p.jobTitle ? ` · ${p.jobTitle}` : ''}`))),
      h('div', null, h('dt', null, 'النوع'), h('dd', null, PLAN_PURPOSE[p.purpose] || p.purpose, p.note ? h('span', { class: 'muted' }, ` — ${p.note}`) : null)),
      h('div', null, h('dt', null, 'الحالة'), h('dd', null, h('span', { class: `chip ${stCls}` }, stLabel))),
      p.submittedAt ? h('div', null, h('dt', null, 'أُرسلت'), h('dd', null, stamp(p.submittedAt))) : null,
      p.decidedAt ? h('div', null, h('dt', null, p.status === 'cancelled' ? 'أُلغيت' : 'القرار'), h('dd', null, `${p.decidedByName || p.decidedBy || ''} — ${stamp(p.decidedAt)}`)) : null,
      p.decisionNote ? h('div', { class: 'span-all' }, h('dt', null, 'ملاحظة المسؤول'), h('dd', null, p.decisionNote)) : null);

    // الرصيد: المتبقي الآن، وما تخصمه هذه الخطة إن اعتُمدت كلها
    const balances = d.balance
      .map((b) => {
        const it = b.items.find((i) => i.purpose === p.purpose);
        if (!it) return h('div', { class: 'sum' }, h('b', null, `${b.year}`), h('span', null, 'لا رصيد محدد لهذا النوع'));
        const after = it.remaining - it.pending - (p.status === 'submitted' || p.status === 'draft' ? b.planned : 0);
        return h('div', { class: `sum${after < 0 ? ' sum-warn' : ''}` },
          h('b', null, it.remaining),
          h('span', null, `رصيد ${b.year}: متبقٍّ من ${fmtN(it.total)}${it.pending ? `، معلّق ${fmtN(it.pending)}` : ''}${b.planned && after !== it.remaining - it.pending ? ` — هذه الخطة ${fmtN(b.planned)}، يبقى ${fmtN(after)}` : ''}`));
      });

    const canDecide = p.can.decide && planned.length > 0;
    const radios = {};
    const rows = d.days.map((x) => {
      const [dl, dc] = DAY_CHIP[x.status] || [x.status, ''];
      const off = d.teamOff?.[x.date];
      const control = canDecide && x.status === 'planned'
        ? h('div', { class: 'dec', role: 'radiogroup', 'aria-label': `قرار ${fmtLong(x.date)}` },
          ['approved', 'rejected'].map((v) => {
            const input = h('input', { type: 'radio', name: `dec-${x.date}`, value: v, checked: decision[x.date] === v, onchange: () => { decision[x.date] = v; sync(); } });
            (radios[x.date] ||= {})[v] = input;
            return h('label', { class: `dec-${v === 'approved' ? 'ok' : 'no'}` }, input, v === 'approved' ? 'اعتماد' : 'رفض');
          }))
        : h('span', { class: `chip ${dc}` }, dl);
      return h('li', { class: `plan-day${x.status === 'withdrawn' ? ' dim' : ''}` },
        h('div', { class: 'pd-date' }, h('b', null, fmtLong(x.date)),
          isOff(x.date) && x.status === 'planned' ? h('span', { class: 'pd-warn' }, 'لم يعد يوم عمل') : null,
          off ? h('span', { class: 'pd-team' }, `غائب من فريقه ${off === 1 ? 'زميل' : `${off} زملاء`}`) : null),
        control,
        x.requestId ? h('a', { class: 'pd-req', href: `#/requests?open=${x.requestId}`, onclick: () => dlg.close() }, `طلب #${x.requestId}`) : null);
    });

    // أدوات القرار
    const note = h('textarea', { rows: '2', maxlength: '300', placeholder: 'سبب الرفض (إلزامي إن رفضت يوماً) أو ملاحظة للموظف', 'aria-label': 'ملاحظة المسؤول' });
    const typeSel = !d.suggestedLeaveType ? select([['', '— اختر نوع الإجازة —'], ...d.leaveTypes.map((t) => [t, t])], '', { 'aria-label': 'نوع الإجازة' }) : null;
    const summary = h('p', { class: 'field-hint', 'aria-live': 'polite' });
    const save = h('button', { type: 'button', class: 'btn btn-primary', onclick: submit }, icon('check'), 'حفظ القرار');
    function sync() {
      const ok = planned.filter((x) => decision[x] === 'approved').length;
      summary.textContent = `${ok} للاعتماد · ${planned.length - ok} للرفض`;
    }
    function setAll(v) {
      for (const date of planned) {
        decision[date] = v;
        if (radios[date]) radios[date][v].checked = true;
      }
      sync();
    }
    async function submit() {
      const rejected = planned.filter((x) => decision[x] === 'rejected').length;
      if (rejected && note.value.trim().length < 2) {
        note.focus();
        return toast('اكتب سبب الرفض ليعرفه الموظف', 'err');
      }
      if (typeSel && !typeSel.value && planned.some((x) => decision[x] === 'approved')) return toast('اختر نوع الإجازة', 'err');
      save.disabled = true;
      const ok = await act('decide', { decisions: decision, note: note.value.trim() || undefined, leaveType: typeSel?.value || undefined }, 'سُجّل القرار');
      if (!ok) save.disabled = false;
    }

    const actions = [];
    if (p.can.submit) actions.push(h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => { if (await confirmBox(`سترسل ${planned.length} يوماً إلى مسؤولك للاعتماد. متابعة؟`, 'أرسل')) act('submit', {}, 'أُرسلت إلى مسؤولك'); } }, 'إرسال لمسؤولي'));
    if (p.can.withdraw) actions.push(h('button', { type: 'button', class: 'btn', onclick: () => act('withdraw', {}, 'سُحبت وعادت مسودة، عدّلها من «خطتي»') }, 'سحب لتعديلها'));
    if (p.can.cancel) actions.push(h('button', { type: 'button', class: 'btn btn-danger-ghost', onclick: async () => { if (await confirmBox(p.status === 'draft' ? 'حذف هذه المسودة؟' : 'إلغاء هذه الخطة؟ تتحرر أيامها.', 'نعم', true)) act('cancel', {}, 'أُلغيت الخطة'); } }, p.status === 'draft' ? 'حذف المسودة' : 'إلغاء الخطة'));

    clear(body).append(...[
      info,
      balances.length ? h('div', { class: 'bal-strip' }, balances) : null,
      planned.length ? h('p', { class: 'muted small' }, `الأيام: ${runsText(planned, (date) => { const t = new Date(`${date}T00:00:00Z`).getUTCDay(); return t === 5 || t === 6; })}`) : null,
      h('ul', { class: 'plain plan-days' }, rows),
      canDecide
        ? h('div', { class: 'plan-decide' },
          h('div', { class: 'row-actions' },
            h('button', { type: 'button', class: 'btn btn-sm', onclick: () => setAll('approved') }, 'اعتماد الكل'),
            h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost', onclick: () => setAll('rejected') }, 'رفض الكل'),
            summary),
          typeSel ? field('نوع الإجازة (لم يُعثر على نوع مناسب تلقائياً)', typeSel) : null,
          field('ملاحظة', note),
          h('p', { class: 'field-hint' }, 'المعتمد يتحوّل إلى طلب إجازة معتمد (طلب لكل فترة متصلة) ويُخصم من الرصيد، والمرفوض يصل الموظف مع سببه.'),
          h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'إغلاق'), save))
        : h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'إغلاق'), actions),
    ].filter(Boolean));
    if (canDecide) sync();
  }
}

/** «أحد 8 نوفمبر» مختصراً للقوائم */
export const shortRange = (first, last, n) => (first ? `${fmtShort(first)}${first !== last ? ` → ${fmtShort(last)}` : ''} · ${fmtN(n)}` : '—');
