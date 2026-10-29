/**
 * بديل محلي لقاعدة D1 فوق node:sqlite، يطابق واجهة D1 التي يستعملها الكود
 * (prepare/bind/first/all/run/batch) ويفرض قيود D1 المجانية التي تهمّنا كي تكشفها الاختبارات:
 *   - 100 متغيّر مربوط كحدّ أقصى للاستعلام الواحد
 *   - 50 استعلاماً كحدّ أقصى لكل «طلب» (يُصفَّر بـ resetCount() عند بداية كل طلب في الاختبار)
 *   - حجم نص الاستعلام ≤ 100 كيلوبايت
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(here, '..', '..', 'migrations');

export const LIMITS = { boundParams: 100, queriesPerRequest: 50, sqlBytes: 100 * 1024 };

export function createD1({ migrate = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const state = { queries: 0, maxQueries: 0, enforce: true };

  function count(n = 1) {
    state.queries += n;
    state.maxQueries = Math.max(state.maxQueries, state.queries);
    if (state.enforce && state.queries > LIMITS.queriesPerRequest) {
      throw new Error(`D1 limit: more than ${LIMITS.queriesPerRequest} queries in one request`);
    }
  }

  function execOne(sql, params) {
    if (Buffer.byteLength(sql) > LIMITS.sqlBytes) throw new Error('D1 limit: SQL statement too large');
    if (params.length > LIMITS.boundParams) throw new Error(`D1 limit: ${params.length} bound parameters (max ${LIMITS.boundParams})`);
    const stmt = db.prepare(sql);
    const returnsRows = stmt.columns().length > 0;
    if (returnsRows) {
      const results = stmt.all(...params).map((r) => ({ ...r })); // كائنات عادية كما تُرجعها D1
      return { success: true, results, meta: { changes: 0, rows_read: results.length } };
    }
    const r = stmt.run(...params);
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }

  function makeStmt(sql, params) {
    return {
      sql,
      params,
      bind: (...p) => makeStmt(sql, p),
      async first(col) {
        count();
        const r = execOne(sql, params);
        const row = r.results[0] ?? null;
        return col && row ? row[col] : row;
      },
      async all() {
        count();
        return execOne(sql, params);
      },
      async run() {
        count();
        return execOne(sql, params);
      },
      async raw() {
        count();
        return execOne(sql, params).results.map((r) => Object.values(r));
      },
    };
  }

  const d1 = {
    prepare: (sql) => makeStmt(sql, []),
    async batch(stmts) {
      count(stmts.length);
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => execOne(s.sql, s.params));
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async exec(sql) {
      db.exec(sql);
    },
    // أدوات الاختبار
    resetCount() {
      state.queries = 0;
    },
    get queries() {
      return state.queries;
    },
    get maxQueries() {
      return state.maxQueries;
    },
    raw: db,
  };

  if (migrate) {
    for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
      db.exec(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
    }
  }
  return d1;
}
