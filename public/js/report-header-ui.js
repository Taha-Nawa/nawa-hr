// ترويسات الشعارات في التقرير الشهري: مجموعات مسمّاة (شعارات بموضع يمين/وسط/يسار وعرض)، تُختار عند الطباعة
// ومنها «بلا ترويسة». الاختيار يُحفظ على الجهاز، والافتراضي من المحرّر.
import { h, clear, dialog, field, select, toast, icon } from './dom.js';
import { get, put } from './api.js';

const POS = [['right', 'يمين'], ['center', 'وسط'], ['left', 'يسار']];
const MAX_SIDE = 480; // أكبر ضلع بالبكسل بعد التصغير
const PICK_KEY = 'nawa-report-header';
const NONE = '';

/** الترويسة كعنصر DOM (null إن لا شعارات). RTL: «يمين» هو بداية السطر. */
export function headerBlock(logos) {
  if (!logos?.length) return null;
  const zone = (pos) => h('div', { class: `rh-zone rh-${pos}` }, logos.filter((l) => l.pos === pos).map((l) => h('img', { src: l.data, alt: l.name, style: { width: `${l.width}mm` } })));
  return h('div', { class: 'rh-block' }, zone('right'), zone('center'), zone('left'));
}

export const savedPick = () => { try { return localStorage.getItem(PICK_KEY); } catch { return null; } };
export const savePick = (v) => { try { localStorage.setItem(PICK_KEY, v); } catch { /* غير متاح */ } };
/** معرّف الترويسة الفعلي: اختيار الجهاز إن كان ما زال موجوداً، وإلا الافتراضي، وإلا بلا. */
export function chosenId(header) {
  const p = savedPick();
  if (p === NONE) return NONE;
  if (p && header.sets.some((s) => s.id === p)) return p;
  return header.default && header.sets.some((s) => s.id === header.default) ? header.default : NONE;
}
export const logosOf = (header, id) => header.sets.find((s) => s.id === id)?.logos || [];

// الصورة تُقرأ بـ FileReader كـ data URL لأن سياسة الأمان (CSP) لا تسمح بروابط blob: في img-src.
function shrink(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('تعذّر قراءة الملف'));
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k));
        c.height = Math.max(1, Math.round(img.height * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png')); // PNG يحفظ الشفافية
      };
      img.onerror = () => reject(new Error('تعذّر قراءة الصورة: استعمل PNG أو JPG أو WebP'));
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });
}

