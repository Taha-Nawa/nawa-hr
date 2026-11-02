// النسخ الاحتياطي (مسؤول النظام): تنزيل نسخة كاملة من البيانات إلى جهاز الجمعية، وحالة آخر نسخة.
// الملف يُجمَّع في المتصفح من صفحات صغيرة (حدود الخطة المجانية)، ويُضغط gzip إن دعم المتصفح ذلك.
import { h, clear, toast, todayLocal } from '../dom.js';
import { get, post } from '../api.js';
import { fmtStamp } from '../time12.js';
import { pullAll } from '../backup-lib.js';

const VIA = { browser: 'من هذه الصفحة', script: 'من السكربت الدوري' };

async function gzipBlob(text) {
  if (typeof CompressionStream === 'undefined') return { blob: new Blob([text], { type: 'application/json' }), ext: 'json' };
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return { blob: await new Response(stream).blob(), ext: 'json.gz' };
}

const code = (text) => h('pre', { class: 'code-block', dir: 'ltr' }, h('code', null, text));

export default async function render() {
  const statusBox = h('div', { class: 'panel' });
  const actionBox = h('div', { class: 'panel' });
  let info = null;

  function drawStatus() {
    clear(statusBox);
    const last = info.last;
    statusBox.append(
      h('h2', null, 'آخر نسخة احتياطية'),
      last
        ? h('p', null, h('b', null, fmtStamp(last.at)), ` — ${last.rows} سجلاً من ${last.tables} جدولاً (${VIA[last.via] || last.via}، ${last.by})`)
        : h('p', null, 'لم تُؤخذ نسخة احتياطية بعد.'),
      info.due
        ? h('div', { class: 'notice notice-warn', role: 'status' }, last ? `مضى ${info.daysSince} يوماً على آخر نسخة. يُستحسن نسخة كل أسبوع.` : 'البيانات محفوظة في Cloudflare فقط. نزّل أول نسخة الآن واحفظها في مكان مقيَّد عندكم.')
        : h('div', { class: 'notice' }, 'النسخة حديثة.'),
      h('p', { class: 'muted small' }, info.tokenEnabled
        ? 'النسخ الدوري بالسكربت مفعَّل (BACKUP_TOKEN مضبوط).'
        : 'النسخ الدوري بالسكربت غير مفعَّل: يحتاج سرّاً باسم BACKUP_TOKEN (24 حرفاً فأكثر) يُضاف في Cloudflare. النسخ من هذه الصفحة يعمل دون ذلك.'));
  }

  function drawAction() {
    const progress = h('progress', { class: 'bk-progress', max: 1, value: 0, hidden: true, 'aria-label': 'تقدّم النسخ' });
    const label = h('p', { class: 'muted small', role: 'status', 'aria-live': 'polite' });
    const result = h('div');
    const btn = h('button', { type: 'button', class: 'btn btn-primary' }, 'تنزيل نسخة كاملة');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      clear(result);
      progress.hidden = false;
      progress.value = 0;
      label.textContent = 'جارٍ جمع البيانات…';
      try {
        let manifest = null;
        const request = async (p) => (p === '/api/backup/manifest' ? (manifest ||= await get(p)) : get(p));
        const total = Math.max(1, (await request('/api/backup/manifest')).tables.reduce((s, t) => s + t.rows, 0));
        const done = {};
        const backup = await pullAll(request, {
          onProgress: ({ table, done: n }) => {
            done[table] = n;
            progress.value = Math.min(1, Object.values(done).reduce((s, x) => s + x, 0) / total);
            label.textContent = `جارٍ جمع البيانات… (${table})`;
          },
        });
        label.textContent = 'جارٍ تجهيز الملف…';
        const { blob, ext } = await gzipBlob(JSON.stringify(backup));
        const name = `nawa-hr-backup-${todayLocal()}.${ext}`;
        const url = URL.createObjectURL(blob);
        const link = h('a', { href: url, download: name, class: 'btn bk-link' }, `تنزيل الملف مرة أخرى (${name})`);
        link.click();
        progress.value = 1;
        await post('/api/backup/done', { rows: backup.rows, tables: Object.keys(backup.tables).length });
        info = await get('/api/backup/status');
        drawStatus();
        label.textContent = '';
        result.append(
          h('div', { class: 'notice notice-ok', role: 'status' }, `تم تنزيل ${name} (${backup.rows} سجلاً، ${Math.max(1, Math.round(blob.size / 1024))} ك.ب). احفظه في مكان مقيَّد: فيه بيانات شخصية.`),
          link);
        toast('تمت النسخة الاحتياطية');
      } catch (e) {
        label.textContent = '';
        result.append(h('div', { class: 'notice notice-err', role: 'alert' }, `تعذّرت النسخة: ${e.message}`));
      } finally {
        progress.hidden = true;
        btn.disabled = false;
      }
    });
    clear(actionBox).append(
      h('h2', null, 'نسخة كاملة الآن'),
      h('p', { class: 'muted' }, 'ملف واحد فيه الموظفون والحركات والطلبات والأرصدة والإعدادات والمتطوعون والتقارير الشهرية والسجل اليومي وسجل التدقيق. لا يحوي جلسات ولا رموز دخول ولا رموز الأجهزة.'),
      btn, progress, label, result);
  }

  const help = h('section', { class: 'panel' },
    h('h2', null, 'كيف تُحمى البيانات؟'),
    h('ul', { class: 'bullets' },
      h('li', null, h('b', null, 'داخل Cloudflare: '), 'قاعدة البيانات تحتفظ بسجل يمكّن من الرجوع إلى أي لحظة خلال آخر 30 يوماً (Time Travel). هذا خط الدفاع الأول عند خطأ بشري.'),
      h('li', null, h('b', null, 'خارج Cloudflare: '), 'هذه الصفحة تعطيك نسخة تحتفظ بها الجمعية، تنفع إن فُقد الحساب كله أو مضى أكثر من 30 يوماً.'),
      h('li', null, h('b', null, 'تلقائياً: '), 'السكربت tools/backup.mjs يسحب نسخة دورية بدل الضغط اليدوي (شرحه في docs/BACKUP.md).')),
    h('details', null,
      h('summary', null, 'الاسترجاع من ملف نسخة'),
      h('p', { class: 'small' }, 'يحتاج مطوّراً أو من يملك أدوات Cloudflare. يُحوَّل الملف إلى SQL ثم يُنفَّذ على قاعدة البيانات. بعد الاسترجاع أنشئ رموزاً جديدة للأجهزة من صفحة «أجهزة البوابة».'),
      code('node tools/backup.mjs sql nawa-hr-backup-2026-11-02.json.gz > restore.sql\nnpx wrangler d1 execute nawa-hr --remote --file restore.sql')));

  const page = h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'النسخ الاحتياطي'), h('p', { class: 'sub' }, 'نسخة من بيانات الحضور والطلبات تحتفظ بها الجمعية خارج Cloudflare.'))),
    statusBox, actionBox, help);

  try {
    info = await get('/api/backup/status');
  } catch (e) {
    page.append(h('div', { class: 'notice notice-err' }, e.message));
    return page;
  }
  drawStatus();
  drawAction();
  return page;
}
