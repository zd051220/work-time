'use strict';
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.resolve(__dirname, '../../v5.5.html'), 'utf8');
const ledger = fs.readFileSync(path.resolve(__dirname, '../../ledger-v5.5.html'), 'utf8');
const checks = [];
function check(name, ok) {
  checks.push({name, ok: !!ok});
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
}
function extract(source, start, end) {
  const a = source.indexOf(start);
  if (a < 0) throw new Error('Missing source: ' + start);
  const b = source.indexOf(end, a);
  if (b < 0) throw new Error('Missing source end: ' + end);
  return source.slice(a, b);
}
const accrueSource = extract(html, 'function accrue(now){', 'function rate(){');
const durationSource = extract(html, 'function duration(ms){', 'function toast(t){');
const editSource = extract(html, 'function timeSeconds(v){', 'function toast(t){');
const accrue = new Function('data','day','addSeg', accrueSource + ';return accrue;');
const makeAccrue = session => {
  const data = {session};
  const addSeg = (s,d,mode,ms) => { s[mode+'Ms'] += ms; s.days[d] = (s.days[d] || 0) + ms; };
  return accrue(data, ts => new Date(ts).toISOString().slice(0,10), addSeg);
};
const duration = new Function(durationSource + ';return duration;')();
const timeSeconds = new Function(editSource + ';return timeSeconds;')();
const editRecordEnd = new Function('duration','timeSeconds',
  extract(html,'function editRecordEnd(r,end){','function rate(){') + ';return editRecordEnd;'
)(duration,timeSeconds);

check('完全移除双时钟比较和单调时钟变量', !/CLOCK_DRIFT_LIMIT|performance\.now|lastMono|lastWall/.test(html));
check('完全移除异常横幅、冻结和人工核对状态', !/clockReviewBanner|clockReviewInclude|pendingReview|clockSnapshot|jumpWarn|setReviewUI/.test(html));
check('不再发起 Supabase 服务器时间校验请求', !/requestServerTime\s*\(|verifyServerWall\s*\(|captureServerClock\s*\(/.test(html));
check('后台隐藏与恢复只通过 Date.now 差值补时', /function onHide\(\).*?Date\.now\(\).*?accrue/s.test(html) && /function onShow\(\).*?Date\.now\(\).*?accrue/s.test(html));
check('首页和完整账本都存在结束时间编辑入口', /class="edit"/.test(html) && /class="edit"/.test(ledger));
check('编辑结束时间会更新结束时间、工作时长、总时长和工资', /r\.end=end/.test(html) && /r\.work=duration\(work\*1000\)/.test(html) && /r\.duration=/.test(html) && /r\.pay=/.test(html));
check('首页修改后会调用云端单条记录同步', /accPushOne\(editRec\)/.test(html));
check('完整账本修改后会调用云端记录同步', /cloudPushAll\(\)/.test(ledger));

{
  const start = Date.UTC(2026, 10, 27, 8);
  const s = {lastAt:start,mode:'work',workMs:0,paidMs:0,unpaidMs:0,days:{}};
  makeAccrue(s)(start + 60*60*1000);
  check('前台经过 1 小时按 Date.now 差值累计', s.workMs === 3600000 && s.lastAt === start+3600000);
}
{
  const start = Date.UTC(2026, 10, 27, 8);
  const s = {lastAt:start,mode:'work',workMs:0,paidMs:0,unpaidMs:0,days:{}};
  makeAccrue(s)(start + 10*60*60*1000);
  check('后台经过 10 小时静默补计，不需要确认', s.workMs === 10*3600000 && s.lastAt === start+10*3600000);
}
{
  const start = Date.UTC(2026, 10, 27, 23);
  const s = {lastAt:start,mode:'work',workMs:0,paidMs:0,unpaidMs:0,days:{}};
  makeAccrue(s)(start + 2*60*60*1000);
  check('跨午夜补时仍按日期拆分且总工时准确', s.workMs === 2*3600000 && Object.values(s.days).reduce((a,b)=>a+b,0) === 2*3600000 && Object.keys(s.days).length === 2);
}
{
  const r = {date:'2026-11-27',start:'08:00',end:'17:00',work:'09:00:00',paid:'00:00:00',unpaid:'00:00:00',duration:'09:00:00',wage:800,hours:8,pay:900};
  const ok = editRecordEnd(r,'16:00');
  check('17:00 改为 16:00：工时和工资同步扣减', ok && r.end==='16:00' && r.work==='08:00:00' && r.duration==='08:00:00' && r.pay===800);
}
{
  const r = {start:'08:00',end:'17:00',work:'07:00:00',paid:'01:00:00',unpaid:'01:00:00',duration:'09:00:00',wage:800,hours:8,pay:800};
  const ok = editRecordEnd(r,'16:00');
  check('改结束时间时保留已登记的带薪和不带薪休息', ok && r.work==='06:00:00' && r.paid==='01:00:00' && r.unpaid==='01:00:00' && r.duration==='08:00:00' && r.pay===700);
}
{
  const r = {start:'08:00',end:'17:00',work:'09:00:00',paid:'00:00:00',unpaid:'00:00:00',duration:'09:00:00',wage:800,hours:8,pay:900};
  check('拒绝无效时间格式和早于上班时间的结束时间', !editRecordEnd(r,'25:00') && !editRecordEnd(r,'07:00'));
}
const failed = checks.filter(x => !x.ok);
console.log('\n通过 ' + (checks.length-failed.length) + ' 项，失败 ' + failed.length + ' 项');
process.exit(failed.length ? 1 : 0);