export function openHeaderEditor({ header, max, maxSets, onSaved }) {
  const sets = header.sets.map((s) => ({ ...s, logos: s.logos.map((l) => ({ ...l })) }));
  let def = header.default;
  let cur = sets.find((s) => s.id === chosenId(header))?.id || sets[0]?.id || null;
  const body = h('div');
  const err = h('div');

  const curSet = () => sets.find((s) => s.id === cur);
  function draw() {
    const s = curSet();
    clear(body).append(
      h('div', { class: 'rh-sets' },
        sets.map((x) => h('button', { type: 'button', class: `btn btn-sm${x.id === cur ? ' btn-primary' : ''}`, onclick: () => { cur = x.id; draw(); } }, x.name, def === x.id ? ' ★' : '')),
        sets.length < maxSets ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => {
          const id = `h${Date.now().toString(36)}`;
          sets.push({ id, name: `ترويسة ${sets.length + 1}`, logos: [] });
          cur = id;
          draw();
        } }, icon('plus'), 'ترويسة جديدة') : null),
      s ? setEditor(s) : h('p', { class: 'muted' }, 'لا ترويسات محفوظة. أضف ترويسة ثم شعاراتها؛ وعند الطباعة تظل «بلا ترويسة» متاحة دائماً.'),
      err);
  }

  function setEditor(s) {
    const preview = h('div', { class: 'rh-preview' });
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'إضافة شعار' });
    const paint = () => clear(preview).append(headerBlock(s.logos) || h('p', { class: 'muted' }, 'لا شعارات في هذه الترويسة.'));
    const items = h('div', { class: 'rh-edit-list' });
    function drawItems() {
      paint();
      clear(items).append(...s.logos.map((l, i) => h('div', { class: 'rh-item' },
        h('img', { src: l.data, alt: l.name }),
        h('div', { class: 'rh-item-f' },
          field('الموضع', select(POS, l.pos, { onchange: (e) => { l.pos = e.target.value; paint(); } })),
          field(`العرض: ${l.width} مم`, h('input', { type: 'range', min: '8', max: '90', step: '1', value: String(l.width), oninput: (e) => { l.width = Number(e.target.value); paint(); e.target.closest('label').querySelector('.field-label').textContent = `العرض: ${l.width} مم`; } }))),
        h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost', onclick: () => { s.logos.splice(i, 1); drawItems(); } }, icon('trash'), 'حذف'))));
    }
    file.addEventListener('change', async () => {
      const f = file.files[0];
      file.value = '';
      if (!f) return;
      if (s.logos.length >= max) return toast(`الحد الأقصى ${max} شعارات`, 'err');
      try {
        const data = await shrink(f);
        if (data.length > 150_000) throw new Error('الصورة معقّدة وكبيرة، استعمل شعاراً أبسط أو أصغر');
        s.logos.push({ name: f.name.replace(/\.[^.]+$/, '').slice(0, 40), data, pos: s.logos.length === 0 ? 'right' : 'left', width: 30 });
        drawItems();
      } catch (e) {
        toast(e.message, 'err');
      }
    });
    drawItems();
    return h('div', { class: 'rh-set' },
      h('div', { class: 'rh-set-head' },
        field('اسم الترويسة', h('input', { value: s.name, maxlength: '40', oninput: (e) => { s.name = e.target.value; } })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: def === s.id, onchange: (e) => { def = e.target.checked ? s.id : null; } }), ' الافتراضية'),
        h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost', onclick: () => {
          sets.splice(sets.indexOf(s), 1);
          if (def === s.id) def = null;
          cur = sets[0]?.id || null;
          draw();
        } }, icon('trash'), 'حذف الترويسة')),
      preview, items, field('إضافة شعار', file));
  }

  const save = h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
    save.disabled = true;
    try {
      const r = await put('/api/report-header', { sets, default: def });
      toast('حُفظت الترويسات');
      d.close();
      onSaved(r.header);
    } catch (e) {
      clear(err).append(h('div', { class: 'notice notice-err' }, e.message));
      save.disabled = false;
    }
  } }, 'حفظ');
  const d = dialog({
    title: 'ترويسات الشعارات',
    wide: true,
    content: h('div', null,
      h('p', { class: 'muted' }, `احفظ حتى ${maxSets} ترويسات بأسماء (مثلاً: رسمية، للممولين)، وفي كل منها حتى ${max} شعارات بموضع وعرض. عند الطباعة تختار إحداها أو «بلا ترويسة».`),
      body,
      h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'إلغاء'), save)),
  });
  draw();
}

/** قائمة الاختيار عند الطباعة: بلا ترويسة + المحفوظة. onPick(logos) يُستدعى عند التغيير. */
export function headerPicker(header, onPick) {
  const opts = [[NONE, 'بلا ترويسة'], ...header.sets.map((s) => [s.id, s.name])];
  const sel = select(opts, chosenId(header), { 'aria-label': 'الترويسة', onchange: (e) => { savePick(e.target.value); onPick(logosOf(header, e.target.value)); } });
  return h('label', { class: 'rh-pick' }, h('span', null, 'الترويسة'), sel);
}

export async function loadHeader() {
  try {
    return await get('/api/report-header');
  } catch {
    return { header: { sets: [], default: null }, canEdit: false, max: 4, maxSets: 6 };
  }
}
