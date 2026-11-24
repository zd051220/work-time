#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""5.3 补丁：单写者（同一台设备只让一个页面计时）+ 字段级脏检查渲染。

用法：python3 .github/scripts/release_53.py   （读 v5.2.html，写 v5.3.html）
所有替换都断言唯一命中，避免误改。
"""
import io
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'v5.2.html'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'v5.3.html'

s = io.open(SRC, encoding='utf-8').read()


def rep(old, new, tag):
    global s
    n = s.count(old)
    assert n == 1, '!! %s 命中 %d 次（应为 1）：%r' % (tag, n, old[:70])
    s = s.replace(old, new, 1)
    print('  patched: %s' % tag)


# ---------------------------------------------------------------- A. 单写者
BLOCK = r"""/* ===== 5.3 单写者：同一台设备只让一个页面计时 ===== */
var MW_LOCK='mw_writer_v53', MW_CH='mw_sync_v53', isWriter=true, mwBc=null, mwRelease=null;
try{if('BroadcastChannel' in window)mwBc=new BroadcastChannel(MW_CH)}catch(e){mwBc=null}
function mwBar(msg,canTake){
  var b=$('writerBar');
  if(!msg){if(b)b.remove();return}
  if(!b){b=document.createElement('div');b.id='writerBar';b.style.cssText='position:fixed;left:0;right:0;bottom:calc(74px + env(safe-area-inset-bottom));z-index:80;background:#594632;color:#fff;font-size:11px;padding:9px 12px;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 14px #3b2a1a33';document.body.appendChild(b)}
  b.innerHTML='<span>'+msg+'</span>'+(canTake?'<button id="takeoverBtn" style="border:0;background:#f0c063;color:#4a3416;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:800;font-family:inherit">接管计时</button>':'');
  if(canTake){$('takeoverBtn').onclick=function(){if(mwBc)mwBc.postMessage({type:'takeover'});mwBar('正在接管…',false);setTimeout(mwClaim,350)}}
}
function mwSetRole(w){
  isWriter=w;
  if(!w){['startBtn','stopBtn','paidBtn','unpaidBtn','resumeBtn'].forEach(function(id){var el=$(id);if(el)el.disabled=true});mwBar('另一个页面正在计时，本页只读',true)}
  else{mwBar('',false);draw()}
}
function mwClaim(){
  if(!navigator||!navigator.locks||!navigator.locks.request){mwSetRole(true);return}
  navigator.locks.request(MW_LOCK,{mode:'exclusive',ifAvailable:true},function(lock){
    if(!lock){mwSetRole(false);return}
    mwSetRole(true);
    return new Promise(function(res){mwRelease=function(){mwRelease=null;res()}})
  }).catch(function(){});
}
if(mwBc)mwBc.onmessage=function(ev){
  var m=ev.data||{};
  if(m.type==='snap'&&m.session&&!isWriter){data.session=upgradeSession(m.session);draw()}
  else if(m.type==='takeover'&&isWriter){save();if(mwBc)mwBc.postMessage({type:'snap',session:data.session});if(mwRelease)mwRelease();mwSetRole(false)}
};
mwClaim();
if(mwBc)setInterval(function(){if(isWriter&&data.session){try{mwBc.postMessage({type:'snap',session:data.session})}catch(e){}}},1000);
/* ===== 5.3 渲染：只写真正变化的字段 ===== */
var mwTxt={};
function st(id,v){var el=$(id);if(!el)return;if(mwTxt[id]===v)return;mwTxt[id]=v;el.textContent=v}
var mwSig='';
function drawSoft(){
  st('now','现在时间 '+new Date().toLocaleTimeString('zh-CN',{hour12:false}));
  var s=data.session;
  if(!s){if(mwSig!=='idle'){mwSig='idle';draw()}return}
  var t=todayTotals(),r=rate(),payMs=t.work+t.paid,pay=payMs/1000*r,goal=s.hours*3600000;
  st('earned','¥'+pay.toFixed(4));st('workTime',duration(t.work));st('paidTime',duration(t.paid));st('unpaidTime',duration(t.unpaid));
  st('paidTotal',duration(payMs));st('totalTime',duration(payMs+t.unpaid));
  var pct=goal>0?payMs/goal*100:0;$('fill').style.width=Math.min(100,Math.max(0,pct))+'%';
  st('pct',pct.toFixed(1)+'%'+(pct>100?' · 已超标准工时':''));
  st('hourRate',money(r*3600));st('todayPay',money(pay));
  var sig=[s.mode,s.pendingReview?1:0,Object.keys(s.days||{}).length,data.records.length,jumpWarn?1:0,monthView].join('|');
  if(sig!==mwSig){mwSig=sig;draw()}
}
"""
rep("document.addEventListener('visibilitychange',function(){document.hidden?onHide():onShow()});",
    BLOCK + "document.addEventListener('visibilitychange',function(){document.hidden?onHide():onShow()});",
    '5.3 单写者与渲染代码块')

# save()：非写者不落盘；lastAt 单调；带 rev；写后广播
rep("function save(){try{localStorage.setItem(KEY,JSON.stringify({version:5,records:data.records,session:data.session,del:data.del||[]}));",
    "function save(){if(!isWriter)return;var mwCur=null;try{mwCur=JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){}\n"
    "  if(mwCur&&mwCur.session&&(Number(mwCur.session.lastAt)||0)>(Number(data.session&&data.session.lastAt)||0)){data.session=upgradeSession(mwCur.session);draw()}\n"
    "  var mwRev=(Number(mwCur&&mwCur.rev)||0)+1;"
    "try{localStorage.setItem(KEY,JSON.stringify({version:5,records:data.records,session:data.session,del:data.del||[],rev:mwRev}));",
    'save() 单写者/单调/rev')

rep("toast('本地存储空间不足，请立即导出备份')}\n  if(data.session)sesPush();",
    "toast('本地存储空间不足，请立即导出备份')}\n  if(data.session){sesPush();if(mwBc&&isWriter){try{mwBc.postMessage({type:'snap',session:data.session})}catch(e){}}}",
    'save() 广播快照')

# 每秒定时器：非写者不累计、不渲染
rep("setInterval(function(){if(document.hidden){if(visible)onHide();return}if(!visible)onShow();if(data.session&&!data.session.pendingReview)accrue(Date.now(),'tick');draw()},1000);",
    "setInterval(function(){if(document.hidden){if(visible)onHide();return}if(!visible)onShow();if(!isWriter)return;if(data.session&&!data.session.pendingReview)accrue(Date.now(),'tick');drawSoft()},1000);",
    'tick 定时器')

# 隐藏/显示时也只有写者结算
rep("function onHide(){visible=false;if(data.session&&!data.session.pendingReview){accrue(Date.now(),'hide');save()}",
    "function onHide(){visible=false;if(isWriter&&data.session&&!data.session.pendingReview){accrue(Date.now(),'hide');save()}",
    'onHide 写者判定')
rep("function onShow(){visible=true;if(data.session&&!data.session.pendingReview){accrue(Date.now(),'resume');save()}",
    "function onShow(){visible=true;if(isWriter&&data.session&&!data.session.pendingReview){accrue(Date.now(),'resume');save()}",
    'onShow 写者判定')

# 云端推送也只有写者做
rep("function sesPush(){\n  if(!accSess()||!data.session)return;",
    "function sesPush(){\n  if(!isWriter||!accSess()||!data.session)return;",
    'sesPush 写者判定')

# draw() 里的按钮可用性也要受写者身份约束
rep("$('startBtn').disabled=!!s;$('stopBtn').disabled=!s||!!s.pendingReview;$('paidBtn').disabled=!s||s.mode!=='work'||!!s.pendingReview;$('unpaidBtn').disabled=!s||s.mode!=='work'||!!s.pendingReview;$('resumeBtn').disabled=!s||s.mode==='work'||!!s.pendingReview;",
    "$('startBtn').disabled=!isWriter||!!s;$('stopBtn').disabled=!isWriter||!s||!!s.pendingReview;$('paidBtn').disabled=!isWriter||!s||s.mode!=='work'||!!s.pendingReview;$('unpaidBtn').disabled=!isWriter||!s||s.mode!=='work'||!!s.pendingReview;$('resumeBtn').disabled=!isWriter||!s||s.mode==='work'||!!s.pendingReview;",
    'draw() 按钮写者约束')

# draw() 结束后清空文本缓存，避免脏检查与全量刷新互相干扰
rep("setReviewUI();drawRecords();}",
    "setReviewUI();drawRecords();mwTxt={};}",
    'draw() 清空文本缓存')

# ------------------------------------------------- B2. 账本页不整体覆盖 session
LEDGER = 'ledger.html'
led = io.open(LEDGER, encoding='utf-8').read()
if 'MW_LEDGER_MERGE' in led:
    print('  ledger.html: 已是 5.3 合并版，跳过')
else:
    old_led = "function save(){try{localStorage.setItem(KEY,JSON.stringify(data))}catch(e){toast('存储失败，请先导出备份')}}"
    new_led = ("/* MW_LEDGER_MERGE */\n"
               "  function save(){try{\n"
               "    var cur=null;try{cur=JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){}\n"
               "    if(cur&&cur.session&&(Number(cur.session.lastAt)||0)>(Number((data.session||{}).lastAt)||0))data.session=cur.session;\n"
               "    var merged=(data.del||[]).slice();(cur&&cur.del?cur.del:[]).forEach(function(x){if(!merged.some(function(y){return String(y.id)===String(x.id)}))merged.push(x)});data.del=merged;\n"
               "    localStorage.setItem(KEY,JSON.stringify(data))\n"
               "  }catch(e){toast('存储失败，请先导出备份')}}")
    assert led.count(old_led) == 1, '!! ledger save() 命中 %d 次' % led.count(old_led)
    led = led.replace(old_led, new_led, 1)
    io.open(LEDGER, 'w', encoding='utf-8').write(led)
    print('  patched: ledger.html 保存时以最新 session 为准（不再倒灌旧 lastAt）')

io.open(OUT, 'w', encoding='utf-8').write(s)
print('%s -> %s（%d 字符）' % (SRC, OUT, len(s)))
