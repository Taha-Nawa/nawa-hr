// منطق النسخة الاحتياطية المشترك بين صفحة «النسخ الاحتياطي» وtools/backup.mjs والاختبارات (نقي: بلا DOM ولا Node-only).
// request(path) ← يُرجع JSON الاستجابة (ويرمي عند الخطأ).

/** يسحب كل الجداول على دفعات ويُرجع كائن النسخة. onProgress({table, done, total}) اختياري. */
export async function pullAll(request, { pageSize = 1000, onProgress } = {}) {
  const manifest = await request('/api/backup/manifest');
  const out = { app: manifest.app, version: 1, exportedAt: manifest.generatedAt, tables: {} };
  let rows = 0;
  for (const t of manifest.tables) {
    let offset = 0;
    let columns = null;
    const all = [];
    for (;;) {
      const page = await request(`/api/backup/table?name=${encodeURIComponent(t.name)}&offset=${offset}&limit=${pageSize}`);
      columns ||= page.columns;
      all.push(...page.rows);
      offset += page.rows.length;
      onProgress?.({ table: t.name, done: offset, total: t.rows });
      if (page.done || !page.rows.length) break;
    }
    out.tables[t.name] = { columns, rows: all };
    rows += all.length;
  }
  out.rows = rows;
  return out;
}

const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
};

/**
 * كائن النسخة ← عبارات SQL للاسترجاع (INSERT OR REPLACE). بصمة رمز الجهاز غير مُصدَّرة فتُوضع قيمة لا تطابق أي رمز،
 * ويُعاد إصدار رموز الأجهزة بعد الاسترجاع.
 */
export function toSqlStatements(backup, { batch = 50 } = {}) {
  const stmts = [];
  for (const [name, t] of Object.entries(backup.tables)) {
    const cols = name === 'devices' ? [...t.columns, 'token_hash'] : t.columns;
    for (let i = 0; i < t.rows.length; i += batch) {
      const values = t.rows.slice(i, i + batch).map((r) => {
        const row = name === 'devices' ? [...r, `restored:${r[t.columns.indexOf('id')]}`] : r;
        return `(${row.map(lit).join(', ')})`;
      });
      stmts.push(`INSERT OR REPLACE INTO "${name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES\n${values.join(',\n')};`);
    }
  }
  return stmts;
}

export const toSqlFile = (backup) => `-- نسخة احتياطية ${backup.exportedAt}: wrangler d1 execute nawa-hr --remote --file <هذا الملف>\nPRAGMA defer_foreign_keys = true;\n${toSqlStatements(backup).join('\n')}\n`;
