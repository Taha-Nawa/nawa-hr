// محرّك صيغ العقود: الرموز {{...}} وشروط الكتل وتحويل الكتل إلى HTML — منقول من سجل العقود القديم.
// الصيغة (النسخة) كائن: {blocks, fields, fp, consts, fmt, foot, logos, logoCfg}.
import { compute, tafqeet, priceKind, money } from './contracts-lib.js';
import { dayName, longDate, contractNo } from './contract-doc.js';

export const SUBJ_RE = /^\s*عقد\s+اتفاق\s+على\s+/;
export const subjBare = v => String(v||"").replace(SUBJ_RE, "").trim();
export const subjFull = v => { const t = String(v||"").trim(); return SUBJ_RE.test(t) ? t : (t ? "عقد اتفاق على "+t : ""); };
/* f=1 يعني قيمة تتغيّر بتغيّر المتعاقد فتُظلَّل في العقد */
export const TOKEN_GROUPS = [
["الطرف الثاني", [
  ["الاسم", (r)=>r.name, 1],
  ["الصفة", (r)=>r.title, 0],
  ["رقم_الهوية", (r)=>r.idno, 1],
  ["الجنسية", (r)=>r.gender==="أنثى"?"فلسطينية الجنسية":"فلسطيني الجنسية", 0],
  ["الجنس", (r)=>r.gender, 0],
  ["مكان_الإقامة", (r)=>r.residence||"قطاع غزة", 0],
  ["الجوال", (r)=>r.phone, 1],
  ["البريد", (r)=>r.email, 1],
  ["التخصص", (r)=>r.major, 0],
  ["سنوات_الخبرة", (r)=>r.exp, 0]
]],
["تعريف العقد", [
  ["رقم_العقد", (r)=>contractNo(r), 1],
  ["نوع_العقد", (r)=>r.ctype, 0],
  ["موضوع_العقد", (r)=>subjBare(r.csubject), 0],
  ["عنوان_العقد", (r)=>subjFull(r.csubject), 0],
  ["وصف_الخدمة", (r)=>r.service, 1],
  ["اسم_المشروع", (r)=>r.project, 0],
  ["جهة_التعاون", (r)=>r.partner, 0],
  ["الممول", (r)=>r.donor, 1],
  ["المادة_النشاط", (r)=>r.subject, 0],
  ["حالة_العقد", (r)=>r.status, 0]
]],
["التواريخ", [
  ["يوم_التوقيع", (r)=>dayName(r.dSign), 1],
  ["تاريخ_التوقيع", (r)=>longDate(r.dSign), 1],
  ["تاريخ_البدء", (r)=>longDate(r.dFrom), 1],
  ["تاريخ_الانتهاء", (r)=>longDate(r.dTo), 1],
  ["رقم_الإعلان", (r)=>r.rfqno, 1],
  ["تاريخ_الإعلان", (r)=>longDate(r.dRfq), 1],
  ["تاريخ_العرض", (r)=>longDate(r.dOffer), 1],
  ["تاريخ_الإنهاء", (r)=>longDate(r.dTerm), 1]
]],
["المال — إلزامية", [
  ["سعر_الجلسة", (r)=>r.rate, 1],
  ["جلسات_اليوم", (r,c)=>c.spd, 1],
  ["سعر_اليوم", (r,c)=>c.dayRate!==null?c.dayRate:r.rate, 1],
  ["عدد_الأيام", (r)=>r.daysBase, 1],
  ["إجمالي_الجلسات", (r,c)=>c.sessB!==null?c.sessB:"", 1],
  ["الأيام_المعتمدة", (r)=>r.daysAct, 1],
  ["الجلسات_المعتمدة", (r,c)=>c.sessA!==null?c.sessA:"", 1],
  ["الإجمالي", (r,c)=>c.base!==null?money(c.base):"", 1],
  ["الإجمالي_كتابة", (r,c)=>c.base!==null?tafqeet(c.base):"", 1],
  ["القيمة_المعتمدة", (r,c)=>c.appr!==null?money(c.appr):"", 1],
  ["القيمة_المعتمدة_كتابة", (r,c)=>c.words, 1],
  ["الحد_الأدنى", (r,c)=>c.min, 1],
  ["الحد_الأعلى", (r,c)=>c.max, 1],
  ["البنك", (r)=>r.bank, 1],
  ["رقم_الحساب", (r)=>r.iban, 1]
]],
["مكان التنفيذ", [
  ["مكان_التنفيذ", (r)=>r.siteName, 1],
  ["نوع_الموقع", (r)=>r.siteType, 0],
  ["المنطقة", (r)=>r.area, 1]
]],
["الطرف الأول", [
  ["الطرف_الأول", (r,c,v)=>v.fp.org, 0],
  ["وصف_الطرف_الأول", (r,c,v)=>v.fp.orgDesc, 0],
  ["ممثل_الطرف_الأول", (r,c,v)=>v.fp.rep, 0],
  ["صفة_الممثل", (r,c,v)=>v.fp.repRole, 0],
  ["مدينة_التوقيع", (r,c,v)=>v.fp.city, 0],
  ["عنوان_الجمعية", (r,c,v)=>v.fp.addr, 0],
  ["هاتف_الجمعية", (r,c,v)=>v.fp.tel, 0],
  ["فاكس_الجمعية", (r,c,v)=>v.fp.fax, 0]
]]];
export const TOKMAP = {};
TOKEN_GROUPS.forEach(g=>g[1].forEach(([k,fn,f])=>{ TOKMAP[k] = {fn, fill:!!f}; }));

