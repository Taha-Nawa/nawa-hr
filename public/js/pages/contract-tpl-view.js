// تبويب «الصيغ والترويسة»: مكتبة صيغ العقود (نصاً ومظهراً) ومجموعات الترويسة. كل عقد مثبّت على نسخة صيغته.
import { h, dialog, confirmBox, toast, field } from '../dom.js';
import { get, post, patch, del, put } from '../api.js';
import { composeDoc, fmtVars, applyDataStyles } from '../contract-compose.js';
import { blocksPane, fieldsPane, fpPane, constsPane, fmtPane } from './contract-tpl-panes.js';
import { drawHeaders } from './contract-hdr-view.js';
import { wordImportDialog } from './contract-docx-import.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const SAMPLE = { id: 0, seq: 12, name: 'اسم مقدّم الخدمة رباعياً', title: 'السيد', gender: 'ذكر', idno: '900000000', residence: 'دير البلح', phone: '0590000000', email: 'name@example.org', major: 'اللغة العربية', exp: '5 سنوات',
  ctype: 'عرض سعر (استدراج عروض أسعار)', csubject: 'عقد اتفاق على تقديم خدمات تربوية', service: 'تنفيذ جلسات تعليم القراءة والكتابة', project: 'اسم المشروع', partner: 'جهة التعاون', donor: 'اسم الممول',
  subject: 'اللغة العربية', rfqno: 'ص/-26/NAWA', dRfq: '2026-06-15', dOffer: '2026-06-22', dSign: '2026-07-01', dFrom: '2026-07-02', dTo: '2026-10-10',
  pricing: 'تسعير بالجلسة — سعر الجلسة × جلسات اليوم × أيام التنفيذ', rate: 40, sessPerDay: 1, daysBase: 80, daysAct: 80, siteName: 'مركز نوى', siteType: 'أحد مراكز جمعية نوى', area: 'دير البلح',
  bank: 'اسم البنك', iban: 'PS00XXXX0000000000', status: 'موقّع', termType: 'لا يوجد — العقد سارٍ', x: {} };

const PANES = [['text', 'نص العقد'], ['fields', 'حقول الصيغة'], ['fp', 'الطرف الأول'], ['consts', 'الثوابت'], ['fmt', 'التنسيق والتذييل والشعارات'], ['revs', 'النسخ']];

