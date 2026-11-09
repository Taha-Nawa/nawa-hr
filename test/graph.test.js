import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTerm, searchUrl } from '../public/js/graph.js';

test('بحث دليل Microsoft: تنظيف النص يمنع كسر الاستعلام', () => {
  assert.equal(cleanTerm('  sal"em*  (x) '), 'sal em x');
  assert.equal(cleanTerm('a'.repeat(100)).length, 40);
  const u = new URL(searchUrl('salem'));
  assert.equal(u.hostname, 'graph.microsoft.com');
  assert.equal(u.searchParams.get('$search'), '"displayName:salem" OR "mail:salem"');
  assert.equal(u.searchParams.get('$top'), '8');
  assert.ok(!searchUrl('a"b').includes('a"b'));
});
