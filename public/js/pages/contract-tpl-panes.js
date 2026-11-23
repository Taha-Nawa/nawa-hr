// لوحات محرّر الصيغة: نص العقد (كتل)، حقول الصيغة، الطرف الأول، الثوابت، التنسيق والتذييل، الشعارات.
import { h, field, confirmBox } from '../dom.js';
import { tokenList, PAY_TOKENS, RATE_TOKENS } from '../contract-tpl.js';
import { BASE_BLOCKS, FMT_DEFAULT, FOOT_DEFAULT } from '../contract-tpl-base.js';
import { logoEditor } from './contract-logos-ui.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const BLOCK_TYPES = [['h1', 'عنوان العقد'], ['lede', 'تعريف مظلّل'], ['sec', 'عنوان قسم'], ['art', 'مادة (ترقيم تلقائي)'], ['cl', 'بند (ترقيم تلقائي)'], ['p', 'فقرة'], ['party', 'طرف في العقد'], ['sigdate', 'سطر التوقيع والتاريخ'], ['sign', 'جدول التوقيعين'], ['pagebreak', 'فاصل صفحة']];
const TYPE_SHORT = { h1: 'عنوان', lede: 'تعريف', sec: 'قسم', art: 'مادة', cl: 'بند', p: 'فقرة', party: 'طرف', sigdate: 'توقيع', sign: 'توقيعان', pagebreak: 'صفحة جديدة' };
const FP_FIELDS = [['org', 'اسم الطرف الأول'], ['orgDesc', 'وصف الطرف الأول'], ['rep', 'ممثل الطرف الأول'], ['repRole', 'صفة الممثل'], ['city', 'مدينة التوقيع'], ['addr', 'العنوان بالعربية'], ['addrEn', 'العنوان بالإنجليزية'], ['tel', 'الهاتف'], ['fax', 'الفاكس']];

const input = (o, k, attrs = {}, onChange) => h('input', { type: 'text', value: o[k] ?? '', ...attrs, oninput: (e) => { o[k] = e.target.value; onChange?.(); } });

