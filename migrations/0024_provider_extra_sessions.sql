-- حصص استثنائية لمزوّد الخدمة بتاريخ محدد (لا تغيّر جدوله الدائم).
--  source = 'planned'  : أضافتها الموارد البشرية مسبقاً ليوم بعينه فتخضع للتأخر والغياب كأي حصة.
--  source = 'approved' : اعتماد لاحق لحضور «خارج الجدول»؛ تُنشأ من وصوله وانصرافه الفعليين فتُحتسب ساعاته.
CREATE TABLE provider_extra_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  date        TEXT NOT NULL,
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('planned', 'approved')),
  note        TEXT NOT NULL,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX provider_extra_sessions_day ON provider_extra_sessions(provider_id, date);
