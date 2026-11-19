/**
 * ربط أذونات المغادرة المعتمدة بحركات البوابة وكتابة الأوقات الفعلية في الطلب (انظر src/engine/exit-link.js).
 * يُستدعى من recomputePairs قبل حساب الأيام، فتعمل كل مسارات إعادة الحساب (البوابة، الإقفال الليلي، الاعتماد، التصحيح) دون تغيير.
 * يتسامح مع غياب أعمدة الترحيل 0032 (يتخطى بصمت).
 */
import { matchExits } from '../engine/exit-link.js';

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

export async function linkExitRequests(db, list, settings, today) {
  if (!list.length) return;
  const key = JSON.stringify(list);
  const IN = '(employee_id, %D%) IN (SELECT json_extract(value,\'$.e\'), json_extract(value,\'$.d\') FROM json_each(?))';
  // استعلام واحد للطلبات أولاً؛ حركات البوابة لا تُقرأ إلا إن وُجد إذن مغادرة معتمد في هذه الأيام (يبقى العدد ثابتاً بلا أذونات)
  let rq;
  try {
    rq = await db.prepare(`SELECT id, employee_id AS e, from_date AS d, from_time AS ft, to_time AS tt, minutes, original, act_state AS st, act_out AS ao, act_ret AS ar FROM requests
                  WHERE kind = 'exit' AND status = 'approved' AND ${IN.replace('%D%', 'from_date')}`).bind(key).all();
  } catch (e) {
    if (/no such column|no such table/.test(String(e?.message || e))) return; // الترحيل 0032 لم يُطبَّق بعد
    throw e;
  }
  if (!rq.results.length) return;
  const mv = await db.prepare(`SELECT employee_id AS e, date AS d, type, time FROM movements WHERE type IN ('خروج', 'عودة') AND ${IN.replace('%D%', 'date')}`).bind(key).all();

  const moves = new Map();
  for (const m of mv.results) {
    const k = `${m.e}|${m.d}`;
    if (!moves.has(k)) moves.set(k, { outs: [], rets: [] });
    moves.get(k)[m.type === 'خروج' ? 'outs' : 'rets'].push(m.time);
  }
  const groups = new Map();
  for (const r of rq.results) {
    const k = `${r.e}|${r.d}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  const stmts = [];
  const set = db.prepare('UPDATE requests SET act_state = ?, act_out = ?, act_ret = ?, from_time = ?, to_time = ?, minutes = ?, original = COALESCE(original, ?) WHERE id = ?');
  for (const [k, rows] of groups) {
    const m = moves.get(k) || { outs: [], rets: [] };
    const manual = rows.filter((r) => r.st === 'manual');
    const auto = rows.filter((r) => r.st !== 'manual');
    // ما اعتمده المعتمِد يدوياً لا يُلمس، وحركاته لا تُحتسب خروجاً بلا طلب
    const dropO = new Set(manual.map((r) => r.ao).filter(Boolean));
    const dropR = new Set(manual.map((r) => r.ar).filter(Boolean));
    const outs = m.outs.filter((t) => !dropO.has(t));
    const rets = m.rets.filter((t) => !dropR.has(t));
    const base = (r) => { const o = parse(r.original); return { from: o?.fromTime || r.ft, to: o?.toTime || r.tt, minutes: o?.minutes ?? r.minutes }; };
    const { links } = matchExits(auto.map((r) => ({ id: r.id, from: base(r).from, to: base(r).to })), outs, rets, { ended: k.split('|')[1] < today, end: settings.end });
    const by = new Map(links.map((l) => [l.id, l]));
    for (const r of auto) {
      const b = base(r);
      const l = by.get(r.id);
      let next;
      if (l && (l.state === 'done' || l.state === 'exit_only')) {
        next = { st: l.state, out: l.out, ret: l.ret, from: l.out, to: l.ret || settings.end, minutes: l.minutes };
      } else if (l) {
        next = { st: l.state, out: l.out, ret: l.ret, from: b.from, to: b.to, minutes: b.minutes };
      } else {
        next = { st: null, out: null, ret: null, from: b.from, to: b.to, minutes: b.minutes };
      }
      if ((r.st || null) === next.st && r.ft === next.from && r.tt === next.to && r.ao === next.out && r.ar === next.ret) continue;
      const orig = JSON.stringify({ fromDate: r.d, toDate: r.d, fromTime: b.from, toTime: b.to, minutes: b.minutes });
      stmts.push(set.bind(next.st, next.out, next.ret, next.from, next.to, next.minutes, orig, r.id));
    }
  }
  if (stmts.length) await db.batch(stmts);
}
