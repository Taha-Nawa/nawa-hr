import test from 'node:test';
import assert from 'node:assert/strict';
import { REST_MS, LOCK_MS, idleStage, idleItem } from '../public/js/idle-lib.js';
import { itemFor, ITEMS } from '../public/js/daily-pop-lib.js';
import { apiEnv, login, call } from './helpers/api.js';

test('مراحل الخمول: نشط قبل 5 دقائق، سكون حتى ساعة، ثم قفل', () => {
  assert.equal(REST_MS, 300_000);
  assert.equal(LOCK_MS, 5_400_000);
  assert.equal(idleStage(0), 'active');
  assert.equal(idleStage(REST_MS - 1), 'active');
  assert.equal(idleStage(REST_MS), 'rest');
  assert.equal(idleStage(LOCK_MS - 1), 'rest');
  assert.equal(idleStage(LOCK_MS), 'lock');
  assert.equal(idleStage(-5000), 'active'); // ساعة رجعت للوراء
  assert.equal(idleStage(NaN), 'active');
});

test('حكمة السكون تختلف دائماً عن حكمة الصباح وتتبدّل بالساعة', () => {
  const seen = new Set();
  for (let d = 1; d <= 60; d++) {
    const date = `2026-${d <= 30 ? '11' : '12'}-${String(((d - 1) % 30) + 1).padStart(2, '0')}`;
    for (let hr = 0; hr < 24; hr++) {
      const it = idleItem(date, hr);
      assert.ok(ITEMS.includes(it));
      assert.notEqual(it, itemFor(date));
      seen.add(it);
    }
  }
  assert.ok(seen.size > 10);
  assert.notEqual(idleItem('2026-11-11', 9), idleItem('2026-11-11', 10));
});

test('فتح القفل بالـ PIN: يتحقق لصاحب الجلسة فقط، ويعدّ المحاولات ويقفل بعد الإخفاق المتكرر', async () => {
  const { db, env } = await apiEnv();
  env.__NOW = '2026-11-11T08:00:00Z';
  const u = await login(db, 'a@nawaculture.org', 'employee', null);
  assert.equal((await call(env, 'POST', '/api/auth/unlock', { body: { pin: '482916' } })).status, 401); // بلا جلسة
  assert.equal((await call(env, 'POST', '/api/auth/unlock', { cookie: u.cookie, body: { pin: '482916' } })).status, 409); // بلا PIN
  const set = await call(env, 'POST', '/api/account/pin', { cookie: u.cookie, body: { pin: '482916' } });
  assert.equal(set.status, 200);
  assert.equal((await call(env, 'POST', '/api/auth/unlock', { cookie: u.cookie, body: { pin: '482916' } })).status, 200);
  assert.equal((await call(env, 'POST', '/api/auth/unlock', { cookie: u.cookie, body: { pin: '111112' } })).status, 401);
  assert.equal((await call(env, 'POST', '/api/auth/unlock', { cookie: u.cookie, body: { pin: 'abc' } })).status, 401);
  let last;
  for (let i = 0; i < 6; i++) last = await call(env, 'POST', '/api/auth/unlock', { cookie: u.cookie, body: { pin: '000001' } });
  assert.equal(last.status, 429);
  // أثناء القفل حتى الـ PIN الصحيح مرفوض
  assert.equal((await call(env, 'POST', '/api/auth/unlock', { cookie: u.cookie, body: { pin: '482916' } })).status, 429);
});
