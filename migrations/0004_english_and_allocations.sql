-- الأسماء والمسميات بالإنجليزية (كما في «قائمة الموظفين» بملف الإدارة 2026) لأن التايم شيت ملف للممولين بالإنجليزية،
-- وتوزيع كل موظف على المشاريع/الممولين بنسب وفترات (ورقة «توزيع المشاريع»).
ALTER TABLE employees ADD COLUMN name_en TEXT;
ALTER TABLE employees ADD COLUMN job_title_en TEXT;
ALTER TABLE employees ADD COLUMN department_en TEXT;
ALTER TABLE employees ADD COLUMN manager_label_en TEXT;
ALTER TABLE centers ADD COLUMN name_en TEXT;

-- share: نسبة التحميل كجزء من 1 (0.5 = 50%). كل فترة لها بداية ونهاية شاملتان.
-- القاعدة (تُفرض في الـ API): في أي يوم يكون مجموع النسب النافذة = 1، وبحد أقصى 3 ممولين متزامنين.
CREATE TABLE employee_projects (
  id          INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  funder      TEXT NOT NULL,
  share       REAL NOT NULL CHECK (share > 0 AND share <= 1),
  from_date   TEXT NOT NULL,
  to_date     TEXT NOT NULL CHECK (to_date >= from_date)
);
CREATE INDEX employee_projects_emp ON employee_projects(employee_id, from_date);
