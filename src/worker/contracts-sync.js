/**
 * ربط العقود بمزوّدي الخدمة (قرار 23 نوفمبر 2026): كل رقم هوية في العقود = مزوّد واحد.
 *  - يُنشأ المزوّد تلقائياً، أو يُربط بمزوّد قائم يطابق الاسم تماماً أو بالاسم الأول والأخير (مثل SP-001 قبل الدمج) ولم يُربط بعد.
 *  - بداية العقد ونهايته والاسم والجوال والخدمة والمشروع من أحدث عقد؛ «منجز» أو «منتهٍ/مفسوخ» ⇒ المزوّد غير فعّال.
 *  - لا يُلمس: المركز والمشرف والجدول الأسبوعي والبطاقة والملاحظات (تُضبط في تبويب مزودو الخدمة).
 *  - رقم الهوية لا يُنسخ إلى جدول المزوّدين؛ الصلة contracts.provider_id.
 */
import { clip } from './util.js';
import { CLOSED_STATUSES } from '../engine/contracts.js';
import { nextProviderCode } from '../engine/providers.js';

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
/** تطابق الاسم: مطابق تماماً، أو الاسم الأول والأخير واحدان (يُسجَّل المزوّد قديماً باسم مختصر والعقد رباعي) */
const sameName = (a, b) => {
  const x = norm(a).split(' ');
  const y = norm(b).split(' ');
  return norm(a) === norm(b) || (x.length >= 2 && y.length >= 2 && x[0] === y[0] && x[x.length - 1] === y[y.length - 1]);
};

/** يزامن مزوّد هوية واحدة. يُرجع { providerId, created, linked } أو { skipped } مع السبب. */
export async function syncProviderFor(db, user, idno, auditStmt) {
  if (!idno) return { skipped: 'بلا رقم هوية' };
  const rows = (await db.prepare('SELECT id, name, phone, subject, service, project, d_from, d_to, status, provider_id FROM contracts WHERE idno = ? ORDER BY d_to DESC, seq DESC, id DESC').bind(idno).all()).results;
  if (!rows.length) return { skipped: 'لا عقود' };
  const latest = rows.find((r) => r.d_from && r.d_to && r.d_to >= r.d_from);
  if (!latest) return { skipped: 'بلا فترة تنفيذ صالحة' };
  let pid = rows.find((r) => r.provider_id)?.provider_id ?? null;
  const active = CLOSED_STATUSES.includes(latest.status) ? 0 : 1;
  const fields = [clip(latest.name, 120), clip(latest.phone, 40), clip(latest.subject || latest.service, 80), clip(latest.project, 120), latest.d_from, latest.d_to, active];
  let created = false;
  let linked = false;

  if (pid === null) {
    const target = norm(latest.name);
    const free = (await db.prepare('SELECT id, name FROM providers WHERE id NOT IN (SELECT provider_id FROM contracts WHERE provider_id IS NOT NULL)').all()).results;
    const same = free.filter((p) => sameName(p.name, target));
    if (same.length === 1) { pid = same[0].id; linked = true; }
  }
  if (pid === null) {
    const code = nextProviderCode((await db.prepare('SELECT code FROM providers').all()).results.map((x) => x.code));
    const res = await db.prepare('INSERT INTO providers (code, name, phone, service, project, contract_start, contract_end, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(code, ...fields).run().catch((e) => { console.error('provider insert failed', e); return null; });
    if (!res) return { skipped: 'تعذّر إنشاء المزوّد' };
    pid = res.meta.last_row_id;
    created = true;
    await auditStmt(db, user, 'provider.create', 'provider', code, { fromContracts: true }).run();
  } else {
    await db.prepare('UPDATE providers SET name = ?, phone = ?, service = ?, project = ?, contract_start = ?, contract_end = ?, active = ? WHERE id = ?').bind(...fields, pid).run();
    if (linked) await auditStmt(db, user, 'provider.link', 'provider', pid, { fromContracts: true }).run();
  }
  await db.prepare('UPDATE contracts SET provider_id = ? WHERE idno = ? AND (provider_id IS NULL OR provider_id <> ?)').bind(pid, idno, pid).run();
  return { providerId: pid, created, linked };
}
