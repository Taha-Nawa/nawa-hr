// مزوّدو الخدمات المشتقّون من العقود: شخص واحد لكل رقم هوية، مع كشف تداخل الفترات واختلاف كتابة الاسم.
import { contractNo } from './contract-doc.js';

export const norm = (v) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
export const bare = (v) => norm(v).replace(/[ـً-ْ]/g, '').replace(/[آأإ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
const PERSON_FIELDS = ['name', 'idno', 'gender', 'title', 'residence', 'phone', 'email', 'major', 'exp', 'bank', 'iban'];
const fmtDate = (s) => (s ? String(s).split('-').reverse().join('/') : '');

export function overlapsOf(recs) {
  const out = [];
  const d = (v) => { const t = norm(v); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };
  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      const a = recs[i]; const b = recs[j];
      const a1 = d(a.dFrom); const a2 = d(a.dTo); const b1 = d(b.dFrom); const b2 = d(b.dTo);
      if (!a1 || !a2 || !b1 || !b2) continue;
      if (a1 <= b2 && b1 <= a2) {
        const s1 = a1 > b1 ? a1 : b1; const s2 = a2 < b2 ? a2 : b2;
        out.push({ a, b, from: s1, to: s2, days: Math.round((new Date(s2) - new Date(s1)) / 86400000) + 1 });
      }
    }
  }
  return out;
}

/** rows: عقود (مع calc) → { [idno]: شخص } */
export function buildPeople(rows) {
  const m = {};
  for (const r of rows) {
    const id = norm(r.idno);
    if (!id) continue;
    const p = (m[id] ||= { idno: id, recs: [], names: {}, last: null });
    p.recs.push(r);
    const nm = norm(r.name);
    if (nm) p.names[nm] = (p.names[nm] || 0) + 1;
    if (r.dSign && (!p.last || r.dSign > p.last)) p.last = r.dSign;
  }
  for (const p of Object.values(m)) {
    p.name = Object.keys(p.names).sort((a, b) => p.names[b] - p.names[a])[0] || '';
    p.altNames = Object.keys(p.names).filter((x) => x !== p.name);
    const latest = p.recs.slice().sort((a, b) => String(b.dSign || '').localeCompare(String(a.dSign || '')))[0] || {};
    for (const k of PERSON_FIELDS) if (p[k] === undefined) p[k] = latest[k];
    p.name = p.name || norm(latest.name);
    p.projects = [...new Set(p.recs.map((r) => norm(r.project)).filter(Boolean))];
    p.total = p.recs.reduce((a, r) => a + (r.calc.appr !== null ? r.calc.appr : r.calc.base || 0), 0);
    p.overlaps = overlapsOf(p.recs);
  }
  return m;
}

export function personFlags(p) {
  const f = [];
  if (p.altNames.length) f.push({ t: 'name', m: `الاسم مكتوب بأكثر من صيغة: ${[p.name, ...p.altNames].join(' / ')}` });
  for (const o of p.overlaps) f.push({ t: 'overlap', m: `تداخل ${o.days} يوماً بين ${contractNo(o.a)} و${contractNo(o.b)} (${fmtDate(o.from)} ← ${fmtDate(o.to)})` });
  return f;
}

export const PPL_COLS = [
  ['م', (p) => p._i || ''], ['الاسم المعتمد', (p) => p.name], ['صيغ أخرى للاسم', (p) => p.altNames.join(' / ')], ['رقم الهوية', (p) => p.idno],
  ['الجنس', (p) => p.gender], ['الصفة', (p) => p.title], ['مكان الإقامة', (p) => p.residence], ['رقم الجوال', (p) => p.phone],
  ['البريد الإلكتروني', (p) => p.email], ['التخصص', (p) => p.major], ['سنوات الخبرة', (p) => p.exp],
  ['اسم البنك', (p) => p.bank], ['رقم الحساب / IBAN', (p) => p.iban],
  ['عدد العقود', (p) => p.recs.length], ['أرقام العقود', (p) => p.recs.map((r) => contractNo(r)).join(' , ')],
  ['المشاريع', (p) => p.projects.join(' , ')], ['إجمالي المستحقات ($)', (p) => Math.round(p.total * 100) / 100],
  ['تاريخ آخر عقد', (p) => (p.last ? fmtDate(p.last) : '')], ['تداخل في الفترات', (p) => p.overlaps.length], ['تنبيهات', (p) => personFlags(p).map((x) => x.m).join(' | ')],
];

/** تنبيهات نموذج العقد: تداخل أو اختلاف اسم مع عقود الشخص الأخرى. cur: القيم الحالية في النموذج، mineId: العقد قيد التعديل */
export function formWarnings(people, cur, mineId) {
  const id = norm(cur.idno);
  if (!id || id.length < 9) return { msgs: [], info: '' };
  const p = people[id];
  if (!p) return { msgs: [], info: '' };
  const others = p.recs.filter((r) => r.id !== mineId);
  if (!others.length) return { msgs: [], info: '' };
  const msgs = [];
  const nm = norm(cur.name);
  if (nm && bare(nm) !== bare(p.name) && !p.altNames.some((x) => bare(x) === bare(nm))) msgs.push(`رقم الهوية هذا مسجّل باسم «${p.name}» — تأكد من الاسم قبل الحفظ.`);
  else if (p.altNames.length) msgs.push(`هذا الشخص مسجّل بأكثر من صيغة للاسم: ${[p.name, ...p.altNames].join(' / ')}`);
  const d = (v) => { const t = norm(v); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };
  const c1 = d(cur.dFrom); const c2 = d(cur.dTo);
  if (c1 && c2) {
    for (const o of others) {
      const o1 = d(o.dFrom); const o2 = d(o.dTo);
      if (o1 && o2 && c1 <= o2 && o1 <= c2) {
        const s1 = c1 > o1 ? c1 : o1; const s2 = c2 < o2 ? c2 : o2;
        msgs.push(`تداخل ${Math.round((new Date(s2) - new Date(s1)) / 86400000) + 1} يوماً مع العقد ${contractNo(o)} (${norm(o.project).slice(0, 40)}) — ${fmtDate(s1)} ← ${fmtDate(s2)}`);
      }
    }
  }
  return { msgs, info: `مزوّد خدمة سابق لديه ${others.length} عقداً آخر — إجمالي مستحقاته ${p.total.toFixed(2)} $.` };
}
