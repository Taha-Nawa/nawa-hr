-- نظام إدارة الحضور والطلبات (نوى) — المخطط الأساسي (المرحلة 1)
-- يعمل على Cloudflare D1 (SQLite). لا بيانات حقيقية هنا: المخطط فقط.
--
-- قواعد التصميم:
--  * الجداول التي تُكتب بكثرة (movements, daily_results) بلا rowid ومعها أقل عدد من الفهارس، لأن D1 يحسب كل فهرس صفاً مكتوباً.
--  * لا استعلام يمسح الحركات الخام للتقارير: التقارير تقرأ daily_results.
--  * التواريخ نصوص YYYY-MM-DD والأوقات HH:MM بتوقيت الجهاز كما تُرسلها البوابة.

CREATE TABLE centers (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE employees (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,                 -- NW-001
  name       TEXT NOT NULL,
  email      TEXT COLLATE NOCASE UNIQUE,           -- حساب nawaculture.org للدخول الموحّد (قد يكون فارغاً)
  center_id  INTEGER REFERENCES centers(id),
  manager_id INTEGER REFERENCES employees(id),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  photo_url  TEXT,
  start_date TEXT,
  end_date   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- محتوى البطاقة (QR) -> موظف. الإلغاء بتغيير الحالة لا بالحذف حتى يبقى الأثر.
CREATE TABLE badges (
  card        TEXT PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX badges_employee ON badges(employee_id);

-- أجهزة البوابة. الرمز لا يُخزَّن: نخزّن بصمته (SHA-256) فقط.
CREATE TABLE devices (
  id         TEXT PRIMARY KEY,                     -- DEV-01
  name       TEXT,
  center_id  INTEGER REFERENCES centers(id),
  token_hash TEXT NOT NULL UNIQUE,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_seen  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- الحركات الخام كما وردت من البوابة. المفتاح = معرّف الحركة الذي تولّده البوابة (يمنع التكرار).
-- employee_id قد يكون NULL إن وردت بطاقة غير معروفة: نحفظها ولا نرفضها كي لا تضيع، وتظهر في لوحة «حركات غير مطابقة».
CREATE TABLE movements (
  id          TEXT PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  card        TEXT,
  code        TEXT,
  name        TEXT,
  center      TEXT,
  type        TEXT NOT NULL CHECK (type IN ('حضور', 'خروج', 'عودة', 'انصراف')),
  date        TEXT NOT NULL,
  time        TEXT NOT NULL,
  iso         TEXT,
  device_id   TEXT,
  offline     INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
) WITHOUT ROWID;
CREATE INDEX movements_emp_date ON movements(employee_id, date);

-- تصحيحات يدوية (لها الأولوية على الحركات) + نوع إجازة معتمدة لليوم. كل تغيير يُسجَّل في audit_log.
CREATE TABLE day_overrides (
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  date        TEXT NOT NULL,
  in_time     TEXT,
  out_time    TEXT,
  ret_time    TEXT,
  dep_time    TEXT,
  leave_type  TEXT,
  reason      TEXT,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (employee_id, date)
) WITHOUT ROWID;

-- نتيجة كل يوم-موظف، يحسبها المحرك (src/engine/attendance.js) عند كل حركة أو تصحيح.
CREATE TABLE daily_results (
  employee_id        INTEGER NOT NULL REFERENCES employees(id),
  date               TEXT NOT NULL,
  day_type           TEXT NOT NULL,
  check_in           TEXT,
  exit_first         TEXT,
  return_last        TEXT,
  departure          TEXT,
  source             TEXT,
  presence_hours     REAL NOT NULL DEFAULT 0,
  exit_hours         REAL NOT NULL DEFAULT 0,
  net_hours          REAL NOT NULL DEFAULT 0,
  required_hours     REAL NOT NULL DEFAULT 0,
  approved_hours     REAL NOT NULL DEFAULT 0,
  late_minutes       REAL NOT NULL DEFAULT 0,
  early_leave_minutes REAL NOT NULL DEFAULT 0,
  deficit_hours      REAL NOT NULL DEFAULT 0,
  overtime_hours     REAL NOT NULL DEFAULT 0,
  status             TEXT NOT NULL,
  alert              TEXT NOT NULL DEFAULT '',
  computed_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (employee_id, date)
) WITHOUT ROWID;

CREATE TABLE holidays (
  date TEXT PRIMARY KEY,
  name TEXT
) WITHOUT ROWID;

-- إعدادات المنظومة (JSON). المفتاح 'work' = إعدادات المحرك: start, end, toleranceMinutes, weekdays[7], leaveTypes{}, monthlyExitCapHours.
-- لا قيم افتراضية في الكود: إن لم يوجد 'work' يرفض الخادم الحساب بدل أن يخمّن.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
) WITHOUT ROWID;

-- مستخدمو الواجهة (حسابات Microsoft). الدور يُمنح هنا وليس من الحساب نفسه.
CREATE TABLE users (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL COLLATE NOCASE UNIQUE,
  employee_id INTEGER REFERENCES employees(id),
  role        TEXT NOT NULL CHECK (role IN ('employee', 'manager', 'hr', 'director', 'admin')),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- جلسات الدخول: نخزّن بصمة الرمز لا الرمز نفسه.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) WITHOUT ROWID;

-- سجل التدقيق: من فعل ماذا ومتى. لا يُحذف منه شيء من الواجهة.
CREATE TABLE audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  actor     TEXT NOT NULL,
  action    TEXT NOT NULL,
  entity    TEXT,
  entity_id TEXT,
  detail    TEXT
);
