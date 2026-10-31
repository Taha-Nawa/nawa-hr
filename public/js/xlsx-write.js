// كاتب مصنّفات إكسل (xlsx) صغير بلا اعتماديات: ملفات zip بلا ضغط (stored) تفتحها Excel وLibreOffice وGoogle Sheets.
// دوال نقية بلا DOM، فتعمل في المتصفح وفي الخادم وفي اختبارات Node.
//
// buildXlsx({ sheets: [{ name, cols:{A:31.6,...}, rowHeights:{2:98}, cells:{ 'A1': {v:'نص'|رقم|null, s:'اسم النمط'}, ... },
//                        merges:['A1:AH1'], landscape:true, image:{ png:Uint8Array, from:{col,row}, size:{w,h} } }] }) -> Uint8Array

const enc = new TextEncoder();

// ---------------------------------------------------------------- الأنماط (ثابتة، يُشار إليها بالاسم)
const FONTS = [
  '<font><sz val="11"/><name val="Arial"/></font>', // 0
  '<font><b/><sz val="11"/><name val="Georgia"/></font>', // 1 عناوين
  '<font><sz val="10"/><name val="Georgia"/></font>', // 2 تسميات
  '<font><b/><sz val="14"/><name val="Georgia"/></font>', // 3 عنوان كبير
];
const FILLS = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', '<fill><patternFill patternType="solid"><fgColor rgb="FFF2DCDB"/><bgColor indexed="64"/></patternFill></fill>'];
const THIN = '<left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/>';
const BORDERS = ['<border><left/><right/><top/><bottom/><diagonal/></border>', `<border>${THIN}</border>`, '<border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>'];
const NUMFMTS = { 164: '0.0#', 165: '0%' };

// name -> [fontId, fillId, borderId, numFmtId, horizontal, wrap]
const STYLES = {
  default: [0, 0, 0, 0, null, false],
  title: [3, 0, 0, 0, 'center', false],
  center: [0, 0, 0, 0, 'center', false],
  underlined: [0, 0, 2, 0, 'center', false],
  labelC: [1, 0, 0, 0, 'center', false],
  head: [1, 2, 1, 0, 'center', true],
  headNum: [0, 2, 1, 0, 'center', true],
  label: [2, 0, 1, 0, 'left', true],
  labelFill: [1, 2, 1, 0, 'right', true],
  pct: [0, 0, 1, 165, 'center', true],
  hours: [0, 0, 1, 164, 'center', true],
  hoursFill: [0, 2, 1, 164, 'center', true],
  boxFill: [1, 2, 1, 0, 'center', true],
  boxText: [0, 0, 1, 0, 'center', true],
  boxLeft: [0, 0, 1, 0, 'left', true],
};
const STYLE_IDS = Object.keys(STYLES);
const styleId = (name) => {
  const i = STYLE_IDS.indexOf(name || 'default');
  if (i < 0) throw new Error(`نمط غير معروف: ${name}`);
  return i;
};

