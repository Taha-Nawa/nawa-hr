-- الدوام الاستثنائي: موظف داوم في يوم عطلة (أسبوعية أو رسمية) بتكليف. صف لكل (موظف، يوم).
-- counted = 1: يُحسب اليوم يوم عمل لهذا الموظف (ساعاته المعتمدة تتوزّع على المشاريع في التايم شيت ويزول تظليله).
-- counted = 0: تسجيل فقط، فيبقى حسابه كما هو (الزائد إضافي ولا يظهر في صفوف المشاريع).
-- comp: التعويض المتفق عليه: none | paid (أجر إضافي) | leave (يوم إجازة بديل) — للتوثيق والمتابعة.
CREATE TABLE work_exceptions (
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  date TEXT NOT NULL,
  counted INTEGER NOT NULL DEFAULT 1 CHECK (counted IN (0, 1)),
  comp TEXT NOT NULL DEFAULT 'none' CHECK (comp IN ('none', 'paid', 'leave')),
  note TEXT,
  by_email TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (employee_id, date)
);
