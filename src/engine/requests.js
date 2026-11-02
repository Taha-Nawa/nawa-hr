/**
 * قواعد الطلبات (إجازة / إذن مغادرة / إذن تأخير) — دوال نقيّة بلا قاعدة بيانات ولا ساعة نظام.
 *
 * مصدر القواعد: النماذج الورقية المعتمدة + توجيهات الإدارة:
 *  - الإجازة الاعتيادية (السنوية) تُقدَّم قبل موعدها.
 *  - المرضية والطارئة وغيرها تُقدَّم في اليوم نفسه أو في يوم لاحق (بعد وقوع الحالة) ضمن مهلة.
 *  - الأذونات (مغادرة/تأخير) تتبع القاعدة نفسها بحسب غرضها.
 * الأرقام هنا (مهلة يوم، مدد التقديم المتأخر) قيم افتراضية تُستبدل بما يُحفظ في settings['requests']
 * متى صدرت لائحة الموارد البشرية، ولا يتغير شيء آخر في الكود.
 */
import { dayTypeOf, DAY_WORK, toMin } from './attendance.js';
import { addDays, daysBetween, isDate, isTime, clip } from '../worker/util.js';

export const KINDS = { leave: 'طلب إجازة', exit: 'إذن مغادرة', late: 'إذن تأخير' };
export const PURPOSES = { annual: 'اعتيادي (سنوي)', emergency: 'طارئ (اضطراري)', sick: 'مرضي', other: 'أخرى' };
// «مهمة عمل» (قرار 2 نوفمبر 2026): طلب بأيام كاملة لموظف خارجي أو صاحب زيارة ميدانية حتى لا يُحسب غائباً.
// يُخزَّن كطلب إجازة (kind = leave) بعلامة mission = 1 وغرض «أخرى» فيستعمل مسار الاعتماد والأيام نفسه،
// ويختلف عن الإجازة في: لا يخصم من أي رصيد، ولا يُلغيه الدخول على البوابة، ونوعه محتسب كدوام (ساعات الممولين).
export const MISSION_LABEL = 'مهمة عمل';
export const MISSION_KIND = 'طلب مهمة عمل';
export const kindLabel = (r) => (r?.mission ? MISSION_KIND : KINDS[r?.kind]);

export const DEFAULT_RULES = {
  // الاعتيادية: لا تُقبل قبل الموعد بأقل من minNoticeDays يوماً (إجازة) أو بعد بدء وقت الإذن (أذونات)
  annual: { minNoticeDays: 1 },
  // بقية الأغراض: يجوز التقديم يوم الحالة أو بعدها بما لا يزيد عن maxBackdateDays يوماً
  emergency: { maxBackdateDays: 7 },
  sick: { maxBackdateDays: 14 },
  other: { maxBackdateDays: 7 },
  mission: { maxBackdateDays: 7 }, // مهمة العمل: تُقدَّم قبل المهمة أو بعدها بهذه المهلة (لا تلزمها مهلة تقديم مسبقة)
  maxSpanDays: 100, // أطول مدة إجازة في طلب واحد (أيام تقويمية)
  maxAheadDays: 366, // أبعد موعد يُقبل
  entitlement: {}, // اختياري: { annual: 21 } يُعرض الرصيد المتبقي إن وُجد
  // إجمالي المغادرات الشهري وسقفه: مُعطَّل عمداً (قرار 2 نوفمبر 2026). الكود جاهز ويُفعَّل لاحقاً
  // بحفظ { monthlyCap: { enabled: true } } في إعداد 'requests' مع settings.monthlyExitCapHours.
  monthlyCap: { enabled: false },
  // الإجازة المرضية: حتى freeDays يوم عمل بلا ورقة طبية، وما فوقها يلزمها ورقة طبية تؤكّدها الموارد البشرية (قرار 2 نوفمبر 2026)
  medical: { freeDays: 1 },
  // أذونات المغادرة/التأخير المعتمدة: تُعفى من العجز والتأخير بقدرها (الحضور يلزم لليوم). إيقافها يعيد كل شيء كما كان.
  permits: { exempt: true },
  // إشعارات البريد عند التقديم والقرار (تعمل فقط إن كان إرسال البريد مضبوطاً في docs/EMAIL-SETUP.md)
  notify: { enabled: true },
  // إجازة معتمدة ثم سجّل الموظف دخولاً فعلياً على البوابة: يُلغى ذلك اليوم منها (يُعاد إلى رصيده) ويُحسب حضوراً.
  leave: { cancelOnCheckIn: true },
};

