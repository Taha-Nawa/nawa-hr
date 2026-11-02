-- السجل اليومي «ماذا أنجزت اليوم» (قرار 2 نوفمبر 2026): سطر سريع لكل إنجاز أو اجتماع أو تدريب/نشاط خارجي أو مهمة قادمة.
-- خاص بصاحبه (لا يقرؤه أحد غيره)؛ في آخر الشهر يستورده التقرير الشهري: done ← المهام الرئيسية، meeting/training ← الاجتماعات
-- والنشاطات الخارجية، todo ← المهام اللاحقة. لا يغيّر شكل التقرير المطبوع.
CREATE TABLE work_log (
  id          INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  date        TEXT NOT NULL,                 -- يوم الإنجاز/الاجتماع، أو تاريخ البدء لمهمة قادمة (YYYY-MM-DD)
  kind        TEXT NOT NULL CHECK (kind IN ('done', 'meeting', 'training', 'todo')),
  title       TEXT NOT NULL,
  status      TEXT,                          -- done: الحالة (تم الإنجاز…)
  details     TEXT,                          -- done: تحديات/ملاحظة، meeting/training: ملخص
  place       TEXT,                          -- meeting/training
  importance  TEXT,                          -- todo
  end_date    TEXT,                          -- todo: الانتهاء المتوقع
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX work_log_employee_date ON work_log(employee_id, date);
