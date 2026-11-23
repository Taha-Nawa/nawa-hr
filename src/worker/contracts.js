/**
 * وحدة العقود: سجل عقود اتفاق تقديم الخدمة التربوية (كان تطبيقاً منفصلاً، ضُمّ إلى النظام).
 * الوصول: الموارد البشرية ومسؤول النظام، ومن مُنح «يدير العقود» بالاسم (canContracts). غيرهم 403.
 * بيانات العقد حسّاسة (هويات، حسابات بنكية، أجور): لا تدخل سجل التدقيق إلا أسماء الحقول المتغيّرة، لا قيمها.
 */
import { clip, isDate, json } from './util.js';
import { canContracts, can } from './authz.js';
import { syncProviderFor } from './contracts-sync.js';
import { TEXT_FIELDS, DATE_FIELDS, NUM_FIELDS, STATUSES, TERM_ARTICLE, NONE_TERM, LISTS, SUGGEST_FIELDS, compute, audit } from '../engine/contracts.js';

const COLS = { ...Object.fromEntries(Object.entries(TEXT_FIELDS).map(([k, [col]]) => [k, col])), ...DATE_FIELDS, ...NUM_FIELDS };
const SELECT = `SELECT id, legacy_id AS legacyId, seq, ${Object.entries(COLS).map(([k, col]) => `${col} AS ${k}`).join(', ')}, created_at AS createdAt, updated_at AS updatedAt FROM contracts`;

/** يحوّل جسم الطلب إلى قيم جاهزة للتخزين، أو يُرجع { error }. partial: تعديل جزئي. */
export function parseContract(b, { partial = false } = {}) {
  const out = {};
  for (const [k, [, max]] of Object.entries(TEXT_FIELDS)) if (!partial || b[k] !== undefined) out[k] = clip(b[k], max);
  if (!partial || b.name !== undefined) if (!out.name) return { error: 'اكتب اسم مزوّد الخدمة' };
  if (out.idno && !/^\d{1,20}$/.test(out.idno)) return { error: 'رقم الهوية أرقام فقط' };
  if (out.status !== undefined && out.status !== null && !STATUSES.includes(out.status)) return { error: 'حالة العقد غير صالحة' };
  for (const k of Object.keys(DATE_FIELDS)) {
    if (partial && b[k] === undefined) continue;
    const v = b[k] === '' ? null : b[k] ?? null;
    if (v !== null && !isDate(v)) return { error: 'تاريخ غير صالح' };
    out[k] = v;
  }
  for (const k of Object.keys(NUM_FIELDS)) {
    if (partial && b[k] === undefined) continue;
    if (b[k] === '' || b[k] === null || b[k] === undefined) { out[k] = null; continue; }
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) return { error: 'رقم غير صالح (السعر أو الأيام أو الجلسات)' };
    out[k] = n;
  }
  return { value: out };
}

/** معرّف الاستيراد: id السجل القديم إن وُجد، وإلا بصمة من حقول العقد (يمنع تكرار الاستيراد). */
export const legacyKey = (r) => (r.id ? `id:${String(r.id).slice(0, 60)}` : `fp:${[r.idno, r.dSign, r.dFrom, r.dTo, r.rate, r.daysBase, r.csubject].map((x) => x ?? '').join('|')}`.slice(0, 200));
const SYNC_CHUNK = 5; // عدد الهويات في الطلب الواحد (حدّ الاستعلامات في الخطة المجانية)
export const IMPORT_CHUNK = 20; // حدّ الاستعلامات في الطلب الواحد (الخطة المجانية) وحجم الجسم

/** خطة إزالة المكرّر: تُحسب دون لمس القاعدة. الأكمل (عدد الحقول المعبّأة) ثم الأحدث ترقيماً؛ ويأخذ رقم أقدم نسخة في المجموعة. */
export function planDedupe(rows) {
  const SKIP = new Set(['id', 'legacyId', 'seq', 'createdAt', 'updatedAt']);
  const filled = (r) => Object.entries(r).filter(([k, v]) => !SKIP.has(k) && v !== null && v !== '').length;
  const groups = new Map();
  for (const r of rows) {
    if (!r.idno || !r.dFrom || !r.dTo) continue; // بلا هوية أو فترة: لا يُحكم بتكراره
    const k = [r.idno, r.dFrom, r.dTo, r.project ?? '', r.csubject ?? ''].join('|');
    (groups.get(k) || groups.set(k, []).get(k)).push(r);
  }
  const remove = [];
  const renumber = [];
  let keep = 0;
  let multi = 0;
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    multi += 1;
    const best = [...arr].sort((a, b) => filled(b) - filled(a) || (b.seq ?? 0) - (a.seq ?? 0) || b.id - a.id)[0];
    const seqs = arr.map((r) => r.seq).filter((x) => x !== null && x !== undefined);
    if (seqs.length && Math.min(...seqs) !== best.seq) renumber.push({ id: best.id, seq: Math.min(...seqs) });
    keep += 1;
    for (const r of arr) if (r.id !== best.id) remove.push(r.id);
  }
  return { groups: multi, keep, remove, renumber };
}

