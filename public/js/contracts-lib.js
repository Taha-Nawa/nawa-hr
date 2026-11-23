/**
 * وحدة العقود: الحساب والتفقيط والتدقيق (منقولة من «سجل عقود نوى» دون تغيير في المعادلات).
 * دوال نقية بلا DOM ولا قاعدة بيانات؛ مصدر واحد يستعمله الخادم (عبر src/engine/contracts.js) والمتصفح معاً،
 * فلا تختلف أرقام الشاشة عن أرقام الخادم. المفاتيح camelCase، والتخزين في worker/contracts.js.
 * قوائم الاختيار العامة فقط هنا؛ أسماء المشاريع والممولين والبنوك والمواقع تُقترح من العقود المحفوظة ولا تُكتب في الكود.
 */
export const NONE_TERM = 'لا يوجد — العقد سارٍ';
export const LUMP = 'قيمة إجمالية للعقد (مبلغ مقطوع)';
export const DAILY = 'تسعير بالجلسة — سعر الجلسة × جلسات اليوم × أيام التنفيذ';
export const BID = 'عرض سعر (استدراج عروض أسعار)';
export const TENDER = 'عطاء';
export const STATUSES = ['مسودة', 'جاهز للتوقيع', 'موقّع', 'قيد التنفيذ', 'منجز ومكتمل', 'منتهٍ / مفسوخ'];
/** حالات تجعل مزوّد الخدمة غير فعّال في تبويب «مزودو الخدمة» */
export const CLOSED_STATUSES = ['منجز ومكتمل', 'منتهٍ / مفسوخ'];

export const LISTS = {
  gender: ['ذكر', 'أنثى', 'فريق', 'أخرى'],
  title: ['السيد', 'السيدة', 'الآنسة', 'السادة (فريق / جهة)'],
  ctype: [BID, 'خدمة مباشرة', TENDER, 'أخرى'],
  csubject: ['عقد اتفاق على تقديم خدمات تربوية', 'عقد اتفاق على تقديم خدمات تدريبية', 'عقد اتفاق على تقديم خدمات نفسية واجتماعية', 'عقد اتفاق على تقديم خدمات فنية وثقافية', 'عقد اتفاق على تقديم خدمات استشارية', 'موضوع آخر (يُحدد في الملاحظات)'],
  siteType: ['أحد مراكز جمعية نوى', 'نقطة تعليمية خارجية', 'موقع آخر تحدده الجمعية'],
  pricing: [DAILY, LUMP],
  termReason: ['لا يوجد', 'انتهاء مدة العقد', 'استكمال تنفيذ جميع الخدمات واعتمادها من الطرف الأول', 'إخلال الطرف الثاني بالتزاماته التعاقدية',
    'مخالفة سياسات الجمعية أو تعليماتها', 'ثبوت التقصير في تنفيذ الخدمات المتفق عليها', 'الإضرار بالأطفال أو المستفيدين',
    'الإضرار بسمعة الجمعية أو الجهة المانحة', 'مخالفة مدونة السلوك', 'مخالفة سياسة حماية الطفل',
    'مخالفة سياسة الحماية من الاستغلال والانتهاك والتحرش الجنسي (PSEAH)', 'توقف المشروع أو إلغاؤه', 'خفض تمويل المشروع',
    'ظروف خارجة عن إرادة الجمعية', 'قوة قاهرة (حرب، أعمال عدائية، إغلاقات، نزوح، كوارث)', 'اتفاق الطرفين', 'طلب من مقدّم/ة الخدمة',
    'سبب آخر (يُذكر في الملاحظات)'],
};
/** حقول تُقترح قيمها من العقود المحفوظة (datalist) */
export const SUGGEST_FIELDS = ['residence', 'major', 'subject', 'siteName', 'area', 'bank', 'service', 'project', 'partner', 'donor', 'hdr'];

export const TERM_ARTICLE = {
  [NONE_TERM]: '—',
  'انتهاء طبيعي بانتهاء المدة أو إتمام الخدمات': 'المادة 9-3 / 3-1',
  'إنهاء كلي بعد إشعار خطي ومهلة تصويب': 'المادة 13-1',
  'فسخ جزئي بعد إشعار خطي': 'المادة 13-1',
  'فسخ كلي فوري دون إشعار مسبق': 'المادة 13-2',
  'إنهاء لتوقف المشروع أو إلغائه أو خفض تمويله': 'المادة 13-3',
  'إنهاء بسبب قوة قاهرة أو ظروف طارئة': 'المادة 11-3',
  'إنهاء بالتراضي بموجب ملحق خطي موقّع': 'المادة 14-3',
};
export const articleFor = (t) => (t ? TERM_ARTICLE[t] || '—' : '');
export const priceKind = (v) => (!v ? '' : v === LUMP ? 'lump' : 'unit');

