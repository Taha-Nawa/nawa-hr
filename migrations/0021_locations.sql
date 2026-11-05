-- مراقبة الموقع: كل حركة قد تحمل موقع الهاتف (lat/lng ودقته بالأمتار)، ولكل مركز/نقطة موقعه ونصف قطر النطاق المسموح.
ALTER TABLE movements ADD COLUMN lat REAL;
ALTER TABLE movements ADD COLUMN lng REAL;
ALTER TABLE movements ADD COLUMN acc REAL;
ALTER TABLE centers ADD COLUMN lat REAL;
ALTER TABLE centers ADD COLUMN lng REAL;
ALTER TABLE centers ADD COLUMN radius_m INTEGER NOT NULL DEFAULT 150;
