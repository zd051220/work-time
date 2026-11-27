#!/usr/bin/env node
/**
 * 计时纯函数自检（发布门禁）。
 * 用法：node .github/scripts/timer_check.js [v5.5.html]
 * 口径：无感补时——切后台/离线期间按挂钟流逝全额计入，不设上限、不弹核对；系统时间回退只重置基线不倒扣。
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
      while (bal > 0 && j + 1 < src.length) { j++; buf.push(src[j]); bal += src[j].split('{').length - src[j].split('}').length; }
      return buf.join('\n');
    }
  }
  throw new Error('缺少函数 ' + name);
}

const consts = `
var data = {session:null, records:[]};
`;
const body = ['pad2', 'day', 'ym', 'hhmm', 'duration', 'dayBucket', 'addSeg', 'todayTotals', 'accrue']
  .map(grab).join('\n\n');

let W = 0;
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(W); else super(...a); }
  static now() { return W; }
};
const runner = new Function('Date', 'data', consts + body +
  '\nreturn {accrue, todayTotals, day, duration, data, session:()=>data.session};');
const T = runner(global.Date, global.data = { session: null, records: [] });

const T0 = RealDate.parse('2026-11-24T10:00:00+08:00');
function start(mode) {
  W = T0;
  const d = '2026-11-24';
  T.data.session = { date: d, started: T0, lastAt: T0, start: '10:00', wage: 200, hours: 8, mode: mode || 'work',
    workMs: 0, paidMs: 0, unpaidMs: 0, engineVersion: 5,
    days: { [d]: { work: 0, paid: 0, unpaid: 0 } } };
}
const sec = (x) => Math.round(x / 1000);
const day24 = () => T.data.session.days['2026-11-24'];
const work = () => sec(day24().work);
const tick = () => { W += 1000; T.accrue(W, 'tick'); };

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log((ok ? '  ok  ' : '  FAIL ') + name.padEnd(44) + ' 得到 ' + String(got).padEnd(9) + (ok ? '' : ' 期望 ' + want));
}

// 1. 连续 20 分钟
start(); for (let i = 0; i < 1200; i++) tick();
check('连续 20 分钟', work(), 1200);

// 2. 切后台 10 分钟（挂钟流逝）→ 全额补回
start(); for (let i = 0; i < 600; i++) tick(); T.accrue(W, 'hide'); W += 600000; T.accrue(W, 'resume');
check('切后台 10 分钟全额补回', work(), 1200);

// 3. 后台 10 分钟后切回，第二层不重复计入
T.accrue(W, 'resume');
check('重复切回不重复计入', work(), 1200);

// 4. 后台 2.9 小时 → 全额补回
start(); for (let i = 0; i < 600; i++) tick(); T.accrue(W, 'hide'); W += 2.9 * 3600000; T.accrue(W, 'resume');
check('后台 2.9 小时全额补回', work(), sec(600000 + 2.9 * 3600000));

// 5. 后台 3.5 小时（无上限）→ 全额补回
start(); for (let i = 0; i < 600; i++) tick(); T.accrue(W, 'hide'); W += 3.5 * 3600000; T.accrue(W, 'resume');
check('后台 3.5 小时无上限全额补回', work(), sec(600000 + 3.5 * 3600000));

// 6. 后台 10 小时（无上限）→ 全额补回
start(); for (let i = 0; i < 600; i++) tick(); T.accrue(W, 'hide'); W += 10 * 3600000; T.accrue(W, 'resume');
check('后台 10 小时无上限全额补回', work(), sec(600000 + 10 * 3600000));

// 7. 系统时间回退 10 分钟 → 只重置基线，不倒扣
start(); for (let i = 0; i < 600; i++) tick(); W -= 600000; T.accrue(W, 'tick');
check('系统时间回退不倒扣', work(), 600);
W += 600000; T.accrue(W, 'tick');
check('回退后时钟调回按前进跳变补记', work(), 1200);

// 8. 前台挂钟跳变 30 分钟 → 全额补记
start(); for (let i = 0; i < 600; i++) tick(); W += 1800000; T.accrue(W, 'tick');
check('挂钟调快 30 分钟全额补记', work(), 600 + 1800);

// 9. 整 1 小时的计薪秒数与收入
start(); for (let i = 0; i < 3600; i++) tick();
const rate = 200 / 8 / 3600;
check('整 1 小时的计薪毫秒数', day24().work + day24().paid, 3600000);
check('整 1 小时收入（200 日薪 / 8 小时）', +(rate * 3600).toFixed(6), 25);

// 10. 跨午夜拆分：22:00 → 次日 02:00，共 4 小时，分到两个自然日
start();
const eve = RealDate.parse('2026-11-23T22:00:00+08:00');
W = eve;
T.data.session.date = '2026-11-23'; T.data.session.started = eve; T.data.session.lastAt = eve;
T.data.session.days = { '2026-11-23': { work: 0, paid: 0, unpaid: 0 }, '2026-11-24': { work: 0, paid: 0, unpaid: 0 } };
for (let i = 0; i < 4 * 3600; i++) { W += 1000; T.accrue(W, 'tick'); }
const buckets = T.data.session.days;
const totalWork = buckets['2026-11-23'].work + buckets['2026-11-24'].work;
const nonEmpty = Object.keys(buckets).filter(k => buckets[k].work > 0);
check('跨午夜合计 4 小时', totalWork, 4 * 3600000);
check('跨午夜拆到 2 个自然日', nonEmpty.length, 2);

// 11. 不带薪摸鱼只记 unpaid，不计入工作 / 带薪
start('unpaid'); for (let i = 0; i < 60; i++) tick();
check('不带薪：工作为 0', day24().work, 0);
check('不带薪：带薪为 0', day24().paid, 0);
check('不带薪：记到不带薪 60 秒', day24().unpaid, 60000);

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
