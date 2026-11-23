// سجل العقود: تصفية سريعة ومتقدمة، ترتيب، ترقيم صفحات، تصدير النتائج (كما في السجل القديم).
import { h, clear, icon } from '../dom.js';
import { money, pct, STATUSES, STATUS_CHIP } from '../contracts-lib.js';
import { contractNo } from '../contract-doc.js';
import { EXPORT_COLS, xlsxBlob, toCSV } from '../contract-export.js';
import { printContract, wordContract, saveBlob } from './contract-actions.js';
import { GROUPS } from './contracts-dash.js';
import { applyHeaderDialog } from './contract-bulk-hdr.js';

const dmy = (s) => (s ? s.split('-').reverse().join('/') : '—');
const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const over25 = (r) => r.calc.delta !== null && Math.abs(r.calc.delta) > 0.2501;

// الفلاتر المتقدمة: opt = تُؤخذ خياراتها من القيم الموجودة فعلاً في العقود
export const FILTERS = [
  { k: 'ctype', l: 'نوع العقد', opt: 1 }, { k: 'csubject', l: 'موضوع العقد', opt: 1 }, { k: 'project', l: 'المشروع', opt: 1 },
  { k: 'donor', l: 'الممول', opt: 1 }, { k: 'partner', l: 'جهة التعاون', opt: 1 }, { k: 'siteType', l: 'نوع موقع التنفيذ', opt: 1 },
  { k: 'siteName', l: 'موقع التنفيذ', opt: 1 }, { k: 'area', l: 'المنطقة', opt: 1 }, { k: 'subject', l: 'المادة / النشاط', opt: 1 },
  { k: 'major', l: 'التخصص', opt: 1 }, { k: 'gender', l: 'الجنس', opt: 1 }, { k: 'bank', l: 'البنك', opt: 1 },
  { k: 'sess', l: 'الجلسات في اليوم', vals: [['1', 'جلسة واحدة'], ['2', 'جلستان فأكثر']] },
  { k: 'termType', l: 'نوع الإنهاء', opt: 1 },
  { k: 'over', l: 'تجاوز حد 25٪', vals: [['yes', 'المتجاوزة فقط'], ['no', 'غير المتجاوزة']] },
  { k: 'ending', l: 'تنتهي خلال', vals: [['30', '30 يوماً'], ['60', '60 يوماً'], ['90', '90 يوماً'], ['past', 'انقضت مدتها']] },
  { k: 'signFrom', l: 'وُقّع من تاريخ', t: 'date' }, { k: 'signTo', l: 'وُقّع حتى تاريخ', t: 'date' },
  { k: 'runFrom', l: 'تنفيذه يشمل من', t: 'date' }, { k: 'runTo', l: 'تنفيذه يشمل حتى', t: 'date' },
  { k: 'daysFrom', l: 'أيام التنفيذ من', t: 'num' }, { k: 'daysTo', l: 'أيام التنفيذ حتى', t: 'num' },
  { k: 'rateFrom', l: 'سعر الجلسة من ($)', t: 'num' }, { k: 'rateTo', l: 'سعر الجلسة حتى ($)', t: 'num' },
  { k: 'valFrom', l: 'القيمة من ($)', t: 'num' }, { k: 'valTo', l: 'القيمة حتى ($)', t: 'num' },
];
const SORTS = [['seq', 'رقم العقد'], ['name', 'الاسم'], ['dSign', 'تاريخ التوقيع'], ['dFrom', 'بداية التنفيذ'], ['value', 'القيمة المعتمدة'], ['days', 'الأيام المعتمدة'], ['delta', 'نسبة التغيّر']];
const FLAGS = { incomplete: 'بيانات ناقصة', over: 'تجاوز حد 25٪', nobank: 'بلا حساب بنكي', nosign: 'بلا تاريخ توقيع', nofile: 'بلا مستند موقّع' };

export const emptyFilter = () => ({ q: '', status: '', audit: '', term: '', flag: '', group: null, sort: 'seq', dir: 1, page: 1, size: 50, adv: {} });