export function drawTemplates({ lists, all }) {
  const root = h('div', { class: 'tp' });
  const sub = h('div', { class: 'tp-sub' });
  const body = h('div');
  root.append(sub, body);
  let mode = 'tpls';
  let data = null;      // {tpls, revs, headers}
  let sel = null;       // معرّف الصيغة المفتوحة
  let draft = null;     // بيانات النسخة قيد التحرير
  let baseline = '';
  let draftRev = null;  // النسخة التي بُني عليها المسودة
  let pane = 'text';
  const dirty = () => draft && JSON.stringify(draft) !== baseline;

  async function load(keepSel) {
    data = await get('/api/contracts/templates');
    if (!keepSel || !data.tpls.some((t) => t.id === sel)) sel = (data.tpls.find((t) => !t.archived) || data.tpls[0])?.id;
    await openTpl(sel);
  }
  async function openTpl(id) {
    sel = id;
    const t = data.tpls.find((x) => x.id === id);
    const { rev } = await get(`/api/contracts/templates/revs/${t.curRev}`);
    const { id: rid, tplId, ver, note, locked, at, ...d } = rev;
    draft = d; draftRev = { id: rid, ver, locked }; baseline = JSON.stringify(draft);
    drawAll();
  }
  async function guardLeave() { return !dirty() || confirmBox('في الصيغة تعديلات لم تُحفظ. تجاهلها؟', 'تجاهل التعديلات', true); }

  function drawSub() {
    sub.replaceChildren(...[['tpls', 'مكتبة الصيغ'], ['hdrs', 'مجموعات الترويسة']].map(([k, t]) => h('button', { type: 'button', class: `ct-tab${mode === k ? ' on' : ''}`, onclick: async () => { if (mode === k || !(await guardLeave())) return; mode = k; if (k === 'tpls') await load(true); else drawAll(); } }, t)));
  }

  function preview() {
    const pick = h('select', { onchange: () => draw() }, h('option', { value: '' }, 'عقد نموذجي'), all.slice().sort((a, b) => (b.seq || 0) - (a.seq || 0)).slice(0, 80).map((r) => h('option', { value: r.id }, `${r.seq || ''} — ${r.name}`)));
    const paper = h('article', { class: 'ct-paper' });
    const draw = () => {
      const r = pick.value ? all.find((x) => String(x.id) === pick.value) : SAMPLE;
      const doc = composeDoc({ contract: r, rev: draft, header: null });
      paper.innerHTML = doc.body;
      for (const [k, v] of Object.entries(fmtVars(doc.fmt))) paper.style.setProperty(k, v);
      applyDataStyles(paper);
    };
    draw();
    dialog({ title: 'معاينة الصيغة (كما هي الآن قبل الحفظ)', wide: true, content: h('div', null, h('div', { class: 'tools' }, field('معاينة على', pick)), paper) });
  }

  async function save() {
    const note = await new Promise((resolve) => {
      const inp = h('input', { type: 'text', maxlength: 120, placeholder: 'مثلاً: تعديل المادة 7' });
      const d = dialog({ title: 'حفظ الصيغة', content: h('div', null,
        h('p', { class: 'dlg-text' }, draftRev.locked ? 'هذه النسخة مستعملة في عقود قائمة، فسيُنشأ منها «نسخة جديدة» ولا يتغيّر أي عقد قائم.' : 'ستُحفظ التعديلات على النسخة الحالية (لم تُستعمل في عقد بعد).'),
        field('ملاحظة على التعديل (اختياري)', inp),
        h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => { d.close(); resolve(null); } }, 'تراجع'), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { d.close(); resolve(inp.value); } }, 'حفظ'))),
      onClose: () => resolve(null) });
    });
    if (note === null) return;
    try {
      const r = await put(`/api/contracts/templates/${sel}/draft`, { data: draft, note });
      toast(r.unchanged ? 'لا تغييرات للحفظ' : `حُفظت الصيغة (النسخة ${r.ver})`);
      await load(true);
    } catch (e) { toast(e.message, 'err'); }
  }

  function revsPane() {
    const mine = data.revs.filter((r) => r.tplId === sel);
    const t = data.tpls.find((x) => x.id === sel);
    return h('div', null,
      h('p', { class: 'hint' }, 'كل عقد مثبّت على نسخته؛ النسخة المستعملة لا تُعدَّل بل يُنشأ منها نسخة جديدة. «استرجاع» يضع نصّ النسخة في المحرّر لتحفظه نسخةً جديدة.'),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['النسخة', 'التاريخ', 'ملاحظة', 'عقود عليها', ''].map((x) => h('th', null, x)))),
        h('tbody', null, mine.map((r) => h('tr', null,
          h('td', null, `${r.ver}${r.id === t.curRev ? ' (الحالية)' : ''}${r.locked ? ' 🔒' : ''}`), h('td', null, String(r.at || '').slice(0, 10)), h('td', null, r.note || '—'), h('td', null, String(r.usage)),
          h('td', null, r.id !== t.curRev ? h('button', { type: 'button', class: 'btn', onclick: async () => {
            if (!(await confirmBox(`يُستبدل ما في المحرّر بنص النسخة ${r.ver}. (لا يُحفظ إلا بزر «حفظ»)`, 'استرجاع'))) return;
            const { rev } = await get(`/api/contracts/templates/revs/${r.id}`);
            const { id, tplId, ver, note, locked, at, ...d } = rev;
            draft = d; pane = 'text'; drawAll(); toast(`وُضعت النسخة ${r.ver} في المحرّر؛ احفظها لتصير الحالية`);
          } }, 'استرجاع') : null)))))));
  }

  function editor() {
    const t = data.tpls.find((x) => x.id === sel);
    const touch = () => { dirtyBadge.hidden = !dirty(); };
    const dirtyBadge = h('span', { class: 'chip chip-late', hidden: !dirty() }, 'تعديلات غير محفوظة');
    const ctx = { touch, lists: lists.lists, preview, wordImport: () => wordImportDialog({ rec: all[0] || {}, fp: draft.fp, onBlocks: (blocks, mode2) => { draft.blocks = mode2 === 'append' ? [...draft.blocks, ...blocks] : blocks; pane = 'text'; drawAll(); touch(); } }) };
    const content = pane === 'text' ? blocksPane(draft, ctx) : pane === 'fields' ? fieldsPane(draft, ctx) : pane === 'fp' ? fpPane(draft, ctx)
      : pane === 'consts' ? constsPane(draft, ctx) : pane === 'fmt' ? fmtPane(draft, ctx) : revsPane();
    return h('div', { class: 'tp-main' },
      h('div', { class: 'tp-head' },
        h('div', null, h('h2', null, t.name), h('p', { class: 'sub' }, `${t.descr || '—'} · النسخة الحالية ${draftRev.ver}${draftRev.locked ? ' (مستعملة)' : ''} · ${t.usage} عقداً${t.archived ? ' · مؤرشفة' : ''}`)),
        h('div', { class: 'tp-act' }, dirtyBadge,
          h('button', { type: 'button', class: 'btn', onclick: preview }, 'معاينة'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, 'حفظ الصيغة'))),
      h('nav', { class: 'ct-tabs' }, PANES.map(([k, l]) => h('button', { type: 'button', class: `ct-tab${pane === k ? ' on' : ''}`, onclick: () => { pane = k; drawAll(); } }, l))),
      content);
  }

  function side() {
    const newTpl = async (copy) => {
      const name = await ask(copy ? 'اسم الصيغة المنسوخة' : 'اسم الصيغة الجديدة', copy ? `${data.tpls.find((x) => x.id === sel).name} — نسخة` : '');
      if (!name) return;
      try {
        const r = await post('/api/contracts/templates', { name, ...(copy ? { fromRev: draftRev.id } : {}) });
        toast('أُنشئت الصيغة');
        data = await get('/api/contracts/templates');
        await openTpl(r.id);
      } catch (e) { toast(e.message, 'err'); }
    };
    const t = data.tpls.find((x) => x.id === sel);
    return h('aside', { class: 'tp-side' },
      h('div', { class: 'tp-bar' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => { if (await guardLeave()) newTpl(false); } }, '＋ صيغة جديدة'), h('button', { type: 'button', class: 'btn', onclick: async () => { if (await guardLeave()) newTpl(true); } }, 'نسخ المحدّدة')),
      h('ul', { class: 'tp-list' }, data.tpls.map((x) => h('li', null, h('button', { type: 'button', class: `tp-item${x.id === sel ? ' on' : ''}${x.archived ? ' arch' : ''}`, onclick: async () => { if (x.id === sel || !(await guardLeave())) return; await openTpl(x.id); } },
        h('strong', null, x.name), h('span', null, `${x.usage} عقداً${x.archived ? ' · مؤرشفة' : ''}`))))),
      h('div', { class: 'tp-bar' },
        h('button', { type: 'button', class: 'btn', onclick: async () => {
          const name = await ask('اسم الصيغة', t.name);
          if (!name) return;
          try { await patch(`/api/contracts/templates/${t.id}`, { name }); data = await get('/api/contracts/templates'); drawAll(); } catch (e) { toast(e.message, 'err'); }
        } }, 'إعادة تسمية'),
        h('button', { type: 'button', class: 'btn', onclick: async () => {
          try { await patch(`/api/contracts/templates/${t.id}`, { archived: !t.archived }); toast(t.archived ? 'أُعيدت الصيغة' : 'أُرشفت الصيغة (لا تظهر للعقود الجديدة)'); data = await get('/api/contracts/templates'); drawAll(); } catch (e) { toast(e.message, 'err'); }
        } }, t.archived ? 'إعادة تفعيل' : 'أرشفة'),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: async () => {
          if (!(await confirmBox(`حذف الصيغة «${t.name}» نهائياً؟`, 'احذف', true))) return;
          try { await del(`/api/contracts/templates/${t.id}`); toast('حُذفت الصيغة'); await load(false); } catch (e) { toast(e.message, 'err'); }
        } }, 'حذف')));
  }

  function drawAll() {
    drawSub();
    if (mode === 'hdrs') { body.replaceChildren(drawHeaders({ headers: data.headers, all, reload: async () => { data = await get('/api/contracts/templates'); drawAll(); } })); return; }
    body.replaceChildren(h('div', { class: 'tp-grid' }, side(), editor()));
  }

  body.append(h('p', { class: 'empty' }, 'جارٍ التحميل…'));
  load(false).catch((e) => body.replaceChildren(h('div', { class: 'notice notice-err' }, e.message)));
  root.guardLeave = guardLeave;
  return root;
}

function ask(title, value) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'text', value, maxlength: 120 });
    const d = dialog({ title, content: h('form', { onsubmit: (e) => { e.preventDefault(); d.close(); resolve(inp.value.trim() || null); } }, field('الاسم', inp),
      h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => { d.close(); resolve(null); } }, 'تراجع'), h('button', { type: 'submit', class: 'btn btn-primary' }, 'موافق'))), onClose: () => resolve(null) });
    setTimeout(() => inp.focus(), 50);
  });
}
