-- «مقصود، تجاهل» لملاحظة في الهيكلية الإدارية: تقرّر الموارد البشرية أن حالة موظف مقصودة (مثلاً مدير لمرؤوس واحد)،
-- فتخرج من الملاحظات ومن درجة السلامة وتبقى في قائمة «تم تجاهلها» لتُعاد عند الحاجة. صف لكل (موظف، فحص).
CREATE TABLE org_dismissed (
  employee_id INTEGER NOT NULL,
  check_id TEXT NOT NULL,
  by_email TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (employee_id, check_id)
);
