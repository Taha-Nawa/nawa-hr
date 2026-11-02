<#
  إعداد إرسال البريد لنظام الحضور والطلبات (Microsoft Graph) — يُشغَّل مرة واحدة بحساب مسؤول Microsoft 365
  (مسؤول عام، أو مسؤول Exchange + مسؤول التطبيقات). الأسهل: Azure Cloud Shell (PowerShell) من portal.azure.com.

  ما يفعله، بالترتيب:
    1) ينشئ صندوقاً مشتركاً مجانياً (no-reply@nawaculture.org) إن لم يوجد.
    2) يسجّل تطبيق «Nawa HR Mail» بصلاحية Mail.Send ويمنح موافقة المسؤول عليها.
    3) ينشئ سرّاً للتطبيق (24 شهراً).
    4) يحصر التطبيق بالصندوق المشترك وحده (حتى لا يستطيع الإرسال باسم أي موظف) ويختبر الحصر.
    5) يطبع القيم الثلاث التي تضعها في Cloudflare كـ Secrets: MAIL_CLIENT_ID وMAIL_CLIENT_SECRET وMAIL_FROM.

  ملاحظات:
   - السرّ يظهر مرة واحدة في نهاية التنفيذ: انسخه فوراً. لا تحفظه في ملف ولا ترسله بالبريد.
   - يمكن إعادة تشغيل السكربت بأمان: ما هو موجود لا يُكرَّر (لكنه يُنشئ سرّاً جديداً في كل مرة).
   - لم يُجرَّب هذا السكربت من طرف مطوّر النظام لأنه يحتاج صلاحيات مسؤولك؛ إن ظهر خطأ أرسله كما هو.
   - بعد الانتهاء قد يتأخر تطبيق الحصر حتى 30 دقيقة. ثم اضغط «أرسل رسالة تجريبية لي» في الإعدادات ← حالة البريد.
#>
param(
  [string]$Mailbox = 'no-reply@nawaculture.org',
  [string]$MailboxName = 'Nawa HR',
  [string]$AppName = 'Nawa HR Mail',
  [int]$SecretMonths = 24
)
$ErrorActionPreference = 'Stop'
$domain = $Mailbox.Split('@')[1]
$alias = $Mailbox.Split('@')[0]
$group = 'NawaHR-Mail-Senders'

foreach ($m in 'Microsoft.Graph.Authentication', 'Microsoft.Graph.Applications', 'ExchangeOnlineManagement') {
  if (-not (Get-Module -ListAvailable -Name $m)) { Write-Host "تثبيت الوحدة $m ..."; Install-Module $m -Scope CurrentUser -Force -AllowClobber }
}

# ---- 1) Exchange: الصندوق المشترك ومجموعة الحصر
Connect-ExchangeOnline -ShowBanner:$false
if (-not (Get-Mailbox -Identity $Mailbox -ErrorAction SilentlyContinue)) {
  New-Mailbox -Shared -Name $MailboxName -DisplayName $MailboxName -Alias $alias -PrimarySmtpAddress $Mailbox | Out-Null
  Write-Host "أُنشئ الصندوق المشترك $Mailbox"
} else { Write-Host "الصندوق $Mailbox موجود" }
if (-not (Get-DistributionGroup -Identity $group -ErrorAction SilentlyContinue)) {
  New-DistributionGroup -Name $group -Type Security -Members $Mailbox | Out-Null
  Write-Host "أُنشئت مجموعة الحصر $group"
}

# ---- 2) Entra: التطبيق وصلاحية Mail.Send وموافقة المسؤول
Connect-MgGraph -Scopes 'Application.ReadWrite.All', 'AppRoleAssignment.ReadWrite.All' -NoWelcome
$graphSp = Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'"
$role = $graphSp.AppRoles | Where-Object { $_.Value -eq 'Mail.Send' -and $_.AllowedMemberTypes -contains 'Application' }
if (-not $role) { throw 'لم أجد صلاحية Mail.Send في Microsoft Graph' }

$app = Get-MgApplication -Filter "displayName eq '$AppName'" | Select-Object -First 1
if (-not $app) {
  $app = New-MgApplication -DisplayName $AppName -SignInAudience 'AzureADMyOrg' `
    -RequiredResourceAccess @(@{ ResourceAppId = $graphSp.AppId; ResourceAccess = @(@{ Id = $role.Id; Type = 'Role' }) })
  Write-Host "سُجّل التطبيق $AppName"
} else { Write-Host "التطبيق $AppName موجود" }

$sp = Get-MgServicePrincipal -Filter "appId eq '$($app.AppId)'" | Select-Object -First 1
if (-not $sp) { $sp = New-MgServicePrincipal -AppId $app.AppId }
$granted = Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id | Where-Object { $_.AppRoleId -eq $role.Id }
if (-not $granted) {
  New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -PrincipalId $sp.Id -ResourceId $graphSp.Id -AppRoleId $role.Id | Out-Null
  Write-Host 'مُنحت موافقة المسؤول على Mail.Send'
}

# ---- 3) السرّ
$secret = Add-MgApplicationPassword -ApplicationId $app.Id -PasswordCredential @{ DisplayName = 'nawa-hr'; EndDateTime = (Get-Date).AddMonths($SecretMonths) }

# ---- 4) حصر التطبيق بالصندوق المشترك
if (-not (Get-ApplicationAccessPolicy -ErrorAction SilentlyContinue | Where-Object { $_.AppId -eq $app.AppId })) {
  New-ApplicationAccessPolicy -AppId $app.AppId -PolicyScopeGroupId "$group@$domain" -AccessRight RestrictAccess -Description 'Nawa HR login codes and notifications' | Out-Null
}
Write-Host 'اختبار الحصر (قد يظهر Denied/Granted غير نهائي حتى 30 دقيقة):'
Test-ApplicationAccessPolicy -AppId $app.AppId -Identity $Mailbox | Select-Object AccessCheckResult | Format-List
Write-Host '--'

# ---- 5) القيم
Write-Host ''
Write-Host '================ ضع هذه القيم في Cloudflare كـ Secrets ================'
Write-Host "MAIL_CLIENT_ID     = $($app.AppId)"
Write-Host "MAIL_CLIENT_SECRET = $($secret.SecretText)    <-- يظهر الآن فقط، انسخه فوراً"
Write-Host "MAIL_FROM          = $Mailbox"
Write-Host '(اختياري) AUTH_SECRET = نص عشوائي طويل من 32 حرفاً فأكثر، يُضبط مرة واحدة ولا يُغيَّر'
Write-Host '======================================================================'
Disconnect-MgGraph | Out-Null
Disconnect-ExchangeOnline -Confirm:$false | Out-Null
