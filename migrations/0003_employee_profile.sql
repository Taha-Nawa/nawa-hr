-- حقول ملف الموظف المطلوبة للتايم شيت (المسمى، القسم، نوع التعاقد، المشروع/الممول) كما في «قائمة الموظفين» بإكسل.
-- manager_label: نص المدير المباشر كما هو في إكسل (قد يكون مسمّى وظيفياً لا اسماً)؛ الربط الفعلي يتم بـ manager_id.
ALTER TABLE employees ADD COLUMN job_title TEXT;
ALTER TABLE employees ADD COLUMN department TEXT;
ALTER TABLE employees ADD COLUMN contract_type TEXT;
ALTER TABLE employees ADD COLUMN project TEXT;
ALTER TABLE employees ADD COLUMN manager_label TEXT;