/* رموز المال التي تضمن حق المتعاقد — لا تُحفظ صيغة بدونها */
export const PAY_TOKENS  = ["الإجمالي","القيمة_المعتمدة"];
export const RATE_TOKENS = ["سعر_اليوم","سعر_الجلسة","الإجمالي"];

export function tokenList(rev){
  const out = TOKEN_GROUPS.map(g=>[g[0], g[1].map(x=>x[0])]);
  const cf = (rev && rev.fields || []).map(f=>f.k);
  if(cf.length) out.push(["حقول هذه الصيغة", cf]);
  return out;
}
export function tokenValue(key, r, c, rev){
  const t = TOKMAP[key];
  if(t) return {v: t.fn(r,c,rev), fill: t.fill, ok:1};
  const f = (rev.fields||[]).find(x=>x.k===key);
  if(f) return {v: (r.x||{})[key], fill:1, ok:1};
  return {v:"", fill:0, ok:0};
}

/* ============================ تحويل النص إلى HTML ============================ */
export const DOTS = "…………";
function esc2(s){ return String(s===null||s===undefined?"":s)
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
export function markup(s){
  return s.replace(/\*\*([^*]+)\*\*/g,"<b>$1</b>").replace(/__([^_]+)__/g,"<u>$1</u>");
}
export function tokenHTML(body, r, c, rev){
  /* صيغة المذكر/المؤنث: ذ:نص|أ:نص */
  if(/^\s*ذ\s*:/.test(body)){
    const parts = body.split("|");
    const m = {}; parts.forEach(p=>{ const i=p.indexOf(":"); if(i>0) m[p.slice(0,i).trim()] = p.slice(i+1); });
    return esc2(r.gender==="أنثى" ? (m["أ"]||m["ذ"]||"") : (m["ذ"]||m["أ"]||""));
  }
  const key = body.trim();
  const t = tokenValue(key, r, c, rev);
  if(!t.ok) return '<span class="badtok">{{'+esc2(key)+'}}</span>';
  const v = (t.v===null||t.v===undefined||t.v==="") ? DOTS : String(t.v);
  return t.fill ? '<span class="fill">'+esc2(v)+'</span>' : esc2(v);
}
export function inlineHTML(text, r, c, rev){
  let out = "", last = 0, m;
  const re = /\{\{([\s\S]*?)\}\}/g;
  while((m = re.exec(text))){
    out += markup(esc2(text.slice(last, m.index)));
    out += tokenHTML(m[1], r, c, rev);
    last = re.lastIndex;
  }
  return out + markup(esc2(text.slice(last)));
}
/* أسطر تبدأ بـ "- " تصبح قائمة نقطية داخل الفقرة */
export function bodyHTML(text, r, c, rev){
  const lines = String(text||"").split("\n");
  let html = "", bullets = [];
  const flush = ()=>{ if(bullets.length){ html += '<ul class="docs">'+bullets.map(b=>"<li>"+b+"</li>").join("")+"</ul>"; bullets=[]; } };
  lines.forEach(ln=>{
    const t = ln.replace(/^\s+/,"");
    if(/^-\s+/.test(t)) bullets.push(inlineHTML(t.replace(/^-\s+/,""), r, c, rev));
    else { flush(); if(t.trim()) html += (html?"<br>":"") + inlineHTML(t, r, c, rev); }
  });
  flush();
  return html;
}
export function blockOn(b, r){
  const w = b.when; if(!w) return true;
  if(w.ctype && w.ctype.length && w.ctype.indexOf(r.ctype)<0) return false;
  if(w.pricing && w.pricing.length){
    const k = priceKind(r.pricing);
    if(!w.pricing.some(v => priceKind(v) === k)) return false;
  }
  if(w.gender && w.gender !== r.gender) return false;
  if(w.sessions){
    const spd = compute(r).spd;
    if(w.sessions === "multi" && !(spd > 1)) return false;
    if(w.sessions === "one"   && !(spd <= 1)) return false;
  }
  return true;
}
export function blockStyle(b){
  const s = b.style || {}, out = [];
  if(s.align) out.push("text-align:"+s.align);
  if(s.size)  out.push("font-size:"+s.size+"pt");
  if(s.before) out.push("margin-top:"+s.before+"px");
  if(s.after)  out.push("margin-bottom:"+s.after+"px");
  if(s.b) out.push("font-weight:700");
  if(s.u) out.push("text-decoration:underline");
  /* data-st لا style: سياسة CSP في النظام تمنع سمة style المضمّنة؛ تُطبَّق عبر applyDataStyles بعد الإدراج */
  return out.length ? ' data-st="'+out.join(";")+'"' : "";
}
export function renderBlocks(rev, r){
  const c = compute(r);
  let art = 0, cl = 0, h = "";
  for(const b of (rev.blocks||[])){
    if(!blockOn(b, r)) continue;
    const st = blockStyle(b);
    const brk = (b.style && b.style.nb) ? '<div class="pbreak"></div>' : "";
    const inner = bodyHTML(b.text, r, c, rev);
    switch(b.type){
      case "h1":      h += brk+'<h1'+st+'>'+inner+'</h1>'; break;
      case "lede":    h += brk+'<p class="lede"'+st+'>'+inner+'</p>'; break;
      case "sec":     h += brk+'<h2'+st+'>'+inner+'</h2>'; break;
      case "art":     art++; cl = 0;
                      h += brk+'<h2'+st+'>المادة ('+art+'): '+inner+'</h2>'; break;
      case "cl":      cl++;
                      h += brk+'<div class="cl"'+st+'><b>'+art+'.'+cl+'</b><div>'+inner+'</div></div>'; break;
      case "party":   h += brk+'<p class="party"'+st+'>'+inner+'</p>'; break;
      case "sigdate": h += brk+'<p class="sigdate"'+st+'>'+inner+'</p>'; break;
      case "sign": {
        const p = String(b.text||"").split("|");
        const cell = (t,n)=>'<div><b>'+inlineHTML(t||"", r, c, rev)+'</b><div class="nm">'
          + inlineHTML(n||"", r, c, rev)+'</div><div class="sg">التوقيع: ...............................</div></div>';
        h += brk+'<div class="sign"'+st+'>'+cell(p[0],p[1])+cell(p[2],p[3])+'</div>'; break;
      }
      case "pagebreak": h += '<div class="pbreak"></div>'; break;
      default:        h += brk+'<p'+st+'>'+inner+'</p>';
    }
  }
  return h;
}

