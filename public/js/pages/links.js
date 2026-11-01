import { h, clear, dialog, field, select, toast, confirmBox, copyText, icon } from '../dom.js';
import { get, put } from '../api.js';
import { qrSvg } from '../qr.js';
import { canInstall, promptInstall, isStandalone, isIOS } from '../pwa.js';

const AUDIENCE = {
  all: { label: 'كل المستخدمين', chip: 'chip-present' },
  staff: { label: 'الإدارة (موارد بشرية، مدير عام، مسؤول)', chip: 'chip-leave' },
  admin: { label: 'المسؤول فقط', chip: 'chip-late' },
};
const STAFF_ROLES = ['hr', 'director', 'admin'];
const GATE_GROUP = 'البوابة';

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** بطاقة رابط واحد */
function card(link, { manage, onEdit }) {
  return h('li', { class: 'link-card' },
    h('div', { class: 'link-main' },
      h('a', { class: 'link-title', href: link.url, target: '_blank', rel: 'noopener noreferrer' }, link.title, h('span', { class: 'sr-only' }, ' (يفتح في تبويب جديد)')),
      h('div', { class: 'link-host', dir: 'ltr' }, hostOf(link.url)),
      link.note ? h('p', { class: 'link-note' }, link.note) : null,
      manage ? h('span', { class: `chip ${AUDIENCE[link.audience].chip}` }, AUDIENCE[link.audience].label) : null),
    h('div', { class: 'link-actions' },
      h('a', { class: 'btn btn-sm btn-primary', href: link.url, target: '_blank', rel: 'noopener noreferrer' }, 'فتح'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => copyText(link.url) }, 'نسخ'),
      manage ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => onEdit(link) }, 'تعديل') : null));
}

/** بطاقة رابط خدمة البوابة: يُحسب من عنوان هذا النظام نفسه فلا يُخزَّن ولا يتقادم */
function gateCard(user) {
  const url = `${location.origin}/api/gate`;
  return h('li', { class: 'link-card link-pinned' },
    h('div', { class: 'link-main' },
      h('div', { class: 'link-title' }, 'رابط خدمة البوابة (للصقه في إعدادات الجهاز)'),
      h('div', { class: 'link-host', dir: 'ltr' }, url),
      h('p', { class: 'link-note' }, 'يُدخل مع رمز الجهاز في حقل «النظام الجديد» داخل إعدادات صفحة تسجيل الحضور. الرمز نفسه لا يُعرض هنا.')),
    h('div', { class: 'link-actions' },
      h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => copyText(url) }, 'نسخ الرابط'),
      user.role === 'admin' ? h('a', { class: 'btn btn-sm', href: '#/devices' }, 'أجهزة البوابة') : null));
}


/** قسم «التطبيق على الجوال والتابلت»: خطوات التثبيت لكل جهاز + رموز QR تُفتح بكاميرا الجوال */
function installSection(user) {
  const appUrl = `${location.origin}/`;
  const gateUrl = `${location.origin}/gate/`;
  const showGate = STAFF_ROLES.includes(user.role);
  const targets = [{ title: 'نظام الحضور والطلبات', url: appUrl }, ...(showGate ? [{ title: 'بوابة الحضور (جهاز المدخل)', url: gateUrl }] : [])];

  const qrRow = h('div', { class: 'qr-row' });
  for (const t of targets) {
    const box = h('div', { class: 'qr-card' }, h('b', null, t.title), h('span', { dir: 'ltr' }, t.url));
    qrSvg(t.url).then((svg) => box.prepend(svg), () => box.prepend(h('p', { class: 'small muted' }, 'تعذّر رسم الرمز')));
    qrRow.append(box);
  }

  const installBtn = h('button', { type: 'button', class: 'btn btn-primary', hidden: true, onclick: async () => {
    if (await promptInstall()) toast('تم تثبيت التطبيق');
    refreshBtn();
  } }, icon('download'), 'تثبيت التطبيق على هذا الجهاز');
  const refreshBtn = () => { installBtn.hidden = !canInstall() || isStandalone(); };
  window.addEventListener('nawa:installable', refreshBtn);
  window.addEventListener('nawa:installed', refreshBtn);
  refreshBtn();

  return h('section', { class: 'install' },
    h('div', { class: 'install-head' }, icon('phone'),
      h('div', null, h('h2', null, 'التطبيق على الجوال والتابلت'),
        h('p', { class: 'sub' }, isStandalone() ? 'أنت تستعمل التطبيق المثبّت الآن.' : 'يعمل على أندرويد وآيفون وآيباد بلا متجر تطبيقات، ويظهر على الشاشة الرئيسية كأي تطبيق.'))),
    installBtn,
    h('div', { class: 'install-grid' },
      h('article', { class: 'install-card' },
        h('h3', null, icon('phone'), 'أندرويد (Chrome)'),
        h('ol', null,
          h('li', null, 'افتح رابط النظام في متصفح Chrome.'),
          h('li', null, 'اضغط زر «تثبيت التطبيق على هذا الجهاز» أعلاه، أو القائمة ⋮ ثم «تثبيت التطبيق».'),
          h('li', null, 'ستجد الأيقونة على الشاشة الرئيسية.'))),
      h('article', { class: `install-card${isIOS() ? ' link-pinned' : ''}` },
        h('h3', null, icon('phone'), 'آيفون وآيباد (Safari)'),
        h('ol', null,
          h('li', null, 'افتح الرابط في متصفح Safari (لا في تطبيقات أخرى).'),
          h('li', null, 'اضغط زر المشاركة ', icon('share'), ' ثم «إضافة إلى الشاشة الرئيسية».'),
          h('li', null, 'اضغط «إضافة»، ثم افتحه من الأيقونة الجديدة.')))),
    h('div', null, h('h3', null, 'افتحه على جوالك بمسح الرمز'), h('p', { class: 'sub' }, 'وجّه كاميرا الجوال نحو الرمز لفتح الرابط مباشرة.')),
    qrRow,
    showGate ? h('p', { class: 'notice notice-warn' }, 'بوابة الحضور على جهاز جديد: افتح رابطها وثبّتها، ثم أدخل إعدادات الجهاز مرة واحدة (اسم البوابة ومعرّف الجهاز ورابط Google ورمزه، ورمز جهاز النظام الجديد). رابط النظام الجديد يُملأ تلقائياً.') : null);
}

