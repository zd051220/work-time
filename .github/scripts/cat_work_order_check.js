#!/usr/bin/env node
'use strict';
// Behavioural check for the cat game work-order UI (cat-workshop.html) and the
// parent RPC bridge error mapping (beta-v5.5.html). Runs the real inline scripts
// against a minimal DOM stub; no network, no Supabase.
const fs = require('fs');
const path = require('path');

let failures = 0;
let passed = 0;
function check(ok, message) {
  if (ok) { passed++; } else { failures++; console.error('FAIL cat work orders: ' + message); }
}

function scriptsOf(file) {
  const source = fs.readFileSync(file, 'utf8');
  return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
}

/* ---------- minimal DOM ---------- */
class Text { constructor(t) { this.nodeType = 3; this.textContent = t; } }
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.style = {}; this.dataset = {};
    this.disabled = false; this.isConnected = true; this._text = ''; this._l = {}; this.attributes = {};
  }
  get lastChild() { return this.children[this.children.length - 1]; }
  get options() { return this.children.filter(c => c.tagName === 'OPTION'); }
  get value() { return this._value !== undefined ? this._value : ((this.options[0] && this.options[0].value) || ''); }
  set value(v) { this._value = v; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attributes[k] = v; }
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
  click() { (this._l.click || []).forEach(f => f({})); }
  find(pred) {
    if (pred(this)) return this;
    for (const c of this.children) { if (c instanceof El) { const r = c.find(pred); if (r) return r; } }
    return null;
  }
}
const ids = {};
function el(id) { return ids[id] || (ids[id] = Object.assign(new El('div'), { id })); }
['level', 'coins', 'stamina', 'catName', 'catHp', 'catHpBar', 'inventorySlots', 'inventoryHint', 'equipmentSlots',
  'jobCatalog', 'workOrderPanel', 'workMessage', 'connection', 'refreshCloud',
  'catXp', 'catAtk', 'catDef', 'catLuck', 'catMining', 'catSatiety', 'catMood', 'catAffection', 'cloudProgress',
  'jobGrowth', 'worldProgressList'].forEach(el);
const doc = {
  _l: {}, body: new El('body'),
  getElementById: id => ids[id] || null,
  createElement: tag => new El(tag),
  createTextNode: t => new Text(t),
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
  dispatchEvent(e) { (this._l[e.type] || []).forEach(f => f(e)); }
};

/* ---------- manual timers and clock ---------- */
let now = Date.parse('2026-11-26T02:00:00.000Z');
const realNow = Date.now;
Date.now = () => now;
let seq = 0;
const timers = {};
const setTimeoutFn = (fn, ms) => { timers[++seq] = { fn, ms, interval: false }; return seq; };
const setIntervalFn = (fn, ms) => { timers[++seq] = { fn, ms, interval: true }; return seq; };
const clearIntervalFn = id => { delete timers[id]; };
const clearTimeoutFn = id => { delete timers[id]; };
const tick = () => { Object.keys(timers).forEach(k => { if (timers[k].interval) timers[k].fn(); }); };
const flushTimeouts = () => { Object.keys(timers).forEach(k => { if (!timers[k].interval) { const t = timers[k]; delete timers[k]; t.fn(); } }); };
const intervalCount = () => Object.values(timers).filter(t => t.interval).length;

/* ---------- window / parent channel ---------- */
const sent = [];
const parent = { postMessage(m) { sent.push(m); } };
const win = {
  location: { origin: 'https://example.test' }, parent, crypto: undefined, _l: {},
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
};
function reply(msg, ok, data, error) {
  win._l.message.forEach(f => f({ origin: 'https://example.test', source: parent, data: { type: 'game-rpc-result', id: msg.id, ok, data, error } }));
  return new Promise(r => process.nextTick(r)); // let promise callbacks run
}
function micro() { return new Promise(r => setImmediate(r)); }

