-- وحدة العقود: سجل عقود اتفاق تقديم الخدمة التربوية (كان تطبيقاً منفصلاً) ضمن نظام الشؤون الإدارية.
-- المفتاح الذي يربط العقد بمزوّد الخدمة هو رقم الهوية (idno) ولا يخرج من وحدة العقود.
-- الحقول المحسوبة (القيمة، ±25%، التفقيط، المستحق) لا تُخزَّن؛ تُحسب عند العرض.

-- صلاحية فردية: يدير العقود وإن لم يكن دوره موارد بشرية (الموارد البشرية ومسؤول النظام لهما ذلك دائماً)
ALTER TABLE users ADD COLUMN contracts INTEGER NOT NULL DEFAULT 0 CHECK (contracts IN (0, 1));

CREATE TABLE IF NOT EXISTS contracts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_id     TEXT UNIQUE,            -- معرّف السجل في التطبيق القديم (يمنع تكرار الاستيراد)
  seq           INTEGER,                -- الرقم المتسلسل للعقد
  -- مزوّد الخدمة
  name          TEXT NOT NULL,
  idno          TEXT,
  gender        TEXT,
  title         TEXT,
  residence     TEXT,
  phone         TEXT,
  email         TEXT,
  work_email    TEXT,                   -- بريد نوى الرسمي إن مُنح (معلومة فقط؛ لا يفتح أي صلاحية)
  major         TEXT,
  exp           TEXT,
  -- العقد
  ctype         TEXT,
  csubject      TEXT,
  service       TEXT,
  project       TEXT,
  partner       TEXT,
  donor         TEXT,
  hdr           TEXT,
  -- الإجراءات والتواريخ
  rfqno         TEXT,
  d_rfq         TEXT,
  d_offer       TEXT,
  d_sign        TEXT,
  d_from        TEXT,
  d_to          TEXT,
  subject       TEXT,
  -- الموقع
  site_type     TEXT,
  site_name     TEXT,
  area          TEXT,
  -- المالية (داخل وحدة العقود فقط)
  pricing       TEXT,
  rate          REAL,
  sess_per_day  REAL,
  days_base     REAL,
  days_act      REAL,
  bank          TEXT,
  iban          TEXT,
  -- الحالة والإنهاء
  status        TEXT NOT NULL DEFAULT 'active',
  term_type     TEXT,
  term_reason   TEXT,
  d_term        TEXT,
  days_term     REAL,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contracts_idno ON contracts(idno);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);

-- الربط بتبويب «مزودو الخدمة»: كل عقود الهوية نفسها تشير إلى مزوّد واحد (الهوية لا تُنسخ إلى جدول المزوّدين).
ALTER TABLE contracts ADD COLUMN provider_id INTEGER REFERENCES providers(id);
CREATE INDEX IF NOT EXISTS idx_contracts_provider ON contracts(provider_id);
