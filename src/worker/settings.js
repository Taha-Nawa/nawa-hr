import { toMin } from '../engine/attendance.js';
import { isTime } from './util.js';

/**
 * يحمّل إعدادات المحرك من جدول settings (المفتاح 'work') ويتحقق من شكلها.
 * لا قيم افتراضية: إن لم تكن موجودة أو كانت معطوبة نُرجع null ويقرّر المستدعي (الحركات تُحفظ دائماً، والحساب يُؤجَّل).
 */
export async function loadWorkSettings(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'work'").first();
  if (!row) return null;
  let s;
  try {
    s = JSON.parse(row.value);
  } catch {
    return null;
  }
  return validateWorkSettings(s) ? s : null;
}

export function validateWorkSettings(s) {
  if (!s || typeof s !== 'object') return false;
  if (!isTime(s.start) || !isTime(s.end) || toMin(s.end) <= toMin(s.start)) return false;
  if (!Number.isFinite(s.toleranceMinutes) || s.toleranceMinutes < 0) return false;
  if (!Array.isArray(s.weekdays) || s.weekdays.length !== 7) return false;
  if (!s.weekdays.every((d) => d === 'عمل' || d === 'عطلة أسبوعية')) return false;
  if (!s.leaveTypes || typeof s.leaveTypes !== 'object') return false;
  if (!Object.values(s.leaveTypes).every((v) => typeof v === 'boolean')) return false;
  return true;
}
