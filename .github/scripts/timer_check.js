#!/usr/bin/env node
/**
 * v5.5 计时恢复回归测试。
 * 覆盖：双钟一致、休眠时单调钟停滞、服务器兜底、墙钟调快、断网、前台调表。
 */
const fs = require('fs');
const path = require('path');
process.env.TZ = 'Asia/Shanghai';
const file = process.argv[2] || path.join(__dirname, '..', '..', 'v5.5.html');
const srcText = fs.readFileSync(file, 'utf8');
const src = srcText.split('\n');
function grab(name) {
  for (let i = 0; i < src.length; i++) {
    if (new RegExp('function ' + name + '\\(').test(src[i].trim())) {
      let buf = [src[i]], bal = src[i].split('{').length - src[i].split('}').length, j = i;
      while (bal > 0 && j + 1 < src.length) {
        j++; buf.push(src[j]);
        bal += src[j].split('{').length - src[j].split('}').length;
      }
      return buf.join('\n');
    }
  }
  throw new Error('缺少函数 ' + name);
}
if (/MAX_AUTO_GAP/.test(srcText)) throw new Error('MAX_AUTO_GAP 不应再存在');
const driftExpr = /CLOCK_DRIFT_LIMIT=([^;]+);/.exec(srcText);
if (!driftExpr) throw new Error('缺少 CLOCK_DRIFT_LIMIT');
const body = ['pad2','day','dayBucket','addSeg','accrue','captureServerClock','requestServerTime','classifyResumeClock','onHide','onShow'].map(grab).join('\n\n');
const RealDate = Date;
const T0 = RealDate.parse('2026-11-24T10:00:00+08:00');
function makeHarness() {
  const clock = {wall:T0,mono:0,serverNow:T0,offline:false,healthNoDate:false,fetches:0,saves:0,draws:0};
  const FakeDate = class extends RealDate {
    constructor(...args) { if (!args.length) super(clock.wall); else super(...args); }
    static now() { return clock.wall; }
  };
  const perf = {now:()=>clock.mono};
  const data = {session:null,records:[]};
  const consts = 'var CLOCK_DRIFT_LIMIT='+driftExpr[1]+';'+
    'var lifecycleSnapshot=null,lifecycleResolving=false,serverClockSample=null,serverClockPromise=null;'+
    "var SB='https://example.supabase.co',SBK='test-key',isWriter=true,visible=true;"+
    'var lastWall=Date.now(),lastMono=performance.now(),jumpWarn=\'\';'+
    'var save=function(){clock.saves++},draw=function(){clock.draws++};'+
    'var fetch=function(url){clock.fetches++;if(clock.offline)return Promise.reject(new Error(\'offline\'));var noDate=clock.healthNoDate&&String(url).indexOf(\'auth/v1/health\')>=0;return Promise.resolve({ok:true,headers:{get:function(name){return !noDate&&String(name).toLowerCase()===\'date\'?new RealDate(clock.serverNow).toUTCString():null}}})};';
  const runner = new Function('performance','Date','data','clock','RealDate',
    consts + body + '\nreturn {data:data,clock:clock,setSample:function(){serverClockSample={serverAt:clock.serverNow,monoAt:clock.mono,seenAt:clock.mono,rtt:0}},clearSample:function(){serverClockSample=null},resetTickBaseline:function(){lastWall=Date.now();lastMono=performance.now()},hide:onHide,show:onShow,accrue:accrue,state:function(){return {pending:!!data.session.pendingReview,review:data.session.pendingReview,work:data.session.workMs,fetches:clock.fetches,snapshot:data.session.clockSnapshot}}};');
  const T = runner(perf,FakeDate,data,clock,RealDate);
  data.session = {sid:'test-session',date:'2026-11-24',started:T0,lastAt:T0,start:'10:00',wage:200,hours:8,mode:'work',workMs:0,paidMs:0,unpaidMs:0,pendingReview:null,clockSnapshot:null,days:{'2026-11-24':{work:0,paid:0,unpaid:0}}};
  T.setSample();
  return T;
}
let pass=0,fail=0;
function check(name,got,want){const ok=got===want;if(ok)pass++;else fail++;console.log((ok?'  PASS ':'  FAIL ')+name+' | got='+String(got)+' expected='+String(want));}
async function resumeCase(name,gap,monoGap,serverGap,expectPending,offline){
  const T=makeHarness(),c=T.clock;T.hide();c.wall+=gap;c.mono+=monoGap;c.serverNow+=serverGap;c.offline=!!offline;await T.show();
  const st=T.state();check(name+' 是否进入人工核对',st.pending,expectPending);
  if(!expectPending)check(name+' 全额累计',st.work,gap);
  return st;
}
(async()=>{
  check('彻底移除 MAX_AUTO_GAP',/MAX_AUTO_GAP/.test(srcText),false);
  check('双钟阈值为 2 秒',Number(driftExpr[1]),2000);
  await resumeCase('后台 1 小时、单调钟停滞、服务器确认',3600000,0,3600000,false,false);
  await resumeCase('后台 5 小时、单调钟停滞、服务器确认',5*3600000,0,5*3600000,false,false);
  await resumeCase('后台 24 小时、单调钟停滞、服务器确认',24*3600000,0,24*3600000,false,false);
  const dual=await resumeCase('后台 5 小时、双钟一致',5*3600000,5*3600000,5*3600000,false,false);
  check('双钟一致也必须请求服务器校验绝对时间',dual.fetches>=1,true);
  await resumeCase('系统时间与单调时钟同时快进 1 小时、服务器未前进：必须冻结核对',3600000,3600000,0,true,false);
  await resumeCase('墙钟比服务器快 30 分钟',5*3600000+1800000,0,5*3600000,true,false);
  await resumeCase('双钟不一致且断网',3600000,0,3600000,true,true);
  {
    const T=makeHarness(),c=T.clock;T.clearSample();T.hide();c.wall+=3*3600000;c.serverNow+=3*3600000;await T.show();
    check('没有隐藏前心跳但恢复时服务器可用，仍静默恢复',T.state().pending,false);
    check('服务器当前时间确认后全额累计',T.state().work,3*3600000);
  }
  {
    const T=makeHarness(),c=T.clock;T.clearSample();T.hide();c.wall+=3600000;c.offline=true;await T.show();
    check('没有隐藏前心跳且恢复时断网，进入人工核对',T.state().pending,true);
  }
  {
    const T=makeHarness(),c=T.clock;T.hide();c.wall+=2*3600000;c.serverNow+=2*3600000;c.healthNoDate=true;await T.show();
    check('Supabase 未暴露 Date 时回退同源服务器时间',T.state().pending,false);
    check('同源服务器确认后全额累计',T.state().work,2*3600000);
    check('同源服务器回退至少请求两次',T.state().fetches>=2,true);
  }
  {
    const T=makeHarness(),c=T.clock;c.wall+=1800000;T.hide();
    check('切出前调快时立即拦截',T.state().pending,true);
    check('切出前调表不提前计入',T.state().work,0);
  }
  {
    const T=makeHarness(),c=T.clock;c.wall+=1800000;T.resetTickBaseline();T.hide();
    check('页面启动后墙钟绝对值快于服务器时拦截',T.state().pending,true);
    check('绝对墙钟偏差不提前计入',T.state().work,0);
  }
  {
    const T=makeHarness(),c=T.clock;c.wall+=600000;c.mono+=1000;T.accrue(c.wall,'tick');
    check('前台运行中调快系统时间被拦截',T.state().pending,true);
    check('前台调表区间不计入',T.state().work,0);
  }
  {
    const T=makeHarness(),c=T.clock;T.hide();c.wall-=60000;c.serverNow+=60000;await T.show();
    check('系统时间回退触发人工核对',T.state().pending,true);
  }
  {
    const T=makeHarness(),c=T.clock;T.hide();c.wall+=3600000;c.mono+=3600000;await T.show();
    check('双钟一致的长时间后台不弹窗',T.state().pending,false);
  }
  console.log('\n通过 '+pass+' 项，失败 '+fail+' 项');
  process.exit(fail?1:0);
})().catch(err=>{console.error(err&&err.stack||err);process.exit(1)});
