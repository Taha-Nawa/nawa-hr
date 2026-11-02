// حسابي والأمان: رقم PIN، الأجهزة المتذكَّرة، وإنهاء الجلسات الأخرى.
import { h, clear, icon, field, dialog, confirmBox, toast, AR_MONTHS } from '../dom.js';
import { get, post } from '../api.js';

const ROLE_LABEL = { employee: 'موظف', manager: 'مدير مباشر', hr: 'موارد بشرية', director: 'مدير عام', admin: 'مسؤول النظام' };
const VIA = { microsoft: 'حساب Microsoft', code: 'رمز البريد', pin: 'رقم PIN', device: 'جهاز متذكَّر' };

function stamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()} · ${t}`;
}

const pinInput = (label, autocomplete) => {
  const el = h('input', { type: 'password', inputmode: 'numeric', maxlength: '6', autocomplete, dir: 'ltr', class: 'code-input code-input-sm', placeholder: '••••••', 'aria-label': label, required: true });
  el.addEventListener('input', () => { el.value = el.value.replace(/\D/g, '').slice(0, 6); });
  return el;
};

export default async function render({ user }) {
  const host = h('div', { class: 'page' });
  let acc;

  async function draw() {
    acc = (await get('/api/account')).account;
    const cur = acc.devices.find((d) => d.current);
    clear(host).append(
      h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'حسابي والأمان'), h('p', { class: 'sub' }, 'طرق دخولك وأجهزتك الموثوقة. لا يظهر هنا أي سرّ، ولا يستطيع أحد (حتى المسؤول) رؤية رقمك.'))),
      identity(), pinCard(), deviceCard(cur), codeCard());
  }

  const identity = () => h('section', { class: 'panel acct' },
    h('div', { class: 'acct-head' }, icon('user'), h('h2', null, 'الحساب')),
    h('dl', { class: 'req-info' },
      h('div', { class: 'kv' }, h('dt', null, 'البريد'), h('dd', { dir: 'ltr', class: 'ltr-cell' }, acc.email)),
      h('div', { class: 'kv' }, h('dt', null, 'الدور'), h('dd', null, ROLE_LABEL[acc.role] || acc.role)),
      h('div', { class: 'kv' }, h('dt', null, 'دخلتَ هذه المرة بـ'), h('dd', null, VIA[acc.via] || acc.via))));

  // ---- PIN
  function openPin() {
    const needCurrent = acc.pin.set && !acc.strongSession;
    const current = needCurrent ? pinInput('الـ PIN الحالي', 'current-password') : null;
    const next = pinInput('الـ PIN الجديد', 'new-password');
    const again = pinInput('تأكيد الـ PIN الجديد', 'new-password');
    const err = h('div', { class: 'notice notice-err', hidden: true, role: 'alert' });
    const save = h('button', { type: 'submit', class: 'btn btn-primary' }, 'حفظ');
    const d = dialog({
      title: acc.pin.set ? 'تغيير رقم PIN' : 'تفعيل رقم PIN',
      content: h('form', { class: 'request-form', onsubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        if (next.value !== again.value) {
          err.textContent = 'الرقمان غير متطابقين';
          err.hidden = false;
          return;
        }
        save.disabled = true;
        try {
          await post('/api/account/pin', { pin: next.value, currentPin: current?.value });
          toast('حُفظ رقم PIN');
          d.close();
          await draw();
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
          save.disabled = false;
        }
      } },
      h('p', { class: 'muted' }, '6 أرقام تدخل بها ببريدك دون Microsoft. تجنّب تاريخ ميلادك والأرقام المتكررة أو المتتالية.'),
      current ? field('الـ PIN الحالي', current) : (acc.pin.set ? h('p', { class: 'small muted' }, 'دخلتَ بطريقة موثوقة، فلا تحتاج إدخال الرقم القديم.') : null),
      field('الـ PIN الجديد', next), field('تأكيد الـ PIN', again), err,
      h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'إلغاء'), save)),
    });
    (current || next).focus();
  }

  function removePin() {
    const needCurrent = !acc.strongSession;
    const current = needCurrent ? pinInput('الـ PIN الحالي', 'current-password') : null;
    const err = h('div', { class: 'notice notice-err', hidden: true, role: 'alert' });
    const go = h('button', { type: 'submit', class: 'btn btn-danger' }, 'إزالة الـ PIN');
    const d = dialog({
      title: 'إزالة رقم PIN',
      content: h('form', { class: 'request-form', onsubmit: async (e) => {
        e.preventDefault();
        go.disabled = true;
        try {
          await post('/api/account/pin/remove', { currentPin: current?.value });
          toast('أُزيل رقم PIN');
          d.close();
          await draw();
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
          go.disabled = false;
        }
      } },
      h('p', null, 'ستعود إلى الدخول بحساب Microsoft أو رمز البريد، وتُلغى الأجهزة التي كانت تفتح بالـ PIN.'),
      current ? field('الـ PIN الحالي', current) : null, err,
      h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'تراجع'), go)),
    });
    current?.focus();
  }

  function pinCard() {
    const blocked = !acc.pin.set && !acc.strongSession;
    return h('section', { class: 'panel acct' },
      h('div', { class: 'acct-head' }, icon('lock'), h('h2', null, 'رقم PIN'),
        h('span', { class: `chip ${acc.pin.set ? 'chip-present' : 'chip-off'}` }, acc.pin.set ? 'مفعّل' : 'غير مفعّل')),
      h('p', null, 'ادخل ببريدك ورقم من 6 أرقام بلا Microsoft ولا انتظار رسالة. بعد 5 محاولات خاطئة يتوقف الدخول مؤقتاً لحمايتك.'),
      acc.pin.set ? h('p', { class: 'small muted' }, `آخر تغيير: ${stamp(acc.pin.updatedAt)}`) : null,
      blocked ? h('div', { class: 'notice notice-warn' }, 'لأمانك، تفعيل PIN يتطلب دخولاً حديثاً: اخرج ثم ادخل بحساب Microsoft أو برمز البريد، ثم عُد إلى هنا.') : null,
      h('div', { class: 'row-actions' },
        blocked ? null : h('button', { type: 'button', class: 'btn btn-primary', onclick: openPin }, icon('key'), acc.pin.set ? 'تغيير الـ PIN' : 'تفعيل الـ PIN'),
        acc.pin.set ? h('button', { type: 'button', class: 'btn btn-danger-ghost', onclick: removePin }, 'إزالة') : null));
  }

  // ---- الأجهزة
  async function act(path, body, okMsg) {
    try {
      await post(path, body);
      if (okMsg) toast(okMsg);
      await draw();
    } catch (e) {
      toast(e.message, 'err');
      await draw();
    }
  }

  function deviceCard(cur) {
    const rememberBox = h('input', { type: 'checkbox', id: 'remDev', checked: !!cur, onchange: (e) => act('/api/account/device', { remember: e.target.checked }, e.target.checked ? 'سيتذكّر هذا الجهاز دخولك' : 'نُسي هذا الجهاز') });
    const pinBox = cur && acc.pin.set
      ? h('label', { class: 'check', for: 'remPin' },
        h('input', { type: 'checkbox', id: 'remPin', checked: cur.pinRequired, onchange: (e) => act('/api/account/device', { remember: true, pinRequired: e.target.checked }, e.target.checked ? 'سيطلب هذا الجهاز الـ PIN عند الفتح' : 'سيفتح هذا الجهاز مباشرة') }),
        h('span', null, 'اطلب الـ PIN عند فتح التطبيق على هذا الجهاز'))
      : null;
    return h('section', { class: 'panel acct' },
      h('div', { class: 'acct-head' }, icon('phone'), h('h2', null, 'الأجهزة المتذكَّرة')),
      h('p', null, `الجهاز المتذكَّر يدخل بلا إعادة إدخال لمدة ${acc.rememberDays} يوماً منذ آخر استعمال. فعّله على هاتفك فقط، لا على جهاز مشترك.`),
      h('label', { class: 'check', for: 'remDev' }, rememberBox, h('span', null, 'تذكّر هذا الجهاز')),
      pinBox,
      acc.devices.length
        ? h('ul', { class: 'plain dev-list' }, acc.devices.map((d) => h('li', { class: 'dev-row' },
          h('div', null,
            h('div', { class: 'dev-name' }, d.label || 'جهاز', d.current ? h('span', { class: 'chip chip-present' }, 'هذا الجهاز') : null, d.pinRequired ? h('span', { class: 'chip chip-off' }, 'يطلب PIN') : null),
            h('div', { class: 'small muted' }, `آخر استعمال: ${stamp(d.lastUsedAt)}`)),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => {
            if (await confirmBox(d.current ? 'سيُنسى هذا الجهاز وتحتاج إلى الدخول من جديد في المرة القادمة.' : 'سيُلغى هذا الجهاز ولن يدخل تلقائياً بعد الآن.', 'إلغاء الجهاز', true)) act(`/api/account/devices/${d.id}/revoke`, {}, 'أُلغي الجهاز');
          } }, 'إلغاء'))))
        : h('p', { class: 'empty' }, 'لا أجهزة متذكَّرة.'),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn', onclick: async () => {
        if (await confirmBox('ستُنهى كل الجلسات الأخرى وتُلغى الأجهزة المتذكَّرة الأخرى. هذا الجهاز يبقى كما هو.', 'إنهاء الجلسات الأخرى', true)) act('/api/account/sign-out-others', {}, 'أُنهيت الجلسات الأخرى');
      } }, 'الخروج من كل الأجهزة الأخرى')));
  }

  const codeCard = () => h('section', { class: 'panel acct' },
    h('div', { class: 'acct-head' }, icon('mail'), h('h2', null, 'رمز التحقق بالبريد'),
      h('span', { class: `chip ${acc.codeAvailable ? 'chip-present' : 'chip-off'}` }, acc.codeAvailable ? 'متاح' : 'غير مفعّل')),
    h('p', null, acc.codeAvailable
      ? 'اطلب رمزاً من شاشة الدخول فيصلك على بريدك المؤسسي (صالح 10 دقائق، يُستعمل مرة واحدة). مفيد إن نسيت الـ PIN أو دخلت من جهاز غريب.'
      : (user.role === 'admin' ? 'لم يُضبط إرسال البريد بعد. اتبع خطوات docs/EMAIL-SETUP.md ثم يظهر خيار «رمز بالبريد» لكل الموظفين.' : 'هذه الطريقة لم تُفعَّل بعد من مسؤول النظام.')));

  await draw();
  return host;
}
