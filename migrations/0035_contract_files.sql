-- مستندات العقد (العقد الموقّع، الهوية، عرض السعر…) تُحفظ في النظام لتراها الإدارة.
-- التخزين: قطع BLOB في D1 (كل قطعة ≤ 1 ميغابايت) فلا يلزم أي إعداد إضافي؛ وإن رُبط حاوية R2 باسم DOCS استُعملت بدلاً منها.
CREATE TABLE IF NOT EXISTS contract_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  storage     TEXT NOT NULL DEFAULT 'd1' CHECK (storage IN ('d1', 'r2')),
  uploaded_by TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contract_files_contract ON contract_files (contract_id);

CREATE TABLE IF NOT EXISTS contract_file_chunks (
  file_id INTEGER NOT NULL,
  n       INTEGER NOT NULL,
  data    BLOB NOT NULL,
  PRIMARY KEY (file_id, n)
);
