// بطاقة الموظف: دوال نقية (بلا DOM) كي تُختبر على Node.

const strip = (w) => w.replace(/^ال/, '');

/** حرفا الأفقية: أول حرف من الاسم الأول وأول حرف من آخر كلمة (دون «ال» والألقاب مثل «أ.» و«د.»). «منى خالد العطار» ← «م.ع» */
export function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter((w) => w && !/\.$/.test(w));
  if (!words.length) return '؟';
  const first = [...words[0]][0];
  if (words.length === 1) return first;
  const last = [...strip(words[words.length - 1]) || words[words.length - 1]][0];
  return `${first}.${last}`;
}

const years = (n) => (n === 1 ? 'سنة' : n === 2 ? 'سنتان' : n <= 10 ? `${n} سنوات` : `${n} سنة`);
const months = (n) => (n === 1 ? 'شهر' : n === 2 ? 'شهران' : n <= 10 ? `${n} أشهر` : `${n} شهراً`);

/**
 * مدة الخدمة نصاً عربياً («3 سنوات و8 أشهر»): من تاريخ التعيين إلى انتهاء الخدمة إن انتهت، وإلا إلى اليوم.
 * التواريخ بصيغة YYYY-MM-DD. تُرجع '' إن لم يُعرف تاريخ التعيين.
 */
export function serviceSpan(start, end, today) {
  if (!start) return '';
  const stop = end && end < today ? end : today;
  if (start > stop) return 'لم تبدأ الخدمة بعد';
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = stop.split('-').map(Number);
  const total = (ey - sy) * 12 + (em - sm) - (ed < sd ? 1 : 0);
  if (total < 1) return 'أقل من شهر';
  const y = Math.floor(total / 12);
  const m = total % 12;
  return [y ? years(y) : '', m ? months(m) : ''].filter(Boolean).join(' و');
}

/** التوزيعات السارية في تاريخ معيّن مرتبة بالأكبر نسبة: [{ funder, percent }] (النسبة مئوية بكسرين عشريين). */
export function activeAllocations(allocations, today) {
  return (allocations || [])
    .filter((a) => a.share > 0 && (!a.from || a.from <= today) && (!a.to || a.to >= today))
    .map((a) => ({ funder: a.funder, percent: Math.round(a.share * 10000) / 100 }))
    .sort((a, b) => b.percent - a.percent);
}

/** «2023-03-01» ← «01/03/2023» */
export const dmy = (date) => (date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '');
