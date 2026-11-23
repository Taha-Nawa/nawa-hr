// استيراد نص عقد من ملف Word (.docx): قراءة الفقرات والجداول → كتل الصيغة → اكتشاف القيم المتغيّرة وتحويلها إلى رموز بعد مراجعتك.
// منقول من سجل العقود القديم، وبلا أي مكتبة (فك الضغط بـ DecompressionStream).
import { h, dialog, toast, confirmBox } from '../dom.js';
import { TOKEN_GROUPS, renderBlocks, PAY_TOKENS, RATE_TOKENS } from '../contract-tpl.js';
import { FP_DEFAULT } from '../contract-tpl-base.js';
import { fmtVars, applyDataStyles } from '../contract-compose.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
async function inflateRaw(bytes){
  if(typeof DecompressionStream === "undefined")
    throw new Error("متصفحك لا يدعم فك ضغط ملفات Word — جرّب Chrome أو Edge أو Firefox حديثاً");
  const ds = new DecompressionStream("deflate-raw");
  const ab = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(ab);
}
async function unzip(buf){
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for(let i = buf.length - 22; i >= 0; i--){ if(dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; } }
  if(eocd < 0) throw new Error("الملف ليس ملف Word صالحاً (.docx)");
  const n = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const out = {};
  for(let k = 0; k < n; k++){
    if(dv.getUint32(off, true) !== 0x02014b50) break;
    const nameLen = dv.getUint16(off + 28, true), extLen = dv.getUint16(off + 30, true),
          cmtLen  = dv.getUint16(off + 32, true), lho    = dv.getUint32(off + 42, true),
          method  = dv.getUint16(off + 10, true), csize  = dv.getUint32(off + 20, true);
    const name = new TextDecoder().decode(buf.subarray(off + 46, off + 46 + nameLen));
    const lnLen = dv.getUint16(lho + 26, true), leLen = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lnLen + leLen;
    out[name] = { method, raw: buf.subarray(start, start + csize) };
    off += 46 + nameLen + extLen + cmtLen;
  }
  return out;
}
async function entryBytes(e){ return e.method === 0 ? e.raw : await inflateRaw(e.raw); }
async function entryText(e){ return new TextDecoder("utf-8").decode(await entryBytes(e)); }

