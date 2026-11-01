// رمز QR يُرسم في المتصفح كـ SVG (مكتبة qrcode-generator، رخصة MIT، محمّلة عند الحاجة فقط).
const SVG_NS = 'http://www.w3.org/2000/svg';
let loading = null;

function loadLib() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/js/vendor/qrcode.js';
    s.onload = () => resolve(window.qrcode);
    s.onerror = () => reject(new Error('تعذّر تحميل مولّد الرموز'));
    document.head.append(s);
  });
  return loading;
}

/** يُرجع عنصر SVG لرمز QR يحمل النص المعطى (وضوح عالٍ M، هامش هادئ 4 وحدات). */
export async function qrSvg(text) {
  const qrcode = await loadLib();
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${n + quiet * 2} ${n + quiet * 2}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `رمز QR يفتح ${text}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', n + quiet * 2); bg.setAttribute('height', n + quiet * 2); bg.setAttribute('fill', '#fff');
  const path = document.createElementNS(SVG_NS, 'path');
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  path.setAttribute('d', d); path.setAttribute('fill', '#2a1410');
  svg.append(bg, path);
  return svg;
}
