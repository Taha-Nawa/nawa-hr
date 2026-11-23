/**
 * صيغ العقود ومجموعات الترويسة والشعارات (كانت في متصفح السجل القديم؛ هنا في قاعدة البيانات لتراها الإدارة كلها).
 *
 *  - الصيغة (tpl) لها «نسخ» (rev). العقد مثبّت على نسخة بعينها: تعديل الصيغة لا يمسّ عقداً قائماً.
 *  - النسخة المستعملة (في عقد) أو المقفلة لا تُعدَّل في مكانها: الحفظ بعد تغييرها يُنشئ نسخة جديدة برقم أعلى.
 *  - لا تُحفظ صيغة بلا رمزَي المقابل المالي (قيمة العقد وسعر اليوم): حماية لحق المتعاقد.
 *  - الوصول: canContracts. بيانات الصيغ ليست شخصية، لكن إدارتها تغيّر عقوداً تُوقَّع، فتبقى لمن يدير العقود.
 */
import { clip, json, sha256hex } from './util.js';
import { canContracts } from './authz.js';
import { BASE_BLOCKS, FP_DEFAULT, CONST_DEFAULT, FMT_DEFAULT, FOOT_DEFAULT } from '../../public/js/contract-tpl-base.js';
import { PAY_TOKENS, RATE_TOKENS } from '../../public/js/contract-tpl.js';

