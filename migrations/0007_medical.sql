-- الإجازة المرضية: بلا ورقة طبية تُقبل يوماً واحداً فقط (قرار 2026-11-02)؛ ما زاد عليه تؤكّد الورقةَ الطبية الموارد البشرية
-- (أو المدير العام/مسؤول النظام) أو من خُوِّل بذلك في صفحة المستخدمين (مثل مديرة الشؤون الإدارية والمالية).

-- تفويض فردي: مستخدم يؤكّد الأوراق الطبية وإن لم يكن دوره موارد بشرية (الأدوار الثلاثة العليا لها ذلك دائماً)
ALTER TABLE users ADD COLUMN medical INTEGER NOT NULL DEFAULT 0 CHECK (medical IN (0, 1));

-- medical_proof: أكّد مقدّم الطلب (أو من أدخله) أن لديه ورقة طبية. medical_by/at: من استلم الورقة وأكّدها عند الاعتماد.
ALTER TABLE requests ADD COLUMN medical_proof INTEGER NOT NULL DEFAULT 0 CHECK (medical_proof IN (0, 1));
ALTER TABLE requests ADD COLUMN medical_by TEXT;
ALTER TABLE requests ADD COLUMN medical_at TEXT;