export default async function render({ user }) {
  const out = h('div', { class: 'link-groups' });
  let state = { canManage: false, links: [] };

  async function save(next, okMessage) {
    const r = await put('/api/links', { links: next });
    state.links = r.links;
    toast(okMessage);
    draw();
  }

  function editor(existing) {
    const title = h('input', { required: true, maxlength: 120, value: existing?.title ?? '', placeholder: 'مثال: ملف الإدارة (Google Sheets)' });
    const url = h('input', { required: true, type: 'url', dir: 'ltr', maxlength: 600, value: existing?.url ?? '', placeholder: 'https://', autocomplete: 'off' });
    const groups = [...new Set(state.links.map((l) => l.group))];
    const list = h('datalist', { id: 'link-groups' }, groups.map((g) => h('option', { value: g })));
    const group = h('input', { maxlength: 60, value: existing?.group ?? '', list: 'link-groups', placeholder: 'مثال: الملفات' });
    const note = h('textarea', { rows: 2, maxlength: 300, placeholder: 'متى يُستعمل، ومن يملكه، وأي حساب يلزم لفتحه' }, existing?.note ?? '');
    const audience = select(Object.entries(AUDIENCE).map(([v, a]) => [v, a.label]), existing?.audience ?? 'staff');
    const err = h('div', { class: 'notice notice-err', hidden: true, role: 'alert' });

    const dlg = dialog({
      title: existing ? 'تعديل الرابط' : 'رابط جديد',
      content: h('form', { class: 'form-grid', onsubmit: async (e) => {
        e.preventDefault();
        const item = { id: existing?.id, title: title.value, url: url.value, group: group.value, note: note.value, audience: audience.value };
        const next = existing ? state.links.map((l) => (l.id === existing.id ? item : l)) : [...state.links, item];
        try {
          await save(next, existing ? 'حُفظ التعديل' : 'أُضيف الرابط');
          dlg.close();
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
        }
      } },
      field('العنوان', title), field('الرابط', url, 'عنوان كامل يبدأ بـ https'),
      field('المجموعة', group, 'تُجمع البطاقات تحت هذا الاسم'), field('من يراه', audience),
      h('div', { class: 'span-all' }, field('ملاحظة', note)),
      list,
      h('div', { class: 'span-all' }, err),
      h('div', { class: 'dlg-actions span-all' },
        existing ? h('button', { type: 'button', class: 'btn btn-danger-ghost', onclick: async () => {
          if (!(await confirmBox(`حذف الرابط «${existing.title}» من القائمة؟ لا يُحذف الملف أو الموقع نفسه.`, 'حذف', true))) return;
          try {
            await save(state.links.filter((l) => l.id !== existing.id), 'حُذف الرابط');
            dlg.close();
          } catch (ex) {
            toast(ex.message, 'err');
          }
        } }, 'حذف') : null,
        h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'إلغاء'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, 'حفظ'))),
    });
  }

  function draw() {
    clear(out);
    const byGroup = new Map();
    for (const l of state.links) {
      if (!byGroup.has(l.group)) byGroup.set(l.group, []);
      byGroup.get(l.group).push(l);
    }
    // بطاقة رابط الخدمة تتصدر مجموعة «البوابة» (وتُنشئها إن لم يبقَ فيها شيء)
    const pinned = STAFF_ROLES.includes(user.role);
    if (pinned && !byGroup.has(GATE_GROUP)) byGroup.set(GATE_GROUP, []);
    const names = [...byGroup.keys()].sort((a, b) => (b === GATE_GROUP && pinned) - (a === GATE_GROUP && pinned));
    for (const name of names) {
      out.append(h('section', { class: 'link-group' },
        h('h2', null, name),
        h('ul', { class: 'link-grid plain' },
          pinned && name === GATE_GROUP ? gateCard(user) : null,
          byGroup.get(name).map((l) => card(l, { manage: state.canManage, onEdit: editor })))));
    }
    if (!state.links.length && !STAFF_ROLES.includes(user.role)) {
      out.append(h('p', { class: 'empty' }, 'لا توجد روابط متاحة لدورك حالياً.'));
    } else if (!state.links.length && state.canManage) {
      out.append(h('p', { class: 'empty' }, 'القائمة فارغة. أضف أول رابط من الزر أعلاه.'));
    }
  }

  const addBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => editor(null), hidden: true }, 'رابط جديد');
  const page = h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', null, h('h1', null, 'الروابط'), h('p', { class: 'sub' }, 'كل روابط التشغيل في مكان واحد: البوابة، الملفات، المجلدات، والمستودعات.')),
      addBtn),
    out,
    installSection(user));

  state = await get('/api/links');
  addBtn.hidden = !state.canManage;
  draw();
  return page;
}
