import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createD1 } from './d1.js';
import { handleGate } from '../../src/worker/gate.js';
import { sha256hex } from '../../src/worker/util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const golden = JSON.parse(readFileSync(path.join(here, '..', 'fixtures', 'march-2026-golden.json'), 'utf8'));

export const DEVICE_TOKEN = 'test-device-token-0123456789abcdef';

/** قاعدة جديدة بمركز + جهاز بوابة. تُرجع { db, env }. */
export async function freshEnv({ withSettings = true } = {}) {
  const db = createD1();
  await db.prepare("INSERT INTO centers (id, name) VALUES (1, 'المبنى الرئيسي'), (2, 'مركز الزيتونة')").run();
  await db
    .prepare('INSERT INTO devices (id, name, center_id, token_hash) VALUES (?, ?, 1, ?)')
    .bind('DEV-01', 'بوابة 1', await sha256hex(DEVICE_TOKEN))
    .run();
  if (withSettings) await setWork(db, golden.settings);
  return { db, env: { DB: db } };
}

export async function setWork(db, settings) {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES ('work', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(settings))
    .run();
}

export async function addEmployee(db, { id, code, name = `موظف ${code}`, centerId = 1, card = `${code}-A`, status = 'active' }) {
  await db.prepare('INSERT INTO employees (id, code, name, center_id, status) VALUES (?, ?, ?, ?, ?)').bind(id, code, name, centerId, status).run();
  if (card) await db.prepare('INSERT INTO badges (card, employee_id) VALUES (?, ?)').bind(card, id).run();
}

export async function addHolidays(db, dates) {
  for (const d of dates) await db.prepare('INSERT INTO holidays (date, name) VALUES (?, ?)').bind(d, 'عطلة').run();
}

export async function addOverride(db, employeeId, date, { manual = {}, leaveType = '' }) {
  await db
    .prepare('INSERT INTO day_overrides (employee_id, date, in_time, out_time, ret_time, dep_time, leave_type) VALUES (?,?,?,?,?,?,?)')
    .bind(employeeId, date, manual.in ?? null, manual.out ?? null, manual.ret ?? null, manual.dep ?? null, leaveType || null)
    .run();
}

/** يرسل طلباً إلى نقطة البوابة كما يفعل التطبيق (POST نصّي) ويعيد { status, body }. */
export async function gatePost(env, moves, token = DEVICE_TOKEN) {
  env.DB.resetCount?.();
  const res = await handleGate(
    new Request('https://hr.test/api/gate', {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token, moves }),
    }),
    env,
  );
  return { status: res.status, body: await res.json(), res, queries: env.DB.queries };
}

export async function gateGet(env, query, headers = {}) {
  env.DB.resetCount?.();
  const res = await handleGate(new Request(`https://hr.test/api/gate?${query}`, { headers }), env);
  return { status: res.status, body: await res.json(), res, queries: env.DB.queries };
}

/** حركة بصيغة التطبيق */
export function mv(code, type, date, time, extra = {}) {
  return {
    id: `MV-${date.replaceAll('-', '')}${time.replace(':', '')}00-${code}-${type}`,
    card: `${code}-A`,
    code,
    name: `موظف ${code}`,
    center: 'المبنى الرئيسي',
    type,
    date,
    time,
    iso: `${date}T${time}:00.000Z`,
    device: 'DEV-01',
    offline: false,
    note: '',
    ...extra,
  };
}

/** صف daily_results -> شكل ناتج المحرك (للمقارنة مع توقعات إكسل) */
export function rowToResult(r) {
  return {
    dayType: r.day_type,
    checkIn: r.check_in,
    exitFirst: r.exit_first,
    returnLast: r.return_last,
    departure: r.departure,
    source: r.source,
    presenceHours: r.presence_hours,
    exitHours: r.exit_hours,
    netHours: r.net_hours,
    requiredHours: r.required_hours,
    approvedHours: r.approved_hours,
    lateMinutes: r.late_minutes,
    earlyLeaveMinutes: r.early_leave_minutes,
    deficitHours: r.deficit_hours,
    overtimeHours: r.overtime_hours,
    status: r.status,
    alert: r.alert,
  };
}
