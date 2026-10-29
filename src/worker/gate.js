/**
 * نقطة الربط مع تطبيق البوابة — متوافقة مع صيغة خدمة Apps Script الحالية كي يكفي تبديل الرابط في إعدادات الجهاز:
 *   GET  ?action=ping&token=...      → { ok, msg }
 *   GET  ?action=badges&token=...    → { ok, badges:[{card, code, name, center, status, photo}], count }
 *   POST (text/plain JSON) { token, moves:[{id,card,code,name,center,type,date,time,iso,device,offline,note}] }
 *                                    → { ok, saved, skipped, rejected?, unmatched?, warning? }
 *
 * الفرق الأمني عن النسخة القديمة: لكل جهاز رمزه الخاص (يُخزَّن مبصوماً SHA-256) ويُلغى منفرداً،
 * بدل رمز واحد مشترك مكتوب في الشيفرة.
 */
import { json, sha256hex, isDate, isTime, clip } from './util.js';
import { loadWorkSettings } from './settings.js';
import { recomputePairs } from './recompute.js';

const MAX_BODY_BYTES = 256 * 1024;
export const MAX_MOVES = 100;
const TYPES = new Set(['حضور', 'خروج', 'عودة', 'انصراف']);
const LAST_SEEN_STALE_MIN = 5;

const INSERT_SQL = `
INSERT OR IGNORE INTO movements (id, employee_id, card, code, name, center, type, date, time, iso, device_id, offline, note)
SELECT j.id, COALESCE(b.employee_id, e.id), j.card, j.code, j.name, j.center, j.type, j.date, j.time, j.iso, ?2, j.offline, j.note
FROM (
  SELECT json_extract(value,'$.id') AS id, json_extract(value,'$.card') AS card, json_extract(value,'$.code') AS code,
         json_extract(value,'$.name') AS name, json_extract(value,'$.center') AS center, json_extract(value,'$.type') AS type,
         json_extract(value,'$.date') AS date, json_extract(value,'$.time') AS time, json_extract(value,'$.iso') AS iso,
         json_extract(value,'$.offline') AS offline, json_extract(value,'$.note') AS note
  FROM json_each(?1)
) j
LEFT JOIN badges b ON b.card = j.card
LEFT JOIN employees e ON e.code = j.code
RETURNING id, employee_id, date`;

export async function authDevice(db, token) {
  if (typeof token !== 'string' || token.length < 16 || token.length > 200) return null;
  const hash = await sha256hex(token);
  const d = await db.prepare('SELECT id, center_id FROM devices WHERE token_hash = ? AND active = 1').bind(hash).first();
  return d || null;
}

function cors(res) {
  // الرمز في الطلب وليس في كوكي، فلا خطر من السماح بأي أصل (التطبيق مستضاف على نطاق مختلف).
  res.headers.set('access-control-allow-origin', '*');
  res.headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.headers.set('access-control-allow-headers', 'content-type, authorization');
  res.headers.set('access-control-max-age', '86400');
  return res;
}

export async function handleGate(request, env) {
  if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
  return cors(await route(request, env));
}

async function route(request, env) {
  const url = new URL(request.url);
  let token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null;
  let body = null;

  if (request.method === 'GET') {
    token = token || url.searchParams.get('token');
  } else if (request.method === 'POST') {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json({ ok: false, error: 'الطلب أكبر من المسموح' }, 413);
    try {
      body = JSON.parse(text);
    } catch {
      return json({ ok: false, error: 'صيغة الطلب غير صالحة' }, 400);
    }
    token = token || body?.token;
  } else {
    return json({ ok: false, error: 'طريقة غير مدعومة' }, 405);
  }

  const device = await authDevice(env.DB, token);
  if (!device) return json({ ok: false, error: 'رمز حماية غير صحيح' }, 401);

  if (request.method === 'GET') {
    const action = url.searchParams.get('action');
    if (action === 'ping') return json({ ok: true, msg: 'الخدمة تعمل', device: device.id });
    if (action === 'badges') return badges(env.DB);
    return json({ ok: false, error: 'إجراء غير معروف' }, 400);
  }
  return ingest(env.DB, device, body);
}

