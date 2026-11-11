// رسوم SVG صغيرة للوحة اليوم بألوان الجمعية (بلا مكتبات). كل دالة تعيد عنصر SVG جاهزاً.
const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const k of kids.flat()) if (k) el.append(k);
  return el;
}

/** ألوان المجموعات (تطابق chip-*): حاضر زيتوني، متأخر ذهبي، غياب أحمر، إجازة أزرق، عطلة وردي، بلا تسجيل رمادي. */
export const COLORS = { present: '#3f5a24', late: '#e6a901', absent: '#a21008', leave: '#34557d', off: '#ff9798', none: '#cdbfb2' };

/** حلقة نسب: parts = [{id, value}], center = {big, small}. */
export function donut(parts, center, size = 168) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = 62, c = 2 * Math.PI * r;
  const root = svg('svg', { viewBox: '0 0 160 160', width: size, height: size, role: 'img', class: 'dg-donut' });
  root.append(svg('circle', { cx: 80, cy: 80, r, fill: 'none', stroke: '#f1e9de', 'stroke-width': 20 }));
  let off = 0;
  if (total > 0) {
    for (const p of parts) {
      if (!p.value) continue;
      const len = (p.value / total) * c;
      root.append(svg('circle', { cx: 80, cy: 80, r, fill: 'none', stroke: COLORS[p.id] || '#999', 'stroke-width': 20, 'stroke-dasharray': `${Math.max(len - 1.5, 0.5)} ${c}`, 'stroke-dashoffset': -off, transform: 'rotate(-90 80 80)' }));
      off += len;
    }
  }
  const t1 = svg('text', { x: 80, y: 82, 'text-anchor': 'middle', class: 'dg-big' }); t1.textContent = center.big;
  const t2 = svg('text', { x: 80, y: 102, 'text-anchor': 'middle', class: 'dg-small' }); t2.textContent = center.small;
  root.append(t1, t2);
  return root;
}

/** أعمدة مكدّسة لاتجاه الأيام: days = [{label, present, late, absent, leave}]، الأحدث في اليسار (RTL: الأقدم يميناً). */
export function trendBars(days, { height = 120, width = 420 } = {}) {
  const n = Math.max(days.length, 1);
  const gap = 4, bw = Math.max(6, (width - gap * (n - 1)) / n);
  const max = Math.max(1, ...days.map((d) => d.present + d.late + d.absent + d.leave));
  const root = svg('svg', { viewBox: `0 0 ${width} ${height + 16}`, class: 'dg-trend', role: 'img', preserveAspectRatio: 'none' });
  days.forEach((d, i) => {
    const x = width - (i + 1) * bw - i * gap; // أقدم يوم عند اليمين
    let y = height;
    for (const id of ['present', 'late', 'leave', 'absent']) {
      const hgt = (d[id] / max) * height;
      if (hgt <= 0) continue;
      y -= hgt;
      root.append(svg('rect', { x, y, width: bw, height: hgt, rx: 2, fill: COLORS[id] }));
    }
    if (!d.present && !d.late && !d.absent && !d.leave) root.append(svg('rect', { x, y: height - 2, width: bw, height: 2, fill: COLORS.none }));
    if (i % Math.ceil(n / 7) === 0 || i === n - 1) { const t = svg('text', { x: x + bw / 2, y: height + 13, 'text-anchor': 'middle', class: 'dg-axis' }); t.textContent = d.label; root.append(t); }
  });
  return root;
}
