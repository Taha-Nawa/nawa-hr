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
export function donut(parts, center, size = 168, onPick = null) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = 62, c = 2 * Math.PI * r;
  const root = svg('svg', { viewBox: '0 0 160 160', width: size, height: size, role: 'img', class: 'dg-donut' });
  root.append(svg('circle', { cx: 80, cy: 80, r, fill: 'none', stroke: '#f1e9de', 'stroke-width': 20 }));
  let off = 0;
  if (total > 0) {
    for (const p of parts) {
      if (!p.value) continue;
      const len = (p.value / total) * c;
      const seg = svg('circle', { cx: 80, cy: 80, r, fill: 'none', stroke: COLORS[p.id] || '#999', 'stroke-width': 20, 'stroke-dasharray': `${Math.max(len - 1.5, 0.5)} ${c}`, 'stroke-dashoffset': -off, transform: 'rotate(-90 80 80)', ...(onPick ? { class: 'dg-seg', tabindex: 0, role: 'button', 'aria-label': p.label || p.id } : {}) });
      if (onPick) { seg.addEventListener('click', () => onPick(p.id)); seg.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') onPick(p.id); }); }
      root.append(seg);
      off += len;
    }
  }
  const t1 = svg('text', { x: 80, y: 82, 'text-anchor': 'middle', class: 'dg-big' }); t1.textContent = center.big;
  const t2 = svg('text', { x: 80, y: 102, 'text-anchor': 'middle', class: 'dg-small' }); t2.textContent = center.small;
  root.append(t1, t2);
  return root;
}