/** يدمج ما حفظه المسؤول (إن وُجد) فوق الافتراضي، ويتجاهل أي قيمة غير صالحة. */
export function mergeRules(stored) {
  const r = structuredClone(DEFAULT_RULES);
  if (!stored || typeof stored !== 'object') return r;
  const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : undefined);
  const a = int(stored.annual?.minNoticeDays, 0, 60);
  if (a !== undefined) r.annual.minNoticeDays = a;
  for (const p of ['emergency', 'sick', 'other', 'mission']) {
    const v = int(stored[p]?.maxBackdateDays, 0, 365);
    if (v !== undefined) r[p].maxBackdateDays = v;
  }
  const span = int(stored.maxSpanDays, 1, 366);
  if (span !== undefined) r.maxSpanDays = span;
  if (stored.monthlyCap?.enabled === true) r.monthlyCap.enabled = true;
  if (stored.permits?.exempt === false) r.permits.exempt = false;
  if (stored.notify?.enabled === false) r.notify.enabled = false;
  if (stored.leave?.cancelOnCheckIn === false) r.leave.cancelOnCheckIn = false;
  const free = int(stored.medical?.freeDays, 0, 30);
  if (free !== undefined) r.medical.freeDays = free;
  if (stored.entitlement && typeof stored.entitlement === 'object') {
    for (const p of Object.keys(PURPOSES)) {
      const v = stored.entitlement[p];
      if (Number.isFinite(v) && v >= 0 && v <= 366) r.entitlement[p] = v;
    }
  }
  return r;
}

/** أيام العمل الفعلية بين تاريخين (تُستثنى العطلة الأسبوعية والعطل الرسمية). */
export function workingDates(from, to, settings, holidays = new Set()) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (dayTypeOf(d, settings, holidays) === DAY_WORK) out.push(d);
  return out;
}

const bad = (error) => ({ ok: false, error });

/**
 * يتحقق من طلب ويحسب مدّته.
 * @param {object} input     ما يرسله العميل (kind, purpose, purposeOther, reason, fromDate, toDate, fromTime, toTime)
 * @param {object} ctx       { today, nowTime, rules, settings (قد تكون null), holidays:Set, enforceTiming:boolean }
 *   enforceTiming=false عند الإدخال نيابة عن موظف من قِبل مسؤول، وعند تعديل المعتمِد للتواريخ.
 */
