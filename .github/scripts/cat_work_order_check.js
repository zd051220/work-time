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
  'jobGrowth', 'equipmentList', 'zoneList', 'battleResult', 'bagMessage', 'adventureMessage',
  'shopList', 'shopBalance', 'shopCount', 'shopMessage',
  'zoneCardForest', 'zoneCardMine', 'zoneCardRuins'].forEach(el);
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
    ids.zoneList.textContent === '冒险区域还没有在云端开放。',
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
    world: [{ zone_code: 'forest', max_floor: 3 }],
    zones: [
      { zone_code: 'forest', display_name: '静谧森林', description: '采集、探索与初级怪物', icon: '🌳', max_floor: 10, min_hp_to_enter: 20, unlock_zone_code: null, unlock_floor: 0, reached_floor: 3, unlocked: true },
      { zone_code: 'mine', display_name: '新手矿洞', description: '矿石、宝箱与史莱姆', icon: '⛏️', max_floor: 15, min_hp_to_enter: 30, unlock_zone_code: 'forest', unlock_floor: 5, reached_floor: 0, unlocked: false },
      { zone_code: 'ruins', display_name: '地下遗迹', description: '骷髅出没的深处', icon: '🏛️', max_floor: 20, min_hp_to_enter: 40, unlock_zone_code: 'mine', unlock_floor: 8, reached_floor: 20, unlocked: true }
    ],
    level: { xp_to_next: 50 },
    item_names: { copper_ore: '铜矿石', rusty_sword: '生锈短剑', herb: '草药' },
    inventory: [{ item_code: 'copper_ore', quantity: 3 }],
    equipment: [{ equipment_id: '11111111-2222-4333-8444-555555555555', item_code: 'rusty_sword', slot: 'weapon', quality: '普通', level: 0, affixes: [{ stat: 'attack', value: 2 }], is_equipped: false }],
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
  check(ids.catXp.textContent === '40 / 50', 'XP must show the cloud requirement for the next level, got ' + ids.catXp.textContent);
  check(ids.cloudProgress.textContent === '云端进度：任务 2 条 · 成就 1 个', 'task and achievement counts must come from the snapshot, got ' + ids.cloudProgress.textContent);
  check(ids.inventorySlots.children[0].children[1].textContent === '铜矿石 × 3', 'inventory must use the cloud item names, got ' + ids.inventorySlots.textContent);

  // Zones, reachable floors and entry cost all come from the snapshot; the page only offers them.
  const zoneRows = ids.zoneList.children;
  check(zoneRows.length === 3 && zoneRows[0].textContent.indexOf('静谧森林 · 最深到达第 3 层') >= 0 && zoneRows[0].textContent.indexOf('进入至少需要 20 生命') >= 0,
    'zones must be rendered from the snapshot, got ' + ids.zoneList.textContent);
  const forestSelect = zoneRows[0].find(n => n.tagName === 'SELECT'), forestGo = zoneRows[0].find(n => n.tagName === 'BUTTON');
  check(forestSelect.options.length === 4 && forestSelect.value === '4' && forestGo.textContent === '进入第 4 层' && forestGo.disabled === false,
    'only reached floors plus the next one may be offered');
  check(!zoneRows[1].find(n => n.tagName === 'BUTTON') && zoneRows[1].textContent.indexOf('尚未解锁：需要先在「静谧森林」到达第 5 层') >= 0,
    'a locked zone must show the unlock rule and no way in');
  check(zoneRows[2].find(n => n.tagName === 'SELECT').options.length === 20 && zoneRows[2].textContent.indexOf('已到达最深层') >= 0,
    'a cleared zone must still offer its floors without inventing a new one');
  check(ids.zoneCardMine.textContent === '尚未解锁' && ids.zoneCardForest.textContent === '最深到达第 3 层', 'map cards must reflect cloud progress');

  // Equipping sends the equipment id and the target state only.
  const equipRow = ids.equipmentList.children[0], equipBtn = equipRow.find(n => n.tagName === 'BUTTON');
  check(equipRow.textContent.indexOf('生锈短剑 · 武器') >= 0 && equipRow.textContent.indexOf('攻击 +2') >= 0 && equipBtn.textContent === '穿戴',
    'equipment must be rendered from the snapshot, got ' + ids.equipmentList.textContent);
  const beforeEquip = sent.length;
  equipBtn.click(); equipBtn.click();
  await micro(); await micro();
  const equips = sent.slice(beforeEquip);
  check(equips.length === 1 && equips[0].method === 'game_equip_item' && Object.keys(equips[0].params).sort().join() === 'p_equipment_id,p_equipped' &&
    equips[0].params.p_equipped === true && equips[0].params.p_equipment_id === '11111111-2222-4333-8444-555555555555',
    'equipping must send only the equipment id and the target state, sent ' + JSON.stringify(equips));
  await reply(equips[0], true, Object.assign({}, rich, { equipment: [Object.assign({}, rich.equipment[0], { is_equipped: true })] }));
  await micro();
  check(ids.equipmentList.children[0].find(n => n.tagName === 'BUTTON').textContent === '脱下', 'an equipped item must offer unequipping');

  // The village shop renders cloud goods, prices and affixes; purchases send only id + key.
  const shopSnapshot = Object.assign({}, rich, { shop: [
    { shop_code: 'wood_sword', display_name: '木剑', icon: '🗡️', slot: 'weapon', quality: 'common', affixes: [{ stat: 'attack', value: 2 }], price_coins: 100, min_level: 1 },
    { shop_code: 'copper_sword', display_name: '铜剑', icon: '⚔️', slot: 'weapon', quality: 'uncommon', affixes: [{ stat: 'attack', value: 6 }], price_coins: 500, min_level: 5 }
  ] });
  const beforeShop = sent.length;
  refreshBtn.click();
  await micro(); await micro();
  await reply(sent[beforeShop], true, shopSnapshot);
  await micro();
  check(ids.shopBalance.textContent.indexOf('持有金币 1,234') === 0 && ids.shopCount.textContent === '2 件商品', 'shop header must show cloud coins and stock, got ' + ids.shopBalance.textContent);
  const shopRows = ids.shopList.children;
  check(shopRows.length === 2 && shopRows[0].textContent.indexOf('木剑') >= 0 && shopRows[0].textContent.indexOf('攻击 +2') >= 0 && shopRows[0].textContent.indexOf('100 金币') >= 0,
    'shop goods must be rendered from the snapshot with cloud prices, got ' + ids.shopList.textContent);
  const woodBtn = shopRows[0].find(n => n.tagName === 'BUTTON'), copperBtn = shopRows[1].find(n => n.tagName === 'BUTTON');
  check(woodBtn.disabled === false && copperBtn.disabled === true && shopRows[1].textContent.indexOf('需要 Lv.5') >= 0,
    'shop must disable goods the cat cannot afford or is too low-level for');
  const beforeBuy = sent.length;
  woodBtn.click(); woodBtn.click();
  await micro(); await micro();
  const buys = sent.slice(beforeBuy);
  check(buys.length === 1 && buys[0].method === 'game_buy_item' && Object.keys(buys[0].params).sort().join() === 'p_idempotency_key,p_shop_code' &&
    buys[0].params.p_shop_code === 'wood_sword' && buys[0].params.p_idempotency_key.length >= 8,
    'buying must send only the shop code and an idempotency key, sent ' + JSON.stringify(buys));
  check(!('price_coins' in buys[0].params) && !('coins' in buys[0].params), 'client must never send a price or coin amount');
  await reply(buys[0], false, undefined, '{"code":"55000","details":null,"hint":null,"message":"shop_insufficient_coins"}');
  await micro(); await micro();
  check(ids.shopMessage.textContent === '金币不够，先去工作或冒险赚一些', 'shop refusals must be translated, got ' + ids.shopMessage.textContent);
  await reply(sent[sent.length - 1], true, shopSnapshot);
  await micro();

  // A battle sends the zone, the floor and an idempotency key, never any outcome.
  const goBtn = ids.zoneList.children[0].find(n => n.tagName === 'BUTTON');
  const beforeBattle = sent.length;
  goBtn.click(); goBtn.click();
  await micro(); await micro();
  const battles = sent.slice(beforeBattle);
  check(battles.length === 1 && battles[0].method === 'game_start_explore' && Object.keys(battles[0].params).sort().join() === 'p_floor,p_idempotency_key,p_zone_code' &&
    battles[0].params.p_zone_code === 'forest' && battles[0].params.p_floor === 4 && typeof battles[0].params.p_idempotency_key === 'string',
    'a battle must send only the zone, the floor and an idempotency key, sent ' + JSON.stringify(battles));
  check(battles.length === 1 && !('xp' in battles[0].params) && !('damage' in battles[0].params) && !('reward' in battles[0].params) && !('outcome' in battles[0].params),
    'the client must never send battle outcomes or rewards');
  const won = Object.assign({}, rich, {
    cat: Object.assign({}, rich.cat, { level: 4, hp: 77 }),
    zones: [Object.assign({}, rich.zones[0], { reached_floor: 4 }), rich.zones[1], rich.zones[2]],
    explore: { outcome: 'win', floor: 4, monster_name: '野狼', turns: [
      { turn: 1, actor: 'cat', damage: 5, crit: false, hp: 47 }, { turn: 1, actor: 'monster', damage: 3, hp: 77 }],
      xp: 18, coins: 4, drops: [{ item_code: 'herb', quantity: 2 }], hp_after: 77, level_after: 4, level_up: true }
  });
  await reply(battles[0], true, won);
  await micro();
  const report = ids.battleResult;
  check(report.style.display === '' && report.textContent.indexOf('胜利！') >= 0 && report.textContent.indexOf('第 4 层 · 野狼') >= 0,
    'a won battle must be reported, got ' + report.textContent);
  check(report.textContent.indexOf('获得 经验 18 · 金币 4 · 掉落 草药 × 2 · 升级到 Lv.4！') >= 0 && report.textContent.indexOf('战斗后生命值 77 / 100') >= 0,
    'rewards must be shown exactly as the server reported them, got ' + report.textContent);
  check(report.textContent.indexOf('第 1 回合：你对野狼造成 5 点伤害，野狼剩余 47') >= 0 && report.textContent.indexOf('第 1 回合：野狼对你造成 3 点伤害，你剩余 77') >= 0,
    'the replay must be listed turn by turn');
  check(ids.level.textContent === 'Lv.4' && ids.zoneList.children[0].textContent.indexOf('最深到达第 4 层') >= 0,
    'the page must re-render from the snapshot returned with the battle');

  // A defeat shows no rewards, and a tired cat is not sent back in.
  const beforeLoss = sent.length;
  ids.zoneList.children[0].find(n => n.tagName === 'BUTTON').click();
  await micro(); await micro();
  await reply(sent[beforeLoss], true, Object.assign({}, won, {
    cat: Object.assign({}, won.cat, { hp: 0 }),
    explore: { outcome: 'lose', floor: 5, monster_name: '野狼', turns: [], xp: 0, coins: 0, drops: [], hp_after: 0, level_after: 4, level_up: false }
  }));
  await micro();
  check(ids.battleResult.textContent.indexOf('挑战失败') >= 0 && ids.battleResult.textContent.indexOf('没有获得奖励') >= 0 && ids.battleResult.textContent.indexOf('金币') < 0,
    'a lost battle must be reported without rewards, got ' + ids.battleResult.textContent);
  const tired = ids.zoneList.children[0].find(n => n.tagName === 'BUTTON');
  check(tired.disabled === true && tired.textContent === '生命不足，先休息', 'a tired cat must not be sent into a battle, got ' + tired.textContent);

  // Battle refusals arrive as raw error bodies and must be readable.
  const beforeWeak = sent.length;
  refreshBtn.click();
  await micro(); await micro();
  await reply(sent[beforeWeak], false, undefined, '{"code":"55000","details":null,"hint":null,"message":"cat_too_weak"}');
  await micro();
  check(ids.inventoryHint.textContent === '生命值不足，先回家休息一会儿', 'battle refusals must be translated, got ' + ids.inventoryHint.textContent);

  /* ---------- main app bridge must stay token-free and whitelist-only ---------- */
  const beta = fs.readFileSync(path.join(__dirname, '..', '..', 'beta-v5.5.html'), 'utf8');
  const bridge = beta.slice(beta.indexOf('/* 游戏云端 RPC 桥'), beta.indexOf('loadFeed(false);loadStats();'));
  check(bridge.length > 500 && /allowed=\{game_bootstrap:true,game_get_snapshot:true,game_start_work:true,game_claim_work:true,game_equip_item:true,game_start_explore:true,game_buy_item:true\}/.test(bridge), 'bridge whitelist must cover exactly the seven game RPCs');
  check(bridge.indexOf("msg.method==='game_buy_item'") > 0 && bridge.indexOf("payload={p_shop_code:args.p_shop_code,p_idempotency_key:args.p_idempotency_key}") > 0 &&
    bridge.indexOf("/^[a-z_]{1,20}$/.test(args.p_shop_code)") > 0,
    'bridge must validate the shop code and rebuild the payload from validated fields only');
  check(/msg\.method==='game_equip_item'[\s\S]*?msg\.method==='game_start_explore'/.test(bridge) && /payload=\{p_equipment_id:args\.p_equipment_id,p_equipped:args\.p_equipped\}/.test(bridge) &&
    /payload=\{p_zone_code:args\.p_zone_code,p_floor:args\.p_floor,p_idempotency_key:args\.p_idempotency_key\}/.test(bridge),
    'bridge must rebuild the payload for the new RPCs from validated fields only');
  check(/accCall\('\/rest\/v1\/rpc\/'\+msg\.method/.test(bridge) && !/access_token|refresh_token/.test(bridge), 'bridge must call RPC itself and never forward tokens to the iframe');

  Date.now = realNow;
  console.log('Cat work-order UI check: ' + passed + ' passed, ' + failures + ' failed.');
  if (failures) process.exit(1);
})().catch(e => { Date.now = realNow; console.error(e); process.exit(1); });
