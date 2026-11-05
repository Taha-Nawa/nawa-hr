// جولة قصيرة لمرة واحدة بحسب الدور بعد أول دخول، تُغلق ولا تعود على هذا الجهاز. تُفتح يدوياً من صفحة حسابي لاحقاً إن لزم.
import { h, dialog, icon } from './dom.js';

const KEY = 'nawa-tour-v1';
const STEPS = {
  employee: [['today', 'يومك', 'من «اليوم» ترى حضورك وانصرافك وتقدّم طلباً بنقرة.'], ['inbox', 'الطلبات', 'قدّم إجازة أو مغادرة أو تأخيراً، وتابع حالة طلبك.'], ['report', 'تقريرك الشهري', 'سجّل ما أنجزته يومياً ثم قدّم تقريرك قبل نهاية الشهر.']],
  manager: [['inbox', 'بانتظار قراري', 'طلبات فريقك تصلك هنا، ويمكنك اعتماد عدة طلبات دفعة واحدة.'], ['users', 'فريقك', 'تابع حضور فريقك واتجاهاته من «المراجعة والاتجاهات».'], ['search', 'بحث سريع', 'اضغط Ctrl+K للوصول إلى أي صفحة أو موظف.']],
  hr: [['today', 'لوحة اليوم', 'حضور الجميع اليوم، و«لم ينصرفوا» من الجانب.'], ['check', 'المراجعة', 'سلامة البيانات وتسوية الممولين والأنماط المتكررة.'], ['report', 'التقارير', 'التايم شيت بمعاينة قبل الطباعة.'], ['search', 'بحث سريع', 'Ctrl+K للوصول لأي شيء، والجرس لما ينتظرك.']],
};
STEPS.director = STEPS.hr;
STEPS.admin = STEPS.hr;

export function maybeTour(role) {
  try { if (localStorage.getItem(KEY) === '1') return; } catch { /* غير متاح */ }
  const steps = STEPS[role];
  if (!steps) return;
  let i = 0;
  const body = h('div', { class: 'tour' });
  const done = () => { try { localStorage.setItem(KEY, '1'); } catch { /* غير متاح */ } };
  const draw = () => {
    const [ic, title, text] = steps[i];
    const last = i === steps.length - 1;
    body.replaceChildren(
      h('div', { class: 'tour-ico' }, icon(ic)), h('h3', null, title), h('p', null, text),
      h('div', { class: 'dlg-actions' },
        h('span', { class: 'muted' }, `${i + 1} / ${steps.length}`),
        h('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'تخطّي'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { if (last) d.close(); else { i += 1; draw(); } } }, last ? 'ابدأ' : 'التالي')));
  };
  const d = dialog({ title: 'مرحباً بك في نظام نوى', content: body, onClose: done });
  draw();
}
