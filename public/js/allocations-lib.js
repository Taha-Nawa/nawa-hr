// فحص توزيع الموظف على المشاريع في المتصفح (يطابق src/worker/projects.js ويُراجَع بالخادم دائماً).
// rows: [{ funder, percent (0..100), from, to }]
export const MAX_CONCURRENT = 6;
const TOL = 0.0100001; // نسبة مئوية: 33.33 × 3 مقبولة (الخادم يقبل فرقاً حتى 0.01%)

const add1 = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const sub1 = (d) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

/** مقاطع الفترات المتتالية التي يثبت فيها المجموع: [{ from, to, total, count, ok, reason }] ومشاكل الصفوف. */
export function allocationCheck(rows) {
  const problems = [];
  rows.forEach((r, i) => {
    if (!String(r.funder || '').trim()) problems.push(`الصف ${i + 1}: اسم المشروع مطلوب`);
    if (!(r.percent > 0 && r.percent <= 100)) problems.push(`الصف ${i + 1}: النسبة بين 0 و100`);
    if (!ok(r.from) || !ok(r.to)) problems.push(`الصف ${i + 1}: التاريخ غير صالح`);
    else if (r.to < r.from) problems.push(`الصف ${i + 1}: النهاية قبل البداية`);
  });
  const valid = rows.filter((r) => ok(r.from) && ok(r.to) && r.to >= r.from && r.percent > 0);
  const points = [...new Set(valid.flatMap((r) => [r.from, add1(r.to)]))].sort();
  const segments = [];
  for (let k = 0; k < points.length - 1; k++) {
    const d = points[k];
    const active = valid.filter((r) => r.from <= d && d <= r.to);
    if (!active.length) continue;
    const total = Math.round(active.reduce((s, r) => s + r.percent, 0) * 100) / 100;
    const seg = { from: d, to: sub1(points[k + 1]), total, count: active.length, ok: Math.abs(total - 100) <= TOL && active.length <= MAX_CONCURRENT };
    seg.reason = active.length > MAX_CONCURRENT ? `أكثر من ${MAX_CONCURRENT} مشاريع متزامنة` : Math.abs(total - 100) > TOL ? `المجموع ${total}% وليس 100%` : '';
    segments.push(seg);
  }
  return { segments, problems, valid: problems.length === 0 && segments.length > 0 && segments.every((s) => s.ok) };
}
