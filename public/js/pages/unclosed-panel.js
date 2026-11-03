// أيقونة جانبية في لوحة اليوم تفتح درجاً بـ«لم يسجّلوا الانصراف»: من سجّل حضوره في يوم ولم يسجّل انصرافه، يوماً بيوم.
// الأسماء تختفي وحدها حين يُسجَّل الانصراف أو يصحّح اليوم (القائمة محسوبة من نتائج الأيام نفسها).
import { h, clear, icon, select } from '../dom.js';
import { get } from '../api.js';
import { fmt12 } from '../time12.js';
import { dayLabel, movePhrase, badgeOf } from '../unclosed-lib.js';

const PERIODS = [['7', 'آخر 7 أيام'], ['14', 'آخر 14 يوماً'], ['31', 'آخر 31 يوماً']];
const REFRESH_MS = 3 * 60 * 1000;

/** user: المستخدم الحالي، work: إعدادات الدوام (لنافذة التصحيح)، onChange: يُستدعى بعد تصحيح يغيّر نتائج الأيام. */
export function unclosedPanel({ user, work = null, onChange = () => {} }) {
  const canFix = ['hr', 'admin'].includes(user.role);
  let days = '7';
  let data = null;
  let failed = false;
  let isOpen = false;

  const badge = h('span', { class: 'uc-n', hidden: true });
  const tab = h('button', { type: 'button', class: 'uc-tab no-print', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => toggle(true) },
    icon('out'), h('span', { class: 'uc-tab-l' }, 'لم ينصرفوا'), badge);
  const body = h('div', { class: 'uc-body' });
  const closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'إغلاق', onclick: () => toggle(false) }, '✕');
  const period = select(PERIODS, days, { 'aria-label': 'الفترة', onchange: (e) => { days = e.target.value; load(); } });
  const drawer = h('aside', { class: 'uc-drawer no-print', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'uc-title', 'aria-hidden': 'true' },
    h('header', { class: 'uc-head' },
      h('div', null, h('h2', { id: 'uc-title' }, 'لم يسجّلوا الانصراف'), h('p', { class: 'sub' }, 'سجّلوا حضورهم ولم يسجّلوا انصرافهم')),
      closeBtn),
    h('div', { class: 'uc-tools' }, period),
    body,
    h('p', { class: 'uc-foot' }, 'يختفي الاسم تلقائياً حين يُسجَّل الانصراف أو يُصحَّح اليوم.'));
  const back = h('div', { class: 'uc-back no-print', hidden: true, onclick: () => toggle(false) });
  const el = h('div', { class: 'uc-root' }, tab, back, drawer);

  function toggle(on) {
    isOpen = on;
    drawer.classList.toggle('open', on);
    drawer.setAttribute('aria-hidden', String(!on));
    tab.setAttribute('aria-expanded', String(on));
    back.hidden = !on;
    if (on) { load(); closeBtn.focus(); } else tab.focus();
  }
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) toggle(false); });

  async function fix(item, date) {
    const { openManualDialog } = await import('./manual.js'); // عند الحاجة فقط (لا دورة استيراد مع today.js)
    openManualDialog({ employees: [{ id: item.id, name: item.name }], date, work, onDone: async () => { await load(); onChange(); } });
  }

  function row(item, date, isToday) {
    const href = item.kind === 'provider' ? `#/providers/${item.id}` : `#/employees/${item.id}`;
    const left = item.lastType === 'خروج';
    return h('li', { class: `uc-row${left ? ' left' : ''}` },
      h('div', { class: 'uc-who' },
        h('a', { href, class: 'uc-name' }, item.name),
        item.kind === 'provider' ? h('span', { class: 'chip chip-leave uc-tag' }, 'مزوّد خدمة') : null,
        item.center ? h('span', { class: 'uc-center' }, item.center) : null,
        canFix && item.kind === 'employee' && !isToday
          ? h('button', { type: 'button', class: 'btn btn-sm uc-fix', onclick: () => fix(item, date) }, 'صحّح اليوم')
          : null),
      h('div', { class: 'uc-times' }, movePhrase(item, fmt12)));
  }

  function draw() {
    const b = badgeOf(data);
    badge.hidden = !b.n;
    badge.textContent = String(b.n);
    badge.classList.toggle('soft', !b.warn);
    tab.classList.toggle('warn', b.warn);
    const label = failed ? 'لم يسجّلوا الانصراف' : `لم يسجّلوا الانصراف: ${b.n}`;
    tab.title = label;
    tab.setAttribute('aria-label', label);
    clear(body);
    if (failed) { body.append(h('div', { class: 'notice notice-err' }, 'تعذّر تحميل القائمة. ', h('button', { type: 'button', class: 'btn btn-sm', onclick: load }, 'أعد المحاولة'))); return; }
    if (!data) { body.append(h('p', { class: 'loading' }, 'جارٍ التحميل…')); return; }
    if (!data.days.length) { body.append(h('p', { class: 'empty uc-empty' }, icon('check'), 'لا أحد: كل من سجّل حضوره في هذه الفترة سجّل انصرافه.')); return; }
    for (const d of data.days) {
      body.append(h('section', { class: `uc-day${d.isToday ? ' today' : ''}` },
        h('h3', null, dayLabel(d.date, data.today), h('span', { class: 'uc-cnt' }, d.items.length)),
        d.isToday ? h('p', { class: 'uc-hint' }, 'ربما ما زالوا في الدوام؛ تظهر أسماؤهم لتتأكد قبل نهاية اليوم.') : null,
        h('ul', { class: 'uc-list' }, d.items.map((i) => row(i, d.date, d.isToday)))));
    }
  }

  async function load() {
    try {
      data = await get(`/api/unclosed?days=${days}`);
      failed = false;
    } catch {
      failed = true;
    }
    draw();
  }

  draw();
  load();
  const timer = setInterval(() => {
    if (!el.isConnected) { clearInterval(timer); return; } // غادر المستخدم الصفحة
    if (document.visibilityState === 'visible') load();
  }, REFRESH_MS);
  return { el, refresh: load };
}
