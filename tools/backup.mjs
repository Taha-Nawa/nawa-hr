#!/usr/bin/env node
// نسخة احتياطية دورية لبيانات الحضور خارج Cloudflare. Node 18+ بلا حزم.
//
//   BACKUP_TOKEN=... node tools/backup.mjs            ← ينزّل نسخة كاملة إلى ./backups (gzip)
//   node tools/backup.mjs sql backups/ملف.json.gz     ← يحوّل نسخة إلى ملف SQL للاسترجاع (stdout)
//
// المتغيرات: BACKUP_TOKEN (إلزامي، نفس السرّ المضبوط في Cloudflare)، BACKUP_URL (افتراضي: العنوان الحي)،
//            BACKUP_DIR (افتراضي ./backups)، BACKUP_KEEP (عدد النسخ المحفوظة، افتراضي 30).
// الجدولة: Task Scheduler على ويندوز أو cron أسبوعياً (انظر docs/BACKUP.md). النسخة فيها بيانات شخصية: خزّنها في مكان مقيَّد.
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';
import { pullAll, toSqlFile } from '../public/js/backup-lib.js';

const BASE = (process.env.BACKUP_URL || 'https://nawa-hr.nawa-attendance.workers.dev').replace(/\/+$/, '');
const DIR = process.env.BACKUP_DIR || 'backups';
const KEEP = Number(process.env.BACKUP_KEEP || 30);

const readBackup = (file) => {
  const buf = readFileSync(file);
  return JSON.parse((buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8'));
};

async function main() {
  if (process.argv[2] === 'sql') {
    if (!process.argv[3]) throw new Error('usage: node tools/backup.mjs sql <backup.json.gz>');
    process.stdout.write(toSqlFile(readBackup(process.argv[3])));
    return;
  }
  const token = process.env.BACKUP_TOKEN;
  if (!token) throw new Error('BACKUP_TOKEN غير مضبوط');
  const headers = { authorization: `Bearer ${token}`, origin: BASE };
  const request = async (p, body) => {
    const res = await fetch(BASE + p, body === undefined ? { headers } : { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.ok === false) throw new Error(`${p}: ${data?.error || res.status}`);
    return data;
  };
  const backup = await pullAll(request, { onProgress: ({ table, done, total }) => process.stderr.write(`\r${table}: ${done}/${total}        `) });
  process.stderr.write('\n');
  mkdirSync(DIR, { recursive: true });
  const stamp = backup.exportedAt.replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(DIR, `nawa-hr-backup-${stamp}.json.gz`);
  writeFileSync(file, gzipSync(JSON.stringify(backup)));
  await request('/api/backup/done', { rows: backup.rows, tables: Object.keys(backup.tables).length });
  // احتفظ بأحدث KEEP نسخة فقط
  const old = readdirSync(DIR).filter((f) => /^nawa-hr-backup-.*\.json\.gz$/.test(f)).sort().reverse().slice(KEEP);
  for (const f of old) unlinkSync(path.join(DIR, f));
  console.log(`تمت النسخة: ${file} (${backup.rows} سجلاً من ${Object.keys(backup.tables).length} جدولاً)${old.length ? `، حُذفت ${old.length} نسخة قديمة` : ''}`);
}

main().catch((e) => { console.error(`فشل: ${e.message}`); process.exit(1); });