async function badges(db) {
  const r = await db
    .prepare(
      `SELECT b.card, e.code, e.name, COALESCE(c.name, '') AS center, b.status, COALESCE(e.photo_url, '') AS photo
       FROM badges b
       JOIN employees e ON e.id = b.employee_id AND e.status = 'active'
       LEFT JOIN centers c ON c.id = e.center_id`,
    )
    .all();
  const list = r.results.map((x) => ({
    card: x.card,
    code: x.code,
    name: x.name,
    center: x.center,
    status: x.status === 'active' ? 'سارية' : 'ملغاة',
    photo: x.photo,
  }));
  return json({ ok: true, badges: list, count: list.length });
}

function validateMove(m) {
  if (!m || typeof m !== 'object') return 'حركة غير صالحة';
  if (typeof m.id !== 'string' || m.id.length < 1 || m.id.length > 80) return 'معرّف غير صالح';
  if (!TYPES.has(m.type)) return 'نوع حركة غير معروف';
  if (!isDate(m.date)) return 'تاريخ غير صالح';
  if (!isTime(m.time)) return 'وقت غير صالح';
  return null;
}

async function ingest(db, device, body) {
  const moves = Array.isArray(body?.moves) ? body.moves : null;
  if (!moves) return json({ ok: false, error: 'لا توجد حركات في الطلب' }, 400);
  if (moves.length > MAX_MOVES) return json({ ok: false, error: `الحد الأقصى ${MAX_MOVES} حركة في الطلب` }, 413);
  return json(await ingestMoves(db, device.id, moves, { touchDevice: true }));
}

/**
 * يحفظ حركات ويعيد حساب أيامها. يُستعمل من البوابة (جهاز مصادَق) ومن استيراد الإدارة (deviceId = 'IMPORT').
 * يُرجع كائن الاستجابة { ok, saved, skipped, rejected?, unmatched?, warning? }.
 */
export async function ingestMoves(db, deviceId, moves, { touchDevice = false } = {}) {
  const good = [];
  const rejected = [];
  for (const m of moves) {
    const why = validateMove(m);
    if (why) rejected.push({ id: typeof m?.id === 'string' ? m.id.slice(0, 80) : null, reason: why });
    else {
      good.push({
        id: m.id,
        card: clip(m.card, 120),
        code: clip(m.code, 40),
        name: clip(m.name, 120),
        center: clip(m.center, 120),
        type: m.type,
        date: m.date,
        time: m.time,
        iso: clip(m.iso, 40),
        offline: m.offline ? 1 : 0,
        note: clip(m.note, 300),
      });
    }
  }

  const out = { ok: true, saved: 0, skipped: 0 };
  if (rejected.length) out.rejected = rejected;

  const staleBefore = new Date(Date.now() - LAST_SEEN_STALE_MIN * 60000).toISOString().replace('T', ' ').slice(0, 19);
  const touch = touchDevice
    ? db.prepare("UPDATE devices SET last_seen = datetime('now') WHERE id = ? AND (last_seen IS NULL OR last_seen < ?)").bind(deviceId, staleBefore)
    : null;
  const touchNow = async () => touch && touch.run();

  if (good.length === 0) {
    await touchNow();
    return out;
  }

  // 1) الحفظ أولاً وبشكل مستقل عن الحساب: لا تضيع حركة لأن الإعدادات ناقصة.
  const ins = await db.prepare(INSERT_SQL).bind(JSON.stringify(good), deviceId).all();
  out.saved = ins.results.length;
  out.skipped = good.length - out.saved;
  const unmatched = ins.results.filter((r) => r.employee_id === null).length;
  if (unmatched) out.unmatched = unmatched;

  // 2) إعادة حساب الأيام المتأثرة (الجديدة فقط؛ المكرَّرة لا تغيّر شيئاً).
  const pairs = ins.results.filter((r) => r.employee_id !== null).map((r) => ({ e: r.employee_id, d: r.date }));
  if (pairs.length === 0) {
    await touchNow();
    return out;
  }
  const settings = await loadWorkSettings(db);
  if (!settings) {
    out.warning = 'settings_missing';
    await touchNow();
    return out;
  }
  await recomputePairs(db, pairs, settings, touch ? [touch] : []);
  return out;
}