const present = (row) => ({ ...row, calc: compute(row), warnings: audit(row) });

export function registerContractRoutes(add, { bad, forbidden, notFound, readJson, auditStmt }) {
  // فشل المزامنة لا يُفشل حفظ العقد: يُسجَّل ويُرجع سبباً، وزر المزامنة يعيدها
  const trySync = async (db, user, idno) => {
    try { return await syncProviderFor(db, user, idno, auditStmt); } catch (e) { console.error('contract sync failed', e); return { skipped: 'تعذّرت المزامنة' }; }
  };
  const gate = (user) => canContracts(user);

  add('GET', '/api/contracts', async ({ db, user, url }) => {
    if (!gate(user)) return forbidden();
    const q = (url.searchParams.get('q') || '').trim();
    const status = url.searchParams.get('status') || '';
    const where = [];
    const params = [];
    if (q) { where.push('(name LIKE ? OR idno LIKE ? OR project LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (status) { where.push('status = ?'); params.push(status); }
    const rows = (await db.prepare(`${SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY seq DESC, id DESC`).bind(...params).all()).results;
    return json({ ok: true, contracts: rows.map(present) });
  });

  add('GET', '/api/contracts/lists', async ({ db, user }) => {
    if (!gate(user)) return forbidden();
    // اقتراحات الحقول الحرّة: القيم المميّزة المحفوظة في العقود (لا قوائم مكتوبة في الكود)
    const suggestions = {};
    for (const k of SUGGEST_FIELDS) {
      const col = TEXT_FIELDS[k][0];
      suggestions[k] = (await db.prepare(`SELECT ${col} AS v, COUNT(*) AS n FROM contracts WHERE ${col} IS NOT NULL AND ${col} <> '' GROUP BY ${col} ORDER BY n DESC, v LIMIT 60`).all()).results.map((r) => r.v);
    }
    return json({ ok: true, statuses: STATUSES, noneTerm: NONE_TERM, termTypes: Object.keys(TERM_ARTICLE), lists: LISTS, suggestions });
  });

  add('GET', '/api/contracts/:id', async ({ db, user, params }) => {
    if (!gate(user)) return forbidden();
    const row = await db.prepare(`${SELECT} WHERE id = ?`).bind(Number(params.id)).first();
    return row ? json({ ok: true, contract: present(row) }) : notFound('العقد');
  });

  add('POST', '/api/contracts', async ({ request, db, user }) => {
    if (!gate(user)) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const { value: v, error: err } = parseContract(body);
    if (err) return bad(err);
    v.status = v.status || 'مسودة';
    v.termType = v.termType || NONE_TERM;
    const keys = Object.keys(v);
    const seq = ((await db.prepare('SELECT MAX(seq) AS m FROM contracts ').first('m')) || 0) + 1;
    const res = await db.prepare(`INSERT INTO contracts (seq, ${keys.map((k) => COLS[k]).join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`).bind(seq, ...keys.map((k) => v[k])).run();
    const id = res.meta.last_row_id;
    await auditStmt(db, user, 'contract.create', 'contract', id, { seq }).run();
    const sync = await trySync(db, user, v.idno);
    const row = await db.prepare(`${SELECT} WHERE id = ?`).bind(id).first();
    return json({ ok: true, contract: present(row), provider: sync }, 201);
  });

  add('PATCH', '/api/contracts/:id', async ({ request, db, user, params }) => {
    if (!gate(user)) return forbidden();
    const id = Number(params.id);
    const { body, error } = await readJson(request);
    if (error) return error;
    const cur = await db.prepare('SELECT id FROM contracts WHERE id = ?').bind(id).first();
    if (!cur) return notFound('العقد');
    const { value: v, error: err } = parseContract(body, { partial: true });
    if (err) return bad(err);
    const keys = Object.keys(v);
    if (!keys.length) return bad('لا شيء للتعديل');
    await db.batch([
      db.prepare(`UPDATE contracts SET ${keys.map((k) => `${COLS[k]} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...keys.map((k) => v[k]), id),
      auditStmt(db, user, 'contract.update', 'contract', id, { fields: keys }), // أسماء الحقول فقط
    ]);
    const row = await db.prepare(`${SELECT} WHERE id = ?`).bind(id).first();
    const sync = await trySync(db, user, row.idno);
    return json({ ok: true, contract: present(row), provider: sync });
  });

  // مزامنة كل المزوّدين من العقود (بعد الاستيراد): على دفعات صغيرة؛ الواجهة تكرّر الطلب حتى done
  add('POST', '/api/contracts/sync', async ({ request, db, user }) => {
    if (!gate(user)) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const offset = Math.max(0, Number(body.offset) || 0);
    const total = await db.prepare("SELECT COUNT(DISTINCT idno) AS n FROM contracts WHERE idno IS NOT NULL AND idno <> ''").first('n');
    const ids = (await db.prepare("SELECT DISTINCT idno FROM contracts WHERE idno IS NOT NULL AND idno <> '' ORDER BY idno LIMIT ? OFFSET ?").bind(SYNC_CHUNK, offset).all()).results.map((r) => r.idno);
    const res = { created: 0, linked: 0, skipped: 0 };
    for (const idno of ids) {
      const r = await syncProviderFor(db, user, idno, auditStmt);
      if (r.skipped) res.skipped += 1;
      else { if (r.created) res.created += 1; if (r.linked) res.linked += 1; }
    }
    const next = offset + ids.length;
    return json({ ok: true, total, next, done: next >= total, ...res });
  });

  // فحص المكرّرات (مسؤول النظام): العقد نفسه (الهوية + الفترة + المشروع + موضوع العقد) المتكرر بسبب استعادة نسخ احتياطية.
  // يُحتفظ بأكمل نسخة (وعند التساوي أحدثها) برقم أقدم نسخة، وتُحذف البقية نهائياً (قرار صاحب النظام: لا حاجة لها).
  add('POST', '/api/contracts/dedupe', async ({ request, db, user }) => {
    if (!can(user, 'user.manage')) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const rows = (await db.prepare(`${SELECT} `).all()).results;
    const plan = planDedupe(rows);
    if (body.commit === true && plan.remove.length) {
      await db.batch([
        db.prepare('DELETE FROM contracts WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(plan.remove)),
        db.prepare('UPDATE contracts SET seq = (SELECT json_extract(j.value, \'$.seq\') FROM json_each(?1) j WHERE json_extract(j.value, \'$.id\') = contracts.id) WHERE id IN (SELECT json_extract(value, \'$.id\') FROM json_each(?1))').bind(JSON.stringify(plan.renumber)),
        auditStmt(db, user, 'contract.dedupe', 'contract', null, { removed: plan.remove.length, kept: plan.keep }),
      ]);
    }
    return json({ ok: true, committed: body.commit === true && plan.remove.length > 0, total: rows.length, groups: plan.groups, kept: plan.keep, duplicates: plan.remove.length });
  });

  // استيراد من ملف النسخة الاحتياطية للسجل القديم (JSON): للمسؤول فقط، على دفعات صغيرة، ومرّتان لا تكرّران شيئاً.
  add('POST', '/api/contracts/import', async ({ request, db, user }) => {
    if (!can(user, 'user.manage')) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const recs = Array.isArray(body.records) ? body.records : null;
    if (!recs || !recs.length || recs.length > IMPORT_CHUNK) return bad(`أرسل من 1 إلى ${IMPORT_CHUNK} عقداً في الدفعة`);
    const commit = body.commit === true;
    const prepared = recs.map((r, i) => {
      const src = r && typeof r === 'object' ? { ...r, exp: r.exp === null || r.exp === undefined ? null : String(r.exp) } : {};
      const { value, error: e } = parseContract(src);
      return e ? { i, error: e } : { i, key: legacyKey(src), value, seq: Number.isFinite(Number(src.seq)) ? Number(src.seq) : null };
    });
    const ok = prepared.filter((x) => !x.error);
    const keys = ok.map((x) => x.key);
    const have = new Set(keys.length ? (await db.prepare(`SELECT legacy_id FROM contracts WHERE legacy_id IN (${keys.map(() => '?').join(',')})`).bind(...keys).all()).results.map((r) => r.legacy_id) : []);
    const seen = new Set();
    const fresh = [];
    const out = { added: 0, existing: 0, invalid: [] };
    for (const x of prepared) {
      if (x.error) out.invalid.push({ index: x.i, reason: x.error });
      else if (have.has(x.key) || seen.has(x.key)) out.existing += 1;
      else { seen.add(x.key); fresh.push(x); }
    }
    out.added = fresh.length;
    if (commit && fresh.length) {
      let next = Math.max((await db.prepare('SELECT MAX(seq) AS m FROM contracts ').first('m')) || 0, ...fresh.map((x) => x.seq || 0)) + 1;
      const stmts = fresh.map((x) => {
        const v = { ...x.value, status: x.value.status || 'مسودة', termType: x.value.termType || NONE_TERM };
        const k = Object.keys(v);
        const seq = x.seq ?? next++;
        return db.prepare(`INSERT INTO contracts (legacy_id, seq, ${k.map((f) => COLS[f]).join(', ')}) VALUES (?, ?, ${k.map(() => '?').join(', ')})`).bind(x.key, seq, ...k.map((f) => v[f]));
      });
      await db.batch([...stmts, auditStmt(db, user, 'contract.import', 'contract', null, { added: fresh.length })]);
    }
    return json({ ok: true, committed: commit, ...out });
  });
}