/** الحقول النصية والرقمية والتاريخية كما تُخزَّن (camelCase ← عمود) */
export const TEXT_FIELDS = {
  name: ['name', 120], idno: ['idno', 20], gender: ['gender', 40], title: ['title', 60], residence: ['residence', 80],
  phone: ['phone', 40], email: ['email', 120], workEmail: ['work_email', 120], major: ['major', 120], exp: ['exp', 300],
  ctype: ['ctype', 80], csubject: ['csubject', 200], service: ['service', 300], project: ['project', 200], partner: ['partner', 200],
  donor: ['donor', 200], hdr: ['hdr', 200], rfqno: ['rfqno', 60], subject: ['subject', 120],
  siteType: ['site_type', 80], siteName: ['site_name', 120], area: ['area', 80], pricing: ['pricing', 120],
  bank: ['bank', 120], iban: ['iban', 60], status: ['status', 60], termType: ['term_type', 120], termReason: ['term_reason', 200],
  notes: ['notes', 1000],
};
export const DATE_FIELDS = { dRfq: 'd_rfq', dOffer: 'd_offer', dSign: 'd_sign', dFrom: 'd_from', dTo: 'd_to', dTerm: 'd_term' };
export const NUM_FIELDS = { rate: 'rate', sessPerDay: 'sess_per_day', daysBase: 'days_base', daysAct: 'days_act', daysTerm: 'days_term' };

/* ============================ التفقيط ============================ */
const W1 = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
  'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const W10 = { 2: 'عشرون', 3: 'ثلاثون', 4: 'أربعون', 5: 'خمسون', 6: 'ستون', 7: 'سبعون', 8: 'ثمانون', 9: 'تسعون' };
const W100 = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
const j2 = (a, b) => (a && b ? `${a} و${b}` : a || b || '');
function w2(v) {
  if (!v) return '';
  if (v <= 19) return W1[v];
  const u = v % 10;
  const d = Math.floor(v / 10);
  return u === 0 ? W10[d] : `${W1[u]} و${W10[d]}`;
}
const w3 = (v) => j2(W100[Math.floor(v / 100)] || '', w2(v % 100));
function wTh(t) {
  if (!t) return '';
  if (t === 1) return 'ألف';
  if (t === 2) return 'ألفان';
  if (t <= 10) return `${W1[t]} آلاف`;
  return `${w3(t)} ألفاً`;
}
function wMn(m) {
  if (!m) return '';
  if (m === 1) return 'مليون';
  if (m === 2) return 'مليونان';
  if (m <= 10) return `${W1[m]} ملايين`;
  return `${w3(m)} مليوناً`;
}
export function tafqeet(n) {
  const v = Math.round(Number(n) * 100) / 100;
  if (!Number.isFinite(v)) return '';
  const whole = Math.floor(v);
  const cents = Math.round((v - whole) * 100);
  let w;
  if (whole === 0) w = 'صفر';
  else {
    const m = Math.floor(whole / 1e6);
    const rest = whole % 1e6;
    w = j2(j2(wMn(m), wTh(Math.floor(rest / 1000))), w3(rest % 1000));
  }
  let out = `${w} دولار أمريكي`;
  if (cents) out += ` و${w2(cents)} سنتاً`;
  return `${out} فقط لا غير`;
}

/* ============================ الحساب والتدقيق ============================ */
const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const R2 = (v) => Math.round(v * 100) / 100;

export function compute(r) {
  const c = {};
  const rate = num(r.rate);
  const db = num(r.daysBase);
  const da = num(r.daysAct);
  const dt = num(r.daysTerm);
  const lump = priceKind(r.pricing) === 'lump';
  const spd = num(r.sessPerDay) !== null && num(r.sessPerDay) > 0 ? num(r.sessPerDay) : 1;
  c.spd = spd;
  c.multi = spd > 1;
  c.dayRate = !lump && rate !== null ? R2(rate * spd) : null;
  c.base = r.pricing ? (lump ? rate : rate !== null && db !== null ? R2(rate * spd * db) : null) : null;
  c.min = db !== null ? Math.round(db * 0.75) : null;
  c.max = db !== null ? Math.round(db * 1.25) : null;
  c.sessB = !lump && db !== null ? db * spd : null;
  c.sessA = !lump && da !== null ? da * spd : null;
  c.appr = r.pricing ? (lump ? rate : rate !== null && da !== null ? R2(rate * spd * da) : null) : null;
  c.delta = c.base && c.appr !== null ? (c.appr - c.base) / c.base : null;
  c.words = c.appr !== null ? tafqeet(c.appr) : '';
  c.article = articleFor(r.termType);
  c.due = r.termType && r.termType !== NONE_TERM && !lump && dt !== null && rate !== null ? R2(dt * rate * spd) : null;
  c.terminated = !!(r.termType && r.termType !== NONE_TERM);
  return c;
}

