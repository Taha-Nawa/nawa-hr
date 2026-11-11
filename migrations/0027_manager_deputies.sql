-- نائب المدير المعتمد (قرار 2026-11-11): تعيّنه الموارد البشرية بتاريخ من/إلى فيعتمد طلبات وخطط فريق المدير خلال المدة فقط.
CREATE TABLE manager_deputies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  manager_id INTEGER NOT NULL REFERENCES employees(id),
  deputy_id  INTEGER NOT NULL REFERENCES employees(id),
  from_date  TEXT NOT NULL,
  to_date    TEXT NOT NULL,
  note       TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (manager_id <> deputy_id AND to_date >= from_date)
);
CREATE INDEX manager_deputies_deputy ON manager_deputies(deputy_id, from_date);
CREATE INDEX manager_deputies_manager ON manager_deputies(manager_id, from_date);
