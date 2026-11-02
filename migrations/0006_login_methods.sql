-- طرق دخول إضافية إلى جانب Microsoft: تذكّر الجهاز، البريد + PIN، ورمز تحقق يُرسَل إلى البريد.
-- لا يُخزَّن أي PIN أو رمز كما هو: نخزّن HMAC-SHA256 بملح لكل صف ومفتاح سري (راجع src/worker/login.js).

-- كيف بدأت الجلسة: microsoft | code | pin | device. يحدد أي الجلسات «قوية» بما يكفي لتعيين PIN جديد.
ALTER TABLE sessions ADD COLUMN via TEXT NOT NULL DEFAULT 'microsoft';

-- أجهزة يتذكّرها المستخدم. الكوكي يحمل الرمز، والقاعدة تحمل بصمته فقط.
--   auto = 1  → يدخل التطبيق تلقائياً عند الفتح؛ 0 → يعرض «متابعة كـ…» (بعد تسجيل خروج صريح).
--   pin_required = 1 → لا يدخل إلا بإدخال PIN (فتح سريع).
CREATE TABLE trusted_devices (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  token_hash   TEXT NOT NULL UNIQUE,
  label        TEXT,
  auto         INTEGER NOT NULL DEFAULT 1 CHECK (auto IN (0, 1)),
  pin_required INTEGER NOT NULL DEFAULT 0 CHECK (pin_required IN (0, 1)),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL
);
CREATE INDEX trusted_devices_user ON trusted_devices(user_id);

-- PIN من 6 أرقام. failures/locked_until/strikes: قفل تصاعدي ضد التخمين.
CREATE TABLE user_pins (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id),
  salt         TEXT NOT NULL,
  pin_hash     TEXT NOT NULL,
  failures     INTEGER NOT NULL DEFAULT 0,
  strikes      INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- رموز البريد: صالحة 10 دقائق، تُستعمل مرة واحدة، وخمس محاولات تحقق كحد أقصى لكل رمز.
CREATE TABLE email_codes (
  id         INTEGER PRIMARY KEY,
  email      TEXT NOT NULL COLLATE NOCASE,
  salt       TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  used       INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX email_codes_email ON email_codes(email, id);
CREATE INDEX email_codes_created ON email_codes(created_at);

-- قيم داخلية للدخول (مثل مفتاح التشفير الاحتياطي إن لم يُضبط سرّ AUTH_SECRET). لا تُعرض عبر أي واجهة.
CREATE TABLE auth_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
