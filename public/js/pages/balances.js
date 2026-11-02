import { h, clear, dialog, field, select, toast, icon, todayLocal } from '../dom.js';
import { get, put, post } from '../api.js';
import { buildXlsx } from '../xlsx-write.js';
import { PURPOSES, PURPOSE_ORDER, shownPurposes, rowStatus, aggregate, overall, fmtDays, balanceWorkbook } from '../balances-lib.js';

const STATUS_CHIP = { ok: 'chip-present', out: 'chip-late', over: 'chip-absent', none: 'chip-none' };

export default async function render() {
  const thisYear = Number(todayLocal().slice(0, 4));
  let year = thisYear;
  let data = { employees: [], canEdit: false, defaults: {} };
  let view = 'employee'; // employee | department | center
  let showAll = false;
  let center = '';
  let dept = '';
  let q = '';
  const picked = new Set();

  const yearSel = select([thisYear - 1, thisYear, thisYear + 1].map((y) => [String(y), String(y)]), String(year), { 'aria-label': 'السنة' });
  const centerSel = select([['', 'كل المراكز']], '', { 'aria-label': 'المركز' });
  const deptSel = select([['', 'كل الأقسام']], '', { 'aria-label': 'القسم' });
  const search = h('input', { type: 'search', placeholder: 'بحث بالاسم أو الرمز', 'aria-label': 'بحث' });
  const tabs = h('div', { class: 'seg-tabs', role: 'tablist', 'aria-label': 'مستوى العرض' });
  const summary = h('div', { class: 'sums' });
  const tableBox = h('div', { class: 'table-wrap' });
  const notice = h('div');
  const bulkBtn = h('button', { type: 'button', class: 'btn btn-primary' }, 'تحديد الرصيد للمحدَّدين');
  const copyBtn = h('button', { type: 'button', class: 'btn' }, 'نسخ توزيع سنة سابقة');
  const exportBtn = h('button', { type: 'button', class: 'btn' }, icon('download'), 'تصدير التقرير (إكسل)');
  const allToggle = h('input', { type: 'checkbox' });

  const filtered = () => data.employees.filter((e) =>
    (!center || String(e.centerId) === center) && (!dept || (e.department || '') === dept) &&
    (!q || e.name.includes(q) || e.code.toLowerCase().includes(q.toLowerCase())));

  function refillFilters() {
    const centers = [...new Map(data.employees.filter((e) => e.centerId).map((e) => [String(e.centerId), e.center])).entries()];
    const depts = [...new Set(data.employees.map((e) => e.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
    const fill = (sel, first, opts, cur) => {
      clear(sel).append(h('option', { value: '' }, first), ...opts.map(([v, t]) => h('option', { value: v }, t)));
      sel.value = opts.some(([v]) => v === cur) ? cur : '';
    };
    fill(centerSel, 'كل المراكز', centers, center);
    fill(deptSel, 'كل الأقسام', depts.map((d) => [d, d]), dept);
    center = centerSel.value;
    dept = deptSel.value;
  }

  const cell = (b) => {
    if (b.total === null) {
      return h('td', { class: 'num' }, h('span', { class: 'muted' }, 'بلا رصيد'), b.used || b.pending ? h('small', { class: 'bal-sub' }, `مستهلك ${fmtDays(b.used)}${b.pending ? ` · معلّق ${fmtDays(b.pending)}` : ''}`) : null);
    }
    const pct = b.total > 0 ? Math.max(0, Math.min(100, (b.remaining / b.total) * 100)) : 0;
    const bar = h('span', { class: `bal-bar${b.remaining < 0 ? ' over' : b.remaining === 0 ? ' out' : ''}`, 'aria-hidden': 'true' }, h('i'));
    bar.firstChild.style.setProperty('width', `${pct}%`);
    return h('td', { class: 'num' },
      h('div', { class: 'bal-main' }, h('strong', null, fmtDays(b.remaining)), h('span', { class: 'muted' }, ` من ${fmtDays(b.total)}`)),
      bar,
      h('small', { class: 'bal-sub' }, `مستهلك ${fmtDays(b.used)}${b.pending ? ` · معلّق ${fmtDays(b.pending)}` : ''}${b.source === 'default' ? ' · افتراضي' : ''}`));
  };

  const aggCell = (a) => {
    if (!a.withBalance) return h('td', { class: 'num' }, h('span', { class: 'muted' }, 'بلا رصيد'), a.withoutBalance ? h('small', { class: 'bal-sub' }, `${a.withoutBalance} موظف`) : null);
    const pct = a.total > 0 ? Math.max(0, Math.min(100, (a.remaining / a.total) * 100)) : 0;
    const bar = h('span', { class: `bal-bar${a.remaining < 0 ? ' over' : ''}`, 'aria-hidden': 'true' }, h('i'));
    bar.firstChild.style.setProperty('width', `${pct}%`);
    return h('td', { class: 'num' },
      h('div', { class: 'bal-main' }, h('strong', null, fmtDays(a.remaining)), h('span', { class: 'muted' }, ` من ${fmtDays(a.total)}`)),
      bar,
      h('small', { class: 'bal-sub' }, `مستهلك ${fmtDays(a.used)}${a.pending ? ` · معلّق ${fmtDays(a.pending)}` : ''}${a.withoutBalance ? ` · بلا رصيد: ${a.withoutBalance}` : ''}`));
  };

  const reqCell = (r) => h('td', { class: 'num bal-req' }, h('span', { title: 'معتمدة' }, r.approved), ' / ', h('span', { title: 'معلّقة' }, r.pending), ' / ', h('span', { title: 'مرفوضة' }, r.rejected));

  function drawSummary(list, purposes) {
    clear(summary);
    const o = overall(list, purposes);
    if (!o) return;
    for (const p of purposes) {
      const a = o.balances[p];
      summary.append(h('div', { class: 'sum' },
        h('b', null, a.withBalance ? fmtDays(a.remaining) : '—'),
        h('span', null, `${PURPOSES[p]}: متبقٍّ${a.withBalance ? ` من ${fmtDays(a.total)} (مستهلك ${fmtDays(a.used)})` : ''}`)));
    }
    summary.append(h('div', { class: 'sum' }, h('b', null, o.count), h('span', null, 'موظفاً في العرض')));
  }

  function draw() {
    const list = filtered();
    const purposes = shownPurposes(data.employees, showAll);
    drawSummary(list, purposes);
    clear(tabs).append(...[['employee', 'حسب الموظف'], ['department', 'حسب القسم'], ['center', 'حسب المركز']].map(([id, label]) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(view === id), class: `seg-tab${view === id ? ' on' : ''}`, onclick: () => { view = id; draw(); } }, label)));
    const canEdit = data.canEdit;
    bulkBtn.hidden = !canEdit;
    copyBtn.hidden = !canEdit;
    bulkBtn.disabled = picked.size === 0;
    clear(bulkBtn).append(`تحديد الرصيد للمحدَّدين${picked.size ? ` (${picked.size})` : ''}`);
    clear(notice);
    if (!list.length) {
      clear(tableBox).append(h('p', { class: 'empty' }, 'لا موظفين مطابقين.'));
      return;
    }
    if (!Object.keys(data.defaults).length && !data.employees.some((e) => PURPOSE_ORDER.some((p) => e.balances[p].total !== null))) {
      notice.append(h('div', { class: 'notice notice-warn' }, canEdit ? 'لم تُحدَّد أرصدة بعد. اختر موظفاً أو عدة موظفين ثم «تحديد الرصيد».' : 'لم تُحدَّد أرصدة بعد. تحدّدها الموارد البشرية.'));
    }

    if (view !== 'employee') {
      const groups = aggregate(list, view === 'department' ? (e) => e.department : (e) => e.center, purposes);
      clear(tableBox).append(h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, view === 'department' ? 'القسم' : 'المركز'), h('th', { class: 'num' }, 'الموظفون'), purposes.map((p) => h('th', { class: 'num' }, PURPOSES[p])), h('th', { class: 'num', title: 'معتمدة / معلّقة / مرفوضة' }, 'الطلبات'))),
        h('tbody', null, groups.map((g) => h('tr', null,
          h('td', null, h('strong', null, g.key)),
          h('td', { class: 'num' }, g.count),
          purposes.map((p) => aggCell(g.balances[p])),
          reqCell(g.requests))))));
      return;
    }

    allToggle.checked = list.every((e) => picked.has(e.id));
    clear(tableBox).append(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null,
        canEdit ? h('th', { class: 'pick' }, h('label', { class: 'check', 'aria-label': 'تحديد الكل' }, allToggle)) : null,
        h('th', null, 'الموظف'),
        purposes.map((p) => h('th', { class: 'num' }, PURPOSES[p])),
        h('th', { class: 'num', title: 'معتمدة / معلّقة / مرفوضة' }, 'الطلبات'), h('th', null, 'الحالة'), canEdit ? h('th') : null)),
      h('tbody', null, list.map((e) => {
        const st = rowStatus(e, purposes);
        const box = h('input', { type: 'checkbox', checked: picked.has(e.id), 'aria-label': `تحديد ${e.name}`, onchange: (ev) => { if (ev.target.checked) picked.add(e.id); else picked.delete(e.id); draw(); } });
        return h('tr', null,
          canEdit ? h('td', { class: 'pick' }, h('label', { class: 'check' }, box)) : null,
          h('td', null, h('strong', null, e.name), h('div', { class: 'muted small' }, [e.code, e.center, e.department].filter(Boolean).join(' · '))),
          purposes.map((p) => cell(e.balances[p])),
          reqCell(e.requests),
          h('td', null, h('span', { class: `chip ${STATUS_CHIP[st.key]}` }, st.label)),
          canEdit ? h('td', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => assignDialog([e]) }, 'تعديل')) : null);
      }))));
  }

  allToggle.addEventListener('change', () => {
    for (const e of filtered()) if (allToggle.checked) picked.add(e.id); else picked.delete(e.id);
    draw();
  });

  async function load() {
    clear(tableBox).append(h('p', { class: 'muted' }, 'جارٍ التحميل…'));
    try {
      data = await get(`/api/balances?year=${year}`);
      for (const id of [...picked]) if (!data.employees.some((e) => e.id === id)) picked.delete(id);
      refillFilters();
      draw();
    } catch (ex) {
      clear(tableBox).append(h('div', { class: 'notice notice-err' }, ex.message));
    }
  }

  // ------------------------------------------------------------ تحديد الرصيد (فردي أو جماعي)
  function assignDialog(list) {
    const single = list.length === 1 ? list[0] : null;
    const purposes = PURPOSE_ORDER;
    const inputs = {};
    const clears = {};
    const err = h('div', { class: 'notice notice-err', hidden: true, role: 'alert' });
    const rows = purposes.map((p) => {
      const cur = single?.balances[p];
      const personal = cur && cur.source === 'personal';
      inputs[p] = h('input', { type: 'number', min: '0', max: '366', step: '0.5', inputmode: 'decimal', value: personal ? cur.total : '', placeholder: single ? (cur?.total !== null ? `${cur.total} (افتراضي)` : 'بلا رصيد') : 'بلا تغيير', 'aria-label': PURPOSES[p] });
      clears[p] = h('input', { type: 'checkbox', onchange: (e) => { inputs[p].disabled = e.target.checked; } });
      return h('div', { class: 'bal-assign-row' },
        h('span', { class: 'bal-assign-name' }, PURPOSES[p], single && cur?.used ? h('small', { class: 'muted' }, ` — مستهلك ${fmtDays(cur.used)}`) : null),
        inputs[p],
        h('label', { class: 'check small' }, clears[p], 'إزالة الرصيد الخاص'));
    });
    const dlg = dialog({
      title: single ? `رصيد ${single.name} — ${year}` : `تحديد الرصيد لـ ${list.length} موظفاً — ${year}`,
      content: h('form', { class: 'form-grid', onsubmit: async (ev) => {
        ev.preventDefault();
        const items = {};
        for (const p of purposes) {
          if (clears[p].checked) items[p] = null;
          else if (inputs[p].value !== '') items[p] = Number(inputs[p].value);
        }
        if (!Object.keys(items).length) {
          err.textContent = 'اكتب رصيداً واحداً على الأقل، أو اختر إزالة.';
          err.hidden = false;
          return;
        }
        try {
          await put('/api/balances', { year, employeeIds: list.map((e) => e.id), items });
          toast('حُفظ الرصيد');
          dlg.close();
          load();
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
        }
      } },
      h('p', { class: 'field-hint span-all' }, single
        ? 'الأيام بمضاعفات نصف يوم. الحقل الفارغ لا يتغيّر. يُخصم من الرصيد تلقائياً كلما اعتُمدت إجازة، ويُردّ إن أُلغي اعتمادها.'
        : `يُطبَّق على ${list.length} موظفاً دفعة واحدة. الحقل الفارغ لا يتغيّر عند أي منهم. يُخصم من الرصيد تلقائياً كلما اعتُمدت إجازة.`),
      h('div', { class: 'span-all bal-assign' }, rows),
      h('div', { class: 'span-all' }, err),
      h('div', { class: 'dlg-actions span-all' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'إلغاء'), h('button', { type: 'submit', class: 'btn btn-primary' }, 'حفظ'))),
    });
  }

  bulkBtn.onclick = () => assignDialog(data.employees.filter((e) => picked.has(e.id)));

  copyBtn.onclick = () => {
    const from = select([year - 1, year - 2].filter((y) => y >= 2020).map((y) => [String(y), String(y)]), String(year - 1));
    const err = h('div', { class: 'notice notice-err', hidden: true, role: 'alert' });
    const dlg = dialog({
      title: `نسخ التوزيع إلى ${year}`,
      content: h('form', { class: 'form-grid', onsubmit: async (ev) => {
        ev.preventDefault();
        try {
          const r = await post('/api/balances/copy', { from: Number(from.value), to: year });
          toast(r.copied ? `نُسخ ${r.copied} رصيداً` : 'لا جديد للنسخ: كل شيء محدَّد مسبقاً');
          dlg.close();
          load();
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
        }
      } },
      field('انسخ أرصدة سنة', from, `تُنسخ الأرصدة الخاصة بالموظفين الفعّالين إلى ${year}، ولا يُستبدل ما حُدِّد فيها مسبقاً.`),
      h('div', { class: 'span-all' }, err),
      h('div', { class: 'dlg-actions span-all' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'إلغاء'), h('button', { type: 'submit', class: 'btn btn-primary' }, 'نسخ'))),
    });
  };

  // ------------------------------------------------------------ التصدير
  exportBtn.onclick = () => {
    const list = filtered();
    if (!list.length) return toast('لا موظفين للتصدير', 'err');
    const purposes = shownPurposes(data.employees, showAll);
    const scope = [center && centerSel.selectedOptions[0]?.textContent, dept && `قسم ${dept}`, q && `بحث: ${q}`].filter(Boolean).join(' — ');
    const bytes = buildXlsx(balanceWorkbook({ year, generated: todayLocal(), employees: list, purposes, scopeNote: scope }));
    const a = h('a', {
      href: URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })),
      download: `Leave-balances_${year}.xlsx`,
    });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast(`نُزّل التقرير: ${list.length} موظفاً، ثلاث أوراق (الموظفون، الأقسام، المراكز)`);
  };

  yearSel.onchange = () => { year = Number(yearSel.value); picked.clear(); load(); };
  centerSel.onchange = () => { center = centerSel.value; draw(); };
  deptSel.onchange = () => { dept = deptSel.value; draw(); };
  search.oninput = () => { q = search.value.trim(); draw(); };
  const allCheck = h('input', { type: 'checkbox', onchange: (e) => { showAll = e.target.checked; draw(); } });

  const page = h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', null, h('h1', null, 'أرصدة الإجازات'), h('p', { class: 'sub' }, 'الرصيد تحدّده الموارد البشرية لكل موظف، ويُخصم منه تلقائياً كلما اعتُمدت إجازته. المتبقي = الرصيد − المعتمد.')),
      h('div', { class: 'row-actions' }, copyBtn, exportBtn, bulkBtn)),
    h('div', { class: 'tools' }, field('السنة', yearSel), field('المركز', centerSel), field('القسم', deptSel), field('بحث', search),
      h('label', { class: 'check' }, allCheck, 'إظهار الطارئة وأخرى')),
    summary, tabs, notice, tableBox);
  await load();
  return page;
}
