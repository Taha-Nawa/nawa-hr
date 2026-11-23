// محرّر الشعارات: يُستعمل لشعارات الصيغة ولكل مجموعة ترويسة. الهدف {logos, logoCfg}؛ شعار نوى مدمج ويمكن إخفاؤه.
import { h, field, toast } from '../dom.js';
import { post } from '../api.js';
import { NAWA_LOGO, assetUrl } from '../contract-compose.js';

const MAX = 280 * 1024; // حدّ الخادم 300 كيلوبايت (طول data URL)
const uid = () => `lg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** يقرأ ملف صورة ويصغّره إن لزم حتى يتّسع في الحدّ، ويُرجع {data, w, h} */
export function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return reject(new Error('اختر صورة PNG أو JPG'));
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('تعذّرت قراءة الملف'));
    fr.onload = () => {
      const url = fr.result;
      const img = new Image();
      img.onerror = () => reject(new Error('الصورة تالفة'));
      img.onload = () => {
        if (url.length <= MAX && img.naturalWidth <= 1600) return resolve({ data: url, w: img.naturalWidth, h: img.naturalHeight });
        let k = Math.min(1, 1200 / img.naturalWidth);
        for (let i = 0; i < 6; i += 1) {
          const c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const out = file.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.88);
          if (out.length <= MAX) return resolve({ data: out, w: c.width, h: c.height });
          k *= 0.75;
        }
        reject(new Error('الصورة كبيرة جداً حتى بعد التصغير'));
      };
      img.src = url;
    };
    fr.readAsDataURL(file);
  });
}

/** target: {logos: [], logoCfg: {}}؛ onChange يُستدعى بعد كل تعديل */
export function logoEditor(target, onChange) {
  target.logos ||= [];
  target.logoCfg ||= {};
  const host = h('div', { class: 'tp-logos' });
  const cfgOf = (id) => (target.logoCfg[id] ||= {});
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

  function draw() {
    const all = [NAWA_LOGO, ...target.logos.map((l) => ({ ...l, src: assetUrl(l.asset) }))];
    host.replaceChildren(
      h('p', { class: 'hint' }, 'اترك شعار الجمعية ظاهراً وأضف شعار الجهة المموّلة أو الشريكة. الارتفاع بالملّيمتر؛ الترتيب الأصغر أولاً داخل كل جهة (يمين/وسط/يسار).'),
      ...all.map((l) => {
        const o = target.logoCfg[l.id] || {};
        const set = (k, v) => { const c = cfgOf(l.id); if (v === '' || v === null) delete c[k]; else c[k] = v; onChange?.(); };
        const custom = l.id !== 'nawa';
        return h('div', { class: 'tp-logo' },
          h('img', { src: l.src, alt: l.name, class: 'tp-logo-img' }),
          custom ? field('الاسم', h('input', { type: 'text', value: l.name, maxlength: 80, oninput: (e) => { l.name = e.target.value; target.logos.find((x) => x.id === l.id).name = e.target.value; onChange?.(); } })) : h('strong', null, l.name),
          field('الارتفاع (مم)', h('input', { type: 'number', min: 8, max: 60, step: 1, value: o.h ?? l.h, onchange: (e) => set('h', num(e.target.value, l.h)) })),
          field('المحاذاة', h('select', { onchange: (e) => set('align', e.target.value) }, [['right', 'يمين'], ['center', 'وسط'], ['left', 'يسار']].map(([v, t]) => h('option', { value: v, selected: (o.align || l.align) === v }, t)))),
          field('الترتيب', h('input', { type: 'number', min: 0, max: 99, value: o.ord ?? l.ord, onchange: (e) => set('ord', num(e.target.value, l.ord)) })),
          h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!o.hidden, onchange: (e) => set('hidden', e.target.checked ? 1 : '') }), 'إخفاء'),
          custom ? h('button', { type: 'button', class: 'btn btn-danger', onclick: () => { target.logos = target.logos.filter((x) => x.id !== l.id); delete target.logoCfg[l.id]; onChange?.(); draw(); } }, 'حذف') : null);
      }),
      h('div', { class: 'tp-logo-add' },
        h('label', { class: 'btn' }, 'إضافة شعار (PNG أو JPG)',
          h('input', { type: 'file', accept: 'image/png,image/jpeg', class: 'sr-only', onchange: async (e) => {
            const f = e.target.files[0];
            e.target.value = '';
            if (!f) return;
            try {
              const img = await readImage(f);
              const { id } = await post('/api/contracts/assets', { data: img.data });
              target.logos.push({ id: uid(), name: f.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'شعار', asset: id, h: 24, align: 'left', ord: 5 + target.logos.length, w: img.w, ih: img.h });
              onChange?.();
              draw();
            } catch (ex) { toast(ex.message, 'err'); }
          } }))));
  }
  draw();
  return host;
}
