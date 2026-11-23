// نموذج العقد (إضافة وتعديل): المجموعات نفسها في سجل العقود القديم، والحقول المحسوبة تتحدّث أثناء الكتابة بالمعادلات نفسها.
import { h, dialog, field, toast } from '../dom.js';
import { post, patch } from '../api.js';
import { compute, audit, money, pct, NONE_TERM, LUMP, DAILY, STATUSES, TERM_ARTICLE } from '../contracts-lib.js';

let seq = 0;
const GROUPS = [
  ['بيانات مقدّم/ة الخدمة', [
    ['name', 'اسم الطرف الثاني (رباعياً)', 'text', { wide: 1, req: 1 }], ['idno', 'رقم الهوية', 'text', { hint: '9 خانات رقمية', ltr: 1 }],
    ['gender', 'الجنس / نوع مقدّم الخدمة', 'list:gender'], ['title', 'الصفة', 'list:title'], ['residence', 'مكان الإقامة', 'sug'],
    ['phone', 'رقم الجوال', 'text', { ltr: 1 }], ['email', 'البريد الإلكتروني', 'text', { ltr: 1 }],
    ['workEmail', 'بريد نوى الرسمي', 'text', { ltr: 1, hint: 'معلومة فقط؛ لا يمنح أي صلاحية دخول' }], ['major', 'التخصص', 'sug'], ['exp', 'سنوات الخبرة', 'text']]],
  ['التعريف بالعقد والمشروع والتمويل', [
    ['ctype', 'نوع العقد', 'list:ctype'], ['csubject', 'موضوع / عنوان العقد', 'list:csubject'], ['service', 'وصف الخدمة المتعاقد عليها', 'sug', { wide: 1 }],
    ['project', 'اسم المشروع', 'sug', { wide: 1 }], ['partner', 'جهة التعاون / الشريك المنفّذ', 'sug', { wide: 1 }], ['donor', 'اسم الممول', 'sug', { wide: 1 }],
    ['hdr', 'مجموعة الترويسة', 'sug', { hint: 'اتركه فارغاً ليتبع الربط التلقائي' }]]],
  ['الإجراء التعاقدي والتواريخ', [
    ['rfqno', 'رقم استدراج العرض / العطاء', 'text', { hint: 'إلزامي لعرض السعر والعطاء' }], ['dRfq', 'تاريخ إعلان عرض السعر / العطاء', 'date'],
    ['dOffer', 'تاريخ تقديم العرض من مزوّد الخدمة', 'date'], ['dSign', 'تاريخ توقيع العقد من مزوّد الخدمة', 'date']]],
  ['فترة تنفيذ العقد', [['dFrom', 'بداية فترة التنفيذ (من)', 'date'], ['dTo', 'نهاية فترة التنفيذ (إلى)', 'date'], ['subject', 'المادة / النشاط المنفَّذ', 'sug']]],
  ['مكان تنفيذ الخدمة', [['siteType', 'نوع موقع التنفيذ', 'list:siteType'], ['siteName', 'اسم موقع التنفيذ', 'sug'], ['area', 'المنطقة', 'sug']]],
  ['القيمة المالية وحد التعديل 25٪ — المادتان (2-4) و(7)', [
    ['pricing', 'أساس التسعير', 'list:pricing', { wide: 1 }], ['rate', 'سعر الجلسة الواحدة ($)', 'number', { hint: 'القيمة المستحقة عن جلسة واحدة (أو المبلغ المقطوع)' }],
    ['sessPerDay', 'عدد الجلسات في يوم العمل الواحد', 'number', { hint: '1 = جلسة واحدة · 2 = جلستان … (الافتراضي 1)' }], ['_dayRate', 'قيمة يوم التنفيذ الواحد ($)', 'calc'],
    ['daysBase', 'عدد أيام التنفيذ المتفق عليها', 'number', { hint: 'أيام عمل داخل الفترة، لا أيام الفترة' }], ['_sessB', 'إجمالي الجلسات المتفق عليها', 'calc'],
    ['_base', 'القيمة التعاقدية الأساسية ($)', 'calc'], ['_range', 'المدى المسموح (أيام) ±25٪', 'calc'],
    ['daysAct', 'عدد أيام التنفيذ المعتمدة فعلياً', 'number'], ['_appr', 'القيمة المعتمدة ($)', 'calc'], ['_delta', 'نسبة التغيّر عن القيمة الأساسية', 'calc'],
    ['_words', 'القيمة المعتمدة كتابةً (تفقيط)', 'calc', { wide: 1 }], ['bank', 'اسم البنك', 'sug'], ['iban', 'رقم الحساب / IBAN', 'text', { ltr: 1 }]]],
  ['حالة العقد والإنهاء — المواد (9) و(11) و(13)', [
    ['status', 'حالة العقد', 'list:status'], ['termType', 'نوع الإنهاء / الفسخ', 'list:termType'], ['termReason', 'سبب الإنهاء / الفسخ', 'list:termReason'],
    ['_article', 'المادة المستند إليها', 'calc'], ['dTerm', 'تاريخ الإنهاء / الفسخ', 'date'], ['daysTerm', 'أيام التنفيذ المعتمدة حتى الإنهاء', 'number'],
    ['_due', 'المستحق حتى الإنهاء ($)', 'calc'], ['notes', 'ملاحظات', 'textarea', { wide: 1 }]]],
];

