# nawa-hr

نظام إدارة الحضور والانصراف والطلبات — جمعية نوى للثقافة والفنون.

- القرارات والمراحل: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- محرك الحساب اليومي: [`src/engine/attendance.js`](src/engine/attendance.js)
- الاختبارات: `npm test` (لا تحتاج تثبيت أي حزمة)
- التطبيقات القابلة للتثبيت: النظام على `/` وبوابة الحضور على `/gate/` ([القرار 2.5](docs/DECISIONS.md))
- مكتبات مرافقة: خط Alexandria (OFL) وjsQR (Apache-2.0) وqrcode-generator (MIT) منسوخة داخل `public/` — تراخيصها في ملفاتها

> لا بيانات موظفين ولا مفاتيح ولا روابط خدمة داخل هذا المستودع — هو علني.
