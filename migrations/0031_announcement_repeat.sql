-- تكرار ظهور الرسالة خلال مدتها: كل repeat_minutes دقيقة بعد آخر مشاهدة (NULL = تظهر مرة واحدة فقط).
ALTER TABLE announcements ADD COLUMN repeat_minutes INTEGER;
