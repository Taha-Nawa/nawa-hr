-- ربط إذن المغادرة بحركة البوابة: حالة الربط والأوقات الفعلية. عند الاكتمال تُكتب الأوقات الفعلية في from_time/to_time/minutes
-- (فيطابق النموذج المطبوع البوابة) ويُحفظ ما طلبه الموظف أولاً في original.
ALTER TABLE requests ADD COLUMN act_state TEXT;  -- done | open | exit_only | over | manual
ALTER TABLE requests ADD COLUMN act_out TEXT;
ALTER TABLE requests ADD COLUMN act_ret TEXT;
