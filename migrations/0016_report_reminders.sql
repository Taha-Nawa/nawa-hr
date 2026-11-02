-- تذكيرات التقرير الشهري بالبريد (قرار 2 نوفمبر 2026): سجل ما أُرسل لكل (مستخدم، شهر، مرحلة) كي لا يتكرر التذكير
-- مهما تكرر تشغيل المهمة المجدولة، ولكي يُكمَل الإرسال في اليوم التالي إن لم تتسع له الدفعة الواحدة.
-- جدول تشغيلي: لا يدخل النسخة الاحتياطية.
CREATE TABLE report_reminders (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month   TEXT NOT NULL,                        -- YYYY-MM: شهر التقرير
  stage   TEXT NOT NULL CHECK (stage IN ('eom', 'late', 'mgr')),
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, month, stage)
) WITHOUT ROWID;
