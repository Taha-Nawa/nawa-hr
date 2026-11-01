import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodText, reportFilename } from '../public/js/report-print.js';

test('عنوان الفترة واسم ملف PDF بصيغة نموذج الجمعية (شهر يناير 2023 · التقرير الشهري - الاسم - 01-2023)', () => {
  assert.equal(periodText('2023-01'), 'شهر يناير 2023');
  assert.equal(periodText('2026-12'), 'شهر ديسمبر 2026');
  assert.equal(reportFilename('طه أبو نمر', '2023-01'), 'التقرير الشهري - طه أبو نمر - 01-2023');
});
