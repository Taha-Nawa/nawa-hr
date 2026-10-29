// قارئ ملفات إكسل (.xlsx) بلا مكتبات: ملف zip فيه XML. يعمل في المتصفح فقط (DecompressionStream + DOMParser).
// يُرجع { الاسم: [[خلية، ...], ...] } حيث الخلية نص أو رقم أو منطقي أو null، والتواريخ بصيغة YYYY-MM-DD.
// يقرأ القيمة المخزّنة (المحسوبة) للصيغ كما حفظها إكسل.

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** يقرأ فهرس ملف zip ويُرجع دالة لجلب محتوى ملف بالاسم (نصاً). */
async function openZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(view, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('الملف ليس بصيغة xlsx صالحة');
  const count = u16(view, eocd + 10);
  let p = u32(view, eocd + 16);
  const entries = new Map();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (u32(view, p) !== 0x02014b50) throw new Error('فهرس الملف تالف');
    const method = u16(view, p + 10);
    const csize = u32(view, p + 20);
    const nameLen = u16(view, p + 28);
    const extraLen = u16(view, p + 30);
    const commentLen = u16(view, p + 32);
    const offset = u32(view, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, csize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return async (name) => {
    const e = entries.get(name);
    if (!e) return null;
    const lh = e.offset;
    const start = lh + 30 + u16(view, lh + 26) + u16(view, lh + 28);
    const raw = bytes.subarray(start, start + e.csize);
    const data = e.method === 0 ? raw : e.method === 8 ? await inflateRaw(raw) : null;
    if (!data) throw new Error('طريقة ضغط غير مدعومة في الملف');
    return dec.decode(data);
  };
}

const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');
const kids = (el, tag) => [...el.getElementsByTagName(tag)];

function sharedStrings(doc) {
  if (!doc) return [];
  return kids(doc, 'si').map((si) => kids(si, 't').map((t) => t.textContent).join(''));
}

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const looksDateFormat = (code) => /[ymd]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''));

/** مصفوفة: فهرس نمط الخلية -> هل هو تاريخ؟ */
function dateStyles(doc) {
  if (!doc) return [];
  const custom = new Map(kids(doc, 'numFmt').map((n) => [Number(n.getAttribute('numFmtId')), n.getAttribute('formatCode') || '']));
  const xfs = doc.getElementsByTagName('cellXfs')[0];
  if (!xfs) return [];
  return [...xfs.children].map((xf) => {
    const id = Number(xf.getAttribute('numFmtId') || 0);
    return BUILTIN_DATE.has(id) || (custom.has(id) && looksDateFormat(custom.get(id)));
  });
}

function serialToDate(n) {
  const ms = Math.round((n - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

function colIndex(ref) {
  let n = 0;
  for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readSheet(doc, strings, isDate) {
  const rows = [];
  for (const row of kids(doc, 'row')) {
    const r = Number(row.getAttribute('r')) - 1;
    const out = [];
    for (const c of kids(row, 'c')) {
      const ref = c.getAttribute('r');
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent;
      let val = null;
      if (t === 's') val = v === undefined ? null : strings[Number(v)] ?? null;
      else if (t === 'inlineStr') val = kids(c, 't').map((x) => x.textContent).join('');
      else if (t === 'str') val = v ?? null;
      else if (t === 'b') val = v === '1';
      else if (t === 'e') val = null;
      else if (v !== undefined && v !== '') {
        const n = Number(v);
        val = isDate[Number(c.getAttribute('s') || 0)] ? serialToDate(n) : n;
      }
      out[ref ? colIndex(ref) : out.length] = val;
    }
    for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = null;
    rows[r] = out;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

export async function readWorkbook(buffer) {
  const read = await openZip(buffer);
  const wbText = await read('xl/workbook.xml');
  if (!wbText) throw new Error('الملف ليس مصنّف إكسل');
  const wb = parseXml(wbText);
  const rels = parseXml(await read('xl/_rels/workbook.xml.rels'));
  const target = new Map(kids(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const strings = sharedStrings(parseXml((await read('xl/sharedStrings.xml')) || '<sst/>'));
  const styles = dateStyles(parseXml((await read('xl/styles.xml')) || '<styleSheet/>'));

  const sheets = {};
  for (const s of kids(wb, 'sheet')) {
    const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id');
    let path = target.get(rid);
    if (!path) continue;
    path = path.startsWith('/') ? path.slice(1) : `xl/${path}`;
    const xml = await read(path);
    if (xml) sheets[s.getAttribute('name')] = readSheet(parseXml(xml), strings, styles);
  }
  return sheets;
}
