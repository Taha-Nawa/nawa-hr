import { h, clear, toast } from '../dom.js';
import { post, put } from '../api.js';
import { readWorkbook } from '../xlsx.js';

const BATCH = 100;

// ---- قراءة الأوراق: نبحث عن صف العناوين بالنص فلا يهم موضعه ولا ترتيب الأعمدة ----
const norm = (s) => String(s ?? '').replace(/[ً-ْـ]/g, '').replace(/\s+/g, ' ').trim();
const str = (v) => (v === null || v === undefined ? '' : String(v).trim());

function table(rows, required) {
  const need = required.map(norm);
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map(norm);
    if (need.every((n) => cells.includes(n))) {
      const col = Object.fromEntries(cells.map((c, j) => [c, j]).filter(([c]) => c));
      return { col, rows: rows.slice(i + 1).filter((r) => r.some((c) => c !== null && c !== '')) };
    }
  }
  return null;
}

const cell = (t, r, name) => (t.col[norm(name)] === undefined ? null : r[t.col[norm(name)]] ?? null);

function timeOf(v) {
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const m = Math.round(v * 1440);
    return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  const m = str(v).match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : str(v);
}

export function extract(sheets) {
  const out = { employees: null, cards: null, holidays: null, movements: null };

  const emp = sheets['قائمة الموظفين'] && table(sheets['قائمة الموظفين'], ['كود الموظف', 'اسم الموظف']);
  if (emp) {
    out.employees = emp.rows.filter((r) => str(cell(emp, r, 'كود الموظف'))).map((r) => ({
      code: str(cell(emp, r, 'كود الموظف')), name: str(cell(emp, r, 'اسم الموظف')), jobTitle: str(cell(emp, r, 'المسمى الوظيفي')) || null,
      department: str(cell(emp, r, 'الدائرة / القسم')) || null, center: str(cell(emp, r, 'المركز')) || null, managerLabel: str(cell(emp, r, 'المدير المباشر')) || null,
      contractType: str(cell(emp, r, 'نوع التعاقد')) || null, startDate: str(cell(emp, r, 'تاريخ التعيين')) || null, project: str(cell(emp, r, 'المشروع / الممول')) || null,
    }));
  }

  const cards = sheets['سجل البطاقات'] && table(sheets['سجل البطاقات'], ['كود الموظف', 'حرف الإصدار']);
  if (cards) {
    out.cards = cards.rows.filter((r) => str(cell(cards, r, 'كود الموظف'))).map((r) => {
      const code = str(cell(cards, r, 'كود الموظف'));
      const letter = str(cell(cards, r, 'حرف الإصدار'));
      return { code, card: str(cell(cards, r, 'محتوى رمز البطاقة')) || (letter ? `${code}-${letter}` : ''), status: norm(cell(cards, r, 'الحالة')) === 'ملغاة' ? 'revoked' : 'active' };
    });
  }

  const hol = sheets['العطل الرسمية'] && table(sheets['العطل الرسمية'], ['التاريخ', 'المناسبة']);
  if (hol) {
    const byYear = {};
    for (const r of hol.rows) {
      const date = str(cell(hol, r, 'التاريخ'));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      (byYear[date.slice(0, 4)] ||= []).push({ date, name: str(cell(hol, r, 'المناسبة')) || null });
    }
    out.holidays = byYear;
  }

  const mov = sheets['الحركات الواردة'] && table(sheets['الحركات الواردة'], ['معرّف الحركة', 'نوع الحركة']);
  if (mov) {
    out.movements = mov.rows
      .filter((r) => str(cell(mov, r, 'معرّف الحركة')) && !str(cell(mov, r, 'جهة المسح')).includes('مثال توضيحي'))
      .map((r) => ({
        id: str(cell(mov, r, 'معرّف الحركة')), card: str(cell(mov, r, 'محتوى البطاقة')) || null, code: str(cell(mov, r, 'كود الموظف')) || null,
        center: str(cell(mov, r, 'المركز')) || null, type: str(cell(mov, r, 'نوع الحركة')), date: str(cell(mov, r, 'التاريخ (نص)')), time: timeOf(cell(mov, r, 'الوقت (نص)')),
        note: [str(cell(mov, r, 'جهة المسح')), str(cell(mov, r, 'ملاحظة الحارس'))].filter(Boolean).join(' — ') || null,
      }));
  }
  return out;
}

// ---- التنفيذ على دفعات ----
async function inBatches(rows, url, onProgress) {
  const total = { imported: 0, saved: 0, skipped: 0, unmatched: 0, rejected: [], warning: null };
  for (let i = 0; i < rows.length; i += BATCH) {
    const r = await post(url, { rows: rows.slice(i, i + BATCH) });
    total.imported += r.imported || 0;
    total.saved += r.saved || 0;
    total.skipped += r.skipped || 0;
    total.unmatched += r.unmatched || 0;
    if (r.warning) total.warning = r.warning;
    for (const x of r.rejected || []) total.rejected.push({ ...x, row: x.row ? x.row + i : x.row });
    onProgress(Math.min(i + BATCH, rows.length), rows.length);
  }
  return total;
}

