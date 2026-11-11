-- إجازة الوضع وساعة الأمومة (قرار 2026-11-11). للموظفات فقط.
--  * إجازة الوضع: leave_days يوماً تقويمياً (افتراضي 70) من delivery_date، وتُكتب أيامها في day_overrides بنوع «إجازة وضع».
--  * ساعة الأمومة: بعد العودة (delivery_date + leave_days) ولمدة سنة تقويمية، يُقصَّر دوام الموظفة ساعة في أوله أو آخره (hour_pos).
ALTER TABLE employees ADD COLUMN gender TEXT CHECK (gender IN ('F', 'M'));

CREATE TABLE maternity (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   INTEGER NOT NULL REFERENCES employees(id),
  delivery_date TEXT NOT NULL,
  leave_days    INTEGER NOT NULL DEFAULT 70 CHECK (leave_days BETWEEN 1 AND 365),
  hour_pos      TEXT CHECK (hour_pos IN ('start', 'end')),
  note          TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX maternity_employee ON maternity(employee_id);

-- تذكير الموارد البشرية (9 صباحاً) بانتهاء إجازة الوضع: مرة لكل (سجل، مستلم، مرحلة)
CREATE TABLE maternity_reminders (
  maternity_id INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  stage        TEXT NOT NULL CHECK (stage IN ('week', 'day')),
  sent_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (maternity_id, user_id, stage)
) WITHOUT ROWID;
