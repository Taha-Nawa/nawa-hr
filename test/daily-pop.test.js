import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, KINDS, itemFor, dayNumber } from '../public/js/daily-pop-lib.js';

test('بوب اليوم: كل نص له نوع معروف ومصدر ولا تكرار، والاختيار ثابت في اليوم ويتغير في اليوم التالي', () => {
  assert.ok(ITEMS.length >= 40);
  for (const i of ITEMS) { assert.ok(KINDS[i.k], i.t); assert.ok(i.t.length > 8 && i.s, i.t); }
  assert.equal(new Set(ITEMS.map((i) => i.t)).size, ITEMS.length);
  assert.equal(itemFor('2026-11-11'), itemFor('2026-11-11'));
  assert.notEqual(itemFor('2026-11-11'), itemFor('2026-11-12'));
  assert.equal(dayNumber('2026-11-12') - dayNumber('2026-11-11'), 1);
  // دورة كاملة ثم يعود النص نفسه
  assert.equal(itemFor('2026-11-11'), itemFor(new Date(Date.UTC(2026, 10, 11) + ITEMS.length * 86400000).toISOString().slice(0, 10)));
});