/** ---------- نص العقد: كتل ---------- */
export function blocksPane(draft, { touch, lists, preview, wordImport }) {
  let openId = null;
  const host = h('div', { class: 'tp-blocks' });
  const missing = h('div', { class: 'notice notice-warn', hidden: true });
  const checkPay = () => {
    const txt = draft.blocks.map((b) => b.text).join('\n');
    const m = [];
    if (!PAY_TOKENS.some((k) => txt.includes(`{{${k}}}`))) m.push('قيمة العقد ({{الإجمالي}} أو {{القيمة_المعتمدة}})');
    if (!RATE_TOKENS.some((k) => txt.includes(`{{${k}}}`))) m.push('سعر اليوم ({{سعر_اليوم}})');
    missing.hidden = !m.length;
    missing.textContent = m.length ? `لا يمكن حفظ الصيغة قبل ذكر المقابل المالي للمتعاقد: ${m.join(' و ')}` : '';
  };
  const change = () => { touch(); checkPay(); };

  function blockEditor(b, i) {
    const ta = h('textarea', { class: 'tp-ta', rows: Math.min(14, Math.max(3, String(b.text || '').split('\n').length + 2)), oninput: (e) => { b.text = e.target.value; change(); } }, b.text || '');
    const pal = h('div', { class: 'tp-pal', hidden: true });
    for (const [g, keys] of tokenList(draft)) {
      pal.append(h('div', { class: 'tp-pal-g' }, g), h('div', { class: 'tp-chips' }, keys.map((k) => h('button', { type: 'button', class: 'tp-chip', onclick: () => {
        const s = ta.selectionStart || 0; const e = ta.selectionEnd || 0;
        ta.value = `${ta.value.slice(0, s)}{{${k}}}${ta.value.slice(e)}`;
        b.text = ta.value; ta.focus(); ta.selectionStart = ta.selectionEnd = s + k.length + 4; change();
      } }, k))));
    }
    pal.append(h('button', { type: 'button', class: 'tp-chip', onclick: () => { const s = ta.selectionStart || 0; ta.value = `${ta.value.slice(0, s)}{{ذ:مقدم|أ:مقدمة}}${ta.value.slice(s)}`; b.text = ta.value; change(); } }, 'ذ/أ صيغة المذكر والمؤنث'));

    const when = b.when || {};
    const cur = when.ctype ? `c:${when.ctype[0]}` : when.pricing ? `p:${when.pricing[0]}` : when.sessions ? `s:${when.sessions}` : when.gender ? `g:${when.gender}` : '';
    const whenSel = h('select', { onchange: (e) => {
      const v = e.target.value;
      if (!v) delete b.when;
      else if (v[0] === 'c') b.when = { ctype: [v.slice(2)] };
      else if (v[0] === 'p') b.when = { pricing: [v.slice(2)] };
      else if (v[0] === 's') b.when = { sessions: v.slice(2) };
      else b.when = { gender: v.slice(2) };
      change(); draw();
    } },
    h('option', { value: '' }, 'تظهر دائماً'),
    lists.ctype.map((v) => h('option', { value: `c:${v}`, selected: cur === `c:${v}` }, `فقط مع نوع العقد: ${v}`)),
    lists.pricing.map((v) => h('option', { value: `p:${v}`, selected: cur === `p:${v}` }, `فقط مع التسعير: ${v}`)),
    ['ذكر', 'أنثى'].map((v) => h('option', { value: `g:${v}`, selected: cur === `g:${v}` }, `فقط إذا كان الجنس: ${v}`)),
    h('option', { value: 's:one', selected: cur === 's:one' }, 'فقط إذا كانت جلسة واحدة في اليوم'),
    h('option', { value: 's:multi', selected: cur === 's:multi' }, 'فقط إذا كانت أكثر من جلسة في اليوم'));
    const st = () => (b.style ||= {});
    const base = BASE_BLOCKS.find((x) => x.id === b.id);
    const swap = (d) => { const a = draft.blocks; const j = i + d; if (j < 0 || j >= a.length) return; [a[j], a[i]] = [a[i], a[j]]; change(); draw(); };
    return h('div', { class: 'tp-blk-b' },
      ta,
      h('p', { class: 'hint' }, 'الرموز بين قوسين مزدوجين، وابدأ السطر بـ «- » لبند نقطي، و**نص** للغامق، و__نص__ للمسطّر.'),
      h('div', { class: 'tp-tools' },
        field('النوع', h('select', { onchange: (e) => { b.type = e.target.value; change(); draw(); } }, BLOCK_TYPES.map(([k, l]) => h('option', { value: k, selected: b.type === k }, l)))),
        field('الظهور', whenSel),
        field('المحاذاة', h('select', { onchange: (e) => { if (e.target.value) st().align = e.target.value; else delete st().align; change(); } }, [['', 'افتراضي'], ['right', 'يمين'], ['center', 'وسط'], ['justify', 'ضبط'], ['left', 'يسار']].map(([k, l]) => h('option', { value: k, selected: (b.style?.align || '') === k }, l)))),
        field('الحجم (pt)', h('input', { type: 'number', min: 7, max: 30, step: 0.5, value: b.style?.size ?? '', onchange: (e) => { const v = Number(e.target.value); if (v) st().size = v; else delete st().size; change(); } })),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!b.style?.nb, onchange: (e) => { if (e.target.checked) st().nb = 1; else delete st().nb; change(); } }), 'تبدأ صفحة جديدة')),
      h('div', { class: 'tp-bar' },
        h('button', { type: 'button', class: 'btn', onclick: () => { pal.hidden = !pal.hidden; } }, 'إدراج رمز'),
        h('button', { type: 'button', class: 'btn', onclick: () => swap(-1) }, '▲'), h('button', { type: 'button', class: 'btn', onclick: () => swap(1) }, '▼'),
        h('button', { type: 'button', class: 'btn', onclick: () => { const c = clone(b); c.id = uid('b'); draft.blocks.splice(i + 1, 0, c); openId = c.id; change(); draw(); } }, 'نسخ'),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: async () => { if (!(await confirmBox('يُحذف هذا الجزء من نص الصيغة.', 'حذف', true))) return; draft.blocks.splice(i, 1); openId = null; change(); draw(); } }, 'حذف'),
        base && JSON.stringify(base) !== JSON.stringify(b) ? h('button', { type: 'button', class: 'btn', onclick: () => { draft.blocks[i] = clone(base); change(); draw(); } }, 'إرجاع للأصل') : null),
      pal);
  }

  function draw() {
    let art = 0; let cl = 0;
    host.replaceChildren(
      ...draft.blocks.map((b, i) => {
        let tag = TYPE_SHORT[b.type] || b.type;
        if (b.type === 'art') { art += 1; cl = 0; tag = `المادة (${art})`; }
        if (b.type === 'cl') { cl += 1; tag = `${art}.${cl}`; }
        const cond = b.when && (b.when.ctype || b.when.pricing || b.when.gender || b.when.sessions);
        return h('div', { class: `tp-blk${openId === b.id ? ' open' : ''}` },
          h('button', { type: 'button', class: 'tp-blk-h', onclick: () => { openId = openId === b.id ? null : b.id; draw(); } },
            h('span', { class: 'tp-blk-t' }, tag), h('span', { class: 'tp-blk-p' }, (b.text || '').replace(/\n/g, ' ').slice(0, 90) || '(فارغة)'), cond ? h('span', { class: 'tp-blk-c' }, 'شرطية') : null),
          openId === b.id ? blockEditor(b, i) : null);
      }),
      h('div', { class: 'tp-bar' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { const nb = { id: uid('b'), type: 'p', text: 'نص جديد…' }; draft.blocks.push(nb); openId = nb.id; change(); draw(); } }, '＋ كتلة جديدة'),
        wordImport ? h('button', { type: 'button', class: 'btn', onclick: wordImport }, 'استيراد نص من ملف Word') : null,
        h('button', { type: 'button', class: 'btn', onclick: preview }, 'معاينة'),
        h('button', { type: 'button', class: 'btn', onclick: async () => { if (!(await confirmBox('يُستبدل نص هذه الصيغة بالكامل بنص العقد الأصلي الموقّع.', 'إرجاع', true))) return; draft.blocks = clone(BASE_BLOCKS); change(); draw(); } }, 'إرجاع النص كاملاً للأصل الموقّع')));
  }
  draw();
  checkPay();
  return h('div', null, missing, host);
}

