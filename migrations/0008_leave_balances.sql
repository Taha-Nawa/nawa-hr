-- أرصدة الإجازات لكل موظف في كل سنة (قرار 2 نوفمبر 2026): تحدّدها الموارد البشرية فردياً أو لعدة موظفين دفعة واحدة.
--
--  - الرصيد الفعلي للموظف = رصيده الخاص في هذا الجدول إن وُجد، وإلا الرصيد الافتراضي في settings['requests'].entitlement،
--    وإلا فلا رصيد (تُعرض الأيام المستهلكة بلا «متبقٍّ»).
--  - لا يُخزَّن «المتبقي» ولا «المستهلك»: يُحسبان دائماً من الطلبات المعتمدة (اعتماد الطلب يخصم، وإلغاء اعتماده يردّ) فلا يتفرّق الرصيد عن الطلبات.
--  - السنة ميلادية (يناير–ديسمبر) وتُنسب الإجازة لسنة تاريخ بدايتها. days تقبل نصف اليوم.

CREATE TABLE leave_balances (
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  year        INTEGER NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  purpose     TEXT NOT NULL CHECK (purpose IN ('annual', 'emergency', 'sick', 'other')),
  days        REAL NOT NULL CHECK (days >= 0 AND days <= 366),
  updated_by  TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (employee_id, year, purpose)
) WITHOUT ROWID;
CREATE INDEX leave_balances_year ON leave_balances(year);
