// تصدير العقود: Excel (48 عموداً) وCSV لدمج المراسلات — منقول من سجل العقود القديم.
import { compute, audit, tafqeet, priceKind, money, BID, TENDER } from './contracts-lib.js';
import { contractNo, longDate, dayName, FP } from './contract-doc.js';
import { zip } from './zip.js';

const fmtDate = (s) => { if (!s) return ''; const p = String(s).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s; };
export { fmtDate };

export const EXPORT_COLS = [
 ["م", r=>r.seq||""], ["رقم العقد", r=>contractNo(r)],
 ["اسم الطرف الثاني (رباعياً)", r=>r.name], ["رقم الهوية", r=>r.idno],
 ["الجنس / نوع مقدّم الخدمة", r=>r.gender], ["الصفة", r=>r.title],
 ["مكان الإقامة", r=>r.residence], ["رقم الجوال", r=>r.phone],
 ["البريد الإلكتروني", r=>r.email], ["التخصص", r=>r.major], ["سنوات الخبرة", r=>r.exp],
 ["نوع العقد", r=>r.ctype], ["موضوع / عنوان العقد", r=>r.csubject],
 ["وصف الخدمة المتعاقد عليها", r=>r.service], ["اسم المشروع", r=>r.project],
 ["جهة التعاون / الشريك المنفّذ", r=>r.partner], ["اسم الممول", r=>r.donor],
 ["رقم استدراج العرض / العطاء", r=>r.rfqno], ["تاريخ إعلان عرض السعر / العطاء", r=>fmtDate(r.dRfq)],
 ["تاريخ تقديم العرض من مزوّد الخدمة", r=>fmtDate(r.dOffer)], ["تاريخ توقيع العقد من مزوّد الخدمة", r=>fmtDate(r.dSign)],
 ["بداية فترة التنفيذ (من)", r=>fmtDate(r.dFrom)], ["نهاية فترة التنفيذ (إلى)", r=>fmtDate(r.dTo)],
 ["المادة / النشاط المنفَّذ", r=>r.subject], ["نوع موقع التنفيذ", r=>r.siteType],
 ["اسم موقع التنفيذ", r=>r.siteName], ["المنطقة", r=>r.area],
 ["أساس التسعير", r=>r.pricing], ["سعر الجلسة الواحدة ($)", r=>r.rate],
 ["عدد الجلسات في يوم العمل الواحد", r=>compute(r).spd],
 ["قيمة يوم التنفيذ الواحد ($)", r=>compute(r).dayRate],
 ["عدد أيام التنفيذ المتفق عليها", r=>r.daysBase],
 ["إجمالي الجلسات المتفق عليها", r=>compute(r).sessB],
 ["القيمة التعاقدية الأساسية ($)", r=>compute(r).base],
 ["الحد الأدنى المسموح (أيام) -25%", r=>compute(r).min],
 ["الحد الأقصى المسموح (أيام) +25%", r=>compute(r).max],
 ["عدد أيام التنفيذ المعتمدة فعلياً", r=>r.daysAct],
 ["إجمالي الجلسات المعتمدة", r=>compute(r).sessA],
 ["القيمة المعتمدة ($)", r=>compute(r).appr],
 ["نسبة التغيّر عن القيمة الأساسية", r=>{const d=compute(r).delta; return d===null?"":(d*100).toFixed(1)+"%";}],
 ["القيمة المعتمدة كتابةً (تفقيط)", r=>compute(r).words],
 ["اسم البنك", r=>r.bank], ["رقم الحساب / IBAN", r=>r.iban],
 ["حالة العقد", r=>r.status], ["نوع الإنهاء / الفسخ", r=>r.termType],
 ["سبب الإنهاء / الفسخ", r=>r.termReason], ["المادة المستند إليها", r=>compute(r).article],
 ["تاريخ الإنهاء / الفسخ", r=>fmtDate(r.dTerm)], ["أيام التنفيذ المعتمدة حتى الإنهاء", r=>r.daysTerm],
 ["المستحق حتى الإنهاء ($)", r=>compute(r).due], ["ملاحظات", r=>r.notes],
 ["تدقيق البيانات", r=>{const e=audit(r); return e.length?e.join(" | "):"مكتملة";}]
];
export const MERGE_COLS = [
 ["ContractNo", r=>contractNo(r)], ["Title", r=>r.title], ["Name", r=>r.name], ["IdNo", r=>r.idno],
 ["Gender", r=>r.gender],
 ["G_Nat", r=>r.gender==="أنثى"?"فلسطينية الجنسية":"فلسطيني الجنسية"],
 ["G_Resid", r=>r.gender==="أنثى"?"والمقيمة":"والمقيم"],
 ["G_Ref", r=>r.gender==="أنثى"?"ويشار إليها":"ويشار إليه"],
 ["G_Role", r=>r.gender==="أنثى"?"مقدمة الخدمة":"مقدم الخدمة"],
 ["Residence", r=>r.residence], ["Phone", r=>r.phone], ["Email", r=>r.email],
 ["Major", r=>r.major], ["Exp", r=>r.exp],
 ["ContractType", r=>r.ctype], ["ContractSubject", r=>r.csubject],
  ["ContractTitle", r=>{const t=String(r.csubject||"تقديم خدمات تربوية").trim(); return /^عقد\s+اتفاق/.test(t)?t:"عقد اتفاق على "+t;}], ["ServiceDesc", r=>r.service],
 ["ProjectName", r=>r.project], ["Partner", r=>r.partner], ["Donor", r=>r.donor],
 ["RfqNo", r=>r.rfqno], ["RfqDate", r=>longDate(r.dRfq)], ["OfferDate", r=>longDate(r.dOffer)],
 ["SignDate", r=>longDate(r.dSign)], ["SignDay", r=>dayName(r.dSign)],
 ["FromDate", r=>longDate(r.dFrom)], ["ToDate", r=>longDate(r.dTo)],
 ["Subject", r=>r.subject], ["SiteType", r=>r.siteType], ["SiteName", r=>r.siteName], ["Area", r=>r.area],
 ["PricingBasis", r=>r.pricing], ["Rate", r=>r.rate], ["DaysBase", r=>r.daysBase],
 ["SessionsPerDay", r=>compute(r).spd], ["DayRate", r=>compute(r).dayRate],
 ["SessionsBase", r=>compute(r).sessB], ["SessionsApproved", r=>compute(r).sessA],
 ["BaseValue", r=>{const v=compute(r).base; return v===null?"":v;}],
 ["BaseValueWords", r=>{const v=compute(r).base; return v===null?"":tafqeet(v);}],
 ["MinDays", r=>compute(r).min], ["MaxDays", r=>compute(r).max],
 ["DaysApproved", r=>r.daysAct],
 ["ApprovedValue", r=>{const v=compute(r).appr; return v===null?"":v;}],
 ["ApprovedValueWords", r=>compute(r).words],
 ["DeltaPct", r=>{const d=compute(r).delta; return d===null?"":(d*100).toFixed(1)+"%";}],
 ["Bank", r=>r.bank], ["Iban", r=>r.iban], ["Status", r=>r.status],
 ["TermType", r=>r.termType], ["TermReason", r=>r.termReason], ["TermArticle", r=>compute(r).article],
 ["TermDate", r=>longDate(r.dTerm)], ["DaysToTerm", r=>r.daysTerm],
 ["DueAtTerm", r=>{const v=compute(r).due; return v===null?"":v;}],
 ["Notes", r=>r.notes],
 ["PreambleText", r=>(r.ctype===BID||r.ctype===TENDER)
   ? "بناءً على "+(r.ctype===TENDER?"العطاء":"طلب استدراج عروض الأسعار")+" الصادر عن "+FP.org+" رقم ("+(r.rfqno||"")+") بتاريخ "+longDate(r.dRfq)+"، بشأن التعاقد مع مقدم/ة خدمة لتنفيذ "+(r.service||"")+" ضمن مشروع «"+(r.project||"")+"» بالتعاون مع "+(r.partner||"")+"، وبتمويل من "+(r.donor||"")+"، والذي تنفذه "+FP.org+"، وبناءً على عرض السعر المقدم من الطرف الثاني بتاريخ "+longDate(r.dOffer)+"، وبعد دراسة العرض والتأكد من استيفائه للشروط الفنية المطلوبة، ولما يتمتع به الطرف الثاني من الكفاءة والخبرة اللازمة لتنفيذ الخدمات موضوع هذا العقد، فقد اتفق الطرفان على أن يتولى الطرف الثاني تنفيذ الخدمات المتفق عليها وفقاً للشروط المرجعية، والمواصفات الفنية، وأحكام هذا العقد، وبما يحقق متطلبات الطرف الأول."
   : "بناءً على قرار التعاقد المباشر الصادر عن "+FP.org+" بشأن التعاقد مع مقدم/ة خدمة لتنفيذ "+(r.service||"")+" ضمن مشروع «"+(r.project||"")+"» بالتعاون مع "+(r.partner||"")+"، وبتمويل من "+(r.donor||"")+"، والذي تنفذه "+FP.org+"، ولما يتمتع به الطرف الثاني من الكفاءة والخبرة اللازمة لتنفيذ الخدمات موضوع هذا العقد، فقد اتفق الطرفان على أن يتولى الطرف الثاني تنفيذ الخدمات المتفق عليها وفقاً للشروط المرجعية، والمواصفات الفنية، وأحكام هذا العقد، وبما يحقق متطلبات الطرف الأول."],
 ["Fee71Text", r=>{const c=compute(r); return priceKind(r.pricing)==="lump"
   ? "اتفق الطرفان على أن هذا العقد بقيمة إجمالية مقطوعة قدرها ("+(c.base!==null?money(c.base):"……")+") فقط لا غير."
   : (c.multi
      ? "اتفق الطرفان على أن قيمة الجلسة الواحدة تبلغ ("+(r.rate!==undefined&&r.rate!==""?r.rate:"……")+") دولاراً أمريكياً، وبما أن يوم التنفيذ الواحد يتضمن ("+c.spd+") جلسة، فإن قيمة يوم التنفيذ الواحد تبلغ ("+(c.dayRate!==null?money(c.dayRate):"……")+") دولاراً أمريكياً فقط لا غير."
      : "اتفق الطرفان على أن قيمة يوم التنفيذ الواحد (الجلسة الواحدة) تبلغ ("+(r.rate!==undefined&&r.rate!==""?r.rate:"……")+") دولاراً أمريكياً فقط لا غير.");}],
 ["Range25Text", r=>{const c=compute(r); return c.min!==null ? " (أي من "+c.min+" إلى "+c.max+" يوم تنفيذ)" : "";}],
 ["OrgName", ()=>FP.org], ["OrgRep", ()=>FP.rep], ["OrgRepRole", ()=>FP.repRole], ["OrgCity", ()=>FP.city]
];
export function toCSV(cols, rs){
  const q = v => { const s = (v===null||v===undefined)?"":String(v);
    return /[",\n\r]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const lines = [cols.map(c=>q(c[0])).join(",")];
  rs.forEach(r=>lines.push(cols.map(c=>q(c[1](r))).join(",")));
  return "﻿"+lines.join("\r\n");
}


function xesc(s){
  let t = String(s===null||s===undefined?"":s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  let o = "";
  for(let i=0;i<t.length;i++){ const c = t.charCodeAt(i); if(c>=32 || c===9 || c===10 || c===13) o += t[i]; }
  return o;
}
function colName(i){ let s=""; i++; while(i>0){ const m=(i-1)%26; s=String.fromCharCode(65+m)+s; i=Math.floor((i-1)/26);} return s; }
export function xlsxBlob(cols, rs){
  let sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
    '<sheetViews><sheetView rightToLeft="1" workbookViewId="0" tabSelected="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'+
    '<sheetFormatPr defaultRowHeight="18"/><cols>';
  cols.forEach((c,i)=>{ sheet += '<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+Math.min(46,Math.max(12,c[0].length+6))+'" customWidth="1"/>'; });
  sheet += '</cols><sheetData>';
  sheet += '<row r="1">'+cols.map((c,i)=>'<c r="'+colName(i)+'1" t="inlineStr" s="1"><is><t xml:space="preserve">'+xesc(c[0])+'</t></is></c>').join("")+'</row>';
  rs.forEach((r,ri)=>{
    sheet += '<row r="'+(ri+2)+'">'+cols.map((c,i)=>{
      const v = c[1](r);
      const ref = colName(i)+(ri+2);
      if(typeof v==="number" && isFinite(v)) return '<c r="'+ref+'"><v>'+v+'</v></c>';
      return '<c r="'+ref+'" t="inlineStr"><is><t xml:space="preserve">'+xesc(v)+'</t></is></c>';
    }).join("")+'</row>';
  });
  sheet += '</sheetData></worksheet>';
  const files = [
    {name:"[Content_Types].xml", data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'},
    {name:"_rels/.rels", data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
    {name:"xl/workbook.xml", data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="بيانات المتعاقدات" sheetId="1" r:id="rId1"/></sheets></workbook>'},
    {name:"xl/_rels/workbook.xml.rels", data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
    {name:"xl/styles.xml", data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="12"/><name val="Sakkal Majalla"/></font><font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Sakkal Majalla"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFA21008"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs></styleSheet>'},
    {name:"xl/worksheets/sheet1.xml", data:sheet}
  ];
  return new Blob([zip(files)], {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}

