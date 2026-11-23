// طباعة عقد (صفحة A4 مستقلة) وتنزيله بصيغة Word.
import { get } from '../api.js';
import { toast } from '../dom.js';
import { buildDocx, wordFileName } from '../contract-word.js';
import { composeDoc } from '../contract-compose.js';

export function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export function printContract(c) {
  const w = window.open(`/contract-print.html?id=${c.id}&auto=1`, '_blank');
  if (!w) toast('المتصفح منع النافذة — اسمح بالنوافذ المنبثقة لهذا الموقع', 'err');
}

export async function wordContract(c) {
  try {
    const d = await get(`/api/contracts/${c.id}/doc`);
    const images = {};
    for (const l of composeDoc(d).logos) {
      try {
        const res = await fetch(l.src, { credentials: 'same-origin' });
        if (res.ok) images[l.id] = new Uint8Array(await res.arrayBuffer());
      } catch { /* يُترك هذا الشعار */ }
    }
    const blob = new Blob([buildDocx(d, images)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    saveBlob(blob, wordFileName(d.contract));
    toast('تم تنزيل ملف Word');
  } catch (e) {
    toast(e.message || 'تعذّر تجهيز الملف', 'err');
  }
}
