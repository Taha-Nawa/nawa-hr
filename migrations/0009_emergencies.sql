-- طوارئ الدوام (قرار 2 نوفمبر 2026): إعلان يصدره المسؤول أو الموارد البشرية عند حدث طارئ في مركز (أو في كل المراكز) في يوم دوام.
--
--  - dismiss_time: «إخلاء فوري» عند هذه الساعة. ينتهي الدوام الفعلي لذلك المركز عندها، فلا عجز ولا انصراف مبكر لمن بقي حتى ذلك الوقت،
--    ومن حضر ولم يسجّل انصرافه يُعدّ منصرفاً عندها. فارغ = لم يكن هناك دوام أصلاً (إغلاق يوم كامل).
--  - leave_type: احتساب اليوم كاملاً بنوع من أنواع الإجازات في إعدادات الدوام (طارئة أو أخرى أو غيرها حسب اختيار المسؤول)،
--    فيُكتب لكل موظف فعّال في النطاق في day_overrides بالربط emergency_id. فارغ = لا احتساب كامل.
--  - center_id فارغ = كل المراكز.
--  - الإلغاء (status = cancelled) يزيل ما كتبه الإعلان فقط ويعيد حساب الأيام.

CREATE TABLE emergencies (
  id           INTEGER PRIMARY KEY,
  date         TEXT NOT NULL,
  center_id    INTEGER REFERENCES centers(id),
  dismiss_time TEXT,
  leave_type   TEXT,
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  cancelled_by TEXT,
  cancelled_at TEXT,
  CHECK (dismiss_time IS NOT NULL OR leave_type IS NOT NULL)
);
CREATE INDEX emergencies_date ON emergencies(date, status);

ALTER TABLE day_overrides ADD COLUMN emergency_id INTEGER;
CREATE INDEX day_overrides_emergency ON day_overrides(emergency_id);
