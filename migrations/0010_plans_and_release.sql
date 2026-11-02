-- (1) الإجازات المتوقعة (التخطيط): الموظف يختار أياماً في تقويم شهري فتبقى «متوقعة» (مسودة) ثم «مُرسَلة» إلى أن يقرّر المسؤول.
--     الاعتماد يحوّل الأيام المعتمدة إلى طلبات إجازة معتمدة عادية (تدخل الحضور والرصيد والتايم شيت كأي إجازة)،
--     والمرفوضة تبقى مرفوضة بسبب ظاهر للموظف.
CREATE TABLE leave_plans (
  id            INTEGER PRIMARY KEY,
  employee_id   INTEGER NOT NULL REFERENCES employees(id),
  purpose       TEXT NOT NULL DEFAULT 'annual' CHECK (purpose IN ('annual', 'other')),
  note          TEXT,                                                                -- وصف الخطة، وغرض «أخرى»
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at  TEXT,
  decided_by    TEXT,
  decided_at    TEXT,
  decision_note TEXT
);
CREATE INDEX leave_plans_emp ON leave_plans(employee_id, status);
CREATE INDEX leave_plans_status ON leave_plans(status, submitted_at);

CREATE TABLE leave_plan_days (
  plan_id     INTEGER NOT NULL REFERENCES leave_plans(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  date        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'approved', 'rejected', 'withdrawn')),
  request_id  INTEGER,                                                               -- الطلب الذي نتج عن اعتماد اليوم
  PRIMARY KEY (plan_id, date)
) WITHOUT ROWID;
CREATE INDEX leave_plan_days_emp ON leave_plan_days(employee_id, date);
-- اليوم الواحد للموظف لا يكون في خطتين فعّالتين (متوقع أو معتمد) معاً
CREATE UNIQUE INDEX leave_plan_days_active ON leave_plan_days(employee_id, date) WHERE status IN ('planned', 'approved');

-- (2) الدخول الفعلي يلغي الإجازة المعتمدة لذلك اليوم (أو الحضور اليدوي بتأكيد): سجل الأيام المُفرَج عنها وسببها.
CREATE TABLE leave_released (
  request_id  INTEGER NOT NULL REFERENCES requests(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  date        TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('checkin', 'manual')),
  released_by TEXT,
  released_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (request_id, date)
) WITHOUT ROWID;
CREATE INDEX leave_released_emp ON leave_released(employee_id, date);