export function validateRequest(input, ctx) {
  const { today, nowTime, rules, settings, holidays, enforceTiming } = ctx;
  const kind = input.kind;
  if (!KINDS[kind]) return bad('نوع الطلب غير صالح');
  const mission = input.mission === true;
  if (mission && kind !== 'leave') return bad('مهمة العمل تُقدَّم بأيام كاملة (طلب إجازة بعلامة المهمة)');
  const purpose = mission ? 'other' : input.purpose;
  if (!PURPOSES[purpose]) return bad('اختر نوع الإجازة أو الغرض');
  const purposeOther = mission ? MISSION_LABEL : purpose === 'other' ? clip(input.purposeOther, 80) : null;
  if (purpose === 'other' && !purposeOther) return bad('حدّد الغرض في خانة «أخرى»');
  const reason = clip(input.reason, 300);
  // الغرض مطلوب في الأذونات وفي «أخرى»؛ الإجازة السنوية والمرضية يكفيها نوعها
  if (!reason && mission) return bad('اكتب مكان المهمة والغرض منها');
  if (!reason && (kind !== 'leave' || purpose === 'other' || purpose === 'emergency')) return bad('اكتب الغرض من الطلب');

  const fromDate = input.fromDate;
  if (!isDate(fromDate)) return bad('تاريخ البداية غير صالح');
  const toDate = kind === 'leave' ? input.toDate : fromDate;
  if (!isDate(toDate)) return bad('تاريخ النهاية غير صالح');
  if (toDate < fromDate) return bad('تاريخ النهاية قبل البداية');
  if (kind === 'leave' && daysBetween(fromDate, toDate) + 1 > rules.maxSpanDays) return bad(`أطول مدة في الطلب الواحد ${rules.maxSpanDays} يوماً`);
  if (fromDate > addDays(today, rules.maxAheadDays)) return bad('الموعد بعيد جداً');

  let fromTime = null;
  let toTime = null;
  let minutes = 0;
  let days = 0;
  let medicalRequired = false;
  if (kind === 'leave') {
    if (!settings) return { ok: false, error: 'أدخل إعدادات الدوام أولاً', status: 409 };
    days = workingDates(fromDate, toDate, settings, holidays).length;
    if (days === 0) return bad('الفترة المختارة كلها عطلة (لا أيام عمل فيها)');
    if (purpose === 'sick' && days > rules.medical.freeDays) {
      medicalRequired = true;
      if (input.medicalProof !== true) {
        const free = rules.medical.freeDays;
        return bad(`الإجازة المرضية بلا ورقة طبية تُقبل ${free === 1 ? 'ليوم واحد' : free === 0 ? 'بورقة طبية دائماً' : `حتى ${free} أيام`} فقط. إن كانت هناك ورقة طبية فأكّد ذلك، وإلا قلّص المدة.`);
      }
    }
  } else {
    if (!isTime(input.fromTime) || !isTime(input.toTime)) return bad('حدّد الوقت من/إلى');
    fromTime = input.fromTime;
    toTime = input.toTime;
    minutes = toMin(toTime) - toMin(fromTime);
    if (minutes <= 0) return bad('وقت النهاية يجب أن يكون بعد البداية');
  }

  if (enforceTiming && mission) {
    const back = rules.mission.maxBackdateDays;
    if (fromDate < addDays(today, -back)) {
      return bad(back === 0 ? 'لا يُقبل طلب المهمة بعد وقوعها' : `انتهت مهلة تقديم المهمة بعد وقوعها (${back} يوماً)، راجع الموارد البشرية`);
    }
  } else if (enforceTiming) {
    if (purpose === 'annual') {
      if (kind === 'leave') {
        if (fromDate < addDays(today, rules.annual.minNoticeDays)) {
          return bad(rules.annual.minNoticeDays === 1
            ? 'الإجازة الاعتيادية (السنوية) تُقدَّم قبل موعدها بيوم على الأقل'
            : `الإجازة الاعتيادية (السنوية) تُقدَّم قبل موعدها بـ ${rules.annual.minNoticeDays} أيام على الأقل`);
        }
      } else if (fromDate < today || (fromDate === today && toMin(fromTime) <= toMin(nowTime))) {
        return bad('الإذن الاعتيادي (السنوي) يُقدَّم قبل وقته، أما بعد وقوع الحالة فاختر «طارئ» أو «مرضي»');
      }
    } else {
      const back = rules[purpose].maxBackdateDays;
      if (fromDate < addDays(today, -back)) {
        return bad(back === 0 ? 'لا يُقبل هذا الطلب بعد وقوع الحالة' : `انتهت مهلة التقديم بعد وقوع الحالة (${back} يوماً)، راجع الموارد البشرية`);
      }
    }
  }

  return { ok: true, value: { kind, purpose, purposeOther, reason, fromDate, toDate, fromTime, toTime, days, minutes, mission, medicalRequired, medicalProof: medicalRequired && input.medicalProof === true } };
}

/** هل يحتاج هذا الطلب (كما هو مخزَّن) إلى تأكيد ورقة طبية؟ إجازة مرضية تزيد عن المسموح بلا ورقة. */
export const needsMedical = (row, rules) => row.kind === 'leave' && row.purpose === 'sick' && Number(row.days) > rules.medical.freeDays;

const LEAVE_KEYWORD = { annual: 'سنوي', sick: 'مرض', emergency: 'طارئ' };

/** نوع الإجازة الافتراضي في إعدادات المحرك بحسب غرض الطلب (اقتراح فقط؛ يؤكده المعتمِد). */
export function suggestLeaveType(purpose, leaveTypes, mission = false) {
  const word = mission ? 'مهمة' : LEAVE_KEYWORD[purpose];
  if (!word) return null;
  return Object.keys(leaveTypes).find((n) => n.includes(word)) || null;
}

/** «2026-11» لتاريخ */
export const monthOf = (date) => date.slice(0, 7);

/** أول وآخر يوم في شهر YYYY-MM */
export function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number);
  return { from: `${ym}-01`, to: `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` };
}