export function contractDialog({ c = null, lists, onDone }) {
  const id = ++seq;
  const inputs = {};
  const calcs = {};
  const opts = {
    gender: lists.lists.gender, title: lists.lists.title, ctype: lists.lists.ctype, csubject: lists.lists.csubject, siteType: lists.lists.siteType,
    pricing: lists.lists.pricing, status: STATUSES, termType: Object.keys(TERM_ARTICLE), termReason: lists.lists.termReason,
  };
  const warn = h('ul', { class: 'ct-warn' });
  const err = h('div', { class: 'notice notice-err', role: 'alert', hidden: true });
  const init = { status: 'مسودة', termType: NONE_TERM, pricing: DAILY, sessPerDay: 1, termReason: 'لا يوجد', ...(c || {}) };

  function make([k, label, type, o = {}]) {
    if (type === 'calc') {
      const out = h('output', { class: 'ct-calc' }, '—');
      calcs[k] = out;
      return h('div', { class: `field${o.wide ? ' span-all' : ''}` }, h('span', { class: 'field-label' }, label), out);
    }
    let el;
    const v = init[k] ?? '';
    if (type.startsWith('list:')) {
      el = h('select', null, h('option', { value: '' }, '—'), opts[type.slice(5)].map((x) => h('option', { value: x, selected: x === v }, x)));
      if (v && !opts[type.slice(5)].includes(v)) el.append(h('option', { value: v, selected: true }, v));
    } else if (type === 'textarea') el = h('textarea', { rows: 2, maxlength: 1000 }, v);
    else {
      el = h('input', { type: type === 'sug' ? 'text' : type, value: v, autocomplete: 'off', ...(type === 'number' ? { step: 'any', min: 0, inputmode: 'decimal' } : {}) });
      if (type === 'sug') { const dl = h('datalist', { id: `ct-${id}-${k}` }, (lists.suggestions[k] || []).map((x) => h('option', { value: x }))); el.setAttribute('list', dl.id); el.after?.(dl); el._dl = dl; }
    }
    if (o.ltr) el.setAttribute('dir', 'ltr');
    el.addEventListener('input', refresh);
    el.addEventListener('change', refresh);
    inputs[k] = el;
    const f = field(label, el, o.hint);
    if (el._dl) f.append(el._dl);
    if (o.wide) f.classList.add('span-all');
    return f;
  }

  const read = () => Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value === '' ? null : el.value]));
  function refresh() {
    const r = read();
    const k = compute(r);
    const lump = r.pricing === LUMP;
    const set = (key, val) => { calcs[key].textContent = val === null || val === '' || val === undefined ? '—' : val; };
    set('_dayRate', k.dayRate !== null ? money(k.dayRate) : '');
    set('_sessB', k.sessB);
    set('_base', k.base !== null ? money(k.base) : '');
    set('_range', k.min !== null && !lump ? `من ${k.min} إلى ${k.max}` : '');
    set('_appr', k.appr !== null ? money(k.appr) : '');
    set('_delta', k.delta !== null ? pct(k.delta) : '');
    set('_words', k.words);
    set('_article', k.article);
    set('_due', k.due !== null ? money(k.due) : '');
    const w = r.name ? audit(r) : [];
    warn.replaceChildren(...w.map((x) => h('li', null, x)));
    warn.hidden = !w.length;
  }

  const body = h('form', { class: 'ct-form', onsubmit: async (e) => {
    e.preventDefault();
    err.hidden = true;
    try {
      const payload = read();
      const res = c ? await patch(`/api/contracts/${c.id}`, payload) : await post('/api/contracts', payload);
      toast('حُفظ العقد');
      dlg.close();
      onDone?.(res.contract);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  } },
  GROUPS.map(([title, fields]) => h('fieldset', { class: 'ct-group' }, h('legend', null, title), h('div', { class: 'form-grid' }, fields.map(make)))),
  h('div', { class: 'ct-audit' }, h('strong', null, 'ملاحظات التدقيق (لا تمنع الحفظ)'), warn),
  err,
  h('div', { class: 'dlg-actions' },
    h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'إلغاء'),
    h('button', { type: 'submit', class: 'btn btn-primary' }, c ? 'حفظ التعديلات' : 'إضافة العقد')));
  const dlg = dialog({ title: c ? `تعديل عقد — ${c.name}` : 'عقد جديد', content: body, wide: true });
  refresh();
  return dlg;
}
