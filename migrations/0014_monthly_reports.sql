-- التقرير الشهري للموظف (قرار 2 نوفمبر 2026): نفس نموذج «التقرير الشهري» الورقي/إكسل — مهام الشهر، الاجتماعات والنشاطات،
-- مهام الشهر التالي، المرفقات (أسماء فقط: لا تخزين ملفات)، وملاحظات المدير المباشر. تقرير واحد لكل موظف في الشهر.
-- body: JSON { tasks: [{title, status, challenges}], meetings: [{title, summary, place, date}],
--              next: [{title, importance, start, end}], attachments: [نص] } — يُتحقَّق منه في src/engine/monthly-report.js.
CREATE TABLE monthly_reports (
  employee_id   INTEGER NOT NULL REFERENCES employees(id),
  month         TEXT NOT NULL,                        -- YYYY-MM
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  submit_date   TEXT,                                 -- «تاريخ تقديم التقرير» في الترويسة (YYYY-MM-DD)
  body          TEXT NOT NULL DEFAULT '{}',
  manager_notes TEXT,
  notes_by      TEXT,
  updated_by    TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (employee_id, month)
) WITHOUT ROWID;
CREATE INDEX monthly_reports_month ON monthly_reports(month);
