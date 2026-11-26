#!/usr/bin/env node
'use strict';
/**
 * v5.5 timer regression tests: UX-first, warning-only dual clock.
 * Covers foreground drift warnings, action-path accrual, lock/background recovery,
 * and confirms there is no server-time or manual-review gate.
 */
const fs = require('node:fs');
const path = require('node:path');
const file = process.argv[2] || path.join(__dirname, '..', '..', 'v5.5.html');
const html = fs.readFileSync(file, 'utf8');

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('Missing function ' + name);
  const brace = html.indexOf('{', start);
  let depth = 0, quote = null, escaped = false, lineComment = false, blockComment = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i], next = html[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error('Unclosed function ' + name);
}

const checks = [];
function check(name, condition) {
  checks.push({ name, ok: !!condition });
  console.log((condition ? '  PASS ' : '  FAIL ') + name);
}
function makeHarness() {
  const RealDate = Date;
  const T0 = RealDate.parse('2026-11-27T09:00:00+08:00');
  const clock = { wall: T0, mono: 1000, timeOrigin: 123456, saves: 0, draws: 0 };
  class FakeDate extends RealDate {
    constructor(...args) { if (!args.length) super(clock.wall); else super(...args); }
    static now() { return clock.wall; }
  }
  const performance = { now: () => clock.mono, timeOrigin: clock.timeOrigin };
  const data = { session: {
    lastAt: T0, mode: 'work', workMs: 0, paidMs: 0, unpaidMs: 0,
    days: { '2026-11-27': { work: 0, paid: 0, unpaid: 0 } }, clockSnapshot: null
  }};
  const funcs = ['accrue', 'onHide', 'onShow'].map(extractFunction).join('\n');
  const runner = new Function('Date','performance','data','clock','RealDate','day','addSeg','save','draw',
    'var CLOCK_DRIFT_LIMIT=2000,lifecycleResolving=false,lifecycleSnapshot=null,visible=true,isWriter=true,lastWall=Date.now(),lastMono=performance.now(),jumpWarn="";' +
    funcs +
    '\nreturn {clock,data,accrue,onHide,onShow,state:function(){return {work:data.session.workMs,pending:data.session.pendingReview||null,lastAt:data.session.lastAt,warn:jumpWarn,snapshot:data.session.clockSnapshot}}};');
  return runner(FakeDate, performance, data, clock, RealDate,
    () => '2026-11-27',
    (s, d, mode, ms) => { s[mode + 'Ms'] += ms; s.days[d][mode] += ms; },
    () => { clock.saves++; },
    () => { clock.draws++; });
}

(async () => {
  check('双时钟阈值为 2 秒', /var CLOCK_DRIFT_LIMIT=2000;/.test(html));
  check('不再请求服务器时间进行绝对校验', !/requestServerTime\s*\(|verifyServerWall\s*\(/.test(html));
  check('不再包含强制人工核对入口', !/reviewInclude|reviewManual|reviewEndTime|resolveReview\s*\(/.test(html));
  check('异常检测横幅为普通提示，不再要求点击核对', /id="clockReviewBanner" role="status"/.test(html));
  check('下班按钮不受异常状态锁定', /\$\('stopBtn'\)\.disabled=!isWriter\|\|!s;/.test(html));
  check('切换带薪休息按钮不受异常状态锁定', /\$\('paidBtn'\)\.disabled=!isWriter\|\|!s\|\|s\.mode==='paid';/.test(html));
  check('计时器不再创建 pendingReview 冻结状态', !/pendingReview\s*=/.test(html));

  {
    const T = makeHarness(), c = T.clock;
    c.wall += 1000; c.mono += 1000; T.accrue(c.wall, 'tick');
    check('正常前台计时按秒累计且不提示', T.state().work === 1000 && !T.state().warn);
  }
  {
    const T = makeHarness(), c = T.clock;
    c.wall += 3600000; c.mono += 1000; T.accrue(c.wall, 'action');
    check('点击操作触发时发现双钟偏差仍显示提示', T.state().warn.includes('明显变动'));
    check('异常提示不会冻结或丢弃已经过的工时', T.state().work === 3600000 && !T.state().pending);
  }
  {
    const T = makeHarness(), c = T.clock;
    T.onHide(); c.wall += 5 * 3600000; c.mono += 5 * 3600000; T.onShow();
    check('锁屏/后台五小时双钟一致：静默补计', T.state().work === 5 * 3600000 && !T.state().warn);
  }
  {
    const T = makeHarness(), c = T.clock;
    T.onHide(); c.wall += 5 * 3600000; T.onShow();
    check('系统挂起导致单调钟暂停：仍按墙钟恢复且不误报', T.state().work === 5 * 3600000 && !T.state().warn);
  }
  {
    const T = makeHarness(), c = T.clock;
    T.onHide(); c.wall += 6 * 3600000; c.mono += 5 * 3600000; T.onShow();
    check('后台期间墙钟与单调钟偏差：显示提示但照常累计', T.state().work === 6 * 3600000 && T.state().warn.includes('明显变动'));
  }
  {
    const T = makeHarness(), c = T.clock;
    c.wall -= 60000; c.mono += 1000; T.accrue(c.wall, 'action');
    check('系统时间回退不产生负工时并重置基准', T.state().work === 0 && T.state().lastAt === c.wall && T.state().warn.includes('回退'));
  }

  const failed = checks.filter(x => !x.ok);
  console.log('\n通过 ' + (checks.length - failed.length) + ' 项，失败 ' + failed.length + ' 项');
  process.exit(failed.length ? 1 : 0);
})().catch(err => { console.error(err && err.stack || err); process.exit(1); });
