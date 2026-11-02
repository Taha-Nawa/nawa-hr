# nawa-hr

نظام إدارة الحضور والانصراف والطلبات — جمعية نوى للثقافة والفنون.

- القرارات والمراحل: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- محرك الحساب اليومي: [`src/engine/attendance.js`](src/engine/attendance.js)
- الاختبارات: `npm test` (لا تحتاج تثبيت أي حزمة)
- الطلبات (إجازة، مغادرة، تأخير) وطباعة النماذج للتوقيع: [القرار 6.2](docs/DECISIONS.md)
- طرق الدخول (Microsoft، رمز البريد، PIN، تذكّر الجهاز): [القرار 6.3](docs/DECISIONS.md) — تفعيل البريد: [`docs/EMAIL-SETUP.md`](docs/EMAIL-SETUP.md)
- التطبيقات القابلة للتثبيت: النظام على `/` وبوابة الحضور على `/gate/` ([القرار 2.5](docs/DECISIONS.md))
- مكتبات مرافقة: خط Alexandria (OFL) وjsQR (Apache-2.0) وqrcode-generator (MIT) منسوخة داخل `public/` — تراخيصها في ملفاتها

> لا بيانات موظفين ولا مفاتيح ولا روابط خدمة داخل هذا المستودع — هو علني.
