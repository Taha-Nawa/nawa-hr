// توليد ملف Word (.docx) لعقد واحد من نص العقد نفسه (contractBody) — بلا مكتبات.
import { contractBody, contractNo, FP } from './contract-doc.js';
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

const run = (r, sz) => `<w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>${r.b || r.fill ? '<w:b/><w:bCs/>' : ''}<w:rtl/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>${r.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${FILL}"/>` : ''}</w:rPr><w:t xml:space="preserve">${x(r.t)}</w:t></w:r>`;
const para = (runs, { jc = 'both', after = 120, sz = 25, ind = 0, shade = false, keep = false } = {}) =>
  `<w:p><w:pPr>${keep ? '<w:keepNext/>' : ''}<w:bidi/>${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${FILL}"/>` : ''}<w:spacing w:after="${after}" w:line="400" w:lineRule="auto"/>${ind ? `<w:ind w:start="${ind}"/>` : ''}<w:jc w:val="${jc}"/></w:pPr>${runs.map((r) => run(r, sz)).join('')}</w:p>`;
const plain = (t, o = {}) => ({ t, b: !!o.b, fill: false });

/** كتل العقد كما تخرج من contractBody → XML فقرات Word */
export function bodyXml(html) {
  const re = /<h1>(.*?)<\/h1>|<h2>(.*?)<\/h2>|<p class="(\w+)">(.*?)<\/p>|<p>(.*?)<\/p>|<div class="cl"><b>(.*?)<\/b><div>(.*?)<\/div><\/div>|<div class="sign">(.*)<\/div>\s*$/gs;
  let out = '';
  let m;
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) out += para([{ t: unent(m[1]), b: true, fill: false }], { jc: 'center', sz: 32, after: 200, keep: true });
    else if (m[2] !== undefined) out += para([{ t: unent(m[2]), b: true, fill: false }], { sz: 27, after: 120, keep: true });
    else if (m[3] !== undefined) {
      const ps = inlineParas(m[4]);
      const lede = m[3] === 'lede';
      ps.forEach((p) => { out += para(lede ? p.map((r) => ({ ...r, b: true })) : p, lede ? { jc: 'center', shade: true, after: 200 } : { after: m[3] === 'sigdate' ? 240 : 160 }); });
    } else if (m[5] !== undefined) inlineParas(m[5]).forEach((p) => { out += para(p); });
    else if (m[6] !== undefined) {
      inlineParas(m[7]).forEach((p, i) => { out += i === 0 ? para([plain(`${unent(m[6])}   `, { b: true }), ...p], { after: 100 }) : para(p, { ind: 720, after: 60 }); });
    } else if (m[8] !== undefined) {
      const sides = [...m[8].matchAll(/<b>(.*?)<\/b><div class="nm">(.*?)<\/div>/g)].map((s) => [unent(s[1]), unent(s[2])]);
      const cell = ([title, name]) => `<w:tc><w:tcPr><w:tcW w:w="4700" w:type="dxa"/></w:tcPr>${para([plain(title, { b: true })], { jc: 'center', sz: 27, after: 60 })}${para([plain(name, { b: true })], { jc: 'center', after: 500 })}${para([plain('التوقيع: ...............................')], { jc: 'center', after: 0 })}</w:tc>`;
      out += `<w:tbl><w:tblPr><w:tblW w:w="9400" w:type="dxa"/><w:bidiVisual/></w:tblPr><w:tblGrid><w:gridCol w:w="4700"/><w:gridCol w:w="4700"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr>${sides.map(cell).join('')}</w:tr></w:tbl>`;
    }
  }
  return out;
}

function pngSize(b) { return b && b[0] === 0x89 ? [(b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]] : null; }

const field = (code) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const small = (t, ltr) => `<w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>${ltr ? '' : '<w:rtl/>'}<w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t xml:space="preserve">${x(t)}</w:t></w:r>`;

/** r: سجل العقد (كما يعيده /api/contracts/:id). logo: {bytes: Uint8Array(PNG), hMm} اختياري. يُرجع Uint8Array */
export function buildDocx(r, { logo = null } = {}) {
  const body = bodyXml(contractBody(r));
  const dim = logo ? pngSize(logo.bytes) : null;
  const hasLogo = !!(logo && dim);
  let header = '';
  if (hasLogo) {
    const h = Math.round((logo.hMm || 24) * 36000);
    const w = Math.round((h * dim[0]) / dim[1]);
    header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="120"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${w}" cy="${h}"/><wp:docPr id="1" name="شعار نوى"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:hdr>`;
  }
  const tabs = '<w:tabs><w:tab w:val="right" w:pos="9070"/></w:tabs>';
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}>`
    + `<w:p><w:pPr><w:pBdr><w:top w:val="dotted" w:sz="6" w:space="4" w:color="8A7570"/></w:pBdr><w:bidi w:val="0"/><w:spacing w:after="20"/><w:jc w:val="left"/></w:pPr>${small('Page ', true)}${field('PAGE')}${small(' of ', true)}${field('NUMPAGES')}</w:p>`
    + `<w:p><w:pPr><w:bidi/>${tabs}<w:spacing w:after="0"/></w:pPr>${small(`العنوان: ${FP.addr}`)}<w:r><w:tab/></w:r>${small(`تلفاكس: ${FP.fax}`)}</w:p>`
    + `<w:p><w:pPr><w:bidi w:val="0"/>${tabs}<w:spacing w:after="0"/></w:pPr>${small(`Address: ${FP.addrEn}`, true)}<w:r><w:tab/></w:r>${small(`Telefax: ${FP.tel}`, true)}</w:p></w:ftr>`;
  const sect = `<w:sectPr>${hasLogo ? '<w:headerReference w:type="default" r:id="rIdHdr"/>' : ''}<w:footerReference w:type="default" r:id="rIdFtr"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${MM(hasLogo ? 38 : 20)}" w:right="${MM(15)}" w:bottom="${MM(24)}" w:left="${MM(15)}" w:header="${MM(8)}" w:footer="${MM(6)}"/><w:bidi/></w:sectPr>`;
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdFtr" Type="${REL}/footer" Target="footer1.xml"/>${hasLogo ? `<Relationship Id="rIdHdr" Type="${REL}/header" Target="header1.xml"/>` : ''}</Relationships>`;
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${hasLogo ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ''}<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`;
  const files = [
    { name: '[Content_Types].xml', data: ct },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/document.xml', data: doc },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    { name: 'word/footer1.xml', data: footer },
  ];
  if (hasLogo) {
    files.push({ name: 'word/header1.xml', data: header });
    files.push({ name: 'word/_rels/header1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLogo" Type="${REL}/image" Target="media/logo.png"/></Relationships>` });
    files.push({ name: 'word/media/logo.png', data: logo.bytes });
  }
  return zip(files);
}

export const wordFileName = (r) => `عقد - ${String(r.name || '').replace(/[\\/:*?"<>|]/g, '')} - ${contractNo(r).replace(/\//g, '-')}.docx`;
