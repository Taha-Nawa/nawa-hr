/** المسافة بالأمتار بين نقطتين (هافرساين). */
export function distanceM(a, b) {
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export const validLat = (v) => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
export const validLng = (v) => typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;

/**
 * يحلّل حركات يوم لموظف مقابل موقع مركزه ونصف قطره.
 * moves: [{lat,lng}|{lat:null}] بترتيب الوقت؛ center: {lat,lng,radius}|null
 * يُرجع علامات: outside (أبعد حركة عن المركز > النصف)، spread (أكبر بعد بين حركتين > النصف)، partial (بعضها بلا موقع)، maxFromCenter، maxSpread.
 */
export function judgeDay(moves, center) {
  const located = moves.filter((m) => validLat(m.lat) && validLng(m.lng));
  const out = { located: located.length, total: moves.length, outside: false, spread: false, partial: located.length > 0 && located.length < moves.length, maxFromCenter: null, maxSpread: 0 };
  if (center && validLat(center.lat) && validLng(center.lng)) {
    const d = located.map((m) => distanceM(center, m));
    if (d.length) {
      out.maxFromCenter = Math.round(Math.max(...d));
      out.outside = out.maxFromCenter > center.radius;
    }
  }
  const radius = center?.radius ?? 150;
  for (let i = 0; i < located.length; i++) for (let j = i + 1; j < located.length; j++) out.maxSpread = Math.max(out.maxSpread, distanceM(located[i], located[j]));
  out.maxSpread = Math.round(out.maxSpread);
  out.spread = out.maxSpread > radius;
  return out;
}