/** ملاحظات التدقيق (نصوص عربية). لا تمنع الحفظ إلا ما ذُكر في validateContract. */
export function audit(r) {
  const e = [];
  const c = compute(r);
  const lump = priceKind(r.pricing) === 'lump';
  if (!String(r.name || '').trim()) return ['الاسم مطلوب'];
  const id = String(r.idno || '');
  if (id.length !== 9) e.push('رقم الهوية يجب أن يكون 9 خانات');
  else if (!/^\d{9}$/.test(id)) e.push('رقم الهوية أرقام فقط');
  if (!r.gender) e.push('الجنس / نوع مقدّم الخدمة ناقص');
  if (!r.title) e.push('الصفة ناقصة');
  if (r.email && !String(r.email).includes('@')) e.push('البريد الإلكتروني غير صحيح');
  if (r.workEmail && !String(r.workEmail).includes('@')) e.push('بريد نوى غير صحيح');
  if (!r.ctype) e.push('نوع العقد ناقص');
  if (!r.csubject) e.push('موضوع العقد ناقص');
  if (!r.project) e.push('اسم المشروع ناقص');
  if (!r.donor) e.push('اسم الممول ناقص');
  if ((r.ctype === BID || r.ctype === TENDER) && (!r.rfqno || !r.dRfq)) e.push('رقم وتاريخ إعلان العرض/العطاء مطلوبان لهذا النوع');
  if (!r.dSign) e.push('تاريخ توقيع العقد ناقص');
  if (!r.dFrom || !r.dTo) e.push('فترة التنفيذ (من/إلى) ناقصة');
  if (r.dFrom && r.dTo && r.dTo < r.dFrom) e.push('تاريخ «إلى» قبل «من»');
  if (r.dRfq && r.dOffer && r.dOffer < r.dRfq) e.push('تقديم العرض قبل إعلانه');
  if (r.dOffer && r.dSign && r.dSign < r.dOffer) e.push('التوقيع قبل تقديم العرض');
  if (!r.siteType || !r.siteName || !r.area) e.push('مكان التنفيذ ناقص');
  if (!r.pricing) e.push('أساس التسعير ناقص');
  if (num(r.rate) === null) e.push(lump ? 'القيمة الإجمالية المقطوعة ناقصة' : 'سعر الجلسة الواحدة ناقص');
  if (!lump && (num(r.sessPerDay) === null || num(r.sessPerDay) < 1)) e.push('عدد الجلسات في يوم العمل الواحد ناقص أو غير صحيح');
  if (!lump && num(r.sessPerDay) !== null && num(r.sessPerDay) > 6) e.push('عدد الجلسات في اليوم يتجاوز ستاً — تأكد من الرقم');
  if (!lump && num(r.sessPerDay) !== null && num(r.sessPerDay) % 1 !== 0) e.push('عدد الجلسات في اليوم يجب أن يكون عدداً صحيحاً');
  if (!lump && num(r.daysBase) === null) e.push('عدد الأيام المتفق عليها ناقص');
  const closed = CLOSED_STATUSES.includes(r.status) || c.terminated;
  if (!lump && closed && num(r.daysAct) === null) e.push('عدد الأيام المعتمدة ناقص — العقد منتهٍ وتلزم أيام التنفيذ المعتمدة');
  if (!lump && num(r.daysAct) !== null && c.min !== null && (num(r.daysAct) < c.min || num(r.daysAct) > c.max)) {
    e.push(`أيام التنفيذ تتجاوز حد 25٪ المسموح (المادة 2-4): المدى ${c.min} – ${c.max} يوماً`);
  }
  if (c.delta !== null && Math.abs(c.delta) > 0.2501) e.push('قيمة العقد تتجاوز حد 25٪ (المادة 2-4)');
  if (!r.bank || !r.iban) e.push('البيانات البنكية ناقصة');
  if (!r.status) e.push('حالة العقد ناقصة');
  if (!r.termType) e.push(`حقل الإنهاء ناقص — اختر «${NONE_TERM}»`);
  if (c.terminated && (!r.termReason || r.termReason === 'لا يوجد' || !r.dTerm)) e.push('سبب وتاريخ الإنهاء مطلوبان');
  if (r.workEmail && closed) e.push('العقد منتهٍ وللمزوّد بريد نوى: أوقف حساباته وصلاحياته');
  if (c.terminated && !lump && num(r.daysTerm) === null) e.push('أيام التنفيذ المعتمدة حتى الإنهاء مطلوبة');
  return e;
}

/* ============================ عرض ============================ */
export const money = (v) => (v === null || v === undefined || v === '' ? '' : `${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`);
export const pct = (v) => (v === null || v === undefined ? '' : `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}٪`);
export const STATUS_CHIP = { 'مسودة': 'chip-none', 'جاهز للتوقيع': 'chip-leave', 'موقّع': 'chip-leave', 'قيد التنفيذ': 'chip-present', 'منجز ومكتمل': 'chip-off', 'منتهٍ / مفسوخ': 'chip-absent' };
