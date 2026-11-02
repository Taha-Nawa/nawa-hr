-- نبض البوابة: آخر ping استلمه النظام (تطبيق البوابة يرسله كل 5 دقائق وهو متصل). last_seen يبقى لآخر حركة.
ALTER TABLE devices ADD COLUMN last_ping TEXT;