/* ---------- run the real game page script ---------- */
const workshop = path.join(__dirname, '..', '..', 'cat-workshop.html');
const gameScripts = scriptsOf(workshop).slice(0, 1);
check(gameScripts.length === 1, 'cat-workshop.html must expose exactly one cloud script block to run');
new Function('window', 'document', 'CustomEvent', 'setTimeout', 'setInterval', 'clearInterval', 'clearTimeout', gameScripts[0])(
  win, doc, class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
  setTimeoutFn, setIntervalFn, clearIntervalFn, clearTimeoutFn
);

(async () => {
  flushTimeouts(); // 500 ms bootstrap delay
  check(sent.length === 1 && sent[0].method === 'game_bootstrap', 'page must request game_bootstrap on load');

  // Device clock is 5 minutes behind the server: the order really completes at serverNow + 1h.
  const skewMs = 5 * 60000;
  const serverNow = new Date(now + skewMs).toISOString().replace(/\.\d{3}Z$/, '.123456+00:00'); // 6-digit fraction like Postgres
  const doneAt = new Date(now + skewMs + 3600000).toISOString();
  const startedAt = new Date(now + skewMs - 60000).toISOString();
  const snapshot = (orders, catalog) => ({
    server_now: serverNow,
    profile: { public_name: '测试猫' },
    cat: { level: 3, hp: 80, max_hp: 100, xp: 40, attack: 5, defense: 2, luck: 1, mining_power: 5, satiety: 80, mood: 90, affection: 12 },
    wallet: { coins: 1234 },
    inventory: [], equipment: [], jobs: [], work_orders: orders, job_catalog: catalog, world: [], tasks: [], achievements: []
  });
  const bakery = { job_code: 'bakery', display_name: '面包店学徒', allowed_durations_minutes: [60, 120] };
  const activeOrder = { order_id: '11111111-2222-4333-8444-555555555555', job_code: 'bakery', status: 'active', started_at: startedAt, completes_at: doneAt };

  await reply(sent[0], true, snapshot([activeOrder], [bakery]));
  check(ids.coins.textContent === '1,234', 'snapshot wallet must be rendered, got ' + ids.coins.textContent);
  check(ids.catHp.textContent === '80 / 100', 'cat HP must come from the cloud snapshot');
  // Character sheet, home state and growth lists must all be read from the snapshot.
  check(ids.catXp.textContent === '40' && ids.catAtk.textContent === '5' && ids.catDef.textContent === '2' &&
    ids.catLuck.textContent === '1' && ids.catMining.textContent === '5', 'XP and attributes must come from the cloud snapshot');
  check(ids.catSatiety.textContent === '80 / 100' && ids.catMood.textContent === '90 / 100' && ids.catAffection.textContent === '12',
    'home state must come from the cloud snapshot');
  check(ids.cloudProgress.textContent === '' && ids.jobGrowth.textContent === '还没有职业成长记录，开始工作后会在这里出现。' &&
    ids.worldProgressList.textContent === '还没有探索记录，冒险系统开放后这里会更新。',
    'empty growth data must show an honest note, not invented progress');

  const catalogRow = ids.jobCatalog.children[0];
  const startBtn = catalogRow && catalogRow.find(n => n.tagName === 'BUTTON');
  const subText = catalogRow && catalogRow.find(n => n.tagName === 'SMALL');
  check(!!startBtn && startBtn.textContent === '开始工作', 'job catalog must render one start button');
  check(subText && subText.textContent === '可选时长：1 小时、2 小时', 'only cloud durations are offered, got ' + (subText && subText.textContent));
  check(startBtn.disabled === true, 'start must be disabled while an order is active');

  let claimBtn = ids.workOrderPanel.find(n => n.tagName === 'BUTTON');
  check(!!claimBtn && claimBtn.disabled === true && claimBtn.textContent === '尚未完成', 'claim must be locked before completion');
  check(intervalCount() === 1, 'exactly one countdown interval must run with an active order');

  // One hour passes on the server. A slow device clock would still show 5 minutes left.
  now += 3600000;
  tick();
  claimBtn = ids.workOrderPanel.find(n => n.tagName === 'BUTTON');
  check(claimBtn.disabled === false && claimBtn.textContent === '向云端核验并领取',
    'claim must unlock by server time even when the device clock is behind, got disabled=' + claimBtn.disabled);
  check(ids.workOrderPanel.textContent.indexOf('已到预计完成时间') >= 0, 'countdown text must report completion');

  // Double click sends exactly one claim request, carrying only the order id.
  const before = sent.length;
  claimBtn.click(); claimBtn.click();
  await micro(); await micro();
  const claims = sent.slice(before);
  check(claims.length === 1 && claims[0].method === 'game_claim_work', 'double click must send one claim request, sent ' + claims.length);
  check(claims.length === 1 && Object.keys(claims[0].params).join() === 'p_order_id', 'claim must send only the order id');

  await reply(claims[0], true, snapshot([{ ...activeOrder, status: 'claimed', claimed_at: doneAt }], [bakery]));
  await micro();
  check(ids.workMessage.textContent === '奖励已由服务器核验并发放。', 'claim success message must be shown');
  check(ids.workOrderPanel.textContent === '当前没有进行中的工作订单。', 'claimed order must leave the panel');
  check(intervalCount() === 0, 'countdown interval must stop once no order is active');

  // Start work: rejected by the server -> readable message, button restored, snapshot re-pulled.
  const start2 = ids.jobCatalog.children[0].find(n => n.tagName === 'BUTTON');
  check(start2.disabled === false, 'start must be enabled when no order is active');
  const beforeStart = sent.length;
  start2.click();
  await micro(); await micro();
  const starts = sent.slice(beforeStart);
  check(starts.length === 1 && starts[0].method === 'game_start_work', 'start must send one game_start_work request');
  const p = starts[0] && starts[0].params;
  check(!!p && p.p_job_code === 'bakery' && p.p_duration_minutes === 60 && typeof p.p_idempotency_key === 'string' && p.p_idempotency_key.length >= 8,
    'start must send job code, cloud duration and an idempotency key only');
  check(!!p && !('coins' in p) && !('reward' in p) && !('reward_coins' in p), 'client must never send a reward amount');
  // The parent bridge forwards the raw PostgREST error body; the page must translate the code.
  await reply(starts[0], false, undefined, '{"code":"55000","details":null,"hint":null,"message":"job_reward_not_configured"}');
  await micro(); await micro(); await micro();
  check(ids.workMessage.textContent === '这个岗位的奖励还没有配置好，暂时不能开始或领取', 'server error code must be shown in plain words, got ' + ids.workMessage.textContent);
  const pulls = sent.slice(beforeStart + 1);
  check(pulls.length === 1 && pulls[0].method === 'game_get_snapshot', 'a failed start must re-pull the snapshot from the server');
  const start3 = ids.jobCatalog.children[0].find(n => n.tagName === 'BUTTON');
  check(start3.disabled === false && start3.textContent === '开始工作', 'start button must be restored after a rejection');
  const idle = snapshot([], [{ ...bakery, allowed_durations_minutes: [] }, bakery]);
  await reply(pulls[0], true, idle);

  // A job with no reward-configured duration offers nothing to click.
  const rows = ids.jobCatalog.children;
  const firstSub = rows[0].find(n => n.tagName === 'SMALL');
  const firstStart = rows[0].find(n => n.tagName === 'BUTTON');
  check(rows.length === 2 && firstSub.textContent.indexOf('暂未开放工作时长') === 0, 'job without configured durations must say so');
  check(firstStart.disabled === true, 'job without configured durations must not be startable');

  // The configured job stays startable and reports "already working" in plain words.
  const start4 = rows[1].find(n => n.tagName === 'BUTTON');
  check(start4.disabled === false, 'job with configured durations must be startable');
  const beforeStart2 = sent.length;
  start4.click();
  await micro(); await micro();
  const starts2 = sent.slice(beforeStart2);
  check(starts2.length === 1 && starts2[0].method === 'game_start_work', 'second start must send one request');
  await reply(starts2[0], false, undefined, '{"code":"55000","details":null,"hint":null,"message":"work_already_in_progress"}');
  await micro(); await micro(); await micro();
  check(ids.workMessage.textContent === '已经有一份工作进行中，完成并领取后才能开始新的', 'work_already_in_progress must be translated, got ' + ids.workMessage.textContent);
  await reply(sent[sent.length - 1], true, snapshot([activeOrder], [bakery]));

  // Unknown codes pass through instead of showing an empty message.
  const refreshBtn = ids.refreshCloud;
  const beforeRefresh = sent.length;
  refreshBtn.click();
  await micro(); await micro();
  await reply(sent[beforeRefresh], false, undefined, '{"code":"22023","details":null,"hint":null,"message":"some_new_code"}');
  await micro();
  check(ids.inventoryHint.textContent === 'some_new_code', 'unknown server codes must pass through unchanged');

  // Cloud growth data (jobs, world, tasks, achievements) must be rendered as recorded.
  const rich = Object.assign(snapshot([activeOrder], [bakery]), {
    jobs: [{ job_code: 'bakery', level: 2, xp: 150 }, { job_code: 'mining', level: 1, xp: 0, specialization: '勘探' }],
    world: [{ zone_code: 'forest', max_floor: 3 }, { zone_code: 'ruins_x', max_floor: 1 }],
    tasks: [{ task_code: 'a' }, { task_code: 'b' }], achievements: [{ achievement_code: 'first_work' }]
  });
  const beforeRich = sent.length;
  refreshBtn.click();
  await micro(); await micro();
  await reply(sent[beforeRich], true, rich);
  await micro();
  const growthRows = ids.jobGrowth.children;
  check(growthRows.length === 2 && growthRows[0].textContent.indexOf('面包店学徒 · Lv.2') >= 0 && growthRows[0].textContent.indexOf('职业经验 150 · 未选择专精') >= 0,
    'job growth must be rendered from the snapshot, got ' + ids.jobGrowth.textContent);
  check(growthRows[1].textContent.indexOf('矿场助手 · Lv.1') >= 0 && growthRows[1].textContent.indexOf('专精：勘探') >= 0, 'job specialization must be rendered when set');
  const worldRows = ids.worldProgressList.children;
  check(worldRows.length === 2 && worldRows[0].textContent.indexOf('静谧森林') >= 0 && worldRows[0].textContent.indexOf('最深到达第 3 层') >= 0,
    'world progress must be rendered from the snapshot, got ' + ids.worldProgressList.textContent);
  check(worldRows[1].textContent.indexOf('ruins_x') >= 0 && worldRows[1].textContent.indexOf('第 1 层') >= 0, 'unknown zone codes must be shown as recorded');
  check(ids.cloudProgress.textContent === '云端进度：任务 2 条 · 成就 1 个', 'task and achievement counts must come from the snapshot, got ' + ids.cloudProgress.textContent);

  /* ---------- main app bridge must stay token-free and whitelist-only ---------- */
  const beta = fs.readFileSync(path.join(__dirname, '..', '..', 'beta-v5.5.html'), 'utf8');
  const bridge = beta.slice(beta.indexOf('/* 游戏云端 RPC 桥'), beta.indexOf('loadFeed(false);loadStats();'));
  check(bridge.length > 500 && /allowed=\{game_bootstrap:true,game_get_snapshot:true,game_start_work:true,game_claim_work:true\}/.test(bridge), 'bridge whitelist must cover exactly the four game RPCs');
  check(/accCall\('\/rest\/v1\/rpc\/'\+msg\.method/.test(bridge) && !/access_token|refresh_token/.test(bridge), 'bridge must call RPC itself and never forward tokens to the iframe');

  Date.now = realNow;
  console.log('Cat work-order UI check: ' + passed + ' passed, ' + failures + ' failed.');
  if (failures) process.exit(1);
})().catch(e => { Date.now = realNow; console.error(e); process.exit(1); });