export function matches(r, f) {
  const a = f.adv;
  const c = r.calc;
  if (f.status && r.status !== f.status) return false;
  if (f.audit === 'ok' && r.warnings.length) return false;
  if (f.audit === 'bad' && !r.warnings.length) return false;
  if (f.term && !(f.term === 'any' ? c.terminated : f.term === 'none' ? !c.terminated : r.termType === f.term)) return false;
  if (f.flag && !(f.flag === 'incomplete' ? r.warnings.length : f.flag === 'over' ? over25(r) : f.flag === 'nobank' ? !r.bank || !r.iban : f.flag === 'nofile' ? (['موقّع', 'قيد التنفيذ', 'منجز ومكتمل'].includes(r.status) && !r.filesN) : !r.dSign)) return false;
  if (f.group && (r[f.group.by] || '— غير محدد —') !== f.group.val) return false;
  for (const k of ['ctype', 'csubject', 'project', 'donor', 'partner', 'siteType', 'siteName', 'area', 'subject', 'major', 'gender', 'bank', 'termType']) if (a[k] && r[k] !== a[k]) return false;
  if (a.sess === '1' && c.spd !== 1) return false;
  if (a.sess === '2' && !(c.spd > 1)) return false;
  if (a.over === 'yes' && !over25(r)) return false;
  if (a.over === 'no' && over25(r)) return false;
  if (a.ending) {
    if (!r.dTo) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((new Date(`${r.dTo}T00:00:00`) - today) / 86400000);
    if (a.ending === 'past' ? days >= 0 : days < 0 || days > Number(a.ending)) return false;
  }
  if (a.signFrom && (!r.dSign || r.dSign < a.signFrom)) return false;
  if (a.signTo && (!r.dSign || r.dSign > a.signTo)) return false;
  if (a.runFrom && r.dTo && r.dTo < a.runFrom) return false;
  if (a.runTo && r.dFrom && r.dFrom > a.runTo) return false;
  const vf = num(a.valFrom); const vt = num(a.valTo);
  if (vf !== null && !(c.appr !== null && c.appr >= vf)) return false;
  if (vt !== null && !(c.appr !== null && c.appr <= vt)) return false;
  const df = num(a.daysFrom); const dt = num(a.daysTo); const db = num(r.daysBase);
  if (df !== null && !(db !== null && db >= df)) return false;
  if (dt !== null && !(db !== null && db <= dt)) return false;
  const rf = num(a.rateFrom); const rt = num(a.rateTo); const rr = num(r.rate);
  if (rf !== null && !(rr !== null && rr >= rf)) return false;
  if (rt !== null && !(rr !== null && rr <= rt)) return false;
  if (f.q) {
    const hay = [r.name, r.idno, contractNo(r), r.project, r.siteName, r.siteType, r.donor, r.partner, r.service, r.csubject, r.subject, r.major, r.phone, r.email, r.area, r.rfqno, r.iban, r.bank, r.notes, r.residence, r.status].join(' ').toLowerCase();
    if (!hay.includes(f.q.toLowerCase())) return false;
  }
  return true;
}

export function sortRows(list, f) {
  const key = (r) => {
    switch (f.sort) {
      case 'name': return r.name || '';
      case 'dSign': return r.dSign || '';
      case 'dFrom': return r.dFrom || '';
      case 'value': return r.calc.appr === null ? -1 : r.calc.appr;
      case 'days': return Number(r.daysAct ?? -1);
      case 'delta': return r.calc.delta === null ? -9 : r.calc.delta;
      default: return Number(r.seq || 0);
    }
  };
  return list.slice().sort((a, b) => {
    const ka = key(a); const kb = key(b);
    return (typeof ka === 'string' || typeof kb === 'string' ? String(ka).localeCompare(String(kb), 'ar') : ka - kb) * f.dir;
  });
}

function activeChips(f) {
  const out = [];
  if (f.q) out.push(['بحث', f.q, () => { f.q = ''; }]);
  if (f.status) out.push(['الحالة', f.status, () => { f.status = ''; }]);
  if (f.audit) out.push(['التدقيق', f.audit === 'ok' ? 'المكتملة' : 'الناقصة', () => { f.audit = ''; }]);
  if (f.term) out.push(['الإنهاء', f.term === 'any' ? 'منتهية أو مفسوخة' : f.term === 'none' ? 'سارية' : f.term, () => { f.term = ''; }]);
  if (f.flag) out.push(['تنبيه', FLAGS[f.flag], () => { f.flag = ''; }]);
  if (f.group) out.push([GROUPS.find((g) => g[0] === f.group.by)[1], f.group.val, () => { f.group = null; }]);
  for (const x of FILTERS) {
    const v = f.adv[x.k];
    if (!v) continue;
    const shown = x.vals ? x.vals.find((m) => m[0] === v)?.[1] || v : x.t === 'date' ? dmy(v) : v;
    out.push([x.l, shown, () => { delete f.adv[x.k]; }]);
  }
  return out;
}

