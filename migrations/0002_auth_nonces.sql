-- رمز استعمال-واحد يربط طلب الدخول (المتصفح) بالتحقق في الخادم: يمنع إعادة استعمال id_token مسروق.
CREATE TABLE auth_nonces (
  nonce      TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
) WITHOUT ROWID;
