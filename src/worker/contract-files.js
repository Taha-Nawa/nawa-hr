/**
 * مستندات العقد: رفع وعرض وحذف. الوصول: canContracts. الملف يُتحقق من نوعه ببصمته (لا باسمه ولا بما يصرّح به المتصفح).
 * التخزين: قطع BLOB في D1 افتراضياً، أو R2 إن رُبطت الحاوية DOCS في wrangler (الدالتان store/load/drop أدناه).
 */
import { json } from './util.js';
import { canContracts } from './authz.js';

export const FILE_KINDS = ['العقد الموقّع', 'صورة الهوية', 'عرض السعر', 'ملحق أو تمديد', 'مستند آخر'];
export const MAX_FILE = 8 * 1024 * 1024;
const MAX_PER_CONTRACT = 12;
const CHUNK = 900 * 1024;
const starts = (b, ...sig) => sig.every((x, i) => x === null || b[i] === x);
// ملف docx = ZIP يحوي مجلد word/ ضمن أسماء مدخلاته (تُكتب نصاً في رؤوس الملفات)؛ يردّ أي ZIP آخر (xlsx، أرشيف عشوائي)
const isDocx = (b) => new TextDecoder('latin1').decode(b.subarray(0, Math.min(b.length, 65536))).includes('word/');
const SNIFF = [
  ['application/pdf', (b) => starts(b, 0x25, 0x50, 0x44, 0x46)],
  ['image/png', (b) => starts(b, 0x89, 0x50, 0x4e, 0x47)],
  ['image/jpeg', (b) => starts(b, 0xff, 0xd8, 0xff)],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', (b) => starts(b, 0x50, 0x4b, 0x03, 0x04) && isDocx(b)],
  ['application/msword', (b) => starts(b, 0xd0, 0xcf, 0x11, 0xe0)],
];
export const sniffMime = (b) => SNIFF.find(([, f]) => f(b))?.[0] || null;

