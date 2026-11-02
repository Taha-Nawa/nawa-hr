/**
 * إعداد ساعات التايم شيت (قرار 2 نوفمبر 2026): المسؤول يحدّد لكل فترة ساعات الدوام الموزّعة على المشاريع والساعات الإضافية
 * وفي أي صف تُسجَّل (طارئة أو أخرى). الافتراضي (بلا إعداد): الدوام الرسمي + ساعة طارئة. يُطبَّق عند بناء كل تايم شيت فلا يحتاج إعادة حساب.
 */
import { json } from './util.js';
import { can } from './authz.js';
import { loadWorkSettings } from './settings.js';
import { officialHours } from '../engine/attendance.js';
import { mergeTimesheetConfig, validateTimesheetConfig, EMERGENCY_HOURS } from '../engine/timesheet.js';

export function registerTimesheetSettings(add, kit) {
  const { bad, forbidden, readJson, auditStmt } = kit;

  add('GET', '/api/settings/timesheet', async ({ db, user }) => {
    if (!can(user, 'settings.read')) return forbidden();
    const [row, work] = await Promise.all([db.prepare("SELECT value FROM settings WHERE key = 'timesheet'").first(), loadWorkSettings(db)]);
    let config;
    try {
      config = mergeTimesheetConfig(row ? JSON.parse(row.value) : null);
    } catch {
      config = mergeTimesheetConfig(null);
    }
    return json({ ok: true, config, dayHours: work ? officialHours(work) : null, defaultExtraHours: EMERGENCY_HOURS, canEdit: can(user, 'settings.write') });
  });

  add('PUT', '/api/settings/timesheet', async ({ request, db, user }) => {
    if (!can(user, 'settings.write')) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const v = validateTimesheetConfig(body?.config);
    if (v.error) return bad(v.error);
    await db.batch([
      db.prepare("INSERT INTO settings (key, value) VALUES ('timesheet', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(JSON.stringify(v.config)),
      auditStmt(db, user, 'settings.timesheet', 'settings', 'timesheet', v.config),
    ]);
    return json({ ok: true, config: v.config });
  });
}
