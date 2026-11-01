(function(){
"use strict";
var $=function(s){return document.querySelector(s)};
var K={cfg:"nawa_cfg",badges:"nawa_badges",pend:"nawa_pending",log:"nawa_log",
       sok:"nawa_last_sync_ok",bok:"nawa_last_badges_ok",
       pend2:"nawa_pending2",sok2:"nawa_last_sync2_ok"};
var syncErr=0, lastSyncOk=0, lastBadgeOk=0, warnedAt=0;
var cfg=null, badges=[], pending=[], pending2=[], log=[], move="حضور";
var syncErr2=0, lastSyncOk2=0, warnedAt2=0;
var stream=null, scanning=false, lastCode="", lastAt=0, canvas=null, ctx=null;
/* تسمية العرض فقط: تظهر «مغادرة» للمستخدم بينما تبقى القيمة المسجّلة في الجدول «خروج»
   حتى لا تتأثر السجلات القديمة ولا معادلات التايم شيت. */
var LBL={"خروج":"مغادرة"};
function lbl(t){return LBL[t]||t}
/* ---------- تخزين ---------- */
function load(k,d){try{var v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}}
function save(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function toast(m,ms){var t=$("#toast");t.textContent=m;t.classList.add("show");
  clearTimeout(t._h);t._h=setTimeout(function(){t.classList.remove("show")},ms||2200)}
/* رابط الخدمة: ينظّف أي نص ملصوق حوله، ويرفض ما ليس رابط نشر صالحاً.
   هذا ما يمنع تكرار عطل «رابط الخدمة: https://…» الذي عطّل المزامنة بصمت. */
function cleanUrl(s){
  var m=String(s==null?"":s).match(/https:\/\/script\.google\.com\/\S*?\/exec/);
  return m?m[0]:String(s==null?"":s).trim();
}
function validUrl(s){
  return /^https:\/\/script\.google\.com\/macros\/s\/[^\/\s]+\/exec$/.test(String(s||""));
}
/* الوجهة الثانية (النظام الجديد): رابط https ينتهي بـ /api/gate. اختيارية، ولا تؤثر على Google أبداً. */
function cleanUrl2(s){
  var m=String(s==null?"":s).match(/https:\/\/[^\/\s]+\/api\/gate/);
  return m?m[0]:String(s==null?"":s).trim();
}
function validUrl2(s){
  return /^https:\/\/[^\/\s]+\/api\/gate$/.test(String(s||""));
}
function sameOriginGate(){return location.protocol==="https:"?location.origin+"/api/gate":""}
function on2(){return !!(cfg&&cfg.url2&&cfg.token2&&validUrl2(cfg.url2))}
function pad(n){return(n<10?"0":"")+n}
function dstr(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())}
function tstr(d){return pad(d.getHours())+":"+pad(d.getMinutes())}
/* ---------- الإعدادات ---------- */
function openSetup(first){
  $("#main").classList.add("hide"); $("#setup").classList.remove("hide");
  $("#btnBack").classList.toggle("hide",!!first);
  if(cfg){
    var sel=$("#cfgCenter"), found=false;
    for(var i=0;i<sel.options.length;i++) if(sel.options[i].value===cfg.center) found=true;
    if(cfg.center&&!found){ var o=document.createElement("option");
      o.value=cfg.center; o.textContent=cfg.center+" (محفوظ سابقاً)"; sel.appendChild(o); }
    sel.value=cfg.center; $("#cfgDevice").value=cfg.device;
    $("#cfgUrl").value=cfg.url; $("#cfgToken").value=cfg.token;
    $("#cfgUrl2").value=cfg.url2||""; $("#cfgToken2").value=cfg.token2||""}
  if(!$("#cfgUrl2").value)$("#cfgUrl2").value=sameOriginGate();
  $("#cacheInfo").textContent="البطاقات المخزّنة على الجهاز: "+badges.length+
    (pending.length?"  |  حركات بانتظار الإرسال: "+pending.length:"")+
    (on2()&&pending2.length?"  |  بانتظار النظام الجديد: "+pending2.length:"");
  stopCam();
}
var wake=null;
function keepAwake(){
  if(!("wakeLock" in navigator)||wake||document.hidden)return;
  navigator.wakeLock.request("screen").then(function(l){
    wake=l; l.addEventListener("release",function(){wake=null});
  }).catch(function(){});
}
function openMain(){
  $("#setup").classList.add("hide"); $("#main").classList.remove("hide");
  $("#gateName").textContent=cfg.center;
  setMove(move); setIdle();
  render(); startCam(); keepAwake();
}
$("#btnSave").onclick=function(){
  var u=cleanUrl($("#cfgUrl").value);
  if(!u){toast("أدخل رابط الخدمة أولاً");return}
  if(!validUrl(u)){
    toast("رابط غير صالح — يجب أن يكون بصيغة https://script.google.com/macros/s/.../exec",6000);
    return}
  $("#cfgUrl").value=u;
  if(!$("#cfgCenter").value){toast("اختر اسم البوابة");return}
  var u2=cleanUrl2($("#cfgUrl2").value), t2=$("#cfgToken2").value.trim();
  if(!t2&&u2&&u2===sameOriginGate())u2="";
  if(u2||t2){
    if(!validUrl2(u2)){
      toast("رابط النظام الجديد غير صالح — يجب أن يكون بصيغة https://.../api/gate",6000);return}
    if(t2.length<16){toast("أدخل رمز جهاز النظام الجديد كاملاً",5000);return}
    $("#cfgUrl2").value=u2;
  }
  var c={center:$("#cfgCenter").value,device:$("#cfgDevice").value.trim()||"DEV-01",
         url:u,token:$("#cfgToken").value.trim(),url2:u2||"",token2:u2?t2:""};
  cfg=c; save(K.cfg,cfg); openMain(); refreshBadges(); sync(); sync2();
};
$("#btnBack").onclick=function(){openMain()};
/* نسخة احتياطية: الحركات محفوظة في متصفح هذا الجهاز فقط،
   ومسح بيانات التصفح يمحوها. هذا الزر ينزّلها كملف قبل أي عملية صيانة. */
$("#btnExport").onclick=function(){
  var all=pending.concat(log);
  if(!all.length){toast("لا توجد حركات لتنزيلها");return}
  var cols=["id","card","code","name","center","type","date","time","iso","device","offline"];
  var q=function(v){v=(v==null?"":String(v)); return '"'+v.replace(/"/g,'""')+'"'};
  var csv=cols.join(",")+"\r\n"+all.map(function(r){
    return cols.map(function(c){return q(r[c])}).join(",")}).join("\r\n");
  var blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});
  var a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="nawa-movements-"+dstr(new Date())+".csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  toast("نُزّلت "+all.length+" حركة ("+pending.length+" منها لم تُرسل بعد)",4000);
};
window.addEventListener("beforeunload",function(e){
  if(pending.length||(on2()&&pending2.length)){e.preventDefault(); e.returnValue=""}
});
$("#btnCfg").onclick=function(){openSetup(false)};
$("#btnTest").onclick=function(){
  var url=cleanUrl($("#cfgUrl").value), tk=$("#cfgToken").value.trim();
  if(!url){toast("أدخل رابط الخدمة");return}
  if(!validUrl(url)){toast("رابط غير صالح — راجع صيغة الرابط",6000);return}
  $("#cfgUrl").value=url;
  toast("جارٍ الاتصال…",4000);
  fetch(url+"?action=badges&token="+encodeURIComponent(tk))
   .then(function(r){return r.json()})
   .then(function(j){
      if(!j.ok){toast("رفض الخادم: "+(j.error||"غير معروف"),4000);return}
      badges=j.badges||[]; save(K.badges,badges);
      lastBadgeOk=Date.now(); save(K.bok,lastBadgeOk);
      $("#cacheInfo").textContent="البطاقات المخزّنة على الجهاز: "+badges.length;
      toast("نجح الاتصال — نُزّلت "+badges.length+" بطاقة",3000);
   })
   .catch(function(){toast("تعذر الاتصال — راجع الرابط والإنترنت",4000)});
};
$("#btnTest2").onclick=function(){
  var url=cleanUrl2($("#cfgUrl2").value), tk=$("#cfgToken2").value.trim();
  if(!url){toast("أدخل رابط النظام الجديد");return}
  if(!validUrl2(url)){toast("رابط النظام الجديد غير صالح — يجب أن يكون بصيغة https://.../api/gate",6000);return}
  $("#cfgUrl2").value=url;
  toast("جارٍ الاتصال بالنظام الجديد…",4000);
  fetch(url+"?action=ping&token="+encodeURIComponent(tk))
   .then(function(r){return r.json()})
   .then(function(j){
      if(!j.ok){toast("رفض النظام الجديد: "+(j.error||"غير معروف"),5000);return}
      toast("النظام الجديد يعمل — الجهاز: "+(j.device||""),4000);
   })
   .catch(function(){toast("تعذر الاتصال بالنظام الجديد — راجع الرابط والإنترنت",4000)});
};
/* ---------- أزرار الحركة ---------- */
var TYPE={"حضور":{c:"in",i:"i-sun"},"خروج":{c:"out",i:"i-out"},"عودة":{c:"back",i:"i-back"},"انصراف":{c:"end",i:"i-moon"}};
function ico(id,cls){return '<svg class="ic'+(cls?' '+cls:'')+'" aria-hidden="true"><use href="#'+id+'"/></svg>'}
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
/* يظهر نوع الحركة الحالي داخل القوس نفسه حتى لا يُسجَّل «حضور» بالخطأ مكان «انصراف» */
function setMove(t){
  move=t;
  [].forEach.call(document.querySelectorAll(".mv"),function(x){
    x.setAttribute("aria-pressed", x.dataset.t===t?"true":"false")});
  var m=$("#mode"), ty=TYPE[t]||TYPE["حضور"];
  m.className="mode t-"+ty.c;
  m.innerHTML=ico(ty.i)+'<span id="modeLbl"></span>';
  $("#modeLbl").textContent=lbl(t);
}
$("#grid").addEventListener("click",function(e){
  var b=e.target.closest(".mv"); if(!b)return;
  setMove(b.dataset.t);
});
/* ---------- الكاميرا ---------- */
function startCam(){
  if(stream)return;
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    $("#ph").textContent="الكاميرا غير مدعومة"; return}
  var facing=load("nawa_cam","environment");
  navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720}}})
  .then(function(s){
    stream=s; var v=$("#vid");
    v.classList.toggle("mirror",facing==="user");
    camButton();
    v.srcObject=s; v.classList.remove("hide"); $("#ph").classList.add("hide");
    $("#scanBox").classList.add("live");
    v.play();
    canvas=document.createElement("canvas");
    ctx=canvas.getContext("2d",{willReadFrequently:true});
    scanning=true; requestAnimationFrame(tick);
  })
  .catch(function(err){
    $("#ph").classList.remove("hide");
    $("#ph").style.fontSize="15px"; $("#ph").style.letterSpacing="0";
    $("#ph").style.padding="0 18px"; $("#ph").style.textAlign="center";
    $("#ph").textContent="تعذر تشغيل الكاميرا — تأكد من فتح الصفحة عبر https ومن منح إذن الكاميرا";
  });
}
function camButton(){
  var b=$("#btnFlip"); if(!b||!navigator.mediaDevices||!navigator.mediaDevices.enumerateDevices)return;
  navigator.mediaDevices.enumerateDevices().then(function(ds){
    var n=0; for(var i=0;i<ds.length;i++)if(ds[i].kind==="videoinput")n++;
    b.classList.toggle("hide",n<2);
  }).catch(function(){});
}
$("#btnFlip").onclick=function(){
  save("nawa_cam",load("nawa_cam","environment")==="user"?"environment":"user");
  stopCam(); startCam();
};
function stopCam(){
  scanning=false;
  if(stream){stream.getTracks().forEach(function(t){t.stop()});stream=null}
  var v=$("#vid"); if(v){v.classList.add("hide");v.srcObject=null}
  $("#ph").classList.remove("hide"); $("#scanBox").classList.remove("live");
}
function tick(){
  if(!scanning)return;
  var v=$("#vid");
  if(v.readyState===v.HAVE_ENOUGH_DATA&&typeof jsQR==="function"){
    var w=Math.min(v.videoWidth,640), sc=w/v.videoWidth, h=Math.round(v.videoHeight*sc);
    if(w>0&&h>0){
      canvas.width=w; canvas.height=h;
      ctx.drawImage(v,0,0,w,h);
      try{
        var img=ctx.getImageData(0,0,w,h);
        var code=jsQR(img.data,w,h,{inversionAttempts:"dontInvert"});
        if(code&&code.data) onCode(code.data.trim());
      }catch(e){}
    }
  }
  requestAnimationFrame(tick);
}
/* ---------- تنبيهات ---------- */
var actx=null;
function unlockAudio(){
  try{
    var A=window.AudioContext||window.webkitAudioContext; if(!A)return;
    if(!actx)actx=new A();
    if(actx.state==="suspended")actx.resume();
  }catch(e){}
}
["pointerdown","touchend","click","keydown"].forEach(function(ev){document.addEventListener(ev,unlockAudio,{passive:true})});
function beep(ok){
  try{
    unlockAudio(); var c=actx; if(!c)return;
    var tone=function(freq,start,dur){
      var o=c.createOscillator(), g=c.createGain();
      o.connect(g); g.connect(c.destination);
      o.frequency.value=freq; o.type="sine";
      g.gain.setValueAtTime(.0001,c.currentTime+start);
      g.gain.exponentialRampToValueAtTime(.18,c.currentTime+start+.012);
      g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+start+dur);
      o.start(c.currentTime+start); o.stop(c.currentTime+start+dur+.03);
    };
    if(ok){ tone(880,0,.16); }
    else { tone(220,0,.14); tone(220,.2,.14); } /* نغمة رفض مزدوجة — لا تلتبس بنغمة القبول الواحدة */
  }catch(e){}
  if(navigator.vibrate)navigator.vibrate(ok?60:[70,60,70]);
}
/* ---------- معالجة المسح ---------- */
function onCode(code){
  var now=Date.now();
  if(code===lastCode&&now-lastAt<2500)return;
  lastCode=code; lastAt=now;
  var b=null;
  for(var i=0;i<badges.length;i++){if(badges[i].card===code){b=badges[i];break}}
  if(!b){ reject(code,"بطاقة غير مسجّلة"); return }
  if(String(b.status).trim()!=="سارية"){ reject(code,"بطاقة ملغاة — "+(b.name||""),b); return }
  var d=new Date(), today=dstr(d);
  for(var j=0;j<log.length;j++){
    var L=log[j];
    if(L.code===b.code&&L.type===move&&L.date===today){
      if(move==="حضور"||move==="انصراف"){ reject(code,"سبق تسجيل "+lbl(move)+" اليوم — "+b.name,b); return }
      if(now-new Date(L.iso).getTime()<180000){ reject(code,"مسح مكرر خلال ٣ دقائق",b); return }
    }
  }
  accept(b,d);
}
var CHECK_SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
var CROSS_SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
var resTimer=0, lastRec=null;
function setIdle(){
  clearTimeout(resTimer); lastRec=null;
  var r=$("#res"); r.className="res"; r.innerHTML='<span class="idle">'+ico("i-qr")+'وجّه رمز البطاقة نحو الكاميرا</span>';
}
function flashHit(ok){
  var s=$("#scanBox"); $("#flashBadge").innerHTML=ok?CHECK_SVG:CROSS_SVG;
  s.classList.remove("hit-ok","hit-bad"); void s.offsetWidth;
  s.classList.add(ok?"hit-ok":"hit-bad");
  clearTimeout(s._h); s._h=setTimeout(function(){s.classList.remove("hit-ok","hit-bad")},1800);
}
function showRes(ok,title,code,b,rec){
  clearTimeout(resTimer);
  var r=$("#res"); r.className="res "+(ok?"ok":"bad"); r.innerHTML="";
  var lead=el("div","lead"), seal=el("div","seal"); seal.innerHTML=ok?CHECK_SVG:CROSS_SVG;
  if(ok&&b&&b.photo){var im=new Image(); im.src=b.photo; im.alt=""; lead.className="lead has-photo"; lead.appendChild(im)}
  lead.appendChild(seal); r.appendChild(lead);
  var w=el("div","who"); w.appendChild(el("div","nm",title));
  var m=el("div","meta");
  if(code)m.appendChild(el("span","cd",code.length>42?code.slice(0,40)+"…":code));
  if(ok&&rec){
    var ty=TYPE[rec.type]||TYPE["حضور"], tg=el("span","tag t-"+ty.c);
    tg.innerHTML=ico(ty.i); tg.appendChild(document.createTextNode(lbl(rec.type))); tg.appendChild(el("span","tm",rec.time)); m.appendChild(tg);
  }
  w.appendChild(m);
  if(ok){
    var h=el("div","hint"); h.innerHTML=ico("i-eye"); h.appendChild(document.createTextNode("طابق الوجه قبل السماح بالدخول")); w.appendChild(h);
    var s=el("div","sent"); s.id="resSent"; w.appendChild(s);
  }
  r.appendChild(w);
  r.classList.remove("pop"); void r.offsetWidth; r.classList.add("pop");
  resTimer=setTimeout(setIdle, ok?14000:9000);
}
/* حالة وصول آخر حركة إلى كل وجهة: تظهر في بطاقة النتيجة نفسها فيطمئن الحارس أنها حُفظت */
function updSent(){
  var s=$("#resSent"); if(!s||!lastRec)return;
  var id=lastRec.id, g=!pending.some(function(p){return p.id===id});
  var h='<span class="tick '+(g?'ok':'')+'">'+ico(g?"i-check":"i-up")+(g?"وصلت Google":"بانتظار Google")+'</span>';
  if(on2()){var n=!pending2.some(function(p){return p.id===id});
    h+='<span class="tick '+(n?'ok':(syncErr2?'err':''))+'">'+ico(n?"i-check":"i-up")+(n?"وصلت النظام الجديد":"بانتظار النظام الجديد")+'</span>'}
  s.innerHTML=h;
}
function reject(code,msg,b){
  beep(false);
  showRes(false,msg,code); flashHit(false);
  addFeed({name:msg,time:tstr(new Date()),type:"",ok:false});
}
function accept(b,d){
  beep(true);
  var iso=d.toISOString();
  var rec={
    id:"MV-"+d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+pad(d.getHours())+
       pad(d.getMinutes())+pad(d.getSeconds())+"-"+b.code,
    card:b.card, code:b.code, name:b.name, center:cfg.center,
    type:move, date:dstr(d), time:tstr(d), iso:iso,
    device:cfg.device, offline:!navigator.onLine, note:""
  };
  pending.push(rec); save(K.pend,pending);
  if(on2()){pending2.push(rec); save(K.pend2,pending2)}
  log.unshift(rec); log=log.slice(0,300); save(K.log,log);
  lastRec=rec;
  showRes(true,b.name,b.code,b,rec); flashHit(true);
  addFeed({name:b.name,time:rec.time,type:move,ok:true},true);
  render(); sync(); sync2();
}
function addFeed(x,fresh){
  var f=$("#feed");
  if(f.querySelector(".em"))f.innerHTML="";
  var ty=TYPE[x.type], row=el("div","row"+(x.ok?(ty?" t-"+ty.c:""):" no")+(fresh?" fresh":""));
  var dot=el("span","dot"); dot.innerHTML=ico(x.ok?(ty?ty.i:"i-check"):"i-x"); row.appendChild(dot);
  row.appendChild(el("span","nmx",x.name));
  row.appendChild(el("span","what",x.ok?(x.type?lbl(x.type):""):"مرفوضة"));
  row.appendChild(el("span","t",x.time));
  f.insertBefore(row,f.firstChild);
  while(f.children.length>8)f.removeChild(f.lastChild);
}
function esc(s){var d=document.createElement("div");d.textContent=s==null?"":s;return d.innerHTML}
/* ---------- العرض ---------- */
var DAYS=["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
var MONTHS=["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
function clockTick(){var d=new Date(); $("#clk").textContent=tstr(d); $("#dt").textContent=DAYS[d.getDay()]+" "+d.getDate()+" "+MONTHS[d.getMonth()]+" "+d.getFullYear()}
function render(){
  var today=dstr(new Date()), n=0;
  for(var i=0;i<log.length;i++)if(log[i].date===today)n++;
  $("#cnt").textContent=n;
  var p=$("#pend");
  p.textContent = pending.length ? ("بانتظار الإرسال: "+pending.length) : "لا شيء بانتظار الإرسال";
  p.className = "pend"+(pending.length?(syncErr?" bad":""):" zero");
  $("#syncG").className="sync"+(pending.length?(syncErr?" bad":" wait"):"");
  var sn=$("#syncN");
  if(on2()){
    var p2=$("#pend2");
    p2.textContent = pending2.length ? ("بانتظار الإرسال: "+pending2.length) : "لا شيء بانتظار الإرسال";
    p2.className = "pend"+(pending2.length?(syncErr2?" bad":""):" zero");
    sn.className="sync"+(pending2.length?(syncErr2?" bad":" wait"):"");
  } else sn.className="sync hide";
  var online=navigator.onLine;
  $("#conn").className = "conn"+(online?"":" off");
  $("#connLbl").textContent = online?"متصل":"غير متصل";
  clockTick(); updSent();
  updateWarn();
}
/* شريط تحذير ظاهر بدل الفشل الصامت */
function mins(t){return Math.round((Date.now()-t)/60000)}
function updateWarn(){
  var w=$("#warn"), msgs=[], hard=false;
  if(!cfg||!validUrl(cfg.url||"")){
    msgs.push("رابط الخدمة غير صالح — لن تصل أي حركة. افتح الإعدادات ⚙ وصحّحه.");hard=true}
  if(pending.length){
    var t = pending.length+" حركة لم تصل الجدول بعد";
    if(syncErr){t+=" — آخر محاولة إرسال فشلت";hard=true}
    t += lastSyncOk ? (" · آخر إرسال ناجح قبل "+mins(lastSyncOk)+" دقيقة")
                    : " · لم ينجح أي إرسال على هذا الجهاز بعد";
    if(pending.length>=20||(lastSyncOk&&mins(lastSyncOk)>60)) hard=true;
    msgs.push(t);
  }
  if(on2()&&pending2.length){
    var t2=pending2.length+" حركة لم تصل النظام الجديد بعد (Google غير متأثر)";
    if(syncErr2)t2+=" — آخر محاولة فشلت";
    msgs.push(t2);
  }
  if(!navigator.onLine) msgs.push("لا يوجد اتصال بالإنترنت — الحركات تُحفظ محلياً وتُرسل عند عودة الشبكة.");
  if(lastBadgeOk && Date.now()-lastBadgeOk>86400000)
    msgs.push("قائمة البطاقات لم تُحدَّث منذ أكثر من ٢٤ ساعة — قد تُرفض بطاقات موظفين جدد.");
  if(!badges.length) {msgs.push("لا توجد بطاقات مخزّنة على هذا الجهاز — كل مسح سيُرفض.");hard=true}
  if(msgs.length){
    w.className="warn"+(hard?"":" soft");
    w.innerHTML=msgs.map(function(m){return '<div class="wl">'+ico("i-alert")+'<span>'+m+'</span></div>'}).join("");
  } else w.className="warn hide";
}
/* ---------- المزامنة ---------- */
var syncing=false;
function sync(){
  if(syncing||!pending.length||!navigator.onLine||!cfg||!cfg.url)return;
  syncing=true;
  var batch=pending.slice(0,40);
  fetch(cfg.url,{
    method:"POST",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({token:cfg.token,moves:batch})
  })
  .then(function(r){return r.json()})
  .then(function(j){
    syncing=false;
    if(!j.ok){syncErr++; toast("رفض الخادم: "+(j.error||"سبب غير معروف"),5000); render(); return}
    syncErr=0; lastSyncOk=Date.now(); save(K.sok,lastSyncOk);
    var ids={}; batch.forEach(function(m){ids[m.id]=1});
    pending=pending.filter(function(m){return !ids[m.id]});
    save(K.pend,pending); render();
    if(pending.length)sync();
  })
  .catch(function(){
    syncing=false; syncErr++;
    if(Date.now()-warnedAt>120000){
      warnedAt=Date.now();
      toast("تعذّر إرسال الحركات — "+pending.length+" حركة معلّقة على الجهاز",5000);
    }
    render();
  });
}
/* مزامنة النظام الجديد: طابورها وحالتها وأخطاؤها مستقلة تماماً عن sync() الخاصة بـ Google. */
var syncing2=false;
function sync2(){
  try{
    if(syncing2||!pending2.length||!navigator.onLine||!on2())return;
    syncing2=true;
    var batch=pending2.slice(0,40);
    var ac=(typeof AbortController!=="undefined")?new AbortController():null;
    var to=setTimeout(function(){if(ac)ac.abort()},20000);
    fetch(cfg.url2,{
      method:"POST",
      headers:{"Content-Type":"text/plain;charset=utf-8"},
      body:JSON.stringify({token:cfg.token2,moves:batch}),
      signal:ac?ac.signal:undefined
    })
    .then(function(r){return r.json()})
    .then(function(j){
      clearTimeout(to); syncing2=false;
      if(!j||!j.ok){
        syncErr2++;
        if(Date.now()-warnedAt2>120000){warnedAt2=Date.now();
          toast("رفض النظام الجديد: "+((j&&j.error)||"سبب غير معروف"),4000)}
        render(); return}
      syncErr2=0; lastSyncOk2=Date.now(); save(K.sok2,lastSyncOk2);
      var ids={}; batch.forEach(function(m){ids[m.id]=1});
      pending2=pending2.filter(function(m){return !ids[m.id]});
      save(K.pend2,pending2); render();
      if(pending2.length)sync2();
    })
    .catch(function(){
      clearTimeout(to); syncing2=false; syncErr2++; render();
    });
  }catch(e){syncing2=false}
}
function refreshBadges(){
  if(!navigator.onLine||!cfg||!cfg.url)return;
  fetch(cfg.url+"?action=badges&token="+encodeURIComponent(cfg.token))
  .then(function(r){return r.json()})
  .then(function(j){
    if(j.ok&&j.badges){badges=j.badges;save(K.badges,badges);
      lastBadgeOk=Date.now(); save(K.bok,lastBadgeOk);}
    else if(!j.ok){toast("تعذّر تحديث البطاقات: "+(j.error||""),4000)}
    render();
  })
  .catch(function(){render()});
}
/* ---------- الإقلاع ---------- */
cfg=load(K.cfg,null); badges=load(K.badges,[]);
pending=load(K.pend,[]); log=load(K.log,[]); pending2=load(K.pend2,[]);
lastSyncOk2=load(K.sok2,0)||0;
lastSyncOk=load(K.sok,0)||0; lastBadgeOk=load(K.bok,0)||0;
/* إصلاح ذاتي: إن كان الرابط المحفوظ ملتصقاً بنص (مثل «رابط الخدمة: …») نظّفه */
if(cfg&&cfg.url){
  var _u=cleanUrl(cfg.url);
  if(_u!==cfg.url&&validUrl(_u)){cfg.url=_u; save(K.cfg,cfg);}
}
if(cfg&&cfg.url2){
  var _u2=cleanUrl2(cfg.url2);
  if(_u2!==cfg.url2&&validUrl2(_u2)){cfg.url2=_u2; save(K.cfg,cfg);}
}
log.slice(0,5).reverse().forEach(function(r){
  addFeed({name:r.name,time:r.time,type:r.type,ok:true})});
if(cfg&&cfg.url)openMain(); else openSetup(true);
setInterval(function(){render();sync();sync2()},20000);
setInterval(updateWarn,60000);
setInterval(clockTick,5000);
setInterval(refreshBadges,900000);
window.addEventListener("online",function(){render();sync();sync2();refreshBadges()});
window.addEventListener("offline",render);
document.addEventListener("visibilitychange",function(){
  if(document.hidden)stopCam();
  else if(!$("#main").classList.contains("hide")){startCam(); keepAwake()}
});
refreshBadges();

/* ---------- تثبيت التطبيق ---------- */
var instEv=null;
function standalone(){return (window.matchMedia&&matchMedia("(display-mode: standalone)").matches)||navigator.standalone===true}
window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();instEv=e;if(!standalone())$("#btnInstall").classList.remove("hide")});
window.addEventListener("appinstalled",function(){instEv=null;$("#btnInstall").classList.add("hide");toast("تم تثبيت التطبيق")});
$("#btnInstall").onclick=function(){
  if(!instEv)return;
  instEv.prompt(); instEv.userChoice.then(function(){instEv=null;$("#btnInstall").classList.add("hide")});
};
var ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
if(ios&&!standalone())$("#iosHint").classList.remove("hide");

/* ---------- العمل دون اتصال + التحديث ---------- */
var needReload=false;
if("serviceWorker" in navigator){
  var hadCtl=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js").catch(function(){});
  navigator.serviceWorker.addEventListener("controllerchange",function(){if(hadCtl)needReload=true});
}
/* لا نعيد التحميل أثناء المسح: ننتظر دقيقة بلا حركة وبلا حركات معلّقة داخل شاشة المسح */
setInterval(function(){
  if(needReload&&Date.now()-lastAt>60000&&!pending.length&&!(on2()&&pending2.length)&&!document.hidden)location.reload();
},15000);
})();