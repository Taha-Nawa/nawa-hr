-- «تجاهل» يوم «انصراف غير مسجّل»: تقرّر الموارد البشرية ألا تصحّح اليوم، فيخرج من قائمة «لم يسجّلوا الانصراف» ولا يتغيّر حساب اليوم نفسه.
-- kind: 'employee' | 'provider'؛ person_id: رقم الموظف أو المزوّد. صف لكل (شخص، يوم)، ويُحذف الصف لإعادة الاسم إلى القائمة.
CREATE TABLE unclosed_dismissed (
  kind TEXT NOT NULL CHECK (kind IN ('employee', 'provider')),
  person_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  by_email TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (kind, person_id, date)
);