export const MAX_REV_BODY = 256 * 1024;
export const MAX_ASSET = 300 * 1024; // طول data URL
const KEEP_REVS = 10;
const BLOCK_TYPES = ['h1', 'lede', 'sec', 'art', 'cl', 'p', 'party', 'sigdate', 'sign', 'pagebreak'];
const FIELD_TYPES = ['text', 'num', 'date', 'sel'];
const ASSET_RE = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const uid = (p) => `${p}_${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;

export const defaultRevData = () => ({
  blocks: JSON.parse(JSON.stringify(BASE_BLOCKS)), fields: [],
  fp: { ...FP_DEFAULT }, consts: JSON.parse(JSON.stringify(CONST_DEFAULT)),
  fmt: { ...FMT_DEFAULT }, foot: { ...FOOT_DEFAULT }, logos: [], logoCfg: {},
});

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

function cleanStyle(s) {
  if (!s || typeof s !== 'object') return undefined;
  const o = {};
  if (['right', 'center', 'left', 'justify'].includes(s.align)) o.align = s.align;
  if (s.size !== undefined && s.size !== '') o.size = num(s.size, 12, 6, 40);
  if (s.before !== undefined && s.before !== '') o.before = num(s.before, 0, 0, 200);
  if (s.after !== undefined && s.after !== '') o.after = num(s.after, 0, 0, 200);
  for (const k of ['b', 'u', 'nb']) if (s[k]) o[k] = 1;
  return Object.keys(o).length ? o : undefined;
}
function cleanWhen(w) {
  if (!w || typeof w !== 'object') return undefined;
  const o = {};
  if (Array.isArray(w.ctype) && w.ctype.length) o.ctype = w.ctype.slice(0, 10).map((x) => str(x, 80));
  if (Array.isArray(w.pricing) && w.pricing.length) o.pricing = w.pricing.slice(0, 10).map((x) => str(x, 120));
  if (w.gender === 'ذكر' || w.gender === 'أنثى') o.gender = w.gender;
  if (w.sessions === 'multi' || w.sessions === 'one') o.sessions = w.sessions;
  return Object.keys(o).length ? o : undefined;
}

/** ينظّف بيانات نسخة ويتحقق منها. يُرجع { value } أو { error } */
export function cleanRev(d) {
  if (!d || typeof d !== 'object') return { error: 'بيانات الصيغة غير صالحة' };
  if (!Array.isArray(d.blocks) || !d.blocks.length) return { error: 'الصيغة بلا نص' };
  if (d.blocks.length > 400) return { error: 'عدد كتل الصيغة أكبر من المسموح (400)' };
  const blocks = d.blocks.map((b, i) => {
    const o = { id: str(b?.id, 24) || `b${i + 1}`, type: BLOCK_TYPES.includes(b?.type) ? b.type : 'p', text: str(b?.text, 8000) };
    const st = cleanStyle(b?.style); if (st) o.style = st;
    const w = cleanWhen(b?.when); if (w) o.when = w;
    return o;
  });
  const fields = (Array.isArray(d.fields) ? d.fields : []).slice(0, 30).map((f) => ({
    k: str(f?.k, 40).replace(/[{}|\n]/g, '').trim(), label: str(f?.label, 80), type: FIELD_TYPES.includes(f?.type) ? f.type : 'text',
    opts: Array.isArray(f?.opts) ? f.opts.slice(0, 40).map((x) => str(x, 80)) : [], req: f?.req ? 1 : 0,
  })).filter((f) => f.k);
  if (new Set(fields.map((f) => f.k)).size !== fields.length) return { error: 'مفاتيح حقول الصيغة مكرّرة' };
  const fp = {};
  for (const k of Object.keys(FP_DEFAULT)) fp[k] = str(d.fp?.[k] ?? FP_DEFAULT[k], 300);
  const consts = (Array.isArray(d.consts) ? d.consts : []).slice(0, 200).map((r) => [str(r?.[0], 200), r?.[1] === null ? null : str(r?.[1], 1500), r?.[2] === null ? null : str(r?.[2], 120)]);
  const fm = d.fmt || {};
  const fmt = {
    hdrLine: ['none', 'solid', 'dotted', 'dashed', 'double'].includes(fm.hdrLine) ? fm.hdrLine : FMT_DEFAULT.hdrLine,
    hdrW: num(fm.hdrW, 1, 0.5, 6), hdrColor: /^#[0-9a-fA-F]{6}$/.test(fm.hdrColor) ? fm.hdrColor : FMT_DEFAULT.hdrColor,
    ftrLine: ['none', 'solid', 'dotted', 'dashed', 'double'].includes(fm.ftrLine) ? fm.ftrLine : FMT_DEFAULT.ftrLine,
    ftrW: num(fm.ftrW, 1, 0.5, 6), ftrColor: /^#[0-9a-fA-F]{6}$/.test(fm.ftrColor) ? fm.ftrColor : FMT_DEFAULT.ftrColor,
    body: num(fm.body, 12.5, 8, 20), lh: num(fm.lh, 1.95, 1, 3), jc: ['justify', 'right', 'center', 'left'].includes(fm.jc) ? fm.jc : 'justify',
    h1: num(fm.h1, 16, 10, 30), h1u: fm.h1u ? 1 : 0, hi: fm.hi ? 1 : 0,
    mT: num(fm.mT, 14, 0, 60), mB: num(fm.mB, 12, 0, 60), mR: num(fm.mR, 15, 5, 50), mL: num(fm.mL, 15, 5, 50),
  };
  const foot = {};
  for (const k of Object.keys(FOOT_DEFAULT)) foot[k] = str(d.foot?.[k] ?? FOOT_DEFAULT[k], 200);
  const logoRes = cleanLogos(d.logos, d.logoCfg);
  const txt = blocks.map((b) => b.text).join('\n');
  const miss = [];
  if (!PAY_TOKENS.some((k) => txt.includes(`{{${k}}}`))) miss.push('قيمة العقد ({{الإجمالي}} أو {{القيمة_المعتمدة}})');
  if (!RATE_TOKENS.some((k) => txt.includes(`{{${k}}}`))) miss.push('سعر اليوم ({{سعر_اليوم}})');
  if (miss.length) return { error: `لا تُحفظ صيغة لا تذكر المقابل المالي للمتعاقد. أضف: ${miss.join(' و ')}` };
  return { value: { blocks, fields, fp, consts, fmt, foot, ...logoRes } };
}

export function cleanLogos(logos, cfg) {
  const out = (Array.isArray(logos) ? logos : []).slice(0, 12).map((l, i) => ({
    id: str(l?.id, 40) || `lg${i + 1}`, name: str(l?.name, 80) || 'شعار', asset: /^as_[0-9a-f]{8,40}$/.test(l?.asset || '') ? l.asset : '',
    h: num(l?.h, 24, 8, 60), align: ['right', 'center', 'left'].includes(l?.align) ? l.align : 'center', ord: num(l?.ord, i + 3, 0, 99),
    w: num(l?.w, 0, 0, 5000), ih: num(l?.ih, 0, 0, 5000),
  })).filter((l) => l.asset);
  const lc = {};
  for (const [k, v] of Object.entries(cfg && typeof cfg === 'object' ? cfg : {}).slice(0, 20)) {
    lc[str(k, 40)] = { ...(v?.h !== undefined ? { h: num(v.h, 24, 8, 60) } : {}), ...(['right', 'center', 'left'].includes(v?.align) ? { align: v.align } : {}), ...(v?.ord !== undefined ? { ord: num(v.ord, 0, 0, 99) } : {}), ...(v?.hidden ? { hidden: 1 } : {}) };
  }
  return { logos: out, logoCfg: lc };
}

async function ensureSeed(db) {
  const n = await db.prepare('SELECT COUNT(*) AS n FROM contract_tpls').first('n');
  if (n) return;
  const tid = 'tpl_main';
  const rid = 'rev_main_1';
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO contract_tpls (id, name, descr, archived, cur_rev) VALUES (?, ?, ?, 0, ?)').bind(tid, 'عقد اتفاق على تقديم خدمات تربوية', 'الصيغة الأصلية الموقّعة — أساس كل الصيغ اللاحقة', rid),
    db.prepare('INSERT OR IGNORE INTO contract_revs (id, tpl_id, ver, note, locked, data) VALUES (?, ?, 1, ?, 1, ?)').bind(rid, tid, 'الصيغة الأصلية', JSON.stringify(defaultRevData())),
  ]);
}

/** الصيغة الافتراضية للعقود الجديدة: أول صيغة غير مؤرشفة */
export async function defaultTemplate(db) {
  await ensureSeed(db);
  return (await db.prepare('SELECT id, cur_rev AS curRev FROM contract_tpls WHERE archived = 0 ORDER BY created_at, id LIMIT 1').first())
    || (await db.prepare('SELECT id, cur_rev AS curRev FROM contract_tpls ORDER BY created_at, id LIMIT 1').first());
}

/** يختم العقود غير المثبّتة (القديمة أو المستوردة) بالنسخة الحالية من الصيغة الافتراضية قبل أي تغيير فيها، كي لا تنتقل معها */
export async function stampLegacy(db) {
  const d = await defaultTemplate(db);
  const r = await db.prepare('UPDATE contracts SET tpl_id = ?, rev_id = ? WHERE tpl_id IS NULL').bind(d.id, d.curRev).run();
  if (r.meta?.changes) await db.prepare('UPDATE contract_revs SET locked = 1 WHERE id = ?').bind(d.curRev).run();
}

async function readHeaders(db) {
  const sets = (await db.prepare('SELECT id, name, data FROM contract_hdr ORDER BY name').all()).results.map((r) => ({ id: r.id, name: r.name, ...JSON.parse(r.data) }));
  const s = await db.prepare("SELECT v FROM contract_settings WHERE k = 'headers'").first('v');
  let o = {};
  try { o = s ? JSON.parse(s) : {}; } catch { o = {}; }
  return { bind: o.bind === 'project' || o.bind === 'donor' ? o.bind : '', map: o.map && typeof o.map === 'object' ? o.map : {}, sets };
}

/** أي مجموعة ترويسة تخصّ العقد: اختيار العقد (بالاسم) أولاً ثم الربط التلقائي بالمشروع أو الممول */
export function headerFor(c, hdrs) {
  if (!hdrs.sets.length) return null;
  if (c.hdr) { const s = hdrs.sets.find((x) => x.name === c.hdr); if (s) return s; }
  if (hdrs.bind) {
    const key = String(c[hdrs.bind] || '').trim();
    const id = key && hdrs.map[key];
    if (id) return hdrs.sets.find((x) => x.id === id) || null;
  }
  return null;
}

const revRow = (r) => ({ id: r.id, tplId: r.tpl_id, ver: r.ver, note: r.note || '', locked: r.locked, at: r.created_at });

async function gcAssets(db) {
  const ids = (await db.prepare('SELECT id FROM contract_assets').all()).results.map((r) => r.id);
  for (const id of ids) {
    const used = await db.prepare('SELECT 1 AS x FROM contract_revs WHERE data LIKE ? UNION ALL SELECT 1 FROM contract_hdr WHERE data LIKE ? LIMIT 1').bind(`%"${id}"%`, `%"${id}"%`).first();
    if (!used) await db.prepare('DELETE FROM contract_assets WHERE id = ?').bind(id).run();
  }
}

export function registerTemplateRoutes(add, { bad, forbidden, notFound, readJson, auditStmt }) {
  const gate = (user) => canContracts(user);

  add('GET', '/api/contracts/templates', async ({ db, user }) => {
    if (!gate(user)) return forbidden();
    await stampLegacy(db);
    const tpls = (await db.prepare('SELECT id, name, descr, archived, cur_rev AS curRev, created_at AS at FROM contract_tpls ORDER BY created_at, id').all()).results;
    const revs = (await db.prepare('SELECT id, tpl_id, ver, note, locked, created_at FROM contract_revs ORDER BY tpl_id, ver DESC').all()).results.map(revRow);
    const use = (await db.prepare('SELECT tpl_id AS t, rev_id AS r, COUNT(*) AS n FROM contracts GROUP BY tpl_id, rev_id').all()).results;
    const byRev = {};
    const byTpl = {};
    for (const u of use) { if (u.r) byRev[u.r] = (byRev[u.r] || 0) + u.n; if (u.t) byTpl[u.t] = (byTpl[u.t] || 0) + u.n; }
    const unstamped = use.filter((u) => !u.t).reduce((a, u) => a + u.n, 0);
    const hdrs = await readHeaders(db);
    const hUse = (await db.prepare("SELECT hdr AS n, COUNT(*) AS c FROM contracts WHERE hdr IS NOT NULL AND hdr <> '' GROUP BY hdr").all()).results;
    return json({
      ok: true, unstamped,
      tpls: tpls.map((t) => ({ ...t, usage: byTpl[t.id] || 0 })),
      revs: revs.map((r) => ({ ...r, usage: byRev[r.id] || 0, locked: r.locked || byRev[r.id] ? 1 : 0 })),
      headers: { ...hdrs, sets: hdrs.sets.map((s) => ({ ...s, usage: hUse.find((u) => u.n === s.name)?.c || 0 })) },
    });
  });

  add('GET', '/api/contracts/templates/revs/:id', async ({ db, user, params }) => {
    if (!gate(user)) return forbidden();
    const r = await db.prepare('SELECT id, tpl_id, ver, note, locked, data, created_at FROM contract_revs WHERE id = ?').bind(params.id).first();
    return r ? json({ ok: true, rev: { ...revRow(r), ...JSON.parse(r.data) } }) : notFound('النسخة');
  });

  add('POST', '/api/contracts/templates', async ({ request, db, user }) => {
    if (!gate(user)) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const name = clip(body.name, 120);
    if (!name) return bad('اكتب اسم الصيغة');
    await ensureSeed(db);
    let data = defaultRevData();
    let note = 'صيغة جديدة';
    if (body.fromRev) {
      const src = await db.prepare('SELECT data FROM contract_revs WHERE id = ?').bind(String(body.fromRev)).first();
      if (!src) return notFound('النسخة المنسوخ منها');
      data = JSON.parse(src.data);
      note = 'منسوخة';
    }
    const tid = uid('tpl');
    const rid = uid('rev');
    await db.batch([
      db.prepare('INSERT INTO contract_tpls (id, name, descr, archived, cur_rev) VALUES (?, ?, ?, 0, ?)').bind(tid, name, clip(body.desc, 300) || '', rid),
      db.prepare('INSERT INTO contract_revs (id, tpl_id, ver, note, locked, data) VALUES (?, ?, 1, ?, 0, ?)').bind(rid, tid, note, JSON.stringify(data)),
      auditStmt(db, user, 'contract.tpl.create', 'contract_tpl', tid, { name }),
    ]);
    return json({ ok: true, id: tid, revId: rid }, 201);
  });

  add('PATCH', '/api/contracts/templates/:id', async ({ request, db, user, params }) => {
    if (!gate(user)) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const t = await db.prepare('SELECT id, archived FROM contract_tpls WHERE id = ?').bind(params.id).first();
    if (!t) return notFound('الصيغة');
    const sets = [];
    const vals = [];
    if (body.name !== undefined) { const n = clip(body.name, 120); if (!n) return bad('اكتب اسم الصيغة'); sets.push('name = ?'); vals.push(n); }
    if (body.desc !== undefined) { sets.push('descr = ?'); vals.push(clip(body.desc, 300) || ''); }
    if (body.archived !== undefined) {
      if (body.archived && !t.archived) {
        const live = await db.prepare('SELECT COUNT(*) AS n FROM contract_tpls WHERE archived = 0').first('n');
        if (live <= 1) return bad('لا يمكن أرشفة آخر صيغة فعّالة');
      }
      await stampLegacy(db);
      sets.push('archived = ?'); vals.push(body.archived ? 1 : 0);
    }
    if (!sets.length) return bad('لا شيء للتعديل');
    await db.batch([db.prepare(`UPDATE contract_tpls SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, params.id), auditStmt(db, user, 'contract.tpl.update', 'contract_tpl', params.id, { fields: Object.keys(body) })]);
    return json({ ok: true });
  });

  add('DELETE', '/api/contracts/templates/:id', async ({ db, user, params }) => {
    if (!gate(user)) return forbidden();
    const t = await db.prepare('SELECT id, name FROM contract_tpls WHERE id = ?').bind(params.id).first();
    if (!t) return notFound('الصيغة');
    const n = await db.prepare('SELECT COUNT(*) AS n FROM contracts WHERE tpl_id = ?').bind(params.id).first('n');
    if (n) return bad(`الصيغة مستعملة في ${n} عقداً؛ أرشِفها بدلاً من حذفها`, 409);
    const total = await db.prepare('SELECT COUNT(*) AS n FROM contract_tpls').first('n');
    if (total <= 1) return bad('لا يمكن حذف آخر صيغة');
    await db.batch([
      db.prepare('DELETE FROM contract_revs WHERE tpl_id = ?').bind(params.id),
      db.prepare('DELETE FROM contract_tpls WHERE id = ?').bind(params.id),
      auditStmt(db, user, 'contract.tpl.delete', 'contract_tpl', params.id, { name: t.name }),
    ]);
    await gcAssets(db);
    return json({ ok: true });
  });

  // حفظ مسودة الصيغة: تعديل النسخة الحالية في مكانها إن لم تُستعمل بعد، وإلا نسخة جديدة برقم أعلى.
  add('PUT', '/api/contracts/templates/:id/draft', async ({ request, db, user, params }) => {
    if (!gate(user)) return forbidden();
    const { body, error } = await readJson(request, MAX_REV_BODY);
    if (error) return error;
    const t = await db.prepare('SELECT id, cur_rev AS curRev FROM contract_tpls WHERE id = ?').bind(params.id).first();
    if (!t) return notFound('الصيغة');
    const { value, error: err } = cleanRev(body.data);
    if (err) return bad(err);
    await stampLegacy(db);
    const data = JSON.stringify(value);
    if (data.length > 200000) return bad('الصيغة أكبر من المسموح');
    const note = clip(body.note, 120) || '';
    const cur = await db.prepare('SELECT id, ver, note, locked, data FROM contract_revs WHERE id = ?').bind(t.curRev).first();
    if (cur && cur.data === data) return json({ ok: true, unchanged: true, revId: cur.id, ver: cur.ver });
    const used = cur ? await db.prepare('SELECT COUNT(*) AS n FROM contracts WHERE rev_id = ?').bind(cur.id).first('n') : 0;
    let revId;
    let ver;
    if (cur && !cur.locked && !used) {
      revId = cur.id; ver = cur.ver;
      await db.batch([db.prepare("UPDATE contract_revs SET data = ?, note = ?, created_at = datetime('now') WHERE id = ?").bind(data, note || cur.note || '', cur.id), auditStmt(db, user, 'contract.tpl.rev', 'contract_tpl', t.id, { ver, inPlace: true })]);
    } else {
      revId = uid('rev'); ver = (cur?.ver || 0) + 1;
      await db.batch([
        db.prepare('INSERT INTO contract_revs (id, tpl_id, ver, note, locked, data) VALUES (?, ?, ?, ?, 0, ?)').bind(revId, t.id, ver, note, data),
        db.prepare('UPDATE contract_tpls SET cur_rev = ? WHERE id = ?').bind(revId, t.id),
        auditStmt(db, user, 'contract.tpl.rev', 'contract_tpl', t.id, { ver, inPlace: false }),
      ]);
    }
    // نقتصّ النسخ القديمة غير المستعملة: نحتفظ بالحالية والمقفلة والمستعملة وآخر 10
    const mine = (await db.prepare('SELECT id, ver, locked FROM contract_revs WHERE tpl_id = ? ORDER BY ver DESC').bind(t.id).all()).results;
    const usedIds = new Set((await db.prepare('SELECT DISTINCT rev_id AS r FROM contracts WHERE tpl_id = ?').bind(t.id).all()).results.map((x) => x.r));
    let kept = 0;
    const drop = [];
    for (const r of mine) { if (r.id === revId || r.locked || usedIds.has(r.id) || kept < KEEP_REVS) kept += 1; else drop.push(r.id); }
    if (drop.length) await db.batch(drop.map((id) => db.prepare('DELETE FROM contract_revs WHERE id = ?').bind(id)));
    await gcAssets(db);
    return json({ ok: true, revId, ver });
  });

  // مجموعات الترويسة + الربط التلقائي (استبدال كامل من الواجهة)
  add('PUT', '/api/contracts/headers', async ({ request, db, user }) => {
    if (!gate(user)) return forbidden();
    const { body, error } = await readJson(request, MAX_REV_BODY);
    if (error) return error;
    const sets = Array.isArray(body.sets) ? body.sets.slice(0, 40) : null;
    if (!sets) return bad('بيانات الترويسات غير صالحة');
    const clean = [];
    for (const s of sets) {
      const name = clip(s?.name, 80);
      if (!name) return bad('لكل مجموعة ترويسة اسم');
      const { logos, logoCfg } = cleanLogos(s.logos, s.logoCfg);
      const foot = {};
      for (const k of Object.keys(FOOT_DEFAULT)) foot[k] = str(s.foot?.[k] ?? FOOT_DEFAULT[k], 200);
      clean.push({ id: /^hdr_[A-Za-z0-9]{3,30}$/.test(s?.id || '') ? s.id : uid('hdr'), name, data: JSON.stringify({ logos, logoCfg, foot }) });
    }
    if (new Set(clean.map((s) => s.name)).size !== clean.length) return bad('اسم مجموعة الترويسة مكرّر');
    const bind = body.bind === 'project' || body.bind === 'donor' ? body.bind : '';
    const ids = new Set(clean.map((s) => s.id));
    const map = {};
    for (const [k, v] of Object.entries(body.map && typeof body.map === 'object' ? body.map : {}).slice(0, 300)) if (ids.has(v)) map[str(k, 200)] = v;
    const old = (await db.prepare('SELECT id, name FROM contract_hdr').all()).results;
    const stmts = [];
    for (const o of old) {
      const n = clean.find((s) => s.id === o.id);
      if (!n) stmts.push(db.prepare('DELETE FROM contract_hdr WHERE id = ?').bind(o.id));
      else if (n.name !== o.name) stmts.push(db.prepare('UPDATE contracts SET hdr = ? WHERE hdr = ?').bind(n.name, o.name)); // إعادة التسمية لا تفصل العقود عن مجموعتها
    }
    // الأسماء فريدة: نفرغ أسماء الموجود أولاً كي لا يصطدم تبديل اسمين
    stmts.push(db.prepare("UPDATE contract_hdr SET name = '~' || id"));
    for (const s of clean) stmts.push(db.prepare('INSERT INTO contract_hdr (id, name, data) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET name = ?2, data = ?3').bind(s.id, s.name, s.data));
    stmts.push(db.prepare("INSERT INTO contract_settings (k, v) VALUES ('headers', ?1) ON CONFLICT(k) DO UPDATE SET v = ?1").bind(JSON.stringify({ bind, map })));
    stmts.push(auditStmt(db, user, 'contract.hdr.save', 'contract_hdr', null, { sets: clean.length, bind }));
    await db.batch(stmts);
    await gcAssets(db);
    return json({ ok: true, headers: await readHeaders(db) });
  });

  add('POST', '/api/contracts/assets', async ({ request, db, user }) => {
    if (!gate(user)) return forbidden();
    const { body, error } = await readJson(request, MAX_ASSET + 2048);
    if (error) return error;
    const data = String(body.data || '');
    const m = ASSET_RE.exec(data);
    if (!m || data.length > MAX_ASSET) return bad(`الصورة غير صالحة أو أكبر من ${Math.round(MAX_ASSET / 1024)} كيلوبايت (PNG أو JPG)`);
    const id = `as_${(await sha256hex(data)).slice(0, 20)}`;
    await db.prepare('INSERT OR IGNORE INTO contract_assets (id, mime, data) VALUES (?, ?, ?)').bind(id, m[1], data).run();
    return json({ ok: true, id }, 201);
  });

  add('GET', '/api/contracts/assets/:id', async ({ db, user, params }) => {
    if (!gate(user)) return forbidden();
    const a = await db.prepare('SELECT mime, data FROM contract_assets WHERE id = ?').bind(params.id).first();
    if (!a) return notFound('الصورة');
    const bin = Uint8Array.from(atob(a.data.slice(a.data.indexOf(',') + 1)), (c) => c.charCodeAt(0));
    return new Response(bin, { headers: { 'content-type': a.mime, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' } });
  });
}

/** ما تحتاجه الطباعة وWord لعقد واحد: نسخة الصيغة المثبّت عليها + مجموعة الترويسة الحاكمة */
export async function docFor(db, row) {
  let revId = row.revId;
  if (!revId || !(await db.prepare('SELECT 1 AS x FROM contract_revs WHERE id = ?').bind(revId).first())) revId = (await defaultTemplate(db)).curRev;
  const rev = await db.prepare('SELECT id, tpl_id, ver, note, locked, data, created_at FROM contract_revs WHERE id = ?').bind(revId).first();
  return { rev: { ...revRow(rev), ...JSON.parse(rev.data) }, header: headerFor(row, await readHeaders(db)) };
}
