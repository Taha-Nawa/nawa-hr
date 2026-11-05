-- تسجيل المتطوعين بالمسح على البوابة (مثل مزوّدي الخدمة): بطاقة QR سرّية لكل متطوع، وحركاتها تملأ volunteer_days تلقائياً.
-- التصحيح اليدوي من الموارد البشرية له الأولوية (يُحمى بـ updated_by) ولا يُطمَس بمسح لاحق.
CREATE TABLE volunteer_badges (
  card         TEXT PRIMARY KEY,
  volunteer_id INTEGER NOT NULL REFERENCES volunteers(id),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX volunteer_badges_volunteer ON volunteer_badges(volunteer_id);

CREATE TABLE volunteer_movements (
  id           TEXT PRIMARY KEY,
  volunteer_id INTEGER NOT NULL REFERENCES volunteers(id),
  card         TEXT,
  type         TEXT NOT NULL CHECK (type IN ('حضور', 'خروج', 'عودة', 'انصراف')),
  date         TEXT NOT NULL,
  time         TEXT NOT NULL,
  iso          TEXT,
  device_id    TEXT,
  offline      INTEGER NOT NULL DEFAULT 0,
  note         TEXT,
  lat          REAL,
  lng          REAL,
  acc          REAL,
  received_at  TEXT NOT NULL DEFAULT (datetime('now'))
) WITHOUT ROWID;
CREATE INDEX volunteer_movements_day ON volunteer_movements(volunteer_id, date);

ALTER TABLE provider_movements ADD COLUMN lat REAL;
ALTER TABLE provider_movements ADD COLUMN lng REAL;
ALTER TABLE provider_movements ADD COLUMN acc REAL;