export default async function render() {
  const results = h('div', { class: 'import-steps' });
  const fileErr = h('div', { class: 'notice notice-err', hidden: true, role: 'alert' });
  let data = null;

  const input = h('input', { type: 'file', accept: '.xlsx', id: 'xl-file', onchange: async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    fileErr.hidden = true;
    clear(results).append(h('p', { class: 'loading' }, 'جارٍ قراءة الملف…'));
    try {
      data = extract(await readWorkbook(await f.arrayBuffer()));
    } catch (ex) {
      clear(results);
      fileErr.textContent = `تعذّرت قراءة الملف: ${ex.message}`;
      fileErr.hidden = false;
      return;
    }
    drawSteps();
  } });

  function step({ title, count, found = true, note, run, sample }) {
    const status = h('div', { class: 'step-status', 'aria-live': 'polite' });
    const btn = h('button', { type: 'button', class: 'btn btn-primary', disabled: !count, onclick: async () => {
      btn.disabled = true;
      clear(status).append(h('span', { class: 'muted' }, 'جارٍ الاستيراد…'));
      try {
        const r = await run((done, total) => { status.textContent = `${done} من ${total}`; });
        clear(status).append(...summary(r));
        toast(`اكتمل: ${title}`);
      } catch (e) {
        clear(status).append(h('div', { class: 'notice notice-err', role: 'alert' }, `توقف الاستيراد: ${e.message}. ما استُورد قبل الخطأ محفوظ، ويمكنك إعادة المحاولة بأمان فالمكرر يُتجاهل.`));
      } finally {
        btn.disabled = false;
      }
    } }, 'استيراد');
    return h('section', { class: 'panel step' },
      h('div', { class: 'step-head' }, h('div', null, h('h2', null, title), h('p', { class: 'muted' }, count ? `${count} صف جاهز` : found ? 'لا صفوف فعلية للاستيراد (الصفوف التوضيحية تُتجاهل)' : 'لم يُعثر على هذه الورقة في الملف', note ? ` · ${note}` : '')), btn),
      sample?.length ? h('details', null, h('summary', null, 'عيّنة من الصفوف'), h('pre', { class: 'sample', dir: 'ltr' }, sample.slice(0, 3).map((s) => JSON.stringify(s)).join('\n'))) : null,
      status);
  }

  function summary(r) {
    const parts = [];
    const line = [];
    if (r.imported !== undefined && r.saved === 0 && r.skipped === 0) line.push(`استُورد ${r.imported}`);
    if (r.saved || r.skipped) line.push(`حُفظ ${r.saved}`, `مكرر تُجوهل ${r.skipped}`);
    if (r.unmatched) line.push(`بلا موظف مطابق ${r.unmatched}`);
    if (r.rejected.length) line.push(`مرفوض ${r.rejected.length}`);
    parts.push(h('p', { class: 'result-line' }, line.join(' · ') || 'لا تغييرات'));
    if (r.warning === 'settings_missing') parts.push(h('div', { class: 'notice notice-warn' }, 'حُفظت الحركات لكنها لم تُحسب لأن قواعد الدوام غير مُدخلة. أدخلها من «الإعدادات والعطل» ثم أعد الحساب.'));
    if (r.rejected.length) {
      parts.push(h('details', null, h('summary', null, 'المرفوض وأسبابه'), h('ul', { class: 'plain small' }, r.rejected.slice(0, 50).map((x) => h('li', null, [x.row ? `صف ${x.row}` : null, x.id, x.code, x.card, x.reason].filter(Boolean).join(' — '))), r.rejected.length > 50 ? h('li', null, `و${r.rejected.length - 50} آخرين`) : null)));
    }
    return parts;
  }

  function drawSteps() {
    clear(results);
    if (!data.employees && !data.cards && !data.movements && !data.holidays) {
      results.append(h('div', { class: 'notice notice-warn' }, 'لم أجد أياً من الأوراق المتوقعة (قائمة الموظفين، سجل البطاقات، العطل الرسمية، الحركات الواردة). تأكد أنه ملف الإدارة الأصلي.'));
      return;
    }
    results.append(
      h('p', { class: 'muted' }, 'استورد بالترتيب من الأعلى إلى الأسفل. إعادة أي خطوة آمنة: ما سبق حفظه يُتجاهل أو يُحدَّث.'),
      step({ title: '١. الموظفون', count: data.employees?.length || 0, found: !!data.employees, note: 'يُحدَّث الموجود بحسب الكود', sample: data.employees, run: (p) => inBatches(data.employees, '/api/import/employees', p) }),
      step({ title: '٢. البطاقات', count: data.cards?.length || 0, found: !!data.cards, note: 'الملغاة تُستورد ملغاة', sample: data.cards, run: (p) => inBatches(data.cards, '/api/import/badges', p) }),
      step({ title: '٣. العطل الرسمية', count: Object.values(data.holidays || {}).flat().length, found: !!data.holidays, note: 'تستبدل عطل كل سنة موجودة في الملف', sample: Object.values(data.holidays || {}).flat(),
        run: async () => {
          let n = 0;
          for (const [year, list] of Object.entries(data.holidays)) {
            await put('/api/holidays', { year: Number(year), holidays: list });
            n += list.length;
          }
          return { imported: n, saved: 0, skipped: 0, rejected: [] };
        } }),
      step({ title: '٤. الحركات', count: data.movements?.length || 0, found: !!data.movements, note: 'بعد الموظفين والبطاقات، ليُربط كل مسح بصاحبه', sample: data.movements, run: (p) => inBatches(data.movements, '/api/import/movements', p) }),
    );
  }

  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'الاستيراد من إكسل'), h('p', { class: 'sub' }, 'ارفع «نظام الحضور بالبطاقة - ملف الإدارة». يُقرأ الملف في متصفحك ولا يُرفع كملف؛ تُرسَل الصفوف فقط.'))),
    h('section', { class: 'panel' }, h('label', { class: 'field', for: 'xl-file' }, h('span', { class: 'field-label' }, 'ملف إكسل (.xlsx)'), input), fileErr),
    results);
}
