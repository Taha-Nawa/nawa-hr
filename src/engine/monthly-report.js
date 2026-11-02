// التقرير الشهري للموظف: تحقق وتنظيف الأقسام الثلاثة. نقي بلا قاعدة بيانات.
import { isDate } from '../worker/util.js';

export const LIMITS = { tasks: 60, meetings: 40, next: 60, attachments: 20, title: 400, challenges: 400, short: 80, summary: 500, place: 120, attachment: 200, notes: 2000 };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (m) => typeof m === 'string' && MONTH_RE.test(m);

export function monthBounds(m) {
  const next = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1));
  return { from: `${m}-01`, to: new Date(next.getTime() - 86400000).toISOString().slice(0, 10) };
}

export function prevMonth(m) {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 2, 1));
  return d.toISOString().slice(0, 7);
}

const str = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const blank = (...vs) => vs.every((v) => v === '');
const obj = (r) => (r && typeof r === 'object' && !Array.isArray(r) ? r : {});
const list = (v) => (Array.isArray(v) ? v : []);

/**
 * input: { tasks, meetings, next, attachments } كما يرسلها المحرّر؛ الأسطر الفارغة تُحذف، والترقيم يُحسب عند العرض لا يُخزَّن.
 * يُرجع { ok: true, value } أو { ok: false, error } برسالة عربية تحدد السطر.
 */
export function validateReport(input, month) {
  const { from, to } = monthBounds(month);
  const tasks = [];
  for (const [i, raw] of list(input?.tasks).entries()) {
    const r = obj(raw);
    const row = { title: str(r.title, LIMITS.title), status: str(r.status, LIMITS.short), challenges: str(r.challenges, LIMITS.challenges) };
    if (blank(...Object.values(row))) continue;
    if (!row.title) return { ok: false, error: `المهام الرئيسية، السطر ${i + 1}: اكتب نص المهمة` };
    tasks.push(row);
  }
  const meetings = [];
  for (const [i, raw] of list(input?.meetings).entries()) {
    const r = obj(raw);
    const row = { title: str(r.title, LIMITS.title), summary: str(r.summary, LIMITS.summary), place: str(r.place, LIMITS.place), date: str(r.date, 10) };
    if (blank(...Object.values(row))) continue;
    if (!row.title) return { ok: false, error: `الاجتماعات والنشاطات، السطر ${i + 1}: اكتب عنوان الاجتماع أو النشاط` };
    if (row.date && !isDate(row.date)) return { ok: false, error: `الاجتماعات والنشاطات، السطر ${i + 1}: التاريخ غير صالح` };
    if (row.date && (row.date < from || row.date > to)) return { ok: false, error: `الاجتماعات والنشاطات، السطر ${i + 1}: التاريخ خارج مدة التقرير` };
    meetings.push(row);
  }
  const next = [];
  for (const [i, raw] of list(input?.next).entries()) {
    const r = obj(raw);
    const row = { title: str(r.title, LIMITS.title), importance: str(r.importance, LIMITS.short), start: str(r.start, 10), end: str(r.end, 10) };
    if (blank(...Object.values(row))) continue;
    if (!row.title) return { ok: false, error: `المهام اللاحقة، السطر ${i + 1}: اكتب نص المهمة` };
    for (const k of ['start', 'end']) if (row[k] && !isDate(row[k])) return { ok: false, error: `المهام اللاحقة، السطر ${i + 1}: التاريخ غير صالح` };
    if (row.start && row.end && row.end < row.start) return { ok: false, error: `المهام اللاحقة، السطر ${i + 1}: تاريخ الانتهاء قبل تاريخ البدء` };
    next.push(row);
  }
  const attachments = list(input?.attachments).map((a) => str(a, LIMITS.attachment)).filter(Boolean);
  for (const [name, arr, label] of [['tasks', tasks, 'المهام الرئيسية'], ['meetings', meetings, 'الاجتماعات والنشاطات'], ['next', next, 'المهام اللاحقة'], ['attachments', attachments, 'المرفقات']]) {
    if (arr.length > LIMITS[name]) return { ok: false, error: `${label}: الحد الأقصى ${LIMITS[name]} سطراً` };
  }
  return { ok: true, value: { tasks, meetings, next, attachments } };
}

export const emptyBody = () => ({ tasks: [], meetings: [], next: [], attachments: [] });

/** يقرأ body المخزَّن بأمان (قيمة تالفة ← تقرير فارغ). */
export function parseBody(text) {
  try {
    const v = JSON.parse(text || '{}');
    return { ...emptyBody(), ...(v && typeof v === 'object' ? v : {}) };
  } catch {
    return emptyBody();
  }
}
