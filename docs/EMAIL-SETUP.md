# تفعيل «رمز الدخول بالبريد» (مجاني)

بدون هذه الخطوات يعمل النظام كاملاً بحساب Microsoft أو البريد + PIN، ويختفي فقط خيار «رمز بالبريد» من شاشة الدخول.
الإرسال يتم عبر Microsoft Graph من صندوق **مشترك** في بريد الجمعية (لا يحتاج ترخيصاً) وبتطبيق مؤسسي مقيَّد بذلك الصندوق وحده.
تحتاج صلاحية «مسؤول عام» أو «مسؤول Exchange» على Microsoft 365 مرة واحدة (حوالي 15 دقيقة).

> **الطريق المختصر:** شغّل [`tools/setup-mail.ps1`](../tools/setup-mail.ps1) مرة واحدة (في Azure Cloud Shell) بحساب مسؤول Microsoft 365؛ ينفّذ الخطوات 1 إلى 3 أدناه ويطبع القيم الثلاث، ثم تنتقل إلى الخطوة 4. وبعد الخطوة 4 افتح «الإعدادات ← حالة البريد» واضغط «أرسل رسالة تجريبية لي»: تعرض البطاقة المتغير الناقص أو سبب الفشل بالعربية. السكربت لم يُجرَّب من طرف المطوّر لأنه يحتاج صلاحيات مسؤولك.

## 1) صندوق الإرسال
مركز إدارة Exchange ← Recipients ← Mailboxes ← **Add a shared mailbox**:
- الاسم: `Nawa HR` · العنوان: `no-reply@nawaculture.org`

(الصندوق المشترك مجاني. يمكن استعمال أي صندوق قائم بدلاً منه.)

## 2) تسجيل التطبيق
[مركز Entra](https://entra.microsoft.com) ← Identity ← Applications ← App registrations ← **New registration**:
- الاسم: `Nawa HR Mail` · Supported account types: *Single tenant* · بلا Redirect URI.
- انسخ **Application (client) ID** → هذا `MAIL_CLIENT_ID`.

ثم **API permissions** ← Add a permission ← Microsoft Graph ← **Application permissions** ← `Mail.Send` ← Add، ثم **Grant admin consent for nawaculture**.

ثم **Certificates & secrets** ← New client secret (24 شهراً) ← انسخ **Value** فوراً (لا يظهر ثانية) → هذا `MAIL_CLIENT_SECRET`.
ضع في التقويم تذكيراً بتجديده قبل انتهائه، وإلا يتوقف إرسال الرموز (بقية طرق الدخول تبقى تعمل).

## 3) حصر التطبيق بصندوق واحد (مهم للأمان)
صلاحية `Mail.Send` وحدها تسمح للتطبيق بالإرسال باسم **أي** موظف. نحصرها بالصندوق المشترك. في PowerShell (وحدة ExchangeOnlineManagement):

```powershell
Connect-ExchangeOnline
New-DistributionGroup -Name "NawaHR-Mail-Senders" -Type Security -Members "no-reply@nawaculture.org"
New-ApplicationAccessPolicy -AppId <MAIL_CLIENT_ID> -PolicyScopeGroupId "NawaHR-Mail-Senders@nawaculture.org" -AccessRight RestrictAccess -Description "Nawa HR login codes"
Test-ApplicationAccessPolicy -AppId <MAIL_CLIENT_ID> -Identity "no-reply@nawaculture.org"   # يجب أن تكون النتيجة Granted
Test-ApplicationAccessPolicy -AppId <MAIL_CLIENT_ID> -Identity "someone-else@nawaculture.org" # يجب أن تكون Denied
```

قد يطبَّق التقييد خلال 30 دقيقة. إن طلب منك Microsoft استعمال *RBAC for Applications* بدل هذه السياسة في مستأجرك فالهدف نفسه: حصر التطبيق بصندوق الإرسال فقط.

## 4) إضافة الأسرار إلى Cloudflare
لوحة Cloudflare ← Workers & Pages ← `nawa-hr` ← Settings ← **Variables and Secrets** ← Add، ونوع كل منها **Secret** (لا Text):

| الاسم | القيمة |
|---|---|
| `MAIL_CLIENT_ID` | معرّف التطبيق من الخطوة 2 |
| `MAIL_CLIENT_SECRET` | قيمة السر من الخطوة 2 |
| `MAIL_FROM` | `no-reply@nawaculture.org` |
| `AUTH_SECRET` | (اختياري، يُنصح به) نص عشوائي طويل من 32 حرفاً فأكثر، يقوّي حفظ الـ PIN |

الأسرار لا تُكتب في المستودع (عام) ولا تُمسح عند كل نشر. بعد الحفظ افتح شاشة الدخول: يظهر تبويب **رمز بالبريد**.

> `AUTH_SECRET`: لو غيّرته لاحقاً يبطل كل رقم PIN محفوظ (يعيد الموظفون تفعيله من «حسابي والأمان»). اضبطه مرة واحدة ولا تغيّره.

## 5) تجربة
1. من شاشة الدخول اختر «رمز بالبريد»، اكتب بريدك، واضغط «أرسل الرمز».
2. إن لم يصل خلال دقيقتين افتح «سجل التدقيق»: إجراء `mail.failed` يحمل سبب الفشل:
   - `graph token 400/401`: معرّف التطبيق أو السر خاطئ أو منتهٍ.
   - `graph send 403`: لم تُمنح موافقة المسؤول على `Mail.Send`، أو سياسة الحصر لا تشمل الصندوق.
   - `graph send 404`: عنوان `MAIL_FROM` غير موجود.
3. راجع مجلد البريد غير الهام في أول مرة.

## بديل: Resend (إن تعذّر Microsoft Graph)
خطة Resend المجانية (100 رسالة/يوم) تكفي: وثّق نطاق `nawaculture.org` عندهم بسجلات DNS، وأضف سرّين فقط: `RESEND_API_KEY` و`MAIL_FROM`. يُستعمل Graph إن ضُبط، وإلا Resend.
