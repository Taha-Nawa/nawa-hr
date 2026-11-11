-- مشاركة السجل اليومي مع المسؤولين في سلسلة الإدارة (قرار 2026-11-11).
-- shared: يظهر السطر لمن فوق صاحبه في الشجرة الإدارية. الأسطر القديمة تبقى خاصة (DEFAULT 0)؛ الأسطر الجديدة تُنشأ مشاركة افتراضياً من التطبيق ويلغيها الموظف.
ALTER TABLE work_log ADD COLUMN shared INTEGER NOT NULL DEFAULT 0;

-- ملاحظات المسؤول على سطر: open ← (الموظف يعدّل أو يردّ) addressed ← (المسؤول يعتمد) closed
CREATE TABLE work_log_notes (
  id           INTEGER PRIMARY KEY,
  log_id       INTEGER NOT NULL REFERENCES work_log(id),
  author_id    INTEGER NOT NULL REFERENCES employees(id),
  note         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'addressed', 'closed')),
  reply        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  addressed_at TEXT,
  closed_at    TEXT
);
CREATE INDEX work_log_notes_log ON work_log_notes(log_id);
