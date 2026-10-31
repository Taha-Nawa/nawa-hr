/**
 * توزيع الموظف على المشاريع/الممولين (ورقة «توزيع المشاريع» بإكسل).
 * كل صف: ممول + نسبة (جزء من 1) + فترة. القاعدة: في أي يوم له توزيع نافذ يكون مجموع النسب = 1 وبحد أقصى 3 ممولين متزامنين
 * (لأن قائمة الموظفين تحمل ثلاث خانات تحميل). الفجوات بين الفترات مسموحة (موظف بلا تحميل في تلك الفترة).
 * دوال نقية بلا قاعدة بيانات كي تُختبر منفردة.
 */
import { isDate, clip, addDays } from './util.js';

export const MAX_CONCURRENT = 3;
export const MAX_ALLOCATIONS = 12;
const EPS = 1e-4;

/** يُرجع { rows } منظّفة أو { error }. rows: [{funder, share, from, to}] */
export function validateAllocations(input) {
  if (!Array.isArray(input) || input.length === 0) return { error: 'التوزيع مطلوب (صف واحد على الأقل)' };
  if (input.length > MAX_ALLOCATIONS) return { error: `الحد الأقصى ${MAX_ALLOCATIONS} صفاً لكل موظف` };
  const rows = [];
  for (const [i, r] of input.entries()) {
    const n = i + 1;
    const funder = clip(r?.funder, 300);
    const share = typeof r?.share === 'number' ? r.share : Number.NaN;
    if (!funder) return { error: `الصف ${n}: الممول/المشروع غير محدد` };
    if (!(share > 0 && share <= 1)) return { error: `الصف ${n}: النسبة يجب أن تكون بين 0 و1 (مثل 0.5 تعني 50%)` };
    if (!isDate(r?.from) || !isDate(r?.to)) return { error: `الصف ${n}: تاريخ البداية أو النهاية غير صالح` };
    if (r.to < r.from) return { error: `الصف ${n}: تاريخ النهاية قبل البداية` };
    rows.push({ funder, share: Math.round(share * 10000) / 10000, from: r.from, to: r.to });
  }
  // نفحص كل تاريخ يتغير عنده المجموع: بدايات الفترات والأيام التي تلي نهاياتها
  const points = new Set();
  for (const r of rows) {
    points.add(r.from);
    points.add(addDays(r.to, 1));
  }
  for (const d of [...points].sort()) {
    const active = rows.filter((r) => r.from <= d && d <= r.to);
    if (active.length === 0) continue;
    if (active.length > MAX_CONCURRENT) return { error: `أكثر من ${MAX_CONCURRENT} ممولين متزامنين في ${d}` };
    const total = active.reduce((s, r) => s + r.share, 0);
    if (Math.abs(total - 1) > EPS) return { error: `مجموع النسب في ${d} هو ${Math.round(total * 10000) / 100}% وليس 100%` };
  }
  return { rows };
}

/** يستبدل توزيع موظف كاملاً (حذف ثم إدراج) ضمن دفعة واحدة. يُرجع الجمل لتُنفَّذ مع db.batch. */
export function replaceStatements(db, employeeId, rows) {
  return [
    db.prepare('DELETE FROM employee_projects WHERE employee_id = ?').bind(employeeId),
    db
      .prepare(
        `INSERT INTO employee_projects (employee_id, funder, share, from_date, to_date)
         SELECT ?1, json_extract(value,'$.funder'), json_extract(value,'$.share'), json_extract(value,'$.from'), json_extract(value,'$.to')
         FROM json_each(?2) WHERE true`,
      )
      .bind(employeeId, JSON.stringify(rows)),
  ];
}
