// الإجازات المتوقعة: الموظف يخطّط أيامه في تقويم شهري ويرسلها لمسؤوله، والمسؤول يقرّر يوماً يوماً،
// وتقويم الفريق على شكل جدول الإكسل المعتمد (أخضر معتمد / أصفر متوقعة / أحمر مرفوض / رمادي عطلة) مع تصديره.
import { h, clear, icon, field, select, toast, dialog, confirmBox, addDays } from '../dom.js';
import { get, post, put } from '../api.js';
import { buildXlsx } from '../xlsx-write.js';
import { openPlanDetail, shortRange } from '../plan-ui.js';
import {
  PLAN_PURPOSE, PLAN_STATUS, DAY_STATE, monthLabel, monthBounds, shiftMonth, monthWeeks, datesBetween, runsText, fmtLong,
  countByYear, balanceAfter, calendarWorkbook, fmtN,
} from '../plans-lib.js';

const DOW = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const DOW_SHORT = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
const weekend = (d) => [5, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

function legend(extra = []) {
  const items = [['approved', 'معتمد'], ['planned', 'متوقعة، بانتظار القرار'], ['rejected', 'مرفوض'], ['draft', 'مسودة'], ...extra];
  return h('ul', { class: 'plain cal-legend', 'aria-label': 'مفتاح الألوان' }, items.map(([k, t]) => h('li', null, h('span', { class: `sw ${DAY_STATE[k]?.cls || k}`, 'aria-hidden': 'true' }), t)));
}

export default async function render({ user }) {
  const meta = await get('/api/plans/meta');
  const tabsDef = [];
  if (meta.linked) tabsDef.push({ id: 'mine', label: 'خطتي' });
  if (meta.canDecide) tabsDef.push({ id: 'inbox', label: 'بانتظار قراري', count: meta.pending }, { id: 'team', label: 'تقويم الفريق' });
  let tab = meta.canDecide && meta.pending > 0 ? 'inbox' : tabsDef[0]?.id;

  const tabBar = h('div', { class: 'seg-tabs', role: 'tablist', 'aria-label': 'أقسام الإجازات المتوقعة' });
  const box = h('div', { class: 'plans-body' });
  const notice = h('div');

  function drawTabs() {
    clear(tabBar).append(...tabsDef.map((t) => h('button', {
      type: 'button', role: 'tab', class: `seg-tab${t.id === tab ? ' on' : ''}`, 'aria-selected': String(t.id === tab),
      onclick: () => { tab = t.id; drawTabs(); show(); },
    }, t.label, t.count ? h('b', { class: 'count' }, t.count) : null)));
  }

  async function refreshMeta() {
    try {
      const m = await get('/api/plans/meta');
      const inbox = tabsDef.find((t) => t.id === 'inbox');
      if (inbox) inbox.count = m.pending;
      drawTabs();
    } catch { /* العدّاد تحسين فقط */ }
    window.dispatchEvent(new CustomEvent('requests:changed'));
  }
  const changed = async () => { await refreshMeta(); await show(); };

  async function show() {
    clear(box).append(h('p', { class: 'loading' }, 'جارٍ التحميل…'));
    try {
      const node = tab === 'mine' ? await mineTab() : tab === 'inbox' ? await inboxTab() : await teamTab();
      clear(box).append(node);
    } catch (e) {
      clear(box).append(h('div', { class: 'notice notice-err', role: 'alert' }, e.message));
    }
  }

  // ================================================================ خطتي
  const S = { month: meta.today.slice(0, 7), selected: new Set(), editing: null, purpose: 'annual', note: '', anchor: null };

  async function mineTab() {
    const { from, to } = monthBounds(S.month);
    const [cal, list] = await Promise.all([get(`/api/plans/calendar?from=${from}&to=${to}&scope=mine`), get('/api/plans?scope=mine')]);
    const days = cal.employees[0]?.days || {};
    const off = cal.off;
    const earliest = () => meta.earliest[S.purpose];
    const latest = addDays(meta.today, meta.rules.maxAheadDays);
    const free = (x) => !x || x.s === 'rejected' || (x.s === 'draft' && x.p === S.editing);
    const selectable = (d) => !off[d] && d >= earliest() && d <= latest && free(days[d]);

    const wrap = h('div', { class: 'cal-wrap' });
    const bar = h('div', { class: 'plan-bar' });
    // على الهاتف يبقى ملخص التحديد ظاهراً أسفل الشاشة ليقود إلى شريط الإرسال البعيد عن التقويم
    const pill = h('button', { type: 'button', class: 'plan-pill', hidden: true, onclick: () => bar.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) });

    function pick(d, ev) {
      if (ev.shiftKey && S.anchor && S.anchor !== d) {
        const [a, b] = S.anchor < d ? [S.anchor, d] : [d, S.anchor];
        for (const x of datesBetween(a, b)) if (x.slice(0, 7) === S.month && selectable(x)) S.selected.add(x);
      } else if (S.selected.has(d)) S.selected.delete(d);
      else S.selected.add(d);
      S.anchor = d;
      drawGrid();
      drawBar();
    }

    function onDay(d, ev) {
      const x = days[d];
      if (!free(x)) {
        if (x.s === 'draft') return startEdit(x.p);
        if (x.p) return openPlanDetail({ id: x.p, onChanged: changed });
        if (x.r) location.hash = `#/requests?open=${x.r}`;
        return;
      }
      if (selectable(d)) pick(d, ev);
    }

    function drawGrid() {
      const weeks = monthWeeks(S.month);
      clear(wrap).append(
        h('div', { class: 'cal-bar' },
          h('div', { class: 'cal-nav' },
            h('button', { type: 'button', class: 'btn btn-sm', 'aria-label': 'الشهر السابق', onclick: () => go(-1) }, icon('arrow-left', 'flip'), 'السابق'),
            h('h2', { 'aria-live': 'polite' }, monthLabel(S.month)),
            h('button', { type: 'button', class: 'btn btn-sm', 'aria-label': 'الشهر التالي', onclick: () => go(1) }, 'التالي', icon('arrow-left'))),
          h('div', { class: 'row-actions' },
            S.month !== meta.today.slice(0, 7) ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { S.month = meta.today.slice(0, 7); reload(); } }, 'الشهر الحالي') : null,
            h('button', { type: 'button', class: 'btn btn-sm', onclick: rangeDialog }, icon('plus'), 'تحديد نطاق'))),
        legend([['sel', 'محدد الآن']]),
        h('div', { class: 'cal-grid', role: 'group', 'aria-label': monthLabel(S.month) },
          DOW.map((n, i) => h('div', { class: `cal-dow${i > 4 ? ' end' : ''}`, 'aria-hidden': 'true' }, h('span', { class: 'full' }, n), h('span', { class: 'short' }, DOW_SHORT[i]))),
          weeks.flat().map((d) => (d ? cell(d) : h('div', { class: 'cal-day empty', 'aria-hidden': 'true' })))));
    }

    function cell(d) {
      const x = days[d];
      const isOff = !!off[d];
      const sel = S.selected.has(d);
      const st = x && !(x.s === 'draft' && x.p === S.editing) ? DAY_STATE[x.s] : null;
      const can = !isOff && (selectable(d) || (x && !free(x)));
      const label = `${fmtLong(d)} — ${isOff ? off[d] : sel ? 'محدد' : st ? st.label : selectable(d) ? 'متاح للتخطيط' : 'غير متاح'}`;
      return h('button', {
        type: 'button', class: `cal-day${isOff ? ' off' : ''}${sel ? ' sel' : ''}${st ? ` ${st.cls}` : ''}${d === meta.today ? ' today' : ''}${!can && !isOff ? ' locked' : ''}`,
        disabled: !can, 'aria-label': label, 'aria-pressed': selectable(d) ? String(sel) : null,
        onclick: (ev) => onDay(d, ev),
      }, h('span', { class: 'n' }, Number(d.slice(8))), h('span', { class: 't' }, sel ? 'محدد' : isOff ? (off[d] === 'عطلة رسمية' ? 'عطلة' : '') : st ? st.short : ''));
    }

    function drawBar() {
      const dates = [...S.selected].sort();
      const byYear = countByYear(dates);
      const balNotes = Object.entries(byYear).map(([y, n]) => {
        const b = balanceAfter(cal.balance, y, S.purpose, n);
        if (!b) return S.purpose === 'annual' ? h('span', { class: 'muted' }, `${y}: لا رصيد محدد لك بعد (تحدّده الموارد البشرية)`) : null;
        return h('span', { class: b.after < 0 ? 'bal-warn' : 'muted' }, `رصيد ${y}: متبقٍّ ${fmtN(b.remaining)}${b.pending ? `، معلّق ${fmtN(b.pending)}` : ''} — بعد هذه الأيام ${b.after < 0 ? `يتجاوز الرصيد بـ ${fmtN(-b.after)}` : `يبقى ${fmtN(b.after)}`}`);
      }).filter(Boolean);

      const purposeSel = select(Object.entries(PLAN_PURPOSE), S.purpose, {
        'aria-label': 'نوع الإجازة',
        onchange: (e) => { S.purpose = e.target.value; for (const d of [...S.selected]) if (d < earliest()) S.selected.delete(d); drawGrid(); drawBar(); },
      });
      const noteIn = h('input', { type: 'text', maxlength: '300', value: S.note, placeholder: S.purpose === 'other' ? 'اكتب السبب (إلزامي)' : 'ملاحظة للمسؤول (اختياري)', 'aria-label': 'ملاحظة', oninput: (e) => { S.note = e.target.value; } });
      const none = dates.length === 0;
      const run = async (submit) => {
        if (S.purpose === 'other' && S.note.trim().length < 2) { noteIn.focus(); return toast('اكتب سبب الإجازة (أخرى)', 'err'); }
        if (submit && !(await confirmBox(`سترسل ${dates.length} يوماً إلى مسؤولك للاعتماد (${runsText(dates, weekend)}). متابعة؟`, 'أرسل'))) return;
        const payload = { purpose: S.purpose, note: S.note.trim(), dates };
        try {
          if (S.editing) {
            await put(`/api/plans/${S.editing}`, payload);
            if (submit) await post(`/api/plans/${S.editing}/submit`);
          } else {
            await post('/api/plans', { ...payload, submit });
          }
        } catch (e) {
          return toast(e.message, 'err');
        }
        toast(submit ? 'أُرسلت إلى مسؤولك للاعتماد' : 'حُفظت مسودة، لم تُرسَل بعد');
        S.selected.clear(); S.editing = null; S.note = ''; S.anchor = null;
        await changed();
      };

      pill.hidden = none;
      pill.textContent = none ? '' : `المحدد: ${fmtN(dates.length)} — أكمل الإرسال ↓`;
      clear(bar).append(...[
        S.editing ? h('div', { class: 'notice' }, `تعديل المسودة #${S.editing}`, ' ', h('button', { type: 'button', class: 'link-btn', onclick: () => { S.editing = null; S.selected.clear(); S.note = ''; reload(); } }, 'إلغاء التعديل')) : null,
        h('div', { class: 'plan-sel' },
          h('b', null, none ? 'اضغط الأيام التي تتوقع إجازتك فيها' : `المحدد: ${fmtN(dates.length)}`),
          none ? h('span', { class: 'muted small' }, 'يمكنك التنقل بين الأشهر، ولتحديد أسبوع كامل استعمل «تحديد نطاق» أو Shift مع الضغط.') : h('span', { class: 'muted small' }, runsText(dates, weekend))),
        h('div', { class: 'plan-fields' }, field('نوع الإجازة', purposeSel), field('ملاحظة', noteIn)),
        balNotes.length ? h('div', { class: 'plan-bal' }, balNotes) : null,
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn btn-primary', disabled: none, onclick: () => run(true) }, icon('check'), 'أرسل لمسؤولي'),
          h('button', { type: 'button', class: 'btn', disabled: none, onclick: () => run(false) }, 'احفظ كمسودة'),
          h('button', { type: 'button', class: 'btn btn-ghost', disabled: none, onclick: () => { S.selected.clear(); S.anchor = null; drawGrid(); drawBar(); } }, 'امسح التحديد')),
      ].filter(Boolean));
    }

    function rangeDialog() {
      const a = h('input', { type: 'date', value: S.month === meta.today.slice(0, 7) ? meta.today : `${S.month}-01`, 'aria-label': 'من' });
      const b = h('input', { type: 'date', 'aria-label': 'إلى' });
      const err = h('p', { class: 'notice notice-err', hidden: true, role: 'alert' });
      const dlg = dialog({
        title: 'تحديد نطاق أيام',
        content: h('form', { onsubmit: (e) => {
          e.preventDefault();
          if (!a.value || !b.value || b.value < a.value) return Object.assign(err, { hidden: false, textContent: 'اختر تاريخ بداية ونهاية صحيحين' });
          if (datesBetween(a.value, b.value).length > 120) return Object.assign(err, { hidden: false, textContent: 'النطاق أطول من اللازم' });
          const missing = [...new Set(datesBetween(a.value, b.value).map((d) => d.slice(0, 7)))].filter((m) => m !== S.month);
          const take = datesBetween(a.value, b.value).filter((d) => d.slice(0, 7) === S.month && selectable(d));
          take.forEach((d) => S.selected.add(d));
          dlg.close();
          drawGrid(); drawBar();
          toast(`أُضيف ${take.length} من أيام العمل في ${monthLabel(S.month)}${missing.length ? ' (انتقل للشهر الآخر وكرّر لباقي النطاق)' : ''}`);
        } },
        field('من', a), field('إلى', b), err,
        h('p', { class: 'field-hint' }, 'تُضاف أيام العمل المتاحة في الشهر المعروض فقط (تُستثنى العطل والأيام المخطَّطة مسبقاً).'),
        h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'إلغاء'), h('button', { type: 'submit', class: 'btn btn-primary' }, 'أضف'))),
      });
    }

    async function go(n) { S.month = shiftMonth(S.month, n); await reload(); }
    async function reload() { clear(box).append(await mineTab()); }

    async function startEdit(id) {
      if (S.selected.size && !S.editing && !(await confirmBox('لديك أيام محددة لم تُحفظ، تُستبدل بأيام هذه المسودة. متابعة؟', 'نعم'))) return;
      try {
        const d = await get(`/api/plans/${id}`);
        const dates = d.days.filter((x) => x.status === 'planned').map((x) => x.date);
        S.editing = id; S.purpose = d.plan.purpose; S.note = d.plan.note || ''; S.selected = new Set(dates);
        if (dates.length) S.month = dates[0].slice(0, 7);
      } catch (e) {
        return toast(e.message, 'err');
      }
      await reload();
    }

    // ---- قائمة خططي
    const mine = list.plans.filter((p) => p.status !== 'cancelled');
    const table = mine.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['الأيام', 'النوع', 'الحالة', 'أُرسلت', 'ملاحظة المسؤول', ''].map((t) => h('th', null, t)))),
        h('tbody', null, mine.map((p) => h('tr', { class: 'req-row', tabindex: '0', onclick: () => openPlanDetail({ id: p.id, onChanged: changed }), onkeydown: (e) => { if (e.key === 'Enter') openPlanDetail({ id: p.id, onChanged: changed }); } },
          h('td', { class: 'wide' }, shortRange(p.firstDate, p.lastDate, p.dayCount)),
          h('td', null, `${PLAN_PURPOSE[p.purpose]}${p.note ? ` — ${p.note}` : ''}`),
          h('td', { class: 'w2' }, h('span', { class: `chip ${PLAN_STATUS[p.status][1]}` }, PLAN_STATUS[p.status][0]),
            p.status === 'approved' && p.rejectedCount ? h('span', { class: 'muted small' }, ` (${p.rejectedCount} مرفوض)`) : null),
          h('td', { class: 'num' }, p.submittedAt ? p.submittedAt.slice(0, 10) : '—'),
          h('td', { class: 'wide' }, p.decisionNote || '—'),
          h('td', { class: 'row-actions' },
            p.status === 'draft' ? h('button', { type: 'button', class: 'btn btn-sm', onclick: (e) => { e.stopPropagation(); startEdit(p.id); } }, 'تعديل') : null,
            h('button', { type: 'button', class: 'btn btn-sm', onclick: (e) => { e.stopPropagation(); openPlanDetail({ id: p.id, onChanged: changed }); } }, p.status === 'draft' ? 'إرسال / حذف' : 'فتح')))))))
      : h('p', { class: 'empty' }, 'لا خطط بعد. اختر أياماً من التقويم ثم أرسلها لمسؤولك.');

    drawGrid();
    drawBar();
    return h('div', { class: 'page-section' },
      meta.work ? null : h('div', { class: 'notice notice-warn' }, 'لم تُدخل إعدادات الدوام بعد.'),
      wrap, pill, bar,
      h('h2', { class: 'section-title' }, 'خططي'), table);
  }

  // ================================================================ بانتظار قراري
  async function inboxTab() {
    const { plans } = await get('/api/plans?scope=inbox');
    if (!plans.length) return h('p', { class: 'empty' }, 'لا خطط إجازات بانتظار قرارك.');
    const open = (id) => openPlanDetail({ id, onChanged: changed });
    return h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['الموظف', 'الأيام', 'النوع', 'أُرسلت', ''].map((t) => h('th', null, t)))),
      h('tbody', null, plans.map((p) => h('tr', { class: 'req-row', tabindex: '0', onclick: () => open(p.id), onkeydown: (e) => { if (e.key === 'Enter') open(p.id); } },
        h('td', { class: 'wide' }, h('span', { class: 'emp-link' }, p.employeeName), h('div', { class: 'code' }, p.employeeCode)),
        h('td', { class: 'wide' }, shortRange(p.firstDate, p.lastDate, p.plannedCount)),
        h('td', null, `${PLAN_PURPOSE[p.purpose]}${p.note ? ` — ${p.note}` : ''}`),
        h('td', { class: 'num' }, p.submittedAt ? p.submittedAt.slice(0, 10) : '—'),
        h('td', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: (e) => { e.stopPropagation(); open(p.id); } }, 'مراجعة')))))));
  }

  // ================================================================ تقويم الفريق (شكل جدول الإكسل)
  const T = { month: meta.today.slice(0, 7), q: '', months: '3' };

  async function teamTab() {
    const { from, to } = monthBounds(T.month);
    const cal = await get(`/api/plans/calendar?from=${from}&to=${to}&scope=team`);
    const dates = datesBetween(from, to);
    const holder = h('div', { class: 'team-wrap', tabindex: '0', role: 'region', 'aria-label': `جدول إجازات ${monthLabel(T.month)}` });

    const matches = () => cal.employees.filter((e) => !T.q || e.name.includes(T.q) || e.code.toLowerCase().includes(T.q.toLowerCase()));

    function drawTable() {
      const list = matches();
      if (!list.length) return clear(holder).append(h('p', { class: 'empty' }, 'لا موظفين مطابقين.'));
      const totals = Object.fromEntries(dates.map((d) => [d, list.filter((e) => ['approved', 'planned'].includes(e.days[d]?.s)).length]));
      clear(holder).append(h('table', { class: 'team' },
        h('thead', null,
          h('tr', null,
            h('th', { class: 'who', rowspan: '2', scope: 'col' }, 'الموظف'),
            dates.map((d) => h('th', { class: `${cal.off[d] ? 'off ' : ''}${d === meta.today ? 'today' : ''}`.trim(), scope: 'col', title: fmtLong(d) }, DOW_SHORT[new Date(`${d}T00:00:00Z`).getUTCDay()]))),
          h('tr', null, dates.map((d) => h('th', { class: `${cal.off[d] ? 'off ' : ''}${d === meta.today ? 'today' : ''}`.trim(), scope: 'col' }, Number(d.slice(8)))))),
        h('tbody', null,
          list.map((e) => h('tr', null,
            h('th', { class: 'who', scope: 'row' }, h('span', { class: 'emp-name' }, e.name), h('span', { class: 'code' }, `${e.code}${e.department ? ` · ${e.department}` : ''}`)),
            dates.map((d) => {
              const x = e.days[d];
              if (cal.off[d]) return h('td', { class: 'off' });
              if (!x) return h('td', null);
              const st = DAY_STATE[x.s];
              return h('td', { class: st.cls },
                h('button', { type: 'button', class: 'cell', 'aria-label': `${e.name} — ${fmtLong(d)}: ${st.label}`, onclick: () => (x.p ? openPlanDetail({ id: x.p, onChanged: changed }) : x.r ? (location.hash = `#/requests?open=${x.r}`) : null) },
                  x.s === 'planned' ? 'إجازة' : st.short));
            })))),
        h('tfoot', null, h('tr', null,
          h('th', { class: 'who', scope: 'row' }, 'عدد الغائبين'),
          dates.map((d) => h('td', { class: cal.off[d] ? 'off' : '' }, !cal.off[d] && totals[d] ? totals[d] : ''))))));
    }

    async function exportXlsx() {
      const n = Number(T.months);
      const a = monthBounds(T.month).from;
      const b = monthBounds(shiftMonth(T.month, n - 1)).to;
      let data;
      try {
        data = n === 1 ? cal : await get(`/api/plans/calendar?from=${a}&to=${b}&scope=team`);
      } catch (e) {
        return toast(e.message, 'err');
      }
      const list = data.employees.filter((e) => !T.q || e.name.includes(T.q) || e.code.toLowerCase().includes(T.q.toLowerCase()));
      if (!list.length) return toast('لا موظفين للتصدير', 'err');
      const bytes = buildXlsx(calendarWorkbook({ from: a, to: b, generated: meta.today, employees: list, off: data.off, scopeNote: T.q ? `بحث: ${T.q}` : '' }));
      const link = h('a', { href: URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), download: `Leave-calendar_${a.slice(0, 7)}_${n}m.xlsx` });
      document.body.append(link);
      link.click();
      setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 2000);
      toast(`نُزّل الجدول: ${list.length} موظفاً، ${n === 1 ? 'شهر واحد' : `${n} أشهر`}`);
    }

    const go = async (n) => { T.month = shiftMonth(T.month, n); clear(box).append(await teamTab()); };
    const search = h('input', { type: 'search', placeholder: 'بحث بالاسم أو الرمز', value: T.q, 'aria-label': 'بحث', oninput: (e) => { T.q = e.target.value.trim(); drawTable(); } });
    drawTable();
    // الشهر الحالي: يظهر عمود اليوم دون أن يبحث المستخدم عنه في جدول عريض
    setTimeout(() => holder.querySelector('thead th.today')?.scrollIntoView({ inline: 'center', block: 'nearest' }), 0);
    return h('div', { class: 'page-section' },
      h('div', { class: 'cal-bar' },
        h('div', { class: 'cal-nav' },
          h('button', { type: 'button', class: 'btn btn-sm', 'aria-label': 'الشهر السابق', onclick: () => go(-1) }, icon('arrow-left', 'flip'), 'السابق'),
          h('h2', { 'aria-live': 'polite' }, monthLabel(T.month)),
          h('button', { type: 'button', class: 'btn btn-sm', 'aria-label': 'الشهر التالي', onclick: () => go(1) }, 'التالي', icon('arrow-left'))),
        h('div', { class: 'tools' }, search,
          select([['1', 'شهر واحد'], ['3', '3 أشهر'], ['6', '6 أشهر'], ['12', '12 شهراً']], T.months, { 'aria-label': 'مدة التصدير', onchange: (e) => { T.months = e.target.value; } }),
          h('button', { type: 'button', class: 'btn', onclick: exportXlsx }, icon('download'), 'تصدير إكسل'))),
      legend(), holder,
      h('p', { class: 'field-hint' }, 'اضغط خلية ملوّنة لفتح الخطة أو الطلب. «عدد الغائبين» يجمع المعتمد والمتوقع في اليوم نفسه.'));
  }

  // ================================================================ الهيكل
  if (!tabsDef.length) notice.append(h('div', { class: 'notice notice-warn' }, 'حسابك غير مرتبط بسجل موظف، فلا يمكن تخطيط إجازات. راجع الموارد البشرية لربطه.'));
  const page = h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', null, h('h1', null, 'الإجازات المتوقعة'),
        h('p', { class: 'sub' }, 'خطّط إجازاتك القادمة في التقويم وأرسلها لمسؤولك. تبقى «متوقعة» حتى يعتمدها أو يرفضها يوماً بيوم، وما يُعتمد يصير إجازة فعلية تُخصم من رصيدك.'))),
    notice, tabsDef.length > 1 ? tabBar : null, box);
  drawTabs();
  if (tabsDef.length) await show();
  const wanted = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('open')) || null;
  if (wanted) openPlanDetail({ id: wanted, onChanged: changed });
  return page;
}
