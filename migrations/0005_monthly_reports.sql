-- التقرير الشهري للموظف (مهام الشهر، الاجتماعات، المرفقات، خطة الشهر القادم) — يُصدَّر PDF بتنسيق نموذج الجمعية.
-- كل (موظف، شهر) صف واحد، والمحتوى JSON صغير (عشرات الصفوف) فيُقرأ ويُكتب باستعلام واحد (قيد 50 استعلاماً للطلب).
-- updated_at = رمز تزامن تفاؤلي: الكتابة تُرفض إن تغيّر الصف منذ آخر قراءة (تعديل من جهاز آخر).
CREATE TABLE monthly_reports (
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  month       TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  data        TEXT NOT NULL,
  submit_date TEXT,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (employee_id, month)
) WITHOUT ROWID;
