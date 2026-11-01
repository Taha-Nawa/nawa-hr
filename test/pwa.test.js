// يضمن أن ملفات التطبيق القابل للتثبيت (النظام الرئيسي + بوابة الحضور) سليمة ومتوافقة مع سياسة CSP الصارمة،
// دون الحاجة لمتصفح: لا style/script مضمّنين، وكل ملف في قائمة التخزين موجود، والـ manifest صالح.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PUB = new URL('../public/', import.meta.url).pathname;
const read = (p) => readFileSync(join(PUB, p), 'utf8');
const exists = (p) => existsSync(join(PUB, p)) && statSync(join(PUB, p)).size > 0;

for (const [name, htmlPath] of [['النظام الرئيسي', 'index.html'], ['بوابة الحضور', 'gate/index.html']]) {
  test(`${name}: صفحة HTML بلا style/script/onclick مضمّنة (تعمل تحت CSP بلا unsafe-inline)`, () => {
    const html = read(htmlPath);
    assert.doesNotMatch(html, /<style[\s>]/i);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'سكربت مضمّن');
    assert.doesNotMatch(html.replace(/<noscript>[\s\S]*?<\/noscript>/g, ''), /\sstyle=/i, 'سمة style مضمّنة');
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'معالج حدث مضمّن');
    assert.match(html, /<link rel="manifest"/);
    assert.match(html, /viewport-fit=cover/);
    assert.match(html, /apple-touch-icon/);
    assert.match(html, /name="theme-color"/);
  });
}

for (const [name, manifestPath, scope] of [['النظام الرئيسي', 'manifest.webmanifest', '/'], ['بوابة الحضور', 'gate/manifest.webmanifest', '/gate/']]) {
  test(`${name}: manifest صالح للتثبيت وأيقوناته موجودة`, () => {
    const m = JSON.parse(read(manifestPath));
    assert.equal(m.scope, scope);
    assert.ok(m.start_url.startsWith(scope));
    assert.equal(m.display, 'standalone');
    assert.equal(m.dir, 'rtl');
    assert.equal(m.lang, 'ar');
    assert.ok(m.name && m.short_name && m.short_name.length <= 14, 'short_name قصير كي لا يُقتطع تحت الأيقونة');
    const purposes = m.icons.map((i) => `${i.sizes}:${i.purpose}`).sort();
    assert.deepEqual(purposes, ['192x192:any', '512x512:any', '512x512:maskable']);
    for (const i of m.icons) {
      const rel = (scope === '/' ? '' : 'gate/') + i.src.replace(/^\/(?:gate\/)?/, '');
      assert.ok(exists(rel), `أيقونة مفقودة: ${rel}`);
    }
  });
}

test('بوابة الحضور: كل ملف في قائمة التخزين الأولي لـ service worker موجود فعلاً', () => {
  const sw = read('gate/sw.js');
  const list = sw.match(/const SHELL = \[([\s\S]*?)\];/)[1];
  const files = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(files.length > 5);
  for (const f of files) assert.ok(f === './' || exists(`gate/${f}`), `مفقود: gate/${f}`);
  assert.ok(!files.includes('index.html'), "الصفحة تُخزَّن تحت './' لأن /gate/index.html يُعاد توجيهه ولا تصلح الاستجابة المُعاد توجيهها لطلبات التنقّل");
});

test('النظام الرئيسي: كل ملف في قائمة التخزين الأولي لـ service worker موجود فعلاً، ولا يمسّ /api', () => {
  const sw = read('sw.js');
  const list = sw.match(/const SHELL = \[([\s\S]*?)\];/)[1];
  for (const f of [...list.matchAll(/'([^']+)'/g)].map((m) => m[1])) assert.ok(f === '/' || exists(f.slice(1)), `مفقود: ${f}`);
  assert.match(sw, /startsWith\('\/api\/'\)/);
  assert.match(sw, /startsWith\('\/gate\/'\)/);
});

test('الترويسات: سياسة صارمة عامة، وسياسة البوابة وحدها تسمح بالكاميرا وGoogle', () => {
  const headers = read('_headers');
  const blocks = headers.split(/\n(?=\/)/).map((b) => b.trim());
  const global = blocks.find((b) => b.startsWith('/*\n'));
  const gate = blocks.find((b) => b.startsWith('/gate/*'));
  assert.ok(global && gate);
  assert.match(global, /camera=\(\)/);
  assert.doesNotMatch(global, /script\.google\.com/);
  assert.match(global, /script-src 'self'/);
  assert.doesNotMatch(global, /unsafe-inline/);
  assert.match(gate, /! Content-Security-Policy/);
  assert.match(gate, /! Permissions-Policy/);
  assert.match(gate, /camera=\(self\)/);
  assert.match(gate, /connect-src 'self' https:\/\/script\.google\.com https:\/\/script\.googleusercontent\.com/);
  assert.doesNotMatch(gate, /unsafe-inline|unsafe-eval/);
  for (const sw of ['/sw.js', '/gate/sw.js']) assert.match(headers, new RegExp(`${sw.replace('/', '\\/')}\\n\\s+Cache-Control: no-cache`), `${sw} لا يُخزَّن`);
});

test('بوابة الحضور: التاريخ ميلادي بأسماء الأشهر المعتمدة (يناير…ديسمبر)', () => {
  const js = read('gate/gate.js');
  const months = js.match(/var MONTHS=\[([^\]]+)\]/)[1];
  assert.equal(months.split(',').length, 12);
  assert.match(months, /"يناير"/);
  assert.match(months, /"فبراير"/);
  assert.match(months, /"ديسمبر"/);
  assert.doesNotMatch(months, /كانون|تشرين|شباط|آذار/);
});

test('بوابة الحضور: نتيجة التسجيل إشعار علوي يختفي وحده، وسجل اليوم قابل للتمرير بكل حركات اليوم', () => {
  const css = read('gate/gate.css');
  const js = read('gate/gate.js');
  const html = read('gate/index.html');
  // الإشعار: ثابت أعلى الصفحة فوق المحتوى، ولا يشغل مساحة وهو فارغ
  assert.match(css, /\.res\{[^}]*position:fixed/);
  assert.match(css, /\.res:not\(\.ok\):not\(\.bad\)\{display:none/);
  assert.match(js, /resTimer=setTimeout\(hideRes/);
  // السجل: يُعاد بناؤه من حركات اليوم كاملة، ولا يُقصّ إلى آخر 5 حركات
  assert.match(js, /function rebuildFeed\(/);
  assert.doesNotMatch(js, /log\.slice\(0,\s*5\)/);
  assert.match(css, /#feed\{[^}]*overflow-y:auto/);
  assert.match(html, /id="feed"/);
  assert.match(html, /id="cnt"/);
});
