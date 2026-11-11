-- السجل الوظيفي: النقل بين المراكز وإنهاء الخدمة (استقالة / إنهاء / انتهاء عقد) وإعادة التفعيل. لا يُحذف منه شيء.
CREATE TABLE employee_history (
  id             INTEGER PRIMARY KEY,
  employee_id    INTEGER NOT NULL REFERENCES employees(id),
  kind           TEXT NOT NULL CHECK (kind IN ('transfer', 'resign', 'terminate', 'contract_end', 'separate_other', 'reinstate')),
  effective_date TEXT NOT NULL,
  from_center_id INTEGER REFERENCES centers(id),
  to_center_id   INTEGER REFERENCES centers(id),
  from_manager_id INTEGER REFERENCES employees(id),
  to_manager_id   INTEGER REFERENCES employees(id),
  reason         TEXT,
  detail         TEXT,                                   -- JSON: ما أُغلق (حسابات، بطاقات، طلبات…) وما أُعيد إسناده
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX employee_history_emp ON employee_history(employee_id, effective_date);