async function store(env, db, id, bytes) {
  if (env.DOCS) { await env.DOCS.put(`contract-files/${id}`, bytes); return 'r2'; }
  const stmts = [];
  for (let n = 0, off = 0; off < bytes.length; n += 1, off += CHUNK) stmts.push(db.prepare('INSERT INTO contract_file_chunks (file_id, n, data) VALUES (?, ?, ?)').bind(id, n, bytes.slice(off, off + CHUNK)));
  await db.batch(stmts);
  return 'd1';
}
async function load(env, db, f) {
  if (f.storage === 'r2') { const o = await env.DOCS?.get(`contract-files/${f.id}`); return o ? new Uint8Array(await o.arrayBuffer()) : null; }
  const rows = (await db.prepare('SELECT data FROM contract_file_chunks WHERE file_id = ? ORDER BY n').bind(f.id).all()).results;
  if (!rows.length) return null;
  const out = new Uint8Array(f.size);
  let off = 0;
  for (const r of rows) { const d = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data); out.set(d, off); off += d.length; }
  return out;
}
/** عبارات حذف مستندات عقد/عقود (للاستعمال داخل batch). ملفات R2 تُحذف بعدها بـ dropR2 */
export const dropStatements = (db, ids) => [
  db.prepare('DELETE FROM contract_file_chunks WHERE file_id IN (SELECT id FROM contract_files WHERE contract_id IN (SELECT value FROM json_each(?)))').bind(JSON.stringify(ids)),
  db.prepare('DELETE FROM contract_files WHERE contract_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)),
];

export function registerContractFileRoutes(add, { bad, forbidden, notFound, auditStmt }) {
  const gate = (user) => canContracts(user);

  add('GET', '/api/contracts/:id/files', async ({ db, user, params }) => {
    if (!gate(user)) return forbidden();
    const files = (await db.prepare('SELECT id, kind, name, mime, size, uploaded_by AS by, created_at AS at FROM contract_files WHERE contract_id = ? ORDER BY id').bind(Number(params.id)).all()).results;
    return json({ ok: true, files, kinds: FILE_KINDS, max: MAX_FILE });
  });

  add('POST', '/api/contracts/:id/files', async ({ request, env, db, user, params, url }) => {
    if (!gate(user)) return forbidden();
    const cid = Number(params.id);
    if (!(await db.prepare('SELECT id FROM contracts WHERE id = ?').bind(cid).first())) return notFound('العقد');
    const kind = url.searchParams.get('kind') || '';
    if (!FILE_KINDS.includes(kind)) return bad('نوع المستند غير صالح');
    let name = (url.searchParams.get('name') || 'مستند').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 120);
    if (!name) name = 'مستند';
    const len = Number(request.headers.get('content-length') || 0);
    if (len > MAX_FILE + 1024) return bad(`حجم الملف أكبر من ${MAX_FILE / 1024 / 1024} ميغابايت`, 413);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length) return bad('الملف فارغ');
    if (bytes.length > MAX_FILE) return bad(`حجم الملف أكبر من ${MAX_FILE / 1024 / 1024} ميغابايت`, 413);
    const mime = sniffMime(bytes);
    if (!mime) return bad('نوع الملف غير مدعوم — ارفع PDF أو صورة PNG/JPG أو ملف Word');
    const n = await db.prepare('SELECT COUNT(*) AS n FROM contract_files WHERE contract_id = ?').bind(cid).first('n');
    if (n >= MAX_PER_CONTRACT) return bad(`الحدّ الأقصى ${MAX_PER_CONTRACT} مستنداً لكل عقد`);
    const res = await db.prepare('INSERT INTO contract_files (contract_id, kind, name, mime, size, storage, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(cid, kind, name, mime, bytes.length, env.DOCS ? 'r2' : 'd1', user.email).run();
    const id = res.meta.last_row_id;
    try { await store(env, db, id, bytes); } catch (e) {
      await db.prepare('DELETE FROM contract_files WHERE id = ?').bind(id).run();
      await db.prepare('DELETE FROM contract_file_chunks WHERE file_id = ?').bind(id).run();
      console.error('contract file store failed', e);
      return bad('تعذّر حفظ الملف، أعد المحاولة', 500);
    }
    await auditStmt(db, user, 'contract.file.add', 'contract', cid, { kind, size: bytes.length }).run();
    return json({ ok: true, id }, 201);
  });

  add('GET', '/api/contracts/files/:fid', async ({ env, db, user, params, url }) => {
    if (!gate(user)) return forbidden();
    const f = await db.prepare('SELECT id, contract_id, name, mime, size, storage FROM contract_files WHERE id = ?').bind(Number(params.fid)).first();
    if (!f) return notFound('المستند');
    const bytes = await load(env, db, f);
    if (!bytes) return notFound('محتوى المستند');
    const inline = url.searchParams.get('inline') === '1' && (f.mime === 'application/pdf' || f.mime.startsWith('image/'));
    const ext = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'application/msword': 'doc' }[f.mime] || 'docx';
    const fname = f.name.toLowerCase().endsWith(`.${ext}`) ? f.name : `${f.name}.${ext}`;
    return new Response(bytes, { headers: {
      'content-type': f.mime, 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fname)}`,
      'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff'
    } });
  });

  add('DELETE', '/api/contracts/files/:fid', async ({ env, db, user, params }) => {
    if (!gate(user)) return forbidden();
    const f = await db.prepare('SELECT id, contract_id, kind, storage FROM contract_files WHERE id = ?').bind(Number(params.fid)).first();
    if (!f) return notFound('المستند');
    await db.batch([
      db.prepare('DELETE FROM contract_file_chunks WHERE file_id = ?').bind(f.id),
      db.prepare('DELETE FROM contract_files WHERE id = ?').bind(f.id),
      auditStmt(db, user, 'contract.file.delete', 'contract', f.contract_id, { kind: f.kind }),
    ]);
    if (f.storage === 'r2') await env.DOCS?.delete(`contract-files/${f.id}`);
    return json({ ok: true });
  });
}
