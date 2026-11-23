-- صيغ العقود ومجموعات الترويسة والشعارات (كانت مخزّنة في المتصفح في السجل القديم).
-- كل عقد مثبّت على «نسخة» من الصيغة (rev_id): تعديل الصيغة لا يمسّ عقداً قائماً، ويُنشئ نسخة جديدة متى كانت الحالية مستعملة.

CREATE TABLE IF NOT EXISTS contract_tpls (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  descr      TEXT,
  archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  cur_rev    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- data: JSON { blocks, fields, fp, consts, fmt, foot, logos, logoCfg }
CREATE TABLE IF NOT EXISTS contract_revs (
  id         TEXT PRIMARY KEY,
  tpl_id     TEXT NOT NULL,
  ver        INTEGER NOT NULL,
  note       TEXT,
  locked     INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contract_revs_tpl ON contract_revs (tpl_id, ver);

-- مجموعة ترويسة: JSON { logos, logoCfg, foot } وتُربط بالعقد بالاسم (contracts.hdr) أو تلقائياً (contract_settings.headers)
CREATE TABLE IF NOT EXISTS contract_hdr (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contract_settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

-- صور الشعارات: data URL كما رُفعت (≤ 300 كيلوبايت)، المعرّف بصمة المحتوى فلا تتكرر
CREATE TABLE IF NOT EXISTS contract_assets (
  id         TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE contracts ADD COLUMN tpl_id TEXT;
ALTER TABLE contracts ADD COLUMN rev_id TEXT;
ALTER TABLE contracts ADD COLUMN cf TEXT;   -- حقول الصيغة المخصّصة: JSON { مفتاح: قيمة }