/** all: كل العقود. f: حالة التصفية (تُعدَّل في مكانها). redraw: يعيد رسم هذا العرض. */
export function drawList({ all, f, user, onEdit, redraw, onChanged }) {
  const filtered = sortRows(all.filter((r) => matches(r, f)), f);
  const pages = f.size ? Math.max(1, Math.ceil(filtered.length / f.size)) : 1;
  if (f.page > pages) f.page = pages;
  const slice = f.size ? filtered.slice((f.page - 1) * f.size, f.page * f.size) : filtered;
  const reset = (fn) => () => { fn(); f.page = 1; redraw(); };

  const sel = (label, value, options, on) => h('select', { 'aria-label': label, onchange: (e) => on(e.target.value) }, options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
  const tools = h('div', { class: 'tools' },
    h('input', { type: 'search', class: 'search', placeholder: 'بحث بالاسم أو الهوية أو رقم العقد أو المشروع أو الممول…', 'aria-label': 'بحث', value: f.q, onchange: reset((e) => e) }),
    sel('التدقيق', f.audit, [['', 'كل السجلات'], ['ok', 'المكتملة فقط'], ['bad', 'الناقصة فقط']], (v) => { f.audit = v; f.page = 1; redraw(); }),
    sel('الحالة', f.status, [['', 'كل الحالات'], ...STATUSES.map((s) => [s, s])], (v) => { f.status = v; f.page = 1; redraw(); }),
    h('button', { type: 'button', class: 'btn', onclick: () => { f.showAdv = !f.showAdv; redraw(); } }, f.showAdv ? 'إخفاء التصفية المتقدّمة' : `تصفية متقدّمة${Object.keys(f.adv).length ? ` (${Object.keys(f.adv).length})` : ''}`));
  const q = tools.querySelector('input');
  q.onchange = undefined;
  q.addEventListener('input', () => { clearTimeout(q._t); q._t = setTimeout(() => { f.q = q.value.trim(); f.page = 1; redraw(true); }, 250); });

  const advBox = f.showAdv ? h('div', { class: 'ct-adv' }, FILTERS.map((x) => {
    let inp;
    if (x.t) inp = h('input', { type: x.t === 'date' ? 'date' : 'number', step: x.t === 'num' ? '0.01' : null, value: f.adv[x.k] || '', id: `flt_${x.k}`, onchange: (e) => { if (e.target.value) f.adv[x.k] = e.target.value; else delete f.adv[x.k]; f.page = 1; redraw(); } });
    else {
      const vals = x.vals || [...new Set(all.map((r) => r[x.k]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'ar')).map((v) => [v, v]);
      inp = h('select', { id: `flt_${x.k}`, onchange: (e) => { if (e.target.value) f.adv[x.k] = e.target.value; else delete f.adv[x.k]; f.page = 1; redraw(); } }, h('option', { value: '' }, 'الكل'), vals.map(([v, t]) => h('option', { value: v, selected: f.adv[x.k] === v }, t)));
    }
    return h('label', { class: 'f' }, h('span', null, x.l), inp);
  })) : null;

  const chips = activeChips(f);
  const chipBar = chips.length ? h('div', { class: 'ct-chips' },
    ...chips.map(([l, v, clr]) => h('span', { class: 'chip chip-none' }, `${l}: ${v} `, h('button', { type: 'button', class: 'linkish', 'aria-label': 'إزالة', onclick: () => { clr(); f.page = 1; redraw(); } }, '✕'))),
    chips.length > 1 ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { Object.assign(f, { ...emptyFilter(), sort: f.sort, dir: f.dir, size: f.size, showAdv: f.showAdv }); redraw(); } }, 'مسح الكل') : null) : null;

  const bar = h('div', { class: 'tools ct-toolrow' },
    h('label', { class: 'check-inline' }, 'ترتيب حسب ', sel('ترتيب', f.sort, SORTS, (v) => { f.sort = v; redraw(); })),
    h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { f.dir = -f.dir; redraw(); } }, f.dir === 1 ? 'تصاعدي ↑' : 'تنازلي ↓'),
    h('label', { class: 'check-inline' }, 'الصفوف في الصفحة ', sel('عدد الصفوف', String(f.size), [['25', '25'], ['50', '50'], ['100', '100'], ['0', 'الكل']], (v) => { f.size = Number(v); f.page = 1; redraw(); })),
    h('button', { type: 'button', class: 'btn btn-sm sp', disabled: !filtered.length, onclick: () => saveBlob(xlsxBlob(EXPORT_COLS, filtered), `عقود نوى — النتائج (${filtered.length}).xlsx`) }, icon('download'), 'تصدير النتائج Excel'),
    h('button', { type: 'button', class: 'btn btn-sm', disabled: !filtered.length, onclick: () => saveBlob(new Blob([toCSV(EXPORT_COLS, filtered)], { type: 'text/csv;charset=utf-8' }), `عقود نوى — النتائج (${filtered.length}).csv`) }, 'CSV'));

  bar.append(h('button', { type: 'button', class: 'btn btn-sm', disabled: !filtered.length, onclick: () => applyHeaderDialog(filtered, () => onChanged?.()) }, 'تطبيق ترويسة على النتائج'));

  const n = (s) => filtered.filter((r) => r.status === s).length;
  const sum = h('div', { class: 'pv-summary' }, h('span', { class: 'chip chip-none' }, `المعروض: ${filtered.length} من ${all.length}`),
    ...STATUSES.filter((s) => n(s)).map((s) => h('button', { type: 'button', class: `chip linkchip ${STATUS_CHIP[s]}`, onclick: () => { f.status = s; f.page = 1; redraw(); } }, `${s}: ${n(s)}`)));

  const box = h('div', { class: 'table-wrap' });
  if (!filtered.length) box.append(h('p', { class: 'empty' }, 'لا عقود مطابقة.'));
  else {
    const heads = ['رقم العقد', 'المتعاقد', 'فترة التنفيذ', 'القيمة', 'الحالة', ''];
    box.append(h('table', { class: 'tbl ct-list' },
      h('thead', null, h('tr', null, heads.map((t) => h('th', null, t)))),
      h('tbody', null, slice.map((r) => {
        const meta = [r.ctype, r.project].filter(Boolean).join(' — ');
        const delta = r.calc.delta;
        return h('tr', null,
          h('td', { class: 'c-no' }, h('span', { dir: 'ltr', class: 'no' }, contractNo(r)), h('span', { class: 'seq' }, `م ${r.seq ?? '—'}`)),
          h('td', { class: 'c-name' },
            h('div', { class: 'nm' }, h('strong', null, r.name), r.filesN ? h('span', { class: 'ct-clip', title: `${r.filesN} مستند مرفوع` }, ` 📎${r.filesN}`) : null),
            h('div', { class: 'meta', title: meta }, meta || '—'),
            r.idno ? h('div', { class: 'idno', dir: 'ltr' }, r.idno) : null),
          h('td', { class: 'c-per' }, h('div', null, `${dmy(r.dFrom)} ← ${dmy(r.dTo)}`), h('div', { class: 'meta' }, `${r.daysBase ?? '—'} يوماً · الفعلي ${r.daysAct ?? '—'}`)),
          h('td', { class: 'c-val' },
            h('div', { class: 'amt' }, r.calc.appr !== null ? money(r.calc.appr) : '—'),
            h('div', { class: 'meta' }, r.calc.dayRate !== null ? `${money(r.calc.dayRate)} / يوم` : '—',
              delta !== null && Math.abs(delta) > 0.0001 ? h('span', { class: `dl${delta > 0 ? ' up' : ''}` }, ` ${pct(delta)}`) : null)),
          h('td', { class: 'c-st' },
            h('span', { class: `chip ${STATUS_CHIP[r.status] || 'chip-none'}` }, r.status),
            r.warnings.length ? h('span', { class: 'chip chip-late', title: r.warnings.join('\n') }, `${r.warnings.length} ملاحظة`) : h('span', { class: 'chip chip-present' }, 'سليم')),
          h('td', { class: 'row-actions' },
            h('button', { type: 'button', class: 'btn btn-sm edit', onclick: () => onEdit(r) }, 'تعديل'),
            h('div', { class: 'sec' },
              h('button', { type: 'button', class: 'btn btn-sm', title: 'طباعة العقد A4', onclick: () => printContract(r) }, 'طباعة'),
              h('button', { type: 'button', class: 'btn btn-sm', title: 'تنزيل العقد بصيغة Word', onclick: () => wordContract(r) }, 'Word'))));
      }))));
  }

  // ترقيم الصفحات
  const nav = h('div', { class: 'ct-pages' });
  if (filtered.length) {
    const from = f.size ? (f.page - 1) * f.size + 1 : 1;
    const to = f.size ? Math.min(filtered.length, f.page * f.size) : filtered.length;
    nav.append(h('span', null, `إظهار ${from} إلى ${to} من ${filtered.length} عقداً`));
    if (pages > 1) {
      const go = (p, t, off, cur) => h('button', { type: 'button', class: 'btn btn-sm', disabled: off, 'aria-current': cur ? 'true' : null, onclick: () => { f.page = p; redraw(); } }, t);
      nav.append(go(1, '«', f.page === 1), go(f.page - 1, '‹', f.page === 1));
      const win = [...new Set([1, pages, f.page - 1, f.page, f.page + 1].filter((p) => p >= 1 && p <= pages))].sort((a, b) => a - b);
      let prev = 0;
      for (const p of win) { if (prev && p - prev > 1) nav.append(h('span', null, '…')); nav.append(go(p, String(p), false, p === f.page)); prev = p; }
      nav.append(go(f.page + 1, '›', f.page === pages), go(pages, '»', f.page === pages));
    }
  }
  return { el: h('div', null, tools, advBox, chipBar, bar, sum, box, nav), count: filtered.length };
}
