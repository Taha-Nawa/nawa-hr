import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// كل ملفات الواجهة (وحدات ES) وصفحة البوابة وعامل الخدمة يجب أن تُحلَّل نحوياً: خطأ قوس واحد في صفحة نادرة الفتح
// (مثل «التحليلات») لا يظهر إلا للمستخدم حين يفتحها، ولا تلتقطه اختبارات الخادم.
const root = path.join(import.meta.dirname, '..', 'public');
function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const f = path.join(dir, n);
    return statSync(f).isDirectory() ? walk(f) : f.endsWith('.js') ? [f] : [];
  });
}

test('كل ملفات public/**/*.js سليمة نحوياً', () => {
  const bad = [];
  for (const f of walk(root)) {
    const r = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: readFileSync(f), encoding: 'utf8' });
    if (r.status !== 0) bad.push(`${path.relative(root, f)}: ${(r.stderr || '').split('\n').find((l) => /Error/.test(l)) || 'خطأ'}`);
  }
  assert.deepEqual(bad, []);
});