/* ---------------- 2) قراءة فقرات المستند ---------------- */
const MIME = { png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", gif:"image/gif", webp:"image/webp", bmp:"image/bmp" };
function b64of(bytes){
  let s = "", CH = 0x8000;
  for(let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
function paraText(par){
  let t = "";
  for(const node of par.getElementsByTagName("*")){
    const nm = node.nodeName.replace(/^.*:/, "");
    if(nm === "t") t += node.textContent;
    else if(nm === "tab") t += " ";
    else if(nm === "br") t += "\n";
  }
  return t;
}
function attr(el, name){
  if(!el) return null;
  return el.getAttribute("w:"+name) || el.getAttribute(name);
}
function first(el, tag){
  const l = el.getElementsByTagName("w:"+tag);
  if(l.length) return l[0];
  const l2 = el.getElementsByTagName(tag);
  return l2.length ? l2[0] : null;
}
function readPara(par){
  const txt = paraText(par);
  const pPr = first(par, "pPr");
  const ind = pPr ? first(pPr, "ind") : null;
  const jcE = pPr ? first(pPr, "jc") : null;
  const szE = first(par, "sz");
  const boldRuns = par.getElementsByTagName("w:b").length + par.getElementsByTagName("b").length;
  const runs = Math.max(1, par.getElementsByTagName("w:r").length || par.getElementsByTagName("r").length);
  return {
    txt,
    list: !!(pPr && first(pPr, "numPr")),
    ind: ind ? Number(attr(ind, "left") || attr(ind, "start") || 0) : 0,
    jc: jcE ? attr(jcE, "val") : "",
    sz: szE ? Number(attr(szE, "val") || 0) / 2 : 0,
    bold: boldRuns >= runs * 0.6
  };
}
export async function readDocx(file){
  const files = await unzip(new Uint8Array(await file.arrayBuffer()));
  const docEntry = files["word/document.xml"];
  if(!docEntry) throw new Error("الملف لا يحتوي مستند Word (.docx). الصيغة القديمة .doc غير مدعومة.");
  const xml = await entryText(docEntry);
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if(doc.getElementsByTagName("parsererror").length) throw new Error("تعذّرت قراءة محتوى الملف");

  /* الصور */
  const images = [];
  for(const nm in files){
    if(!/^word\/media\//.test(nm)) continue;
    const ext = (nm.split(".").pop() || "").toLowerCase();
    if(!MIME[ext]) continue;
    try{
      const bytes = await entryBytes(files[nm]);
      if(bytes.length > 2_000_000) continue;
      images.push({ name: nm.split("/").pop(), data: "data:" + MIME[ext] + ";base64," + b64of(bytes) });
    }catch(e){}
  }

  /* الفقرات والجداول بترتيب ظهورها */
  const body = first(doc.documentElement, "body") || doc.documentElement;
  const items = [];
  for(const child of body.children){
    const nm = child.nodeName.replace(/^.*:/, "");
    if(nm === "p"){
      const pr = readPara(child);
      if(pr.txt.trim()) items.push(Object.assign({ kind: "p" }, pr));
    } else if(nm === "tbl"){
      const rows = [];
      for(const tr of child.children){
        if(tr.nodeName.replace(/^.*:/, "") !== "tr") continue;
        const cells = [];
        for(const tc of tr.children){
          if(tc.nodeName.replace(/^.*:/, "") !== "tc") continue;
          const lines = [];
          for(const cp of tc.getElementsByTagName("*")){
            if(cp.nodeName.replace(/^.*:/, "") !== "p") continue;
            const t = paraText(cp).trim(); if(t) lines.push(t);
          }
          cells.push(lines);
        }
        if(cells.length) rows.push(cells);
      }
      if(rows.length) items.push({ kind: "tbl", rows });
    }
  }
  return { items, images, headerFooter: Object.keys(files).some(k => /^word\/(header|footer)\d*\.xml$/.test(k)) };
}

/* ---------------- 3) تحويل الفقرات إلى كتل ---------------- */
const ORD = ["أولاً","ثانياً","ثالثاً","رابعاً","خامساً","سادساً","سابعاً","ثامناً","تاسعاً","عاشراً",
             "أولا","ثانيا","ثالثا","رابعا","خامسا","سادسا","سابعا","ثامنا","تاسعا","عاشرا"];
const RE_ART  = /^\s*(?:المادة|البند)\s*[\(（]?\s*(\d+)\s*[\)）]?\s*[:：\-–]?\s*(.*)$/;
const RE_CL   = /^\s*(\d{1,2})\s*[.\-–]\s*(\d{1,2})\s*[.\)）:：]?\s+(.*)$/;
const RE_BUL  = /^\s*[•\-•●▪‣*]\s+(.*)$/;
const RE_SEC  = new RegExp("^\\s*(?:" + ORD.join("|") + ")\\s*[:：]");

function isSignRow(rows){
  const flat = rows.flat(2).join(" ");
  return /الطرف\s*الأول/.test(flat) && /الطرف\s*الثاني/.test(flat) && /التوقيع/.test(flat);
}
export function blocksFromDocx(items){
  const out = [];
  let i = 0, seenTitle = false;
  const push = (type, text, extra) => {
    const b = Object.assign({ id: uid("b"), type, text: String(text || "").trim() }, extra || {});
    out.push(b); return b;
  };
  const addBullet = txt => {
    const prev = out[out.length - 1];
    if(prev && (prev.type === "cl" || prev.type === "p")) prev.text += "\n- " + txt;
    else push("p", "- " + txt);
  };

  for(; i < items.length; i++){
    const it = items[i];

    if(it.kind === "tbl"){
      if(isSignRow(it.rows)){
        const cells = it.rows[0] || [];
        const pick = c => (c && c.length ? c : []);
        const a = pick(cells[0]), b2 = pick(cells[1]);
        push("sign", [a[0] || "الطرف الأول", a[1] || "", b2[0] || "الطرف الثاني", b2[1] || ""].join("|"));
      } else {
        it.rows.forEach(r => push("p", r.map(c => c.join(" ")).join(" — ")));
      }
      continue;
    }

    const raw = it.txt.replace(/\s+/g, " ").trim();
    if(!raw) continue;

    if(!seenTitle && out.length === 0 && (it.jc === "center" || it.bold)){
      push("h1", raw); seenTitle = true; continue;
    }
    if(seenTitle && out.length === 1 && (it.jc === "center") && raw.length < 220){
      push("lede", raw); continue;
    }
    let m;
    if((m = raw.match(RE_ART))){ push("art", m[2] || raw); continue; }
    if((m = raw.match(RE_CL))){  push("cl", m[3]); continue; }
    if(RE_BUL.test(raw) || (it.list && it.ind > 500)){ addBullet(raw.replace(RE_BUL, "$1")); continue; }
    if(RE_SEC.test(raw) && raw.length < 120){ push("sec", raw); continue; }
    if(/^\s*أحكام\s+ختامية/.test(raw)){ push("sec", raw); continue; }
    if(/^\s*(الطرف\s*(الأول|الثاني))\s*[:：]/.test(raw)){
      push("party", raw.replace(/^\s*(الطرف\s*(?:الأول|الثاني))\s*[:：]/, "**$1:**")); continue;
    }
    if(/تاريخ\s*التوقيع\s*[:：]/.test(raw) && raw.length < 90){ push("sigdate", raw); continue; }
    if(it.bold && raw.length < 70 && raw.split(/\s+/).length <= 8 && !/[.،؛]/.test(raw)){
      push("sec", raw); continue;
    }
    push("p", raw);
  }
  if(!out.some(b => b.type === "sign"))
    push("sign", "الطرف الأول|{{الطرف_الأول}}|الطرف الثاني|{{الاسم}}");
  return out;
}

/* ---------------- 4) اكتشاف الرموز ---------------- */
const MERGE2TOK = {
  ContractNo:"رقم_العقد", Title:"الصفة", Name:"الاسم", IdNo:"رقم_الهوية", Gender:"الجنس",
  Residence:"مكان_الإقامة", Phone:"الجوال", Email:"البريد", Major:"التخصص", Exp:"سنوات_الخبرة",
  ContractType:"نوع_العقد", ContractSubject:"موضوع_العقد", ContractTitle:"عنوان_العقد",
  ServiceDesc:"وصف_الخدمة", ProjectName:"اسم_المشروع", Partner:"جهة_التعاون", Donor:"الممول",
  RfqNo:"رقم_الإعلان", RfqDate:"تاريخ_الإعلان", OfferDate:"تاريخ_العرض",
  SignDate:"تاريخ_التوقيع", SignDay:"يوم_التوقيع", FromDate:"تاريخ_البدء", ToDate:"تاريخ_الانتهاء",
  Subject:"المادة_النشاط", SiteType:"نوع_الموقع", SiteName:"مكان_التنفيذ", Area:"المنطقة",
  Rate:"سعر_اليوم", DaysBase:"عدد_الأيام", BaseValue:"الإجمالي", BaseValueWords:"الإجمالي_كتابة",
  MinDays:"الحد_الأدنى", MaxDays:"الحد_الأعلى", DaysApproved:"الأيام_المعتمدة",
  ApprovedValue:"القيمة_المعتمدة", ApprovedValueWords:"القيمة_المعتمدة_كتابة",
  Bank:"البنك", Iban:"رقم_الحساب", Status:"حالة_العقد", TermDate:"تاريخ_الإنهاء",
  OrgName:"الطرف_الأول", OrgRep:"ممثل_الطرف_الأول", OrgRepRole:"صفة_الممثل", OrgCity:"مدينة_التوقيع",
  G_Nat:"الجنسية"
};
const MERGE2LIT = {
  G_Resid:"{{ذ:والمقيم|أ:والمقيمة}}", G_Ref:"{{ذ:ويشار إليه|أ:ويشار إليها}}",
  G_Role:"{{ذ:مقدم الخدمة|أ:مقدمة الخدمة}}"
};
const COMPUTED = { PreambleText:"نص التمهيد", Fee71Text:"نص الأتعاب", Range25Text:"مدى الـ25٪" };

const RE_MERGE = /[«»]([A-Za-z_][A-Za-z0-9_]*)[«»]|«([A-Za-z_][A-Za-z0-9_]*)»/g;
const RE_BLANK = /(?:[.…ـ_]{3,}|…{1,})/g;
const RE_ID9   = /\b\d{9}\b/g;
const RE_MONEY = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:دولار|\$)/g;
const RE_DATE  = /\d{1,2}\s*(?:يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)\s*\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/g;


/* قواعد سياقية: الجملة نفسها تكشف معنى القيمة */
const DATE_SRC = "\\d{1,2}\\s*(?:يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)\\s*\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}\\/\\d{4}";
const NUM = "\\d[\\d,]*(?:\\.\\d+)?";
const CTX_RULES = [
  [new RegExp("(?:السيد|السيدة|السيد/ة|الآنسة|الأستاذ|الأستاذة)\\s+([^\u060C,.()\\n]{6,60}?)(?=\\s*(?:[\u060C,.(]|بصفت|بصفة|الجنسية)|$)"),
   "الاسم", "اسم يلي صفة الطرف الثاني", /الطرف\s*الثاني/],
  [new RegExp("هوية\\s*(?:رقم)?\\s*[\\(（]?\\s*(\\d{6,12})"), "رقم_الهوية", "رقم يلي كلمة «هوية»"],
  [new RegExp("(?:الحساب|IBAN|الآيبان)\\s*(?:رقم|رقمه)?\\s*[:：]?\\s*([A-Za-z0-9…\\u0640_\\-]{6,40})"),
   "رقم_الحساب", "قيمة تلي «الحساب رقم»"],
  [new RegExp("(?:اعتباراً\\s+من|يسري[^\\n]{0,20}من|ابتداءً\\s+من|من)\\s+(" + DATE_SRC + ")"),
   "تاريخ_البدء", "تاريخ يلي «من» في مدة العقد"],
  [new RegExp("(?:وحتى|حتى|إلى|ولغاية|لغاية)\\s+(" + DATE_SRC + ")"),
   "تاريخ_الانتهاء", "تاريخ يلي «حتى» في مدة العقد"],
  [new RegExp("(?:في\\s+يوم[^\\n]{0,18}الموافق|تاريخ\\s+التوقيع\\s*[:：])\\s*(" + DATE_SRC + ")"),
   "تاريخ_التوقيع", "تاريخ إبرام العقد أو توقيعه"],
  [new RegExp("(?:قيمة|سعر)\\s+(?:اليوم|يوم)[^\\n]{0,40}?(" + NUM + ")\\s*(?:دولار|\\$)"),
   "سعر_اليوم", "مبلغ في جملة تذكر سعر اليوم"],
  [new RegExp("(?:القيمة\\s+(?:التقديرية|الإجمالية|الكلية)|إجمالي\\s+قيمة)[^\\n]{0,40}?(" + NUM + ")"),
   "الإجمالي", "مبلغ في جملة تذكر القيمة الإجمالية"],
  [new RegExp("(?:عدد\\s+(?:أيام|الأيام)[^\\n]{0,30}?|بعدد\\s+تقديري\\s+قدره\\s*[\\(（]?)(\\d{1,4})"),
   "عدد_الأيام", "عدد في جملة تذكر أيام التنفيذ"],
  [new RegExp("(?:مشروع|مشروع\\s+«)\\s*«?([^»\\n]{4,80})»"), "اسم_المشروع", "نص بين «» بعد كلمة مشروع"],
  [new RegExp("(?:بتمويل\\s+من|الممول|الجهة\\s+المانحة)\\s*[:：]?\\s*([^\u060C.\\n]{3,60}?)(?=\\s*[\u060C.]|$)"),
   "الممول", "جهة تلي «بتمويل من»"]
];

function esc4(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function replaceAll_(s, find, rep){ return s.split(find).join(rep); }

/* يبني قائمة مرشّحين موحّدة حسب النص */
export function detectCandidates(blocks, rec = {}, FP = FP_DEFAULT){
  const map = new Map();   /* text -> {text, token, reason, count, auto} */
  const add = (text, token, reason, auto) => {
    text = String(text);
    if(!text.trim() || text.length > 120) return;
    const e = map.get(text);
    if(e){ e.count++; if(!e.token && token){ e.token = token; e.reason = reason; e.auto = auto; } return; }
    map.set(text, { text, token: token || "", reason: reason || "", count: 1, auto: !!auto });
  };

  const known = [
    [rec.name, "الاسم"], [rec.idno, "رقم_الهوية"], [rec.project, "اسم_المشروع"],
    [rec.partner, "جهة_التعاون"], [rec.donor, "الممول"], [rec.service, "وصف_الخدمة"],
    [rec.siteName, "مكان_التنفيذ"], [rec.bank, "البنك"], [rec.iban, "رقم_الحساب"],
    [rec.rfqno, "رقم_الإعلان"], [rec.residence, "مكان_الإقامة"]
  ].filter(x => x[0] && String(x[0]).length > 3);
  const fpKnown = [
    [FP.org, "الطرف_الأول"], [FP.orgDesc, "وصف_الطرف_الأول"], [FP.rep, "ممثل_الطرف_الأول"],
    [FP.repRole, "صفة_الممثل"], [FP.city, "مدينة_التوقيع"]
  ].filter(x => x[0]);

  for(const b of blocks){
    const t = b.text || "";
    let m;
    RE_MERGE.lastIndex = 0;
    while((m = RE_MERGE.exec(t))){
      const key = m[1] || m[2];
      const lit = "«" + key + "»";
      if(MERGE2LIT[key]) add(lit, "__LIT__" + key, "حقل دمج للمذكر والمؤنث — يُستبدل بالصيغة المزدوجة", 1);
      else if(MERGE2TOK[key]) add(lit, MERGE2TOK[key], "حقل دمج موجود في الملف: " + key, 1);
      else if(COMPUTED[key]) add(lit, "", "«" + key + "» جملة كان البرنامج يحسبها — اتركها نصاً ثابتاً أو استبدلها ببند شرطي", 0);
      else add(lit, "", "حقل دمج غير معروف: " + key, 0);
    }
    fpKnown.forEach(([v, tok]) => { if(t.includes(v)) add(v, tok, "يطابق بيانات الطرف الأول المسجّلة", 1); });
    known.forEach(([v, tok]) => { if(t.includes(String(v))) add(String(v), tok, "يطابق بيانات عقد في سجلّك", 1); });
    CTX_RULES.forEach(([re, tok, why, req]) => {
      if(req && !req.test(t)) return;
      const mm = t.match(re);
      if(!mm || !mm[1]) return;
      const v = mm[1].trim();
      if(v.length < 2) return;
      if(/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) return;   /* اسم حقل دمج — تكفّلت به قاعدة الدمج */
      add(v, tok, why, 1);
    });
    (t.match(RE_BLANK) || []).forEach(v => add(v, "", "فراغ في الأصل — اختر الرمز الذي يملؤه", 0));
    (t.match(RE_ID9)   || []).forEach(v => add(v, "رقم_الهوية", "رقم من تسع خانات", 0));
    (t.match(RE_MONEY) || []).forEach(v => add(v, "", "مبلغ مالي — اختر: سعر اليوم أم قيمة العقد؟", 0));
    (t.match(RE_DATE)  || []).forEach(v => add(v, "", "تاريخ — اختر أي تاريخ هو", 0));
  }
  let list = [...map.values()];
  /* أسقط المرشّحين المكرّرين الذين يغطّيهم اقتراح مؤكَّد */
  const autos = list.filter(x => x.auto);
  list = list.filter(c => c.auto ||
    !autos.some(a => a.text !== c.text && (c.text.indexOf(a.text) >= 0 || a.text.indexOf(c.text) >= 0)));
  return list.sort((a, b) => (b.auto - a.auto) || (b.count - a.count) || b.text.length - a.text.length);
}

/* يطبّق القرارات على الكتل — الأطول أولاً حتى لا يُقطع نص داخل نص */
export function applyCandidates(blocks, cands){
  const acc = cands.filter(c => c.token).sort((a, b) => b.text.length - a.text.length);
  blocks.forEach(b => {
    let t = b.text || "";
    acc.forEach(c => {
      const rep = c.token.indexOf("__LIT__") === 0 ? MERGE2LIT[c.token.slice(7)] : "{{" + c.token + "}}";
      t = replaceAll_(t, c.text, rep);
    });
    b.text = t;
  });
  /* حقول الدمج التي لم يُتخذ لها قرار: الجمل المحسوبة تُترك كتذكير، والباقي فراغ */
  blocks.forEach(b => {
    b.text = b.text.replace(/«([A-Za-z_][A-Za-z0-9_]*)»/g,
      (m, k) => COMPUTED[k] ? "[[ " + COMPUTED[k] + " — اكتبه هنا ]]" : "…………");
  });
  return blocks;
}


const SAMPLE = { seq: 1, name: 'اسم مقدّم الخدمة', title: 'السيد', gender: 'ذكر', idno: '900000000', ctype: 'عرض سعر (استدراج عروض أسعار)', csubject: 'عقد اتفاق على تقديم خدمات تربوية',
  pricing: 'تسعير بالجلسة — سعر الجلسة × جلسات اليوم × أيام التنفيذ', rate: 40, sessPerDay: 1, daysBase: 80, daysAct: 80, dSign: '2026-07-01', dFrom: '2026-07-02', dTo: '2026-10-10', project: 'اسم المشروع', donor: 'اسم الممول', x: {} };

/** نافذة الاستيراد: اختر ملف Word، راجع القيم المقترحة رمزاً رمزاً، ثم اعتمد. onBlocks(blocks, mode) mode: replace | append */
export function wordImportDialog({ onBlocks, rec = {}, fp = FP_DEFAULT }) {
  const body = h('div', { class: 'tp-imp' });
  let dlg;
  let st = null; // {file, blocks, cands, images}
  let mode = 'replace';

  function pickScreen() {
    body.replaceChildren(
      h('p', { class: 'dlg-text' }, 'اختر ملف عقد بصيغة Word (.docx). تُقرأ الفقرات والجداول وتُحوَّل إلى مواد وبنود، ثم يقترح النظام القيم التي تتغيّر من عقد لآخر (الاسم، الهوية، التواريخ، المبالغ…) لتحوّلها إلى رموز بعد مراجعتك. لا يتغيّر شيء قبل اعتمادك، ولا يمسّ أي عقد قائم.'),
      h('label', { class: 'btn btn-primary' }, 'اختيار ملف Word',
        h('input', { type: 'file', accept: '.docx', class: 'sr-only', onchange: async (e) => {
          const f = e.target.files[0];
          e.target.value = '';
          if (!f) return;
          try {
            toast('جارٍ قراءة الملف…');
            const { items, images } = await readDocx(f);
            const blocks = blocksFromDocx(items);
            if (blocks.length < 3) throw new Error('لم يُعثر على نص كافٍ داخل الملف');
            st = { file: f.name, blocks, cands: detectCandidates(blocks, rec, fp), images };
            reviewScreen();
          } catch (ex) { toast(ex.message || 'ملف غير مدعوم', 'err'); }
        } })));
  }

  function tokenSelect(c, onChange) {
    const sel = h('select', { 'aria-label': `رمز «${c.text}»`, onchange: (e) => { c.token = e.target.value; onChange(); } },
      h('option', { value: '' }, '— نص ثابت، لا يتغيّر —'),
      TOKEN_GROUPS.map(([g, list]) => h('optgroup', { label: g }, list.map(([k]) => h('option', { value: k, selected: c.token === k }, k)))),
      c.token && c.token.startsWith('__LIT__') ? h('option', { value: c.token, selected: true }, 'صيغة المذكر والمؤنث') : null);
    return sel;
  }

  function reviewScreen() {
    const stat = h('p', { class: 'hint' });
    const warn = h('div', { class: 'notice notice-warn', hidden: true });
    const paper = h('article', { class: 'ct-paper tp-imp-prev' });
    const redraw = () => {
      const b = st.blocks;
      const n = (t) => b.filter((x) => x.type === t).length;
      stat.textContent = `${b.length} كتلة · ${n('art')} مادة · ${n('cl')} بند · ${st.cands.length} مرشّحاً للرموز · ${st.cands.filter((x) => x.token).length} مقترحاً`;
      const blocks = applyCandidates(clone(st.blocks), st.cands);
      const rev = { blocks, fields: [], fp };
      paper.innerHTML = renderBlocks(rev, SAMPLE);
      for (const [k, v] of Object.entries(fmtVars({ body: 12.5, lh: 1.9, jc: 'justify', h1: 16, h1u: 1, hi: 1, hdrLine: 'none', hdrW: 1, hdrColor: '#000', ftrLine: 'none', ftrW: 1, ftrColor: '#000', mT: 12, mB: 12, mR: 15, mL: 15 }))) paper.style.setProperty(k, v);
      applyDataStyles(paper);
      const txt = blocks.map((x) => x.text).join('\n');
      const miss = [];
      if (!PAY_TOKENS.some((k) => txt.includes(`{{${k}}}`))) miss.push('قيمة العقد ({{الإجمالي}} أو {{القيمة_المعتمدة}})');
      if (!RATE_TOKENS.some((k) => txt.includes(`{{${k}}}`))) miss.push('سعر اليوم ({{سعر_اليوم}})');
      warn.hidden = !miss.length;
      warn.textContent = miss.length ? `تنبيه: النص لا يذكر ${miss.join(' و ')}. يمكنك الاستيراد الآن، لكن لن تُحفظ الصيغة حتى تضيف الرمز الناقص.` : '';
    };
    body.replaceChildren(
      h('p', { class: 'dlg-text' }, `الملف: ${st.file}`), stat,
      h('div', { class: 'tbl-wrap tp-imp-tbl' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['القيمة في الملف', 'تُستبدل بالرمز', 'السبب'].map((x) => h('th', null, x)))),
        h('tbody', null, st.cands.length ? st.cands.map((c) => h('tr', null,
          h('td', null, h('code', null, c.text), c.count > 1 ? h('span', { class: 'sub' }, ` ${c.count} مواضع`) : null),
          h('td', null, tokenSelect(c, redraw)),
          h('td', null, c.reason || '—', c.auto ? h('span', { class: 'chip chip-present' }, 'اقتراح مؤكَّد') : null)))
          : h('tr', null, h('td', { colspan: 3 }, 'لا قيم مرشّحة: النص كله ثابت. أضف الرموز يدوياً من المحرّر.'))))),
      warn,
      h('div', { class: 'tp-bar' },
        h('button', { type: 'button', class: 'btn', onclick: () => { st.cands.forEach((c) => { if (!c.auto) c.token = ''; }); reviewScreen(); } }, 'أبقِ الاقتراحات المؤكَّدة فقط'),
        h('select', { 'aria-label': 'طريقة الإدراج', onchange: (e) => { mode = e.target.value; } }, h('option', { value: 'replace' }, 'استبدال نص الصيغة بالكامل'), h('option', { value: 'append' }, 'إضافته بعد النص الحالي'))),
      h('details', null, h('summary', null, 'معاينة النص بعد التحويل'), paper),
      h('div', { class: 'dlg-actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'إلغاء'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
          if (mode === 'replace' && !(await confirmBox('يُستبدل نص الصيغة المفتوحة بنص الملف (لا يُحفظ إلا بزر «حفظ الصيغة»).', 'استبدال', true))) return;
          onBlocks(applyCandidates(clone(st.blocks), st.cands), mode);
          dlg.close();
          toast('أُدرج النص في المحرّر — راجعه ثم احفظ الصيغة');
        } }, 'اعتماد وإدراج في المحرّر')));
    redraw();
  }

  pickScreen();
  dlg = dialog({ title: 'استيراد عقد من ملف Word', content: body, wide: true });
  return dlg;
}
