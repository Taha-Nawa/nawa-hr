// صفحة طباعة عقد واحد: ?id=<رقم العقد>. تجلب العقد وتعرض نصه على ورق A4 ثم تفتح نافذة الطباعة.
import { contractBody, contractNo, FP } from './contract-doc.js';

const $ = (id) => document.getElementById(id);
const id = Number(new URLSearchParams(location.search).get('id'));
$('printBtn').addEventListener('click', () => window.print());

(async () => {
  try {
    const res = await fetch(`/api/contracts/${id}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'لا تملك صلاحية عرض العقود — سجّل الدخول من النظام' : 'تعذّر جلب العقد');
    const { contract: r } = await res.json();
    document.title = `${contractNo(r)} - ${r.name || ''}`;
    $('doc').innerHTML = contractBody(r);
    $('fAddr').textContent = `العنوان: ${FP.addr}`;
    $('fFax').textContent = `تلفاكس: ${FP.fax}`;
    $('fAddrEn').textContent = `Address: ${FP.addrEn}`;
    $('fTel').textContent = `Telefax: ${FP.tel}`;
    $('sheet').hidden = false;
    $('msg').textContent = `${contractNo(r)} — ${r.name || ''}`;
    const img = document.querySelector('.hdr img');
    if (img && !img.complete) await new Promise((ok) => { img.onload = ok; img.onerror = ok; });
    if (new URLSearchParams(location.search).get('auto') === '1') setTimeout(() => window.print(), 300);
  } catch (e) {
    $('msg').textContent = e.message;
  }
})();
