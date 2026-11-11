-- رسائل البوب (قرار 2026-11-11): تكتبها الموارد البشرية أو المسؤول، أو مسؤول فريق لفريقه (audience = team)، لتظهر للمستهدفين في فانوس عند فتح النظام ولمدة محددة كالستوري.
CREATE TABLE announcements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT,
  body         TEXT NOT NULL,
  starts_at    TEXT NOT NULL,                      -- ISO UTC
  ends_at      TEXT NOT NULL,                      -- ISO UTC
  audience     TEXT NOT NULL CHECK (audience IN ('all', 'center', 'employees', 'team')),
  audience_ids TEXT NOT NULL DEFAULT '[]',         -- مصفوفة JSON: أرقام المراكز أو الموظفين (فارغة للكل والفريق)
  revoked      INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT,
  sender_id    INTEGER,                            -- موظف المرسِل (لرسائل الفريق وعنوان «رسالة من فلان»)
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (ends_at > starts_at)
);
CREATE INDEX announcements_window ON announcements(ends_at, revoked);
CREATE TABLE announcement_seen (
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL,
  seen_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (announcement_id, user_id)
);
