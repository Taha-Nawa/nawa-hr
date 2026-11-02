// الوقت بنظام 12 ساعة: التنسيق للعرض فقط، والتخزين والحساب يبقيان HH:MM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fmt12, fmtRange12, to24, from24, fmtStamp } from '../public/js/time12.js';
import { fmt12 as serverFmt12 } from '../src/worker/util.js';

test('fmt12: حالات الحدود (منتصف الليل، الظهر، قبل/بعد الظهر)', () => {
  assert.equal(fmt12('00:00'), '12:00 ص');
  assert.equal(fmt12('00:05'), '12:05 ص');
  assert.equal(fmt12('08:00'), '8:00 ص');
  assert.equal(fmt12('11:59'), '11:59 ص');
  assert.equal(fmt12('12:00'), '12:00 م');
  assert.equal(fmt12('12:30'), '12:30 م');
  assert.equal(fmt12('13:05'), '1:05 م');
  assert.equal(fmt12('15:00'), '3:00 م');
  assert.equal(fmt12('23:59'), '11:59 م');
});

test('fmt12: قيم فارغة أو غير صالحة', () => {
  assert.equal(fmt12(''), '');
  assert.equal(fmt12(null), '');
  assert.equal(fmt12(undefined), '');
  assert.equal(fmt12('24:00'), '24:00');
  assert.equal(fmt12('12:60'), '12:60');
  assert.equal(fmt12('abc'), 'abc');
  assert.equal(fmt12('8:05'), '8:05 ص');
  assert.equal(fmt12('08:05:30'), '8:05 ص');
});

test('النسخة في الخادم مطابقة للواجهة لكل دقيقة في اليوم', () => {
  for (let m = 0; m < 1440; m++) {
    const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    assert.equal(serverFmt12(t), fmt12(t), t);
  }
  assert.equal(serverFmt12(''), '');
  assert.equal(serverFmt12('xx'), 'xx');
});

test('to24 / from24 ذهاباً وإياباً لكل دقيقة', () => {
  for (let m = 0; m < 1440; m++) {
    const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const p = from24(t);
    assert.equal(to24(p.hour, p.minute, p.ap), t);
  }
  assert.equal(to24('12', '00', 'ص'), '00:00');
  assert.equal(to24('12', '00', 'م'), '12:00');
  assert.equal(to24('1', '05', 'م'), '13:05');
  assert.equal(to24('', '00', 'ص'), '');
  assert.equal(to24('3', '', 'م'), '');
  assert.equal(to24('3', '10', ''), '');
  assert.equal(to24('13', '10', 'م'), '');
  assert.equal(from24(''), null);
  assert.equal(from24('99:00'), null);
});

test('fmtRange12', () => {
  assert.equal(fmtRange12('08:00', '15:00'), '8:00 ص – 3:00 م');
});

test('fmtStamp: UTC من قاعدة البيانات يُعرض بتوقيت فلسطين بنظام 12 ساعة', () => {
  // نوفمبر: التوقيت الشتوي UTC+2
  assert.equal(fmtStamp('2026-11-02 12:23:00'), '2026-11-02 2:23 م');
  assert.equal(fmtStamp('2026-11-02T12:23:00Z'), '2026-11-02 2:23 م');
  assert.equal(fmtStamp('2026-11-02 22:30:00'), '2026-11-03 12:30 ص');
  // صيفاً UTC+3
  assert.equal(fmtStamp('2026-07-01 09:00:00'), '2026-07-01 12:00 م');
  assert.equal(fmtStamp(''), '');
  assert.equal(fmtStamp(null), '');
  assert.equal(fmtStamp('غير تاريخ'), 'غير تاريخ');
});