/** ---------- حقول الصيغة المخصّصة ---------- */
export function fieldsPane(draft, { touch }) {
  draft.fields ||= [];
  const host = h('div');
  const draw = () => host.replaceChildren(
    h('p', { class: 'hint' }, 'حقول إضافية تظهر في نموذج العقد عند اختيار هذه الصيغة، ويُدرج الواحد منها في النص بمفتاحه: {{المفتاح}}.'),
    ...draft.fields.map((f, i) => h('div', { class: 'tp-field' },
      field('المفتاح (يُكتب في النص)', input(f, 'k', { maxlength: 40, placeholder: 'رقم_القرار' }, touch)),
      field('العنوان في النموذج', input(f, 'label', { maxlength: 80 }, touch)),
      field('النوع', h('select', { onchange: (e) => { f.type = e.target.value; touch(); draw(); } }, [['text', 'نص'], ['num', 'رقم'], ['date', 'تاريخ'], ['sel', 'قائمة خيارات']].map(([k, l]) => h('option', { value: k, selected: f.type === k }, l)))),
      f.type === 'sel' ? field('الخيارات (واحد في كل سطر)', h('textarea', { rows: 3, oninput: (e) => { f.opts = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); touch(); } }, (f.opts || []).join('\n'))) : null,
      h('button', { type: 'button', class: 'btn btn-danger', onclick: () => { draft.fields.splice(i, 1); touch(); draw(); } }, 'حذف'))),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { draft.fields.push({ k: `حقل_${draft.fields.length + 1}`, label: 'حقل جديد', type: 'text', opts: [] }); touch(); draw(); } }, '＋ حقل جديد'));
  draw();
  return host;
}

/** ---------- الطرف الأول ---------- */
export function fpPane(draft, { touch }) {
  return h('div', { class: 'form-grid' },
    FP_FIELDS.map(([k, l]) => field(l, input(draft.fp, k, { maxlength: 300 }, touch))));
}

