import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presenceOf, presenceCounts } from '../public/js/presence-lib.js';

test('وضع الموظف الآن من حركات اليوم', () => {
  assert.equal(presenceOf({ status: 'حاضر', checkIn: '08:30', departure: null, lastType: 'حضور' }), 'in');
  assert.equal(presenceOf({ status: 'حاضر', checkIn: '08:30', departure: null, lastType: 'عودة' }), 'in');
  assert.equal(presenceOf({ status: 'حاضر', checkIn: '08:30', departure: null, lastType: 'خروج' }), 'out');
  assert.equal(presenceOf({ status: 'حاضر', checkIn: '08:30', departure: '15:00', lastType: 'انصراف' }), 'gone');
  assert.equal(presenceOf({ status: 'متأخر', checkIn: '09:00', departure: null, lastType: 'حضور' }), 'in');
  assert.equal(presenceOf({ status: null, checkIn: null }), 'wait');
  assert.equal(presenceOf({ status: 'غياب', checkIn: null }), 'wait');
  assert.equal(presenceOf({ status: 'إجازة سنوية', checkIn: null }), 'rest');
  assert.equal(presenceOf({ status: 'عطلة أسبوعية', checkIn: null }), 'rest');
});

test('عدّاد الأوضاع', () => {
  const c = presenceCounts([{ checkIn: '08:30', lastType: 'حضور' }, { checkIn: '08:30', lastType: 'خروج' }, { checkIn: '08:30', departure: '14:00' }, { status: null }]);
  assert.deepEqual(c, { in: 1, out: 1, gone: 1, wait: 1, rest: 0 });
});
