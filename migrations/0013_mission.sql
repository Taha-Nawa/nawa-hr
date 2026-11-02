-- «مهمة عمل» (قرار 2 نوفمبر 2026): طلب بأيام كاملة للموظفين الخارجيين وأصحاب الزيارات الميدانية.
-- يُخزَّن كطلب إجازة بعلامة mission = 1 (غرضه «أخرى») فيمرّ في مسار الاعتماد وكتابة الأيام نفسه، لكنه لا يخصم من رصيد
-- ولا يُلغيه الدخول على البوابة، ونوعه محتسب كدوام فتصل ساعاته إلى الممولين في التايم شيت.
ALTER TABLE requests ADD COLUMN mission INTEGER NOT NULL DEFAULT 0 CHECK (mission IN (0, 1));

-- نوع «مهمة عمل» (محتسب كدوام) في إعدادات الدوام إن لم يوجد نوع بهذا المعنى؛ لا يمسّ شيئاً غير ذلك.
UPDATE settings
   SET value = json_set(value, '$.leaveTypes."مهمة عمل"', json('true')), updated_at = datetime('now')
 WHERE key = 'work' AND json_valid(value) AND json_type(value, '$.leaveTypes') = 'object'
   AND NOT EXISTS (SELECT 1 FROM json_each(settings.value, '$.leaveTypes') WHERE instr(key, 'مهمة') > 0);
