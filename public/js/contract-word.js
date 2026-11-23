// توليد ملف Word (.docx) لعقد واحد من نص العقد نفسه (contractBody) — بلا مكتبات.
import { contractNo } from './contract-doc.js';
import { composeDoc, footRows } from './contract-compose.js';
import { zip } from './zip.js';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const FONT = 'Sakkal Majalla';
const FILL = 'FBF0A8';
const MM = (n) => Math.round(n * 56.7);
const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** سلسلة HTML مضمّنة → فقرات، كل فقرة مصفوفة مقاطع {t, b, fill} */
export function inlineParas(html) {
  const paras = [[]];
  let b = 0;
  let fill = 0;
  for (const tok of html.split(/(<[^>]+>)/)) {
    if (!tok) continue;
    if (tok[0] === '<') {
      if (/^<b>/.test(tok)) b++;
      else if (/^<\/b>/.test(tok)) b--;
      else if (/^<span class="fill">/.test(tok)) fill++;
      else if (/^<\/span>/.test(tok)) fill--;
      else if (/^<li>/.test(tok)) paras.push([{ t: '• ', b: 0, fill: 0 }]);
      else if (/^<ul/.test(tok)) paras.push([]);
      continue;
    }
    paras[paras.length - 1].push({ t: unent(tok), b: b > 0, fill: fill > 0 });
  }
  return paras.filter((p) => p.some((r) => r.t.trim()));
}

const BORDER = { solid: 'single', dotted: 'dotted', dashed: 'dashed', double: 'double' };
const border = (side, style, w, color) => (style === 'none' ? '' : `<w:${side} w:val="${BORDER[style] || 'single'}" w:sz="${Math.max(2, Math.round(w * 6))}" w:space="4" w:color="${String(color).replace('#', '')}"/>`);
const JC = { justify: 'both', center: 'center', right: 'left', left: 'right' }; // الفقرة RTL: left/right في Word تُقرأ من بداية السطر

const run = (r, sz) => `<w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>${r.b || r.fill ? '<w:b/><w:bCs/>' : ''}${r.u ? '<w:u w:val="single"/>' : ''}<w:rtl/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>${r.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${FILL}"/>` : ''}</w:rPr><w:t xml:space="preserve">${x(r.t)}</w:t></w:r>`;
const para = (runs, { jc = 'both', after = 120, before = 0, sz = 25, line = 400, ind = 0, shade = false, keep = false } = {}) =>
  `<w:p><w:pPr>${keep ? '<w:keepNext/>' : ''}<w:bidi/>${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${FILL}"/>` : ''}<w:spacing${before ? ` w:before="${before}"` : ''} w:after="${after}" w:line="${line}" w:lineRule="auto"/>${ind ? `<w:ind w:start="${ind}"/>` : ''}<w:jc w:val="${jc}"/></w:pPr>${runs.map((r) => run(r, sz)).join('')}</w:p>`;
const plain = (t, o = {}) => ({ t, b: !!o.b, fill: false });

/** data-st="text-align:center;font-size:14pt;..." → خيارات الفقرة */
function parseSt(attrs) {
  const m = /data-st="([^"]*)"/.exec(attrs || '');
  const o = {};
  if (!m) return o;
  for (const kv of m[1].split(';')) {
    const [k, v] = kv.split(':');
    if (k === 'text-align' && JC[v]) o.jc = JC[v];
    else if (k === 'font-size') o.sz = Math.round(parseFloat(v) * 2);
    else if (k === 'margin-top') o.before = Math.round(parseFloat(v) * 15);
    else if (k === 'margin-bottom') o.after = Math.round(parseFloat(v) * 15);
    else if (k === 'font-weight') o.b = true;
    else if (k === 'text-decoration') o.u = true;
  }
  return o;
}

