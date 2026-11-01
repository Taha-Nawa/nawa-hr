// تثبيت التطبيق على الجوال/التابلت (PWA) والعمل دون اتصال للواجهة.
// البيانات نفسها لا تُخزَّن محلياً أبداً (كلها من /api مباشرة)، فلا تبقى بيانات موظفين على الجهاز بعد الخروج.

let installEvent = null;

export const isStandalone = () => (window.matchMedia?.('(display-mode: standalone)').matches ?? false) || navigator.standalone === true;
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const canInstall = () => !!installEvent;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  window.dispatchEvent(new Event('nawa:installable'));
});
window.addEventListener('appinstalled', () => {
  installEvent = null;
  window.dispatchEvent(new Event('nawa:installed'));
});

/** يعرض نافذة التثبيت الأصلية (أندرويد/كروم). يُرجع true إن وافق المستخدم. */
export async function promptInstall() {
  if (!installEvent) return false;
  installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  return outcome === 'accepted';
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* المتصفح لا يدعم أو الصفحة غير آمنة: النظام يعمل كالمعتاد */ });
}
