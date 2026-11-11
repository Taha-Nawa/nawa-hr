// رسائل البوب للموظفين (الموارد البشرية والمسؤول): نصّ قصير في فانوس يظهر للمستهدفين عند فتح النظام لمدة محددة كالستوري.
import { h, clear, select, toast, confirmBox, field } from '../dom.js';
import { get, post, put, del } from '../api.js';
import { dailyPop } from '../daily-pop.js';
import { SHAPES, ITEMS, KINDS } from '../daily-pop-lib.js';

const DURATIONS = [[24, '24 ساعة'], [72, '3 أيام'], [168, 'أسبوع'], [336, 'أسبوعان'], [720, 'شهر']];
const STATUS = { live: ['سارية', 'present'], ended: ['انتهت', 'none'], revoked: ['مسحوبة', 'absent'], scheduled: ['مجدولة', 'late'] };
const MAX = 400;
const when = (iso) => new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Hebron' }).format(new Date(iso));

export default async function render({ user }) {
  const [emps, cents] = await Promise.all([get('/api/employees').then((r) => r.employees.filter((e) => e.status === 'active')), get('/api/centers').then((r) => r.centers || r.items || [])]);
  const st = { audience: 'all', centers: new Set(), people: new Set(), q: '' };
  const title = h('input', { type: 'text', maxlength: '80', placeholder: 'عنوان قصير (اختياري)' });
  const body = h('textarea', { rows: '4', maxlength: String(MAX), placeholder: 'اكتب رسالتك للموظفين…' });
  const count = h('span', { class: 'muted small' }, `0 من ${MAX}`);
  body.addEventListener('input', () => { count.textContent = `${body.value.length} من ${MAX}`; });
  const dur = select(DURATIONS, 24, { 'aria-label': 'المدة' });
  const aud = h('div', { class: 'seg-tabs', role: 'tablist' });
  const pick = h('div', { class: 'ann-pick' });
  const listBox = h('div', { class: 'ann-list' });

  // شكل البوب: يُعتمد للمؤسسة كلها (لكل الأنواع)، واللون يتبع النوع تلقائياً
  const cur = (await get('/api/pop-style').catch(() => ({ shape: 'lantern' }))).shape;
  let shape = cur;
  const shapeBox = h('div', { class: 'ann-shapes', role: 'radiogroup', 'aria-label': 'شكل البوب' });
  const drawShapes = () => clear(shapeBox).append(...SHAPES.map(([id, name]) => h('button', { type: 'button', class: `ann-shape${shape === id ? ' on' : ''}`, role: 'radio', 'aria-checked': String(shape === id), onclick: () => { shape = id; drawShapes(); } }, name)));
  const sample = (k) => { const it = ITEMS.find((i) => i.k === k); return { kind: k, label: KINDS[k], body: it.t, source: it.s }; };
  const previewShape = h('button', { type: 'button', class: 'btn', onclick: () => dailyPop(user, { preview: true, shape, messages: [sample('quran'), sample('hadith'), sample('wisdom'), { kind: 'msg', label: 'رسالة من الإدارة', title: 'اجتماع عام', body: 'اجتماع الطاقم غداً الساعة العاشرة' }] }) }, 'معاينة الألوان الأربعة');
  const saveShape = h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => { try { await put('/api/pop-style', { shape }); toast('اعتُمد الشكل لكل الموظفين'); } catch (e) { toast(e.message, 'err'); } } }, 'اعتماد هذا الشكل');

  function drawAud() {
    clear(aud).append(...[['all', 'كل الموظفين'], ['center', 'مراكز محددة'], ['employees', 'موظفون بأسمائهم']].map(([k, t]) =>
      h('button', { type: 'button', class: `seg-tab${st.audience === k ? ' on' : ''}`, role: 'tab', 'aria-selected': String(st.audience === k), onclick: () => { st.audience = k; drawAud(); } }, t)));
    clear(pick);
    if (st.audience === 'center') {
      pick.append(...cents.map((c) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.centers.has(c.id), onchange: (e) => { if (e.target.checked) st.centers.add(c.id); else st.centers.delete(c.id); } }), h('span', null, c.name))));
    } else if (st.audience === 'employees') {
      const rows = h('div', { class: 'ec-pick' });
      const info = h('p', { class: 'muted small' });
      const draw = () => {
        const list = emps.filter((e) => !st.q || `${e.name} ${e.code}`.includes(st.q));
        clear(rows).append(...list.map((e) => h('label', { class: 'check ec-pick-row' },
          h('input', { type: 'checkbox', checked: st.people.has(e.id), onchange: (ev) => { if (ev.target.checked) st.people.add(e.id); else st.people.delete(e.id); info.textContent = `${st.people.size} محدَّد`; } }),
          h('span', null, e.name), h('span', { class: 'muted small' }, e.center || ''))));
        info.textContent = `${st.people.size} محدَّد`;
      };
      pick.append(h('input', { type: 'search', class: 'search', placeholder: 'بحث بالاسم', 'aria-label': 'بحث', oninput: (e) => { st.q = e.target.value.trim(); draw(); } }), rows, info);
      draw();
    }
  }

  const payload = () => ({ title: title.value.trim(), body: body.value.trim(), hours: Number(dur.value), audience: st.audience, ids: st.audience === 'center' ? [...st.centers] : st.audience === 'employees' ? [...st.people] : [] });
  const preview = h('button', { type: 'button', class: 'btn', onclick: () => { if (!body.value.trim()) { toast('اكتب نص الرسالة أولاً', 'err'); return; } dailyPop(user, { preview: true, messages: [{ title: title.value.trim(), body: body.value.trim() }] }); } }, 'معاينة الفانوس');
  const send = h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
    const p = payload();
    try { send.disabled = true; await post('/api/announcements', p); toast('نُشرت الرسالة وستظهر للمستهدفين عند فتحهم للنظام'); body.value = ''; title.value = ''; count.textContent = `0 من ${MAX}`; await load(); }
    catch (e) { toast(e.message, 'err'); } finally { send.disabled = false; }
  } }, 'نشر الرسالة');

  async function load() {
    const r = await get('/api/announcements');
    clear(listBox).append(r.items.length ? h('ul', { class: 'plain ann-ul' }, r.items.map((a) => {
      const [t, g] = STATUS[a.status] || [a.status, 'none'];
      return h('li', { class: 'ann-item' },
        h('div', { class: 'ann-top' }, h('span', { class: `chip chip-${g}` }, t), a.title ? h('b', null, a.title) : null,
          a.status === 'live' ? h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => { if (await confirmBox('تُسحب الرسالة فلا تظهر لمن لم يرها بعد. متابعة؟', 'سحب', true)) { await del(`/api/announcements/${a.id}`); toast('سُحبت الرسالة'); load(); } } }, 'سحب') : null),
        h('p', null, a.body),
        h('p', { class: 'muted small' }, `${a.audienceText} · حتى ${when(a.endsAt)} · شاهدها ${a.seen} من ${a.target}`));
    })) : h('p', { class: 'empty' }, 'لم تُنشر رسائل بعد.'));
  }

  drawShapes();
  drawAud();
  await load();
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'رسائل البوب للموظفين'), h('p', { class: 'sub' }, 'رسالة قصيرة في فانوس تظهر للموظفين عند فتح النظام لمدة محددة، ثم تنتهي وحدها'))),
    h('section', { class: 'panel ann-form' },
      h('h2', null, 'شكل البوب'),
      h('p', { class: 'muted' }, 'الآية خضراء، والحديث ذهبي، والحكمة زرقاء، ورسالة الإدارة ياقوتية، بأي شكل تختاره.'),
      shapeBox, h('div', { class: 'row-actions' }, previewShape, saveShape)),
    h('section', { class: 'panel ann-form' },
      h('h2', null, 'رسالة جديدة'),
      field('العنوان', title), field('نص الرسالة', body, count),
      h('div', null, h('label', { class: 'lbl' }, 'تظهر لـ'), aud, pick),
      field('مدة الظهور', dur, 'تُحسب من لحظة النشر، وتظهر للموظف مرة واحدة فقط'),
      h('div', { class: 'row-actions' }, preview, send)),
    h('section', { class: 'panel' }, h('h2', null, 'الرسائل المنشورة'), listBox));
}
