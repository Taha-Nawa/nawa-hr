-- رسائل البوب (قرار 2026-11-11): تكتبها الموارد البشرية أو المسؤول لتظهر للموظفين المستهدفين في فقاعة عند فتح النظام، ولمدة محددة كالستوري.
CREATE TABLE announcements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT,
  body         TEXT NOT NULL,
  starts_at    TEXT NOT NULL,                      -- ISO UTC
  ends_at      TEXT NOT NULL,                      -- ISO UTC
  audience     TEXT NOT NULL CHECK (audience IN ('all', 'center', 'employees')),
  audience_ids TEXT NOT NULL DEFAULT '[]',         -- مصفوفة JSON: أرقام المراكز أو الموظفين
  revoked      INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT,
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
