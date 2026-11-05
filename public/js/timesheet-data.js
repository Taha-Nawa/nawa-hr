// جلب التايم شيت من الخادم على دفعات (الحد 25 موظفاً في الطلب) — مشترك بين صفحة التقارير والمعاينة المطبوعة.
import { get } from './api.js';

export const CHUNK = 25;
export const NOTE = {
  no_allocation: 'لا يوجد توزيع على ممول في هذا الشهر — صفوف الممولين فارغة (أضف التوزيع من صفحة الموظف).',
  too_many_funders: 'أكثر من 6 مشاريع متزامنة في هذا الشهر — يُعرض أول 6 فقط.',
};

export async function fetchTimesheets(month, ids) {
  const sheets = [];
  let approver = '';
  for (let i = 0; i < ids.length; i += CHUNK) {
    const r = await get(`/api/reports/timesheet?month=${encodeURIComponent(month)}&employees=${ids.slice(i, i + CHUNK).join(',')}`);
    sheets.push(...r.sheets);
    approver = r.approver || approver;
  }
  return { sheets, approver };
}

export async function loadLogo() {
  try {
    const r = await fetch('/logo.png');
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : undefined;
  } catch {
    return undefined;
  }
}