/** كتل العقد كما تخرج من renderBlocks → XML فقرات Word. fmt: تنسيق الصيغة (حجم الخط وتباعد الأسطر) */
export function bodyXml(html, fmt = {}) {
  const base = Math.round((fmt.body || 12.5) * 2);
  const line = Math.round(((fmt.lh || 1.95) / 1.17) * 240);
  const h1 = Math.round((fmt.h1 || 16) * 2);
  const A = '([^>]*)';
  const re = new RegExp(`<h1${A}>(.*?)</h1>|<h2${A}>(.*?)</h2>|<p class="(\\w+)"${A}>(.*?)</p>|<p${A}>(.*?)</p>|<div class="cl"${A}><b>(.*?)</b><div>(.*?)</div></div>|<div class="sign"${A}>((?:<div><b>.*?</b><div class="nm">.*?</div><div class="sg">[^<]*</div></div>){2})</div>|<div class="pbreak"></div>`, 'gs');
  let out = '';
  let m;
  const o = (st, d) => ({ sz: base, line, ...d, ...parseSt(st) });
  while ((m = re.exec(html))) {
    if (m[2] !== undefined) out += para([{ t: unent(m[2]), b: true, u: fmt.h1u === undefined ? true : !!fmt.h1u, fill: false }], o(m[1], { jc: 'center', sz: h1, after: 200, keep: true }));
    else if (m[4] !== undefined) out += para([{ t: unent(m[4]), b: true, fill: false }], o(m[3], { sz: base + 2, after: 120, keep: true }));
    else if (m[5] !== undefined) {
      const lede = m[5] === 'lede';
      inlineParas(m[7]).forEach((p) => { out += para(lede ? p.map((r) => ({ ...r, b: true })) : p, o(m[6], lede ? { jc: 'center', shade: true, after: 200 } : { after: m[5] === 'sigdate' ? 240 : 160 })); });
    } else if (m[9] !== undefined) inlineParas(m[9]).forEach((p) => { out += para(p, o(m[8], {})); });
    else if (m[11] !== undefined) {
      inlineParas(m[12]).forEach((p, i) => { out += i === 0 ? para([plain(`${unent(m[11])}   `, { b: true }), ...p], o(m[10], { after: 100 })) : para(p, o(m[10], { ind: 720, after: 60 })); });
    } else if (m[14] !== undefined) {
      const sides = [...m[14].matchAll(/<b>(.*?)<\/b><div class="nm">(.*?)<\/div>/g)].map((sd) => [unent(sd[1]), unent(sd[2])]);
      const cell = ([title, name]) => `<w:tc><w:tcPr><w:tcW w:w="4700" w:type="dxa"/></w:tcPr>${para([plain(title, { b: true })], { jc: 'center', sz: base + 2, line, after: 60 })}${para([plain(name, { b: true })], { jc: 'center', sz: base, line, after: 500 })}${para([plain('التوقيع: ...............................')], { jc: 'center', sz: base, line, after: 0 })}</w:tc>`;
      out += `<w:tbl><w:tblPr><w:tblW w:w="9400" w:type="dxa"/><w:bidiVisual/></w:tblPr><w:tblGrid><w:gridCol w:w="4700"/><w:gridCol w:w="4700"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr>${sides.map(cell).join('')}</w:tr></w:tbl>`;
    } else out += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  }
  return out;
}

/** أبعاد صورة PNG أو JPEG من بايتاتها، أو null */
export function imgSize(b) {
  if (!b || b.length < 24) return null;
  if (b[0] === 0x89) return [(b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]];
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const mk = b[i + 1];
      if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) return [(b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]];
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return null;
}
const extOf = (b) => (b[0] === 0x89 ? 'png' : b[0] === 0xff ? 'jpeg' : b[0] === 0x47 ? 'gif' : 'png');

const field = (code) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const small = (t, ltr) => `<w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>${ltr ? '' : '<w:rtl/>'}<w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t xml:space="preserve">${x(t)}</w:t></w:r>`;