const stylesXml = () =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  `<numFmts count="${Object.keys(NUMFMTS).length}">${Object.entries(NUMFMTS).map(([id, c]) => `<numFmt numFmtId="${id}" formatCode="${esc(c)}"/>`).join('')}</numFmts>` +
  `<fonts count="${FONTS.length}">${FONTS.join('')}</fonts>` +
  `<fills count="${FILLS.length}">${FILLS.join('')}</fills>` +
  `<borders count="${BORDERS.length}">${BORDERS.join('')}</borders>` +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  `<cellXfs count="${STYLE_IDS.length}">${STYLE_IDS.map((n) => {
    const [font, fill, border, fmt, h, wrap] = STYLES[n];
    const al = h || wrap ? `<alignment${h ? ` horizontal="${h}"` : ''} vertical="center"${wrap ? ' wrapText="1"' : ''}/>` : '';
    return `<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1"${fmt ? ' applyNumberFormat="1"' : ''}${al ? ' applyAlignment="1">' + al + '</xf>' : '/>'}`;
  }).join('')}</cellXfs>` +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

// ---------------------------------------------------------------- مساعدات XML
function esc(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
}
// أحرف التحكم غير مسموحة في XML 1.0
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');

export function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
function parseRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`مرجع خلية غير صالح: ${ref}`);
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { col: c - 1, row: Number(m[2]) };
}

function sheetXml(sh, hasImage) {
  const byRow = new Map();
  for (const [ref, cell] of Object.entries(sh.cells || {})) {
    const { col, row } = parseRef(ref);
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push({ col, ref, cell });
  }
  for (const r of Object.keys(sh.rowHeights || {})) if (!byRow.has(Number(r))) byRow.set(Number(r), []);
  const rows = [...byRow.keys()].sort((a, b) => a - b);

  const colsXml = Object.keys(sh.cols || {}).length
    ? `<cols>${Object.entries(sh.cols).map(([k, w]) => {
      // مفتاح 'A' أو نطاق 'D:AH'
      const [a, b] = k.split(':');
      return `<col min="${parseRef(a + '1').col + 1}" max="${parseRef((b || a) + '1').col + 1}" width="${w}" customWidth="1"/>`;
    }).join('')}</cols>`
    : '';

  const body = rows.map((r) => {
    const h = sh.rowHeights?.[r];
    const cells = byRow.get(r).sort((a, b) => a.col - b.col).map(({ ref, cell }) => {
      const s = styleId(cell.s);
      const v = cell.v;
      if (v === null || v === undefined || v === '') return `<c r="${ref}" s="${s}"/>`;
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) return `<c r="${ref}" s="${s}"/>`;
        return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
      }
      return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(clean(v))}</t></is></c>`;
    }).join('');
    return `<row r="${r}"${h ? ` ht="${h}" customHeight="1"` : ''}>${cells}</row>`;
  }).join('');

  const merges = sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
    '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>' +
    colsXml + `<sheetData>${body}</sheetData>` + merges +
    '<printOptions horizontalCentered="1"/><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
    `<pageSetup paperSize="9" orientation="${sh.landscape === false ? 'portrait' : 'landscape'}" fitToWidth="1" fitToHeight="0"/>` +
    (hasImage ? '<drawing r:id="rId1"/>' : '') + '</worksheet>'
  );
}

const EMU = 9525; // بكسل -> EMU
function drawingXml(img) {
  const { col, row } = img.from; // أساس صفري
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<xdr:oneCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${img.size.w * EMU}" cy="${img.size.h * EMU}"/>` +
    '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="logo"/><xdr:cNvPicPr preferRelativeResize="0"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
    '<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>'
  );
}

// ---------------------------------------------------------------- zip (stored)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  const DOS_TIME = 0;
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(DOS_TIME), ...u16(DOS_DATE), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
    chunks.push(local, name, data);
    central.push({ name, crc, size: data.length, offset });
    offset += local.length + name.length + data.length;
  }
  const cdStart = offset;
  for (const c of central) {
    const rec = new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(DOS_TIME), ...u16(DOS_DATE), ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(c.offset)]);
    chunks.push(rec, c.name);
    offset += rec.length + c.name.length;
  }
  const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(offset - cdStart), ...u32(cdStart), ...u16(0)]);
  chunks.push(end);
  const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

// أسماء الأوراق: ≤ 31 حرفاً، بلا : \ / ? * [ ]، وفريدة (Excel لا يفرّق حالة الأحرف)
export function sheetNames(names) {
  const used = new Set();
  return names.map((raw, i) => {
    let base = clean(raw || `Sheet${i + 1}`).replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`;
    let n = base;
    for (let k = 2; used.has(n.toLowerCase()); k++) n = `${base.slice(0, 31 - String(k).length - 1)}-${k}`;
    used.add(n.toLowerCase());
    return n;
  });
}

export function buildXlsx({ sheets }) {
  if (!Array.isArray(sheets) || !sheets.length) throw new Error('لا أوراق للكتابة');
  const names = sheetNames(sheets.map((s) => s.name));
  const files = [];
  const imageSheets = [];
  sheets.forEach((sh, i) => {
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sh, !!sh.image) });
    if (sh.image) {
      const n = imageSheets.length + 1;
      imageSheets.push({ i: i + 1, n, img: sh.image });
      files.push({ name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${n}.xml"/></Relationships>` });
      files.push({ name: `xl/drawings/drawing${n}.xml`, data: drawingXml(sh.image) });
      files.push({ name: `xl/drawings/_rels/drawing${n}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${n}.png"/></Relationships>` });
      files.push({ name: `xl/media/image${n}.png`, data: sh.image.png });
    }
  });
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  files.unshift(
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      imageSheets.map((s) => `<Override PartName="/xl/drawings/drawing${s.n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${R}/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: stylesXml() },
  );
  return zip(files);
}
