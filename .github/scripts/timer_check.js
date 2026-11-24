#!/usr/bin/env node
/**
 * 计时纯函数自检（发布门禁）。
 * 用法：node .github/scripts/timer_check.js [v5.2.html]
 * 从目标 HTML 里抽出计时相关纯函数，用可控时钟跑场景断言；任意一项失败则退出码 1，
 * 发布工作流会因此阻断提交。新增计时行为时请在这里补对应场景。
 */
const fs = require('fs');
const path = require('path');

// 测试场景使用 +08:00 的固定时间，CI 也必须按产品目标时区运行。
process.env.TZ = 'Asia/Shanghai';

const file = process.argv[2] || path.join(__dirname, '..', '..', 'v5.2.html');
const srcText = fs.readFileSync(file, 'utf8');
const src = srcText.split('\n');

function grab(name) {
  for (let i = 0; i < src.length; i++) {
    if (new RegExp('function ' + name + '\\(').test(src[i].trim())) {
      let buf = [src[i]], bal = src[i].split('{').length - src[i].split('}').length, j = i;
      while (bal > 0 && j + 1 < src.length) { j++; buf.push(src[j]); bal += src[j].split('{').length - src[j].split('}').length; }
      return buf.join('\n');
    }
  }
  throw new Error('缺少函数 ' + name);
}

const gapExpr = /MAX_AUTO_GAP=([^;]+);/.exec(srcText)[1];
const driftExpr = /CLOCK_DRIFT_LIMIT=([^;]+);/.exec(srcText)[1];
const consts = `
var MAX_AUTO_GAP = ${gapExpr};
var CLOCK_DRIFT_LIMIT = ${driftExpr};
var lastMono = performance.now();
var lastWall = Date.now();
var jumpWarn = '';
var data = {session:null, records:[]};
`;
const body = ['pad2', 'day', 'ym', 'hhmm', 'duration', 'dayBucket', 'addSeg', 'todayTotals', 'accrue']
  .map(grab).join('\n\n');

// 可控时钟
let W = 0, M = 0;
global.performance = { now: () => M };
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(W); else super(...a); }
  static now() { return W; }
};
const runner = new Function('performance', 'Date', 'data', consts + body +
  '\nreturn {accrue, todayTotals, day, duration, data, session:()=>data.session, setLast:(w,m)=>{lastWall=w;lastMono=m}, jumpWarn:()=>jumpWarn};');
const T = runner(global.performance, global.Date, global.data = { session: null, records: [] });

const T0 = RealDate.parse('2026-11-24T10:00:00+08:00');
function start(mode) {
  W = T0; M = 0; T.setLast(T0, 0);
  const d = '2026-11-24';
  T.data.session = { date: d, started: T0, lastAt: T0, start: '10:00', wage: 200, hours: 8, mode: mode || 'work',
    workMs: 0, paidMs: 0, unpaidMs: 0, pendingReview: null, engineVersion: 5,
    days: { [d]: { work: 0, paid: 0, unpaid: 0 } } };
}
const sec = (x) => Math.round(x / 1000);
const day24 = () => T.data.session.days['2026-11-24'];
const work = () => sec(day24().work);
const pending = () => !!T.data.session.pendingReview;
const tick = () => { W += 1000; M += 1000; T.accrue(W, 'tick'); };

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log((ok ? '  ok  ' : '  FAIL ') + name.padEnd(42) + ' 得到 ' + String(got).padEnd(9) + (ok ? '' : ' 期望 ' + want));
}

// 0. 阈值本身：3 小时（防被改回 30 分钟）
const gapMs = eval(gapExpr);
check('MAX_AUTO_GAP = 3 小时', gapMs, 3 * 60 * 60 * 1000);

// 1. 连续 20 分钟
start(); for (let i = 0; i < 1200; i++) tick();
check('连续 20 分钟', work(), 1200);

// 2. 锁屏 10 分钟，单调时钟停走（手机休眠）→ 全额补回，不弹核对
start(); for (let i = 0; i < 600; i++) tick(); T.accrue(W, 'hide'); W += 600000; T.accrue(W, 'resume');
check('锁屏 10 分钟（单调钟停走）', work(), 1200);
check('  且不弹核对', pending(), false);

// 3. 锁屏 10 分钟，单调时钟照走（桌面端）
start(); for (let i = 0; i < 600; i++) tick(); T.accrue(W, 'hide'); W += 600000; M += 600000; T.accrue(W, 'resume');
check('锁屏 10 分钟（单调钟照走）', work(), 1200);

// 4. 锁屏 2.9 小时（低于新阈值）→ 全额补回，不弹核对
start(); for (let i = 0; i < 600; i++) tick(); T.accrue(W, 'hide'); W += 2.9 * 3600000; T.accrue(W, 'resume');
check('锁屏 2.9 小时（低于 3 小时阈值）全额计入', work(), sec(600000 + 2.9 * 3600000));
check('  且不弹核对', pending(), false);

// 5. 锁屏 3.5 小时（超过阈值）→ 停在锁屏前，要求核对
start(); for (let i = 0; i < 600; i++) tick(); T.accrue(W, 'hide'); W += 3.5 * 3600000; T.accrue(W, 'resume');
check('锁屏 3.5 小时（超过 3 小时阈值）', work(), 600);
check('  会要求核对', pending(), true);

// 6. 系统时间回退 10 分钟
start(); for (let i = 0; i < 600; i++) tick(); W -= 600000; T.accrue(W, 'tick');
check('系统时间回退 10 分钟', work(), 600);
check('  会要求核对', pending(), true);

// 7. 前台把系统时间调快 30 分钟
start(); for (let i = 0; i < 600; i++) tick(); W += 1800000; T.accrue(W, 'tick');
check('前台调快 30 分钟', work(), 600);
check('  会要求核对', pending(), true);

// 8. 整 1 小时的计薪秒数与收入
start(); for (let i = 0; i < 3600; i++) tick();
const rate = 200 / 8 / 3600;
check('整 1 小时的计薪毫秒数', day24().work + day24().paid, 3600000);
check('整 1 小时收入（200 日薪 / 8 小时）', +(rate * 3600).toFixed(6), 25);

// 9. 跨午夜拆分：22:00 → 次日 02:00，共 4 小时，分到两个自然日
start();
const eve = RealDate.parse('2026-11-23T22:00:00+08:00');
W = eve; M = 0; T.setLast(eve, 0);
T.data.session.date = '2026-11-23'; T.data.session.started = eve; T.data.session.lastAt = eve;
T.data.session.days = { '2026-11-23': { work: 0, paid: 0, unpaid: 0 }, '2026-11-24': { work: 0, paid: 0, unpaid: 0 } };
for (let i = 0; i < 4 * 3600; i++) { W += 1000; M += 1000; T.accrue(W, 'tick'); }
const buckets = T.data.session.days;
const totalWork = buckets['2026-11-23'].work + buckets['2026-11-24'].work;
const nonEmpty = Object.keys(buckets).filter(k => buckets[k].work > 0);
check('跨午夜合计 4 小时', totalWork, 4 * 3600000);
check('跨午夜拆到 2 个自然日', nonEmpty.length, 2);

// 10. 不带薪摸鱼只记 unpaid，不计入工作 / 带薪
start('unpaid'); for (let i = 0; i < 60; i++) tick();
check('不带薪：工作为 0', day24().work, 0);
check('不带薪：带薪为 0', day24().paid, 0);
check('不带薪：记到不带薪 60 秒', day24().unpaid, 60000);

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
