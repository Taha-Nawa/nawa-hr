// وضع الموظف الآن داخل مركزه (من حركات اليوم): داخل، خرج مؤقتاً، انصرف، لم يحضر، إجازة/عطلة. منطق نقي يُختبر في Node.
export const PRES = [
  { id: 'in', label: 'داخل المركز الآن' },
  { id: 'out', label: 'خرج مؤقتاً' },
  { id: 'gone', label: 'انصرف' },
  { id: 'wait', label: 'لم يحضر بعد' },
  { id: 'rest', label: 'إجازة أو عطلة' },
];

const OFF = new Set(['عطلة أسبوعية', 'عطلة رسمية']);

/** row: صف /api/day (status, checkIn, departure, lastType). isToday: اليوم المعروض هو اليوم الحالي (تتغيّر تسمية «لم يحضر»). */
export function presenceOf(row) {
  if (row.status && row.status !== 'حاضر' && row.status !== 'متأخر' && row.status !== 'غياب' && !row.checkIn) return 'rest'; // إجازة أو مهمة
  if (OFF.has(row.status) && !row.checkIn) return 'rest';
  if (!row.checkIn) return 'wait';
  if (row.departure) return 'gone';
  return row.lastType === 'خروج' ? 'out' : 'in';
}

/** عدّاد لكل وضع. */
export function presenceCounts(rows) {
  const c = Object.fromEntries(PRES.map((p) => [p.id, 0]));
  for (const r of rows) c[presenceOf(r)]++;
  return c;
}
