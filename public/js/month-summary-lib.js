// ملخص أداء الموظف الشهري: دوال نقية (بلا DOM) تُختبر على Node.
const OFF = new Set(['عطلة أسبوعية', 'عطلة رسمية']);

/**
 * days: صفوف daily_results لشهر (من /api/employees/:id/days). today: YYYY-MM-DD (الأيام بعده لا تُحسب).
 * يُحسب فقط ما هو يوم عمل وفات (أو هو اليوم وله نتيجة).
 */
export function summarize(days, today) {
  const s = { workDays: 0, present: 0, late: 0, lateMinutes: 0, absent: 0, leave: 0, approved: 0, required: 0, overtime: 0, deficit: 0 };
  for (const d of days || []) {
    if (d.date > today || OFF.has(d.status) || d.dayType !== 'عمل') continue;
    if (d.status === null || d.status === undefined) continue;
    s.workDays += 1;
    if (d.status === 'حاضر' || d.status === 'متأخر') s.present += 1;
    if (d.status === 'متأخر') { s.late += 1; s.lateMinutes += d.lateMinutes || 0; }
    else if (d.status === 'غياب') s.absent += 1;
    else if (d.status !== 'حاضر') s.leave += 1;
    s.approved += d.approvedHours || 0;
    s.required += d.requiredHours || 0;
    s.overtime += d.overtimeHours || 0;
    s.deficit += d.deficitHours || 0;
  }
  const r = (n) => Math.round(n * 100) / 100;
  return { ...s, approved: r(s.approved), required: r(s.required), overtime: r(s.overtime), deficit: r(s.deficit), pct: s.required > 0 ? Math.min(100, Math.round((s.approved / s.required) * 100)) : null };
}

/** أرصدة الإجازات المعروضة: من صف /api/balances للموظف */
export const BALANCE_LABELS = { annual: 'اعتيادية', emergency: 'طارئة', sick: 'مرضية' };
export function balanceCards(row) {
  if (!row?.balances) return [];
  return Object.entries(BALANCE_LABELS)
    .map(([k, label]) => ({ key: k, label, ...row.balances[k] }))
    .filter((b) => b.total !== null && b.total !== undefined);
}
