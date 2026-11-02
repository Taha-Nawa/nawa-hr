// شاشة الدخول: القوس (توقيع الهوية) ثم ثلاث طرق: حساب Microsoft، رمز على البريد، البريد + PIN،
// وبطاقة «مرحباً بعودتك» إن كان الجهاز متذكَّراً. كل ما هنا واجهة فقط؛ الخادم هو من يتحقق ويقرر.
import { h, clear, icon } from './dom.js';
import { startLogin, requestCode, verifyCode, loginWithPin, resumeDevice } from './auth.js';
import { isStandalone } from './pwa.js';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* التخزين غير متاح */ } },
};
const METHOD = 'nawa-method';
const REMEMBER = 'nawa-remember';
const EMAIL = 'nawa-email';

const METHODS = {
  microsoft: { label: 'Microsoft', icon: 'user' },
  code: { label: 'رمز بالبريد', icon: 'mail' },
  pin: { label: 'رقم PIN', icon: 'key' },
};

const msLogo = () => h('span', { class: 'ms-logo', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
const mm = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/**
 * root: عنصر التطبيق. config: { sso, pin, code, rememberDays }. device: { known, name, email, pinRequired }.
 * onDone: يُستدعى بعد نجاح الدخول (الجلسة صارت كوكي في المتصفح).
 */
export function showLogin({ root, message, config, device, onDone }) {
  document.title = 'الدخول — نظام الحضور والطلبات';
  const available = ['microsoft', 'code', 'pin'].filter((m) => (m === 'microsoft' ? config.sso : m === 'code' ? config.code : config.pin));
  const saved = store.get(METHOD);
  const st = {
    view: device?.known ? 'welcome' : 'methods',
    method: available.includes(saved) ? saved : available[0],
    stage: 'email', // رمز البريد: email ثم verify
    email: store.get(EMAIL) || '',
    cooldownUntil: 0,
    msg: message || '',
    remember: store.get(REMEMBER) === null ? isStandalone() : store.get(REMEMBER) === '1',
  };
  let timer = 0;
  let focusSel = null;

  const card = h('section', { class: 'arch login-card' });
  clear(root).append(h('main', { class: 'login' }, card));

  const fail = (box, e) => {
    box.textContent = e.message || 'تعذّر الدخول، حاول مرة أخرى.';
    box.hidden = false;
  };

  /** يغلّف إرسال نموذج: تعطيل الزر أثناء العمل، وعرض الخطأ في صندوقه. */
  const guarded = (btn, box, work) => async (e) => {
    e?.preventDefault();
    if (btn.disabled) return; // لا إرسال مزدوج (الإدخال التلقائي عند اكتمال الرقم ثم نقر الزر)
    box.hidden = true;
    btn.disabled = true;
    try {
      await work();
    } catch (ex) {
      fail(box, ex);
      btn.disabled = false;
    }
  };

  function remember() {
    const box = h('input', { type: 'checkbox', id: 'rememberDevice', checked: st.remember, onchange: (e) => { st.remember = e.target.checked; store.set(REMEMBER, st.remember ? '1' : '0'); } });
    return h('label', { class: 'login-remember', for: 'rememberDevice' }, box,
      h('span', null, h('b', null, 'تذكّر هذا الجهاز'), h('small', null, `لمدة ${config.rememberDays} يوماً بلا إعادة إدخال. لا تفعّله على جهاز مشترك.`)));
  }

  const errBox = () => h('p', { class: 'login-msg', role: 'alert', hidden: true });

  // ------------------------------------------------------------ بطاقة «مرحباً بعودتك»
  function welcome() {
    const err = errBox();
    const go = async (pin) => {
      await resumeDevice(pin);
      onDone();
    };
    let body;
    if (device.pinRequired) {
      const pin = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'current-password', maxlength: '6', class: 'code-input', 'aria-label': 'رقم PIN', placeholder: '••••••' });
      const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-wide' }, icon('lock'), h('span', null, 'فتح'));
      const run = guarded(btn, err, () => go(pin.value.trim()));
      pin.addEventListener('input', () => {
        pin.value = pin.value.replace(/\D/g, '').slice(0, 6);
        if (pin.value.length === 6) run();
      });
      body = h('form', { class: 'login-form', onsubmit: run }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'أدخل رقم PIN'), pin), err, btn);
      focusSel = '.code-input';
    } else {
      const btn = h('button', { type: 'button', class: 'btn btn-primary btn-wide' }, icon('check'), h('span', null, `متابعة كـ ${device.name}`));
      btn.addEventListener('click', guarded(btn, err, () => go()));
      body = h('div', { class: 'login-form' }, err, btn);
    }
    return [
      h('div', { class: 'welcome' },
        h('span', { class: 'avatar avatar-lg', 'aria-hidden': 'true' }, (device.name || '؟')[0].toUpperCase()),
        h('div', null, h('p', { class: 'welcome-hi' }, 'مرحباً بعودتك'), h('p', { class: 'welcome-name' }, device.name), h('p', { class: 'welcome-mail', dir: 'ltr' }, device.email))),
      body,
      h('button', { type: 'button', class: 'link-btn login-alt', onclick: () => { st.view = 'methods'; st.msg = ''; draw(); } }, 'ليس أنت؟ ادخل بحساب آخر'),
    ];
  }

  // ------------------------------------------------------------ الطرق
  function microsoftPanel() {
    const err = errBox();
    const btn = h('button', { type: 'button', class: 'btn btn-ms btn-wide' }, msLogo(), h('span', null, 'الدخول بحساب Microsoft'));
    btn.addEventListener('click', guarded(btn, err, () => startLogin({ remember: st.remember })));
    return [h('p', { class: 'login-hint' }, 'بحسابك المؤسسي على nawaculture.org، كما تدخل بريدك.'), err, btn, remember()];
  }

  function emailField(extra = {}) {
    return h('input', { type: 'email', autocomplete: 'username', inputmode: 'email', dir: 'ltr', required: true, placeholder: 'name@nawaculture.org', value: st.email, 'aria-label': 'البريد المؤسسي', ...extra,
      oninput: (e) => { st.email = e.target.value.trim(); } });
  }

  function codePanel() {
    const err = errBox();
    if (st.stage === 'email') {
      const mail = emailField();
      const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-wide' }, icon('mail'), h('span', null, 'أرسل الرمز'));
      focusSel = 'input[type=email]';
      return [
        h('p', { class: 'login-hint' }, 'نرسل رمزاً من 6 أرقام إلى بريدك المؤسسي، فلا تحتاج كلمة مرور.'),
        h('form', { class: 'login-form', onsubmit: guarded(btn, err, async () => {
          const r = await requestCode(st.email);
          st.stage = 'verify';
          st.cooldownUntil = Date.now() + (r.cooldown || 60) * 1000;
          draw();
        }) },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'البريد المؤسسي'), mail), err, btn),
        remember(),
      ];
    }
    // التحقق
    const otp = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '7', class: 'code-input', 'aria-label': 'رمز التحقق', placeholder: '——————', dir: 'ltr' });
    const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-wide' }, icon('check'), h('span', null, 'تأكيد والدخول'));
    const run = guarded(btn, err, async () => {
      await verifyCode(st.email, otp.value, st.remember);
      store.set(EMAIL, st.email);
      onDone();
    });
    otp.addEventListener('input', () => {
      otp.value = otp.value.replace(/\D/g, '').slice(0, 6);
      if (otp.value.length === 6) run();
    });
    const resend = h('button', { type: 'button', class: 'link-btn', disabled: true });
    const tick = () => {
      const left = Math.max(0, Math.ceil((st.cooldownUntil - Date.now()) / 1000));
      resend.disabled = left > 0;
      resend.textContent = left > 0 ? `إعادة الإرسال بعد ${mm(left)}` : 'إعادة إرسال الرمز';
    };
    tick();
    clearInterval(timer);
    timer = setInterval(() => (resend.isConnected ? tick() : clearInterval(timer)), 1000);
    resend.addEventListener('click', async () => {
      err.hidden = true;
      resend.disabled = true;
      try {
        const r = await requestCode(st.email);
        st.cooldownUntil = Date.now() + (r.cooldown || 60) * 1000;
        otp.value = '';
        otp.focus();
        tick();
      } catch (ex) {
        fail(err, ex);
        tick();
      }
    });
    focusSel = '.code-input';
    return [
      h('p', { class: 'login-hint' }, 'أرسلنا الرمز إلى ', h('b', { dir: 'ltr' }, st.email), '. إن كان بريدك مسجّلاً سيصلك خلال دقيقة (راجع البريد غير الهام أيضاً).'),
      h('form', { class: 'login-form', onsubmit: run },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'رمز التحقق'), otp), err, btn),
      h('div', { class: 'login-row' }, resend, h('button', { type: 'button', class: 'link-btn', onclick: () => { st.stage = 'email'; draw(); } }, 'تغيير البريد')),
      remember(),
    ];
  }

  function pinPanel() {
    const err = errBox();
    const mail = emailField();
    const pin = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'current-password', maxlength: '6', class: 'code-input', 'aria-label': 'رقم PIN', placeholder: '••••••', dir: 'ltr' });
    const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-wide' }, icon('lock'), h('span', null, 'دخول'));
    const run = guarded(btn, err, async () => {
      await loginWithPin(st.email, pin.value, st.remember);
      store.set(EMAIL, st.email);
      onDone();
    });
    pin.addEventListener('input', () => {
      pin.value = pin.value.replace(/\D/g, '').slice(0, 6);
      if (pin.value.length === 6 && mail.checkValidity() && mail.value) run();
    });
    focusSel = st.email ? '.code-input' : 'input[type=email]';
    return [
      h('p', { class: 'login-hint' }, 'بريدك ورقم PIN من 6 أرقام اخترته في «حسابي والأمان».'),
      h('form', { class: 'login-form', onsubmit: run },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'البريد المؤسسي'), mail),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'رقم PIN'), pin), err, btn),
      remember(),
      h('p', { class: 'login-fine' }, 'لم تفعّل PIN بعد أو نسيته؟ ادخل بطريقة أخرى ثم افتح «حسابي والأمان».'),
    ];
  }

  function methods() {
    const tabs = available.length > 1
      ? h('div', { class: 'login-tabs', role: 'tablist', 'aria-label': 'طريقة الدخول' },
        available.map((m) => h('button', { type: 'button', role: 'tab', id: `tab-${m}`, class: `login-tab${m === st.method ? ' on' : ''}`, 'aria-selected': String(m === st.method), 'aria-controls': 'loginPanel',
          onclick: () => { st.method = m; st.msg = ''; store.set(METHOD, m); draw(); } }, icon(METHODS[m].icon), h('span', null, METHODS[m].label))))
      : null;
    const panel = st.method === 'microsoft' ? microsoftPanel() : st.method === 'code' ? codePanel() : pinPanel();
    return [tabs, h('div', { class: 'login-panel', id: 'loginPanel', role: 'tabpanel', 'aria-labelledby': `tab-${st.method}` }, panel)];
  }

  function draw() {
    clearInterval(timer);
    focusSel = null;
    const kids = [
      h('img', { src: '/logo.png', alt: 'جمعية نوى للثقافة والفنون', class: 'arch-logo' }),
      h('h1', null, 'الحضور والطلبات'),
      h('p', { class: 'arch-sub' }, 'جمعية نوى للثقافة والفنون'),
      st.msg ? h('p', { class: 'login-msg', role: 'alert' }, st.msg) : null,
      ...(st.view === 'welcome' ? welcome() : available.length ? methods() : [h('p', { class: 'login-msg', role: 'alert' }, 'لا توجد طريقة دخول مفعّلة. راجع مسؤول النظام.')]),
    ];
    clear(card).append(...kids.filter(Boolean)); // append(null) يكتب كلمة «null» في الصفحة
    if (focusSel) card.querySelector(focusSel)?.focus({ preventScroll: true });
  }
  draw();
}
