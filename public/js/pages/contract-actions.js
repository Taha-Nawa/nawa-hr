// طباعة عقد (صفحة A4 مستقلة) وتنزيله بصيغة Word.
import { get } from '../api.js';
import { toast } from '../dom.js';
import { buildDocx, wordFileName } from '../contract-word.js';

export function printContract(c) {
  const w = window.open(`/contract-print.html?id=${c.id}&auto=1`, '_blank');
  if (!w) toast('المتصفح منع النافذة — اسمح بالنوافذ المنبثقة لهذا الموقع', 'err');
}

export async function wordContract(c) {
  try {
    const { contract: r } = await get(`/api/contracts/${c.id}`);
    let logo = null;
    try {
      const res = await fetch('/logo.png');
      if (res.ok) logo = { bytes: new Uint8Array(await res.arrayBuffer()), hMm: 24 };
    } catch { /* بلا شعار */ }
    const blob = new Blob([buildDocx(r, { logo })], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = wordFileName(r);
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast('تم تنزيل ملف Word');
  } catch (e) {
    toast(e.message || 'تعذّر تجهيز الملف', 'err');
  }
}
