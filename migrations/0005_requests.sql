-- الطلبات (المرحلة 3): طلب إجازة، إذن مغادرة، إذن تأخير — كما في النماذج الورقية المعتمدة في الجمعية.
--
-- دورة الحياة:  pending (قدّمه الموظف أو أدخله المسؤول) → approved | rejected | cancelled.
-- عند اعتماد الإجازة تُكتب أيامها في day_overrides (بسبب «req:<id>») فتدخل حساب اليوم والتايم شيت،
-- وعند إلغاء الاعتماد تُزال بالسبب نفسه فقط، فلا يُمسّ أي تصحيح يدوي آخر.

CREATE TABLE requests (
  id            INTEGER PRIMARY KEY,
  employee_id   INTEGER NOT NULL REFERENCES employees(id),
  kind          TEXT NOT NULL CHECK (kind IN ('leave', 'exit', 'late')),            -- إجازة | مغادرة | تأخير
  purpose       TEXT NOT NULL CHECK (purpose IN ('annual', 'emergency', 'sick', 'other')),
  purpose_other TEXT,                                                                -- «أخرى، حدد»
  reason        TEXT,                                                                -- الغرض
  from_date     TEXT NOT NULL,                                                       -- الإذن: يوم واحد (from_date = to_date)
  to_date       TEXT NOT NULL CHECK (to_date >= from_date),
  from_time     TEXT,                                                                -- للمغادرة والتأخير فقط
  to_time       TEXT,
  days          REAL NOT NULL DEFAULT 0,                                             -- أيام العمل المحتسبة (إجازة)
  minutes       INTEGER NOT NULL DEFAULT 0,                                          -- مدة الإذن بالدقائق
  leave_type    TEXT,                                                                -- نوع الإجازة في إعدادات المحرك (يختاره المعتمِد)
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  request_date  TEXT NOT NULL,                                                       -- «التاريخ» في النموذج: يوم التقديم بتوقيت المنطقة
  created_by    TEXT NOT NULL,                                                       -- بريد من أدخل الطلب (الموظف نفسه أو من أدخله نيابة عنه)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by    TEXT,
  decided_at    TEXT,
  decision_note TEXT,
  original      TEXT                                                                 -- JSON: ما طلبه الموظف إن عدّله المعتمِد
);
CREATE INDEX requests_emp ON requests(employee_id, from_date);
CREATE INDEX requests_status ON requests(status, created_at);

-- ربط أيام الإجازة المعتمدة بطلبها: إلغاء الاعتماد يزيل ما كتبه هذا الطلب فقط ولا يمسّ تصحيحاً يدوياً.
ALTER TABLE day_overrides ADD COLUMN request_id INTEGER;
CREATE INDEX day_overrides_request ON day_overrides(request_id);
