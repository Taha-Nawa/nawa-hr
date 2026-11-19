/**
 * مطابقة أذونات المغادرة المعتمدة بحركات البوابة (دالة نقية).
 *
 * الطلب نافذة (من–حتى): «من» وقت الخروج المتوقع و«حتى» أقصى وقت للعودة. أول مسح «خروج» خلال السماحية من «من» يُربط بالطلب،
 * ومسح «عودة» بعده يُكمله: تصير نافذة الطلب هي الأوقات الفعلية (فيطابق النموذج المطبوع البوابة).
 *  - done      : خرج وعاد ضمن أقصى مدة معتمدة                  → تُكتب الأوقات الفعلية في الطلب
 *  - over      : المدة الفعلية أطول من المعتمدة                  → لا يُعدَّل الطلب، وترفعه المراجعة للمعتمِد
 *  - exit_only : خرج ولم يعد حتى انتهى اليوم                     → المغادرة من الخروج إلى نهاية الدوام
 *  - open      : خرج ولم يعد واليوم لم ينتهِ                      → لا تغيير بعد
 * خروج بلا طلب مطابق يُرجَع في unmatched لتراجعه الإدارة.
 */
import { toMin, toHHMM } from './attendance.js';

export const TOLERANCE_MIN = 10;

/**
 * @param {{id:number, from:string, to:string}[]} reqs  طلبات معتمدة لليوم؛ from/to = ما طلبه الموظف (HH:MM)
 * @param {string[]} outs   أوقات مسح «خروج»
 * @param {string[]} rets   أوقات مسح «عودة»
 * @param {{ended:boolean, end:string, tolerance?:number}} opt   end = نهاية الدوام
 * @returns {{links:{id:number,state:string,out:string,ret:string|null,minutes:number}[], unmatched:string[]}}
 */
export function matchExits(reqs, outs, rets, { ended, end, tolerance = TOLERANCE_MIN }) {
  const O = outs.map(toMin).sort((a, b) => a - b);
  const R = rets.map(toMin).sort((a, b) => a - b);
  const free = new Map(reqs.map((r) => [r.id, r]));
  const links = [];
  const unmatched = [];
  O.forEach((o, i) => {
    let best = null;
    for (const r of free.values()) {
      const gap = Math.abs(o - toMin(r.from));
      if (gap <= tolerance && (best === null || gap < best.gap)) best = { r, gap };
    }
    if (!best) { unmatched.push(toHHMM(o)); return; }
    free.delete(best.r.id);
    const next = i + 1 < O.length ? O[i + 1] : Infinity;
    const back = R.find((x) => x > o && x < next);
    const max = toMin(best.r.to) - toMin(best.r.from);
    if (back !== undefined) {
      const minutes = back - o;
      links.push({ id: best.r.id, state: minutes <= max ? 'done' : 'over', out: toHHMM(o), ret: toHHMM(back), minutes });
    } else if (ended) {
      const minutes = Math.max(0, toMin(end) - o);
      links.push({ id: best.r.id, state: minutes <= max ? 'exit_only' : 'over', out: toHHMM(o), ret: null, minutes });
    } else {
      links.push({ id: best.r.id, state: 'open', out: toHHMM(o), ret: null, minutes: 0 });
    }
  });
  return { links, unmatched };
}
