-- إجازات خاصة تسجّلها الموارد البشرية (قرار 2026-11-11): حج، وفاة قريب من الدرجة الأولى، علاج طويل.
-- أيام تقويمية من from_date، تُكتب في day_overrides بنوع الإجازة وتظهر في صف Others، ولا تُخصم من أي رصيد.
CREATE TABLE special_leaves (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  kind        TEXT NOT NULL CHECK (kind IN ('hajj', 'bereavement', 'long_treatment')),
  from_date   TEXT NOT NULL,
  days        INTEGER NOT NULL CHECK (days BETWEEN 1 AND 365),
  relation    TEXT,
  note        TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX special_leaves_employee ON special_leaves(employee_id, from_date);