const drawing = (n, w, h, rid, name) => `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${w}" cy="${h}"/><wp:docPr id="${n}" name="${x(name)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${x(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

/**
 * d: {contract, rev, header} كما يعيده /api/contracts/:id/doc. images: { [معرّف الشعار]: Uint8Array } لما أمكن جلبه.
 * يُرجع Uint8Array (ملف docx)
 */
export function buildDocx(d, images = {}) {
  const r = d.contract;
  const doc0 = composeDoc(d);
  const fmt = doc0.fmt;
  const body = bodyXml(doc0.body, fmt);
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const logos = doc0.logos.filter((l) => images[l.id]).map((l) => {
    const bytes = images[l.id];
    const dim = imgSize(bytes) || (l.w && l.ih ? [l.w, l.ih] : [1, 1]);
    const h = Math.round(l.h * 36000);
    return { ...l, bytes, ext: extOf(bytes), cy: h, cx: Math.round((h * dim[0]) / dim[1]) };
  });
  const usable = 11906 - MM(fmt.mR) - MM(fmt.mL);
  const maxH = Math.max(0, ...doc0.logos.map((l) => l.h));
  let header = '';
  const hdrRels = [];
  if (logos.length) {
    let n = 0;
    const cell = (al) => {
      const mine = logos.filter((l) => l.align === al);
      const runs = mine.map((l) => { n += 1; hdrRels.push(`<Relationship Id="rIdL${n}" Type="${REL}/image" Target="media/logo${n}.${l.ext}"/>`); l._n = n; return drawing(n, l.cx, l.cy, `rIdL${n}`, l.name) + '<w:r><w:t xml:space="preserve"> </w:t></w:r>'; }).join('');
      const jc = al === 'center' ? 'center' : al === 'right' ? 'left' : 'right';
      return `<w:tc><w:tcPr><w:tcW w:w="${Math.round(usable / 3)}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:bidi/><w:spacing w:after="0"/><w:jc w:val="${jc}"/></w:pPr>${runs}</w:p></w:tc>`;
    };
    const bb = border('bottom', fmt.hdrLine, fmt.hdrW, fmt.hdrColor);
    header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}><w:tbl><w:tblPr><w:tblW w:w="${usable}" w:type="dxa"/><w:bidiVisual/>${bb ? `<w:tblBorders>${bb}</w:tblBorders>` : ''}</w:tblPr><w:tblGrid>${[0, 1, 2].map(() => `<w:gridCol w:w="${Math.round(usable / 3)}"/>`).join('')}</w:tblGrid><w:tr>${['right', 'center', 'left'].map(cell).join('')}</w:tr></w:tbl><w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p></w:hdr>`;
  }
  const tabs = `<w:tabs><w:tab w:val="right" w:pos="${usable}"/></w:tabs>`;
  const rows = footRows(doc0.foot);
  const topB = border('top', fmt.ftrLine, fmt.ftrW, fmt.ftrColor);
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}>`
    + `<w:p><w:pPr>${topB ? `<w:pBdr>${topB}</w:pBdr>` : ''}<w:bidi w:val="0"/><w:spacing w:after="20"/><w:jc w:val="left"/></w:pPr>${small('Page ', true)}${field('PAGE')}${small(' of ', true)}${field('NUMPAGES')}</w:p>`
    + rows.map((t) => `<w:p><w:pPr>${t.en ? '<w:bidi w:val="0"/>' : '<w:bidi/>'}${tabs}<w:spacing w:after="0"/></w:pPr>${small(t.a, t.en)}<w:r><w:tab/></w:r>${small(t.b, t.en)}</w:p>`).join('')
    + '</w:ftr>';
  const top = fmt.mT + (logos.length ? maxH + 6 : 6);
  const sect = `<w:sectPr>${logos.length ? '<w:headerReference w:type="default" r:id="rIdHdr"/>' : ''}<w:footerReference w:type="default" r:id="rIdFtr"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${MM(top)}" w:right="${MM(fmt.mR)}" w:bottom="${MM(fmt.mB + 12)}" w:left="${MM(fmt.mL)}" w:header="${MM(fmt.mT)}" w:footer="${MM(Math.max(4, fmt.mB / 2))}"/><w:bidi/></w:sectPr>`;
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdFtr" Type="${REL}/footer" Target="footer1.xml"/>${logos.length ? `<Relationship Id="rIdHdr" Type="${REL}/header" Target="header1.xml"/>` : ''}</Relationships>`;
  const exts = [...new Set(logos.map((l) => l.ext))];
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${exts.map((e) => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('')}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${logos.length ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ''}<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`;
  const files = [
    { name: '[Content_Types].xml', data: ct },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/document.xml', data: docXml },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    { name: 'word/footer1.xml', data: footer },
  ];
  if (logos.length) {
    files.push({ name: 'word/header1.xml', data: header });
    files.push({ name: 'word/_rels/header1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hdrRels.join('')}</Relationships>` });
    for (const l of logos) files.push({ name: `word/media/logo${l._n}.${l.ext}`, data: l.bytes });
  }
  return zip(files);
}

export const wordFileName = (r) => `عقد - ${String(r.name || '').replace(/[\\/:*?"<>|]/g, '')} - ${contractNo(r).replace(/\//g, '-')}.docx`;