/** ---------- الثوابت (مرجع للمراجعة) ---------- */
export function constsPane(draft, { touch }) {
  const host = h('div', { class: 'tp-consts' });
  const draw = () => host.replaceChildren(
    h('p', { class: 'hint' }, 'جدول مرجعي بثوابت العقد الموقّع يُراجَع عند تعديل النص؛ لا يدخل في العقد المطبوع إلا إذا أدرجتَ قيمته في الكتل.'),
    ...draft.consts.map((r, i) => (r[1] === null
      ? h('div', { class: 'tp-const-h' }, input(r, 0, { maxlength: 200 }, touch), h('button', { type: 'button', class: 'btn', onclick: () => { draft.consts.splice(i, 1); touch(); draw(); } }, 'حذف'))
      : h('div', { class: 'tp-const' }, input(r, 0, { maxlength: 200 }, touch), h('textarea', { rows: 2, oninput: (e) => { r[1] = e.target.value; touch(); } }, r[1] || ''), input(r, 2, { maxlength: 120, placeholder: 'موضعه' }, touch), h('button', { type: 'button', class: 'btn', onclick: () => { draft.consts.splice(i, 1); touch(); draw(); } }, 'حذف')))),
    h('div', { class: 'tp-bar' },
      h('button', { type: 'button', class: 'btn', onclick: () => { draft.consts.push(['ثابت جديد', '', '']); touch(); draw(); } }, '＋ ثابت'),
      h('button', { type: 'button', class: 'btn', onclick: () => { draft.consts.push(['قسم جديد', null, null]); touch(); draw(); } }, '＋ عنوان قسم')));
  draw();
  return host;
}

/** ---------- التنسيق والتذييل والشعارات ---------- */
export function fmtPane(draft, { touch }) {
  const f = (draft.fmt ||= clone(FMT_DEFAULT));
  const ft = (draft.foot ||= clone(FOOT_DEFAULT));
  const n = (k, label, o = {}) => field(label, h('input', { type: 'number', step: o.step || 0.5, min: o.min ?? 0, max: o.max ?? 100, value: f[k], onchange: (e) => { f[k] = Number(e.target.value); touch(); } }));
  const sel = (k, label, opts) => field(label, h('select', { onchange: (e) => { f[k] = e.target.value; touch(); } }, opts.map(([v, t]) => h('option', { value: v, selected: f[k] === v }, t))));
  const col = (k, label) => field(label, h('input', { type: 'color', value: f[k], onchange: (e) => { f[k] = e.target.value; touch(); } }));
  const chk = (k, label) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!f[k], onchange: (e) => { f[k] = e.target.checked ? 1 : 0; touch(); } }), label);
  const LINES = [['none', 'بلا خط'], ['solid', 'متصل'], ['dotted', 'منقّط'], ['dashed', 'متقطّع'], ['double', 'مزدوج']];
  return h('div', null,
    h('h3', null, 'تنسيق صفحة العقد'),
    h('div', { class: 'form-grid' },
      n('body', 'حجم خط النص (pt)', { min: 8, max: 20 }), n('lh', 'تباعد الأسطر', { step: 0.05, min: 1, max: 3 }), sel('jc', 'محاذاة النص', [['justify', 'ضبط'], ['right', 'يمين'], ['center', 'وسط'], ['left', 'يسار']]),
      n('h1', 'حجم العنوان (pt)', { min: 10, max: 30 }), chk('h1u', 'العنوان مسطّر'), chk('hi', 'تظليل القيم المتغيّرة بالأصفر'),
      n('mT', 'الهامش العلوي (مم)'), n('mB', 'الهامش السفلي (مم)'), n('mR', 'الهامش الأيمن (مم)'), n('mL', 'الهامش الأيسر (مم)'),
      sel('hdrLine', 'خط تحت الترويسة', LINES), n('hdrW', 'سماكته', { min: 0.5, max: 6 }), col('hdrColor', 'لونه'),
      sel('ftrLine', 'خط فوق التذييل', LINES), n('ftrW', 'سماكته', { min: 0.5, max: 6 }), col('ftrColor', 'لونه')),
    h('h3', null, 'تذييل الصفحات'),
    h('div', { class: 'form-grid' },
      field('العنوان (عربي)', input(ft, 'ar1', { maxlength: 200 }, touch)), field('تلفاكس (عربي)', input(ft, 'ar2', { maxlength: 200 }, touch)),
      field('العنوان (إنجليزي)', input(ft, 'en1', { maxlength: 200, dir: 'ltr' }, touch)), field('Telefax', input(ft, 'en2', { maxlength: 200, dir: 'ltr' }, touch))),
    h('h3', null, 'شعارات هذه الصيغة'),
    h('p', { class: 'hint' }, 'تُستعمل ما لم يُربط العقد بمجموعة ترويسة (تبويب «مجموعات الترويسة»).'),
    logoEditor(draft, touch));
}
