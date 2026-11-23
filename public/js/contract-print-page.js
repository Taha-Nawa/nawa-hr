// صفحة طباعة عقد واحد: ?id=<رقم العقد>. تجلب العقد ونسخة صيغته وترويسته، وتعرض النص على ورق A4 ثم تفتح نافذة الطباعة.
import { contractNo } from './contract-doc.js';
import { composeDoc, headerHTML, fmtVars, footRows, applyDataStyles } from './contract-compose.js';
import { esc } from './contract-doc.js';

const $ = (id) => document.getElementById(id);
const id = Number(new URLSearchParams(location.search).get('id'));
$('printBtn').addEventListener('click', () => window.print());

(async () => {
  try {
    const res = await fetch(`/api/contracts/${id}/doc`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'لا تملك صلاحية عرض العقود — سجّل الدخول من النظام' : 'تعذّر جلب العقد');
    const d = await res.json();
    const r = d.contract;
    const doc = composeDoc(d);
    document.title = `${contractNo(r)} - ${r.name || ''}`;
    for (const [k, v] of Object.entries(fmtVars(doc.fmt))) document.documentElement.style.setProperty(k, v);
    $('doc').innerHTML = doc.body;
    $('hdr').innerHTML = headerHTML(doc.logos);
    $('hdr').hidden = !doc.logos.length;
    applyDataStyles($('sheet'));
    $('ftr').innerHTML = footRows(doc.foot).map((x) => `<div class="ftr-row${x.en ? ' en' : ''}"><span>${esc(x.a)}</span><span>${esc(x.b)}</span></div>`).join('');
    $('sheet').hidden = false;
    $('msg').textContent = `${contractNo(r)} — ${r.name || ''}`;
    await Promise.all([...document.querySelectorAll('.hdr img')].map((img) => (img.complete ? null : new Promise((ok) => { img.onload = ok; img.onerror = ok; }))));
    if (new URLSearchParams(location.search).get('auto') === '1') setTimeout(() => window.print(), 300);
  } catch (e) {
    $('msg').textContent = e.message;
  }
})();
