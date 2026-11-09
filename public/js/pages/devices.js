import { h, clear, dialog, field, select, toast, confirmBox, copyText, dash } from '../dom.js';
import { get, post } from '../api.js';
import { fmtStamp } from '../time12.js';

const STATE = {
  ok: ['متصلة', 'chip-present'], silent: ['منقطعة', 'chip-absent'], quiet: ['هادئة: لا حركة اليوم', 'chip-late'],
  off: ['خارج الدوام', ''], never: ['لم تتصل بعد', ''], emergency: ['طارئ معلَن', ''],
};

const when = (s) => {
  if (!s) return 'لم يتصل بعد';
  const t = new Date(`${s.replace(' ', 'T')}Z`);
  const mins = Math.round((Date.now() - t.getTime()) / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `قبل ${mins} دقيقة`;
  if (mins < 1440) return `قبل ${Math.round(mins / 60)} ساعة`;
  return fmtStamp(s);
};

const setupLink = (deviceId, token, center) => {
  const json = JSON.stringify({ d: deviceId, u: `${location.origin}/api/gate`, t: token, ...(center ? { c: center } : {}) });
  const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}/gate/#cfg=${b64}`;
};

const copyRow = (label, value) => h('div', null,
  h('p', { class: 'field-label' }, label),
  h('div', { class: 'secret-row' }, h('code', { class: 'secret', dir: 'ltr' }, value || '—'),
    value ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => copyText(value) }, 'نسخ') : null));

function showToken(deviceId, token, center) {
  const url = `${location.origin}/api/gate`;
  const link = setupLink(deviceId, token, center);
  const secret = h('code', { class: 'secret', dir: 'ltr' }, token);
  return dialog({
    title: `رمز الجهاز ${deviceId}`,
    content: h('div', null,
      h('div', { class: 'notice notice-warn' }, 'انسخ الرمز الآن. لا يمكن عرضه مرة أخرى؛ إن ضاع، أنشئ رمزاً جديداً وسيتوقف القديم.'),
      h('p', { class: 'field-label' }, 'الرمز'), h('div', { class: 'secret-row' }, secret, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => copyText(token) }, 'نسخ')),
      h('p', { class: 'field-label' }, 'رابط الخدمة'), h('div', { class: 'secret-row' }, h('code', { class: 'secret', dir: 'ltr' }, url), h('button', { type: 'button', class: 'btn btn-sm', onclick: () => copyText(url) }, 'نسخ')),
      h('p', { class: 'field-label' }, 'رابط الإعداد الجاهز'), h('div', { class: 'secret-row' }, h('code', { class: 'secret', dir: 'ltr' }, link), h('button', { type: 'button', class: 'btn btn-sm', onclick: () => copyText(link) }, 'نسخ')),
      h('p', { class: 'muted' }, 'افتح «رابط الإعداد الجاهز» على جهاز المركز فيُضبط المركز والمعرّف ورابط النظام ورمزه تلقائياً، أو أدخل الرابط والرمز يدوياً في إعدادات البوابة. الرمز داخل الرابط، فلا ترسله إلا لمن يجهّز الجهاز.'),
      h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: (e) => e.target.closest('dialog').close() }, 'نسختُ الرمز'))),
  });
}

function showDetails(d) {
  return dialog({
    title: `بيانات الجهاز ${d.id}`,
    content: h('div', null,
      copyRow('معرّف الجهاز', d.id),
      copyRow('المركز', d.center),
      copyRow('رابط الخدمة (النظام الجديد)', `${location.origin}/api/gate`),
      copyRow('صفحة البوابة', `${location.origin}/gate/`),
      h('div', { class: 'notice' }, 'رمز الجهاز محفوظ مشفّراً ولا يمكن عرضه. إن نسيته اضغط «رمز جديد» فيظهر رمز جديد مرة واحدة مع رابط إعداد جاهز للنسخ.'),
      h('div', { class: 'notice' }, 'رابط Google ورمزه غير محفوظين في النظام: هما في إعدادات السكربت وعلى الجهاز نفسه. ويُعدَّلان من إعدادات البوابة بالترس.'),
      h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: (e) => e.target.closest('dialog').close() }, 'إغلاق'))),
  });
}

export default async function render() {
  const centersReq = get('/api/centers'); // يُطلب مع قائمة الأجهزة لا قبلها
  const body = h('div', { class: 'table-wrap' });

  let centers = [];
  async function load() {
    const [{ devices }, st] = await Promise.all([get('/api/devices'), get('/api/gates/status').catch(() => ({ devices: [] }))]);
    const state = new Map((st.devices || []).map((d) => [d.id, d.state]));
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
        h('td', { class: 'muted' }, when([d.lastPing, d.lastSeen].filter(Boolean).sort().pop() || null),
          d.lastSeen ? h('div', { class: 'small' }, `آخر حركة: ${when(d.lastSeen)}`) : null),
        h('td', null, d.active && state.get(d.id) && STATE[state.get(d.id)]
          ? h('span', { class: `chip ${STATE[state.get(d.id)][1]}` }, STATE[state.get(d.id)][0])
          : h('span', { class: `chip ${d.active ? 'chip-present' : 'chip-absent'}` }, d.active ? 'فعّال' : 'موقوف')),
        h('td', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn btn-sm', onclick: () => showDetails(d) }, 'البيانات'),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => {
            if (!(await confirmBox(`إنشاء رمز جديد للجهاز ${d.id}؟ سيتوقف الرمز الحالي فوراً حتى تُدخل الجديد في الجهاز.`, 'رمز جديد'))) return;
            try {
              const r = await post(`/api/devices/${encodeURIComponent(d.id)}/rotate`);
              showToken(d.id, r.token, d.center);
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
          showToken(r.device.id, r.token, (centers.find((c) => String(c.id) === center.value) || {}).name);
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
  await Promise.all([centersReq.then((r) => { centers = r.centers; }), load()]);
  return page;
}
