import { h, clear, dialog, field, select, toast, confirmBox, copyText, dash } from '../dom.js';
import { get, post } from '../api.js';

const when = (s) => {
  if (!s) return 'لم يتصل بعد';
  const t = new Date(`${s.replace(' ', 'T')}Z`);
  const mins = Math.round((Date.now() - t.getTime()) / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `قبل ${mins} دقيقة`;
  if (mins < 1440) return `قبل ${Math.round(mins / 60)} ساعة`;
  return t.toLocaleDateString('ar-EG-u-nu-latn');
};

function showToken(deviceId, token) {
  const url = `${location.origin}/api/gate`;
  const secret = h('code', { class: 'secret', dir: 'ltr' }, token);
  return dialog({
    title: `رمز الجهاز ${deviceId}`,
    content: h('div', null,
      h('div', { class: 'notice notice-warn' }, 'انسخ الرمز الآن. لا يمكن عرضه مرة أخرى؛ إن ضاع، أنشئ رمزاً جديداً وسيتوقف القديم.'),
      h('p', { class: 'field-label' }, 'الرمز'), h('div', { class: 'secret-row' }, secret, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => copyText(token) }, 'نسخ')),
      h('p', { class: 'field-label' }, 'رابط الخدمة'), h('div', { class: 'secret-row' }, h('code', { class: 'secret', dir: 'ltr' }, url), h('button', { type: 'button', class: 'btn btn-sm', onclick: () => copyText(url) }, 'نسخ')),
      h('p', { class: 'muted' }, 'يُدخلان في إعدادات تطبيق البوابة على هذا الجهاز: رابط الخدمة والرمز.'),
      h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: (e) => e.target.closest('dialog').close() }, 'نسختُ الرمز'))),
  });
}

export default async function render() {
  const { centers } = await get('/api/centers');
  const body = h('div', { class: 'table-wrap' });

  async function load() {
    const { devices } = await get('/api/devices');
    clear(body);
    if (!devices.length) {
      body.append(h('p', { class: 'empty' }, 'لا أجهزة بعد. أنشئ جهازاً لكل بوابة؛ يحصل على رمزه الخاص.'));
      return;
    }
    body.append(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['الجهاز', 'المركز', 'آخر اتصال', 'الحالة', ''].map((t) => h('th', null, t)))),
      h('tbody', null, devices.map((d) => h('tr', { class: d.active ? '' : 'row-off' },
        h('td', null, h('strong', { dir: 'ltr' }, d.id), d.name ? h('div', { class: 'muted small' }, d.name) : null),
        h('td', { class: 'muted' }, dash(d.center)),
        h('td', { class: 'muted' }, when(d.lastSeen)),
        h('td', null, h('span', { class: `chip ${d.active ? 'chip-present' : 'chip-absent'}` }, d.active ? 'فعّال' : 'موقوف')),
        h('td', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => {
            if (!(await confirmBox(`إنشاء رمز جديد للجهاز ${d.id}؟ سيتوقف الرمز الحالي فوراً حتى تُدخل الجديد في الجهاز.`, 'رمز جديد'))) return;
            try {
              const r = await post(`/api/devices/${encodeURIComponent(d.id)}/rotate`);
              showToken(d.id, r.token);
              load();
            } catch (e) {
              toast(e.message, 'err');
            }
          } }, 'رمز جديد'),
          d.active ? h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost', onclick: async () => {
            if (!(await confirmBox(`إيقاف الجهاز ${d.id}؟ سيُرفض كل ما يرسله حتى تنشئ له رمزاً جديداً.`, 'إيقاف', true))) return;
            try {
              await post(`/api/devices/${encodeURIComponent(d.id)}/deactivate`);
              toast('أُوقف الجهاز');
              load();
            } catch (e) {
              toast(e.message, 'err');
            }
          } }, 'إيقاف') : null))))));
  }

  function create() {
    const id = h('input', { required: true, dir: 'ltr', placeholder: 'DEV-01', autocomplete: 'off' });
    const name = h('input', { placeholder: 'بوابة المبنى الرئيسي' });
    const center = select([['', 'بلا مركز'], ...centers.map((c) => [c.id, c.name])], '');
    const err = h('div', { class: 'notice notice-err', hidden: true, role: 'alert' });
    const dlg = dialog({
      title: 'جهاز بوابة جديد',
      content: h('form', { class: 'form-grid', onsubmit: async (e) => {
        e.preventDefault();
        try {
          const r = await post('/api/devices', { id: id.value, name: name.value || null, centerId: center.value === '' ? null : Number(center.value) });
          dlg.close();
          showToken(r.device.id, r.token);
          load();
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
        }
      } },
      field('معرّف الجهاز', id, 'حروف إنجليزية وأرقام وشرطة'), field('الوصف', name), field('المركز', center),
      h('div', { class: 'span-all' }, err),
      h('div', { class: 'dlg-actions span-all' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'إلغاء'), h('button', { type: 'submit', class: 'btn btn-primary' }, 'إنشاء الجهاز'))),
    });
  }

  const page = h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', null, h('h1', null, 'أجهزة البوابة'), h('p', { class: 'sub' }, 'لكل جهاز رمزه الخاص؛ إيقاف جهاز مفقود لا يمس بقية الأجهزة.')),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: create }, 'جهاز جديد')),
    body);
  await load();
  return page;
}
