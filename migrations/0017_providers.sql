-- مزوّدو الخدمة (قرار 3 نوفمبر 2026): معلّمون ومدرّبون متعاقد معهم لمدة محدودة، بلا حساب nawaculture ولا بطاقة موظف.
--
--  - سجلّهم مستقل عن employees عمداً: لا يدخلون تايم شيت الممولين ولا أرصدة الإجازات ولا الطلبات.
--  - الحضور بنفس بوابة المراكز: بطاقة QR خاصة بهم (provider_badges) تُمسح فتُحفظ الحركة في provider_movements.
--  - جدول الدوام (provider_schedule) هو أساس مراقبة التأخر والغياب والساعات المحتسبة. weekday: 0 = الأحد … 6 = السبت.
--  - لا مبالغ مالية في النظام: الكشف الشهري بالساعات فقط ويُحاسَب عليه خارج النظام.

CREATE TABLE providers (
  id             INTEGER PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,                 -- SP-001
  name           TEXT NOT NULL,
  phone          TEXT,
  center_id      INTEGER REFERENCES centers(id),
  service        TEXT,                                 -- نوع الخدمة: تدريس، تدريب، ...
  project        TEXT,
  supervisor_id  INTEGER REFERENCES employees(id),     -- المشرف المسؤول عن متابعته (موظف)
  contract_start TEXT NOT NULL,
  contract_end   TEXT NOT NULL,
  notes          TEXT,
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (contract_end >= contract_start)
);
CREATE INDEX providers_center ON providers(center_id);
CREATE INDEX providers_supervisor ON providers(supervisor_id);

CREATE TABLE provider_schedule (
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL,
  PRIMARY KEY (provider_id, weekday, start_time)
) WITHOUT ROWID;

-- محتوى بطاقة QR (سرّي عشوائي، لا يُشتق من الرمز العلني) -> مزوّد. الإلغاء بالحالة لا بالحذف.
CREATE TABLE provider_badges (
  card        TEXT PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX provider_badges_provider ON provider_badges(provider_id);

-- الحركات الخام من البوابة (أو يدوية من الموارد البشرية: device_id = 'MANUAL'). المفتاح = معرّف الحركة (يمنع التكرار).
CREATE TABLE provider_movements (
  id          TEXT PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  card        TEXT,
  type        TEXT NOT NULL CHECK (type IN ('حضور', 'خروج', 'عودة', 'انصراف')),
  date        TEXT NOT NULL,
  time        TEXT NOT NULL,
  iso         TEXT,
  device_id   TEXT,
  offline     INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
) WITHOUT ROWID;
CREATE INDEX provider_movements_day ON provider_movements(provider_id, date);
CREATE INDEX provider_movements_date ON provider_movements(date);

-- تنبيهات «لم يحضر» المرسلة (مرة لكل مزوّد وحصة ويوم) كي لا يتكرر البريد كل نصف ساعة. ليست من بيانات النسخ الاحتياطي.
CREATE TABLE provider_alerts (
  provider_id   INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,
  session_start TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('noshow')),
  sent_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider_id, date, session_start, kind)
) WITHOUT ROWID;
