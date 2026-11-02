-- المتطوعون: سجل حضور شهري يُدخله المنسّق/الموارد البشرية ويُطبع بصيغة «كشف حضور وغياب» المعتمدة.
CREATE TABLE volunteers (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  center_id   INTEGER REFERENCES centers(id),
  project     TEXT,
  coordinator TEXT,            -- اسم المنسّق (يُطبع أسفل الكشف)
  phone       TEXT,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX volunteers_center ON volunteers(center_id);

CREATE TABLE volunteer_days (
  volunteer_id INTEGER NOT NULL REFERENCES volunteers(id),
  date         TEXT NOT NULL,
  arrive       TEXT,           -- ساعة الوصول HH:MM
  depart       TEXT,           -- ساعة الانصراف
  exit_at      TEXT,           -- ساعة المغادرة المؤقتة
  return_at    TEXT,           -- ساعة العودة
  reason       TEXT,           -- سبب المغادرة
  updated_by   TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (volunteer_id, date)
) WITHOUT ROWID;
