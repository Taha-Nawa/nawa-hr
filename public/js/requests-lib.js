// تسميات الطلبات وتنسيقها (مشتركة بين صفحة الطلبات ونافذة التفاصيل وصفحة الطباعة).
import { h, AR_MONTHS } from './dom.js';

export const KIND = {
  leave: { label: 'طلب إجازة', short: 'إجازة', icon: 'calendar' },
  exit: { label: 'إذن مغادرة', short: 'مغادرة', icon: 'door' },
  late: { label: 'إذن تأخير', short: 'تأخير', icon: 'clock' },
};

// الإجازة تحمل أسماء نموذجها الورقي، والإذن أسماءه
export const PURPOSE = {
  leave: { annual: 'إجازة اعتيادية (سنوية)', emergency: 'إجازة طارئة (اضطرارية)', sick: 'إجازة مرضية', other: 'أخرى' },
  permit: { annual: 'اعتيادي (سنوي)', emergency: 'طارئ (اضطراري)', sick: 'مرضي', other: 'أخرى' },
};
export const purposeLabels = (kind) => (kind === 'leave' ? PURPOSE.leave : PURPOSE.permit);

export function purposeText(r) {
  const base = purposeLabels(r.kind)[r.purpose];
  return r.purpose === 'other' && r.purposeOther ? `أخرى: ${r.purposeOther}` : base;
}

export const STATUS = {
  pending: ['بانتظار الاعتماد', 'chip-late'],
  approved: ['معتمد', 'chip-present'],
  rejected: ['مرفوض', 'chip-absent'],
  cancelled: ['ملغى', 'chip-off'],
};
export const statusChip = (s) => h('span', { class: `chip ${STATUS[s]?.[1] || ''}` }, STATUS[s]?.[0] || s);

/** 2026-11-08 → «8 نوفمبر 2026» */
export function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${AR_MONTHS[m - 1]} ${y}`;
}

/** دقائق → «ساعة ونصف» بصيغة رقمية واضحة: 1:30 ساعة / 45 دقيقة */
export function fmtMinutes(min) {
  if (!min) return '—';
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  if (!hh) return `${mm} دقيقة`;
  return `${hh}:${String(mm).padStart(2, '0')} ساعة`;
}

export const fmtDays = (n) => (n === 1 ? 'يوم عمل واحد' : n === 2 ? 'يومان' : `${n} ${n >= 3 && n <= 10 ? 'أيام' : 'يوماً'}`);

/** الفترة كما تُعرض في القوائم */
export function fmtPeriod(r) {
  if (r.kind === 'leave') return r.fromDate === r.toDate ? fmtDate(r.fromDate) : `${fmtDate(r.fromDate)} ← ${fmtDate(r.toDate)}`;
  return `${fmtDate(r.fromDate)} · ${r.fromTime} – ${r.toTime}`;
}

export const fmtLength = (r) => (r.kind === 'leave' ? fmtDays(r.days) : fmtMinutes(r.minutes));

/** الجمل التي يراها المعتمِد بعد احتساب الخادم */
export function calcLines(c) {
  const lines = [];
  if (c.kind === 'leave') {
    lines.push(['المحتسب', fmtDays(c.days) + ' (بعد استثناء العطلة الأسبوعية والعطل الرسمية)']);
    if (c.usedApproved) {
      const u = c.usedApproved;
      const used = [['annual', 'اعتيادية'], ['sick', 'مرضية'], ['emergency', 'طارئة'], ['other', 'أخرى']]
        .filter(([k]) => u[k] || c.usedPending?.[k])
        .map(([k, l]) => `${l}: ${u[k] || 0}${c.usedPending?.[k] ? ` (+${c.usedPending[k]} معلّقة)` : ''}`);
      lines.push([`المستهلك عام ${c.year}`, used.length ? `${used.join(' · ')} يوماً` : 'لا إجازات معتمدة بعد']);
    }
    if (c.entitlement !== undefined) lines.push(['الرصيد المتبقي', `${c.remaining} يوماً من ${c.entitlement}`]);
  } else {
    lines.push(['المحتسب', fmtMinutes(c.minutes)]);
    // إجمالي الشهر وسقفه: لا يصل من الخادم ما لم يُفعَّل (rules.monthlyCap.enabled)
    if (c.kind === 'exit' && c.month !== undefined) {
      const cap = c.capMinutes !== undefined ? ` من ${fmtMinutes(c.capMinutes)}` : '';
      lines.push(['مغادرات هذا الشهر', `${fmtMinutes(c.monthApprovedMinutes) === '—' ? '0' : fmtMinutes(c.monthApprovedMinutes)} معتمدة${c.monthPendingMinutes ? ` + ${fmtMinutes(c.monthPendingMinutes)} معلّقة` : ''}${cap}`]);
    }
  }
  return lines;
}
