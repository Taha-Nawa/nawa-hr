import { h, clear, icon, field, select, toast, confirmBox } from '../dom.js';
import { get, post } from '../api.js';
import { KIND, kindOf, statusChip, purposeText, fmtPeriod, fmtLength, fmtDate } from '../requests-lib.js';
import { openRequestForm, openRequestDetail } from '../request-ui.js';
import { PURPOSES, fmtDays } from '../balances-lib.js';

export default async function render({ user }) {
  const meta = await get('/api/requests/meta');
  const shown = [];
  if (meta.linked) shown.push({ id: 'mine', label: 'طلباتي' });
  if (meta.canDecide) shown.push({ id: 'inbox', label: 'بانتظار قراري', count: meta.pending }, { id: 'all', label: 'السجل' });
  let tab = meta.canDecide && meta.pending > 0 ? 'inbox' : shown[0]?.id || 'mine';
  let rows = [];
  let status = '';
  let kind = '';
  let q = '';
  const picked = new Set();

  const tabBar = h('div', { class: 'seg-tabs', role: 'tablist', 'aria-label': 'قوائم الطلبات' });
  const tools = h('div', { class: 'tools' });
  const box = h('div', { class: 'table-wrap' });
  const notice = h('div');

  const newButtons = (meta.linked || meta.canBehalf)
    ? ['leave', 'exit', 'late', 'mission'].map((k, i) => h('button', {
      type: 'button', class: i === 0 ? 'btn btn-primary' : 'btn',
      onclick: () => openRequestForm({ kind: k, meta, user, onSaved: () => { window.dispatchEvent(new CustomEvent('requests:changed')); load(); } }),
    }, icon(KIND[k].icon), KIND[k].label))
    : [];
  // الاختصار إلى التخطيط المسبق: الإجازات المتوقعة بتقويم شهري
  if (meta.linked) newButtons.push(h('a', { class: 'btn btn-ghost', href: '#/plans' }, icon('calendar'), 'خطّط إجازاتك القادمة'));

  function drawTabs() {
    clear(tabBar).append(...shown.map((t) => h('button', {
      type: 'button', role: 'tab', class: `seg-tab${t.id === tab ? ' on' : ''}`, 'aria-selected': String(t.id === tab),
      onclick: () => { tab = t.id; status = ''; kind = ''; q = ''; drawTabs(); load(); },
    }, t.label, t.count ? h('b', { class: 'count' }, t.count) : null)));
  }

  function drawTools() {
    clear(tools);
    if (tab === 'inbox') return;
    const qIn = h('input', { type: 'search', placeholder: 'بحث بالاسم', value: q, 'aria-label': 'بحث', oninput: (e) => { q = e.target.value; drawRows(); } });
    tools.append(...[
      tab === 'all' ? qIn : null,
      select([['', 'كل الحالات'], ['pending', 'بانتظار الاعتماد'], ['approved', 'معتمد'], ['rejected', 'مرفوض'], ['cancelled', 'ملغى']], status, { 'aria-label': 'الحالة', onchange: (e) => { status = e.target.value; load(); } }),
      select([['', 'كل الأنواع'], ['leave', 'الإجازات'], ['exit', 'المغادرات'], ['late', 'التأخير'], ['mission', 'مهام العمل']], kind, { 'aria-label': 'النوع', onchange: (e) => { kind = e.target.value; load(); } }),
    ].filter(Boolean));
  }

  async function approveSelected() {
    const ids = [...picked];
    if (!ids.length || !(await confirmBox(`اعتماد ${ids.length} طلب كما قُدّمت (دون تعديل)؟ يطبّق النظام على كل طلب قواعده (الأرصدة، الورقة الطبية، التعارض) وما لا يجوز اعتماده يُترك ويُذكر.`, 'اعتماد المحدد'))) return;
    let ok = 0;
    const failed = [];
    for (const id of ids) {
      try {
        await post(`/api/requests/${id}/approve`, {});
        ok += 1;
      } catch (e) {
        failed.push(`#${id}: ${e.message}`);
      }
    }
    picked.clear();
    toast(failed.length ? `اعتُمد ${ok} وتعذّر ${failed.length}: ${failed[0]}` : `اعتُمد ${ok} طلب`, failed.length ? 'err' : 'ok');
    meta.pending = Math.max(0, meta.pending - ok);
    load();
  }

  function drawRows() {
    const list = rows.filter((r) => !q || r.employeeName.includes(q) || r.employeeCode.toLowerCase().includes(q.toLowerCase()));
    clear(box);
    if (!list.length) {
      box.append(h('p', { class: 'empty' }, tab === 'inbox' ? 'لا طلبات بانتظار قرارك.' : tab === 'mine' ? 'لم تقدّم أي طلب بعد. استعمل الأزرار أعلاه لتقديم إجازة أو إذن.' : 'لا طلبات مطابقة.'));
      return;
    }
    const showEmp = tab !== 'mine';
    const bulk = tab === 'inbox';
    if (bulk) {
      const all = h('input', { type: 'checkbox', 'aria-label': 'تحديد الكل', checked: list.every((r) => picked.has(r.id)), onchange: (e) => { for (const r of list) (e.target.checked ? picked.add(r.id) : picked.delete(r.id)); drawRows(); } });
      box.append(h('div', { class: 'bulk-bar' }, h('label', { class: 'check' }, all, ' تحديد الكل'),
        h('button', { type: 'button', class: 'btn btn-primary', disabled: picked.size === 0, onclick: approveSelected }, icon('check'), `اعتماد المحدد (${picked.size})`)));
    }
    box.append(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, [bulk ? '' : null, 'الطلب', showEmp ? 'الموظف' : null, 'الفترة', 'المدة', 'الغرض', 'التقديم', 'الحالة', ''].map((t) => (t === null ? null : h('th', null, t))))),
      h('tbody', null, list.map((r) => h('tr', { class: 'req-row', tabindex: '0', onclick: () => open(r.id), onkeydown: (e) => { if (e.key === 'Enter') open(r.id); } },
        bulk ? h('td', { onclick: (e) => e.stopPropagation() }, h('input', { type: 'checkbox', 'aria-label': `تحديد طلب ${r.employeeName}`, checked: picked.has(r.id), onchange: (e) => { if (e.target.checked) picked.add(r.id); else picked.delete(r.id); drawRows(); } })) : null,
        h('td', null, h('span', { class: 'kind-tag' }, icon(KIND[kindOf(r)].icon), KIND[kindOf(r)].short)),
        showEmp ? h('td', { class: 'wide' }, h('span', { class: 'emp-link' }, r.employeeName), h('div', { class: 'code' }, r.employeeCode)) : null,
        h('td', { class: 'wide' }, fmtPeriod(r)),
        h('td', { class: 'num' }, fmtLength(r)),
        h('td', { class: 'w2' }, purposeText(r)),
        h('td', { class: 'num' }, fmtDate(r.requestDate)),
        h('td', { class: 'w2' }, statusChip(r.status)),
        h('td', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: (e) => { e.stopPropagation(); open(r.id); } }, tab === 'inbox' ? 'مراجعة' : 'فتح')))))));
  }

  const open = (id) => openRequestDetail({ id, meta, onChanged: load });

  async function load() {
    clear(box).append(h('p', { class: 'loading' }, 'جارٍ التحميل…'));
    const p = new URLSearchParams({ scope: tab });
    if (status) p.set('status', status);
    if (kind) p.set('kind', kind);
    try {
      rows = (await get(`/api/requests?${p}`)).requests;
    } catch (e) {
      clear(box).append(h('div', { class: 'notice notice-err' }, e.message));
      return;
    }
    drawTools();
    drawRows();
  }

  if (!meta.linked && !meta.canBehalf) {
    notice.append(h('div', { class: 'notice notice-warn' }, 'حسابك غير مرتبط بسجل موظف، فلا يمكن تقديم طلبات منه. راجع الموارد البشرية لربطه.'));
  }
  if (!meta.work && ['hr', 'director', 'admin'].includes(user.role)) {
    notice.append(h('div', { class: 'notice notice-warn' }, 'لم تُدخل إعدادات الدوام بعد، لذا لا يمكن احتساب الإجازات. أدخلها من «الإعدادات والعطل».'));
  }

  // رصيدي لهذه السنة (خاص بي أو الافتراضي): المتبقي بعد المعتمد، وما هو معلّق بانتظار القرار
  const balanceStrip = meta.balance
    ? h('section', { class: 'bal-strip', 'aria-label': 'رصيد إجازاتي' },
      meta.balance.items.map((b) => h('div', { class: 'sum' },
        h('b', null, fmtDays(b.remaining)),
        h('span', null, `${PURPOSES[b.purpose] || b.purpose}: متبقٍّ من ${fmtDays(b.total)} (مستهلك ${fmtDays(b.used)}${b.pending ? `، معلّق ${fmtDays(b.pending)}` : ''})`))))
    : null;

  const page = h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', null, h('h1', null, 'الطلبات'), h('p', { class: 'sub' }, 'الإجازات وأذونات المغادرة والتأخير ومهام العمل')),
      h('div', { class: 'row-actions new-req' }, newButtons)),
    notice,
    balanceStrip,
    shown.length > 1 ? tabBar : null,
    tools, box);
  drawTabs();
  if (shown.length) await load();
  else clear(box).append(h('p', { class: 'empty' }, 'لا شيء لعرضه.'));
  // رابط البريد: #/requests?open=ID يفتح الطلب مباشرة
  const wanted = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('open')) || null;
  if (wanted) open(wanted);
  return page;
}
