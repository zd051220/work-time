// Runs the three cat-game migrations inside PGlite (a real Postgres engine compiled
// to WASM) and asserts the structural guarantees plus the core RPC behaviour.
// 78 checks: structure/RLS, snapshot shape, exploration (win/lose/level-up/regen),
// work orders, equipment, and client-role permission fences. Random rolls
// (crit, coins, drops) are asserted with tolerant ranges so CI never flakes.
// Usage: node .github/scripts/cat_game_pg_check.mjs [repo-root]
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const dir = process.argv[2] || '.';
const mig = f => fs.readFileSync(dir + '/supabase/migrations/' + f, 'utf8');
const A = '00000000-0000-4000-8000-00000000000a'; // battle path
const B = '00000000-0000-4000-8000-00000000000b'; // foreign player (never bootstrapped)
const C = '00000000-0000-4000-8000-00000000000c'; // level-up path
const D = '00000000-0000-4000-8000-00000000000d'; // lose path
const E = '00000000-0000-4000-8000-00000000000e'; // regen path
const F = '00000000-0000-4000-8000-00000000000f'; // work-order path
const G = '00000000-0000-4000-8000-000000000010'; // equipment path
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.error('FAIL ' + msg); } };

const db = new PGlite();
const rows = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await rows(s, p))[0];
const errOf = async (s, p) => { try { await db.query(s, p); return ''; } catch (e) { return e.message; } };
const as = async uid => { await db.query("select set_config('test.uid',$1,false)", [uid]); };
const su = async (s, p) => { await db.query('reset role'); try { return await rows(s, p); } finally { await db.query('set role authenticated'); } };
process.on('uncaughtException', e => { console.error('ERROR ' + (e.query || '') + ' -> ' + e.message); process.exit(1); });

await db.exec(`
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
`);
for (const f of ['20261126010000_cat_game_cloud_core.sql', '20261126020000_cat_game_work_orders.sql', '20261126030000_cat_game_adventure.sql']) {
  await db.exec(mig(f));
}
await su('insert into auth.users(id) values ($1),($2),($3),($4),($5),($6),($7)', [A, B, C, D, E, F, G]);
await db.query('set role authenticated');
await as(A);

// structure: table count, RLS everywhere, definer/invoker split
const tables = await su("select count(*)::int n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r'");
check(tables[0].n === 19, 'expected 19 public tables, got ' + tables[0].n);
const noRls = await su("select count(*)::int n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r' and not c.relrowsecurity");
check(noRls[0].n === 0, 'every public table must have RLS enabled, missing ' + noRls[0].n);
const priv = await su("select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='private' and p.prosecdef");
check(priv[0].n === 7, 'expected 7 security definer functions in private after the redefinitions, got ' + priv[0].n);
const pub = await su("select p.proname, p.prosecdef from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname like 'game_%' order by 1");
check(pub.length === 6 && pub.every(r => !r.prosecdef), 'expected 6 invoker wrappers, got ' + JSON.stringify(pub.map(r => r.proname)));

// snapshot shape and what it must not leak
const boot = (await one('select public.game_bootstrap() as s')).s;
check(boot.cat.hp === 100 && boot.cat.level === 1 && boot.wallet.coins === 0, 'bootstrap must create the default cat and wallet');
check(boot.zones.length === 3 && boot.zones[0].zone_code === 'forest' && boot.zones[0].unlocked === true, 'forest must be unlocked from the start');
check(boot.zones[1].unlocked === false && boot.zones[2].unlocked === false, 'mine and ruins must start locked');
check(boot.level.xp_to_next === 40, 'level 1 must need 40 xp, got ' + JSON.stringify(boot.level));
check(boot.item_names && boot.item_names.copper_ore === '铜矿石', 'item display names must come from the cloud');
check(!('xp_reward' in boot) && !('crit_chance' in boot) && !('chance' in boot), 'snapshot must not leak reward or drop configuration');

// bootstrap is idempotent: a second call must not bump the profile revision
await one('select public.game_bootstrap()');
const rev1 = (await su('select revision from public.game_profiles where user_id=$1', [A]))[0].revision;
check(Number(rev1) === 1, 'a second bootstrap must leave the profile revision at 1, got ' + rev1);

// floor and zone guards
check(/floor_locked/.test(await errOf(`select public.game_start_explore('forest',2,$1)`, ['k-00000002'])), 'floor 2 before floor 1 must be floor_locked');
check(/zone_locked/.test(await errOf(`select public.game_start_explore('mine',1,$1)`, ['k-00000101'])), 'mine must stay locked before forest floor 5');
check(/floor_out_of_range/.test(await errOf(`select public.game_start_explore('forest',11,$1)`, ['k-00000011'])), 'floor beyond the zone must be out of range');
check(/invalid_explore_request/.test(await errOf(`select public.game_start_explore('forest',1,$1)`, ['short'])), 'a short idempotency key must be rejected');

// one real battle, then a replay of the same key
const r = (await one(`select public.game_start_explore('forest',1,$1) as s`, ['k-00000001'])).s;
check(r.explore.outcome === 'win' && r.explore.xp === 8 && r.explore.coins >= 1 && r.explore.coins <= 3,
  'forest floor 1 must win with 8 xp and 1..3 coins, got ' + JSON.stringify(r.explore));
check(r.zones[0].reached_floor === 1, 'a win must advance the recorded floor');
const r2 = (await one(`select public.game_start_explore('forest',1,$1) as s`, ['k-00000001'])).s;
check(JSON.stringify(r2.explore) === JSON.stringify(r.explore), 'a replayed key must return the stored battle instead of rolling again');

// battle report detail
check(r.explore.monster_name === '绿色史莱姆' && r.explore.monster_emoji === '🟢', 'forest floor 1 must face the green slime');
check(r.explore.monster_hp === 30, 'forest floor 1 slime must have 30 hp, got ' + r.explore.monster_hp);
const replay = r.explore.turns;
check(replay.length >= 7 && replay.length <= 13 && replay[0].actor === 'cat' && replay[replay.length - 1].hp === 0,
  'the replay must start with the cat, end with the monster at 0 hp and stay within the turn cap');
check(r.explore.drops.every(d => (d.item_code === 'herb' || d.item_code === 'wood') && d.quantity >= 1 && d.quantity <= 2),
  'forest drops must only be herb or wood in quantities 1..2, got ' + JSON.stringify(r.explore.drops));
const dropped = {}; r.explore.drops.forEach(d => dropped[d.item_code] = (dropped[d.item_code] || 0) + d.quantity);
const stocked = {}; r.inventory.forEach(i => stocked[i.item_code] = i.quantity);
check(JSON.stringify(dropped) === JSON.stringify(stocked), 'the inventory must mirror the battle drops exactly');
check(r.cat.xp === 8 && r.cat.hp === r.explore.hp_after, 'the cat row must persist 8 xp and the post-battle hp');
const battleLedger = await su('select delta, reason, balance_after from public.game_wallet_ledger where user_id=$1', [A]);
check(battleLedger.length === 1 && Number(battleLedger[0].delta) === r.explore.coins && battleLedger[0].reason === 'explore'
  && Number(battleLedger[0].balance_after) === r.explore.coins && r.wallet.coins === r.explore.coins,
  'the explore payout must hit the wallet and ledger exactly once');

// floor scaling and progression
const rFloor2 = (await one(`select public.game_start_explore('forest',2,$1) as s`, ['k-00000003'])).s;
check(rFloor2.explore.outcome === 'win' && rFloor2.explore.monster_hp === 36 && rFloor2.explore.xp === 11
  && rFloor2.explore.coins >= 2 && rFloor2.explore.coins <= 4 && rFloor2.zones[0].reached_floor === 2,
  'floor 2 must scale the slime to 36 hp with 11 xp and 2..4 coins');
check(/floor_locked/.test(await errOf(`select public.game_start_explore('forest',4,$1)`, ['k-00000004'])),
  'floor 4 with only floor 2 reached must be floor_locked');
await su("update public.game_world_progress set max_floor=5 where user_id=$1 and zone_code='forest'", [A]);
const zonesAfter5 = (await one('select public.game_get_snapshot() as s')).s;
check(zonesAfter5.zones[1].unlocked === true && zonesAfter5.zones[2].unlocked === false,
  'reaching forest floor 5 must unlock the mine but not the ruins');
await su('update public.game_cats set attack=30, hp=100 where user_id=$1', [A]);
const rMine = (await one(`select public.game_start_explore('mine',1,$1) as s`, ['k-00000005'])).s;
check(rMine.explore.outcome === 'win' && rMine.explore.monster_hp === 60 && rMine.explore.xp === 18
  && rMine.explore.coins >= 3 && rMine.explore.coins <= 6 && rMine.zones[1].reached_floor === 1,
  'mine floor 1 must open with a 60 hp rock slime worth 18 xp and 3..6 coins');

// level-up: crossing the 40 xp threshold
await as(C);
await one('select public.game_bootstrap()');
await su('update public.game_cats set xp=39 where user_id=$1', [C]);
const rLevel = (await one(`select public.game_start_explore('forest',1,$1) as s`, ['k-lvl-00001'])).s;
check(rLevel.explore.outcome === 'win' && rLevel.explore.level_after === 2 && rLevel.explore.level_up === true,
  'crossing 40 xp must level the cat up to 2');
check(rLevel.cat.level === 2 && rLevel.cat.xp === 7, 'the cat row must keep level 2 with 7 xp, got ' + JSON.stringify(rLevel.cat));
check(rLevel.cat.max_hp === 110 && rLevel.cat.attack === 6 && rLevel.cat.defense === 3,
  'level 2 must grant +10 max hp, +1 attack and +1 defense');
check(rLevel.level.xp_to_next === 50, 'level 2 must need 50 xp to advance, got ' + JSON.stringify(rLevel.level));
check(rLevel.explore.hp_after >= 100 && rLevel.explore.hp_after <= 110, 'the level-up heal must land between 100 and 110 hp');

// a lost battle must pay nothing and leave the cat at 0 hp
await as(D);
await one('select public.game_bootstrap()');
await su('update public.game_cats set attack=0, defense=0, hp=30 where user_id=$1', [D]);
const rLose = (await one(`select public.game_start_explore('forest',1,$1) as s`, ['k-lose-0001'])).s;
check(rLose.explore.outcome === 'lose' && rLose.explore.xp === 0 && rLose.explore.coins === 0
  && rLose.explore.drops.length === 0 && rLose.zones[0].reached_floor === 0,
  'a lost battle must pay nothing and not advance the zone');
check(rLose.explore.hp_after === 0 && rLose.cat.hp === 0, 'a lost battle must leave the cat at 0 hp');
const loseLedger = await su('select count(*)::int n from public.game_wallet_ledger where user_id=$1', [D]);
check(loseLedger[0].n === 0 && rLose.wallet.coins === 0, 'a lost battle must not touch the wallet or ledger');
check(/cat_too_weak/.test(await errOf(`select public.game_start_explore('forest',1,$1)`, ['k-lose-0002'])),
  'a cat at 0 hp must be rejected as cat_too_weak');

// hp regen over time, capped at max hp
await as(E);
await one('select public.game_bootstrap()');
await su("update public.game_cats set hp=50, updated_at=now()-interval '10 minutes' where user_id=$1", [E]);
const regen10 = (await one('select public.game_get_snapshot() as s')).s;
check(regen10.cat.hp === 60, '10 minutes at 1 hp/min must heal exactly 10 hp, got ' + regen10.cat.hp);
check(regen10.cat.revision === 2, 'the regen settle must bump the cat revision, got ' + regen10.cat.revision);
await su("update public.game_cats set hp=95, updated_at=now()-interval '30 minutes' where user_id=$1", [E]);
const regen30 = (await one('select public.game_get_snapshot() as s')).s;
check(regen30.cat.hp === 100, 'regen must stop at max hp, got ' + regen30.cat.hp);

// work orders: validation, idempotency, claim payout
await as(F);
await one('select public.game_bootstrap()');
await su("update public.game_job_catalog set is_active=true, rewards_by_duration=$1::jsonb where job_code='bakery'", ['{"60":{"coins":50}}']);
check(/invalid_work_order_request/.test(await errOf(`select public.game_start_work('bakery',60,'short')`)),
  'a short work idempotency key must be rejected');
check(/job_unavailable/.test(await errOf(`select public.game_start_work('ghost',60,$1)`, ['k-work-0001'])),
  'an unknown job must be job_unavailable');
check(/job_unavailable/.test(await errOf(`select public.game_start_work('fishing',60,$1)`, ['k-work-0002'])),
  'a seeded but inactive job must be job_unavailable');
check(/duration_not_allowed/.test(await errOf(`select public.game_start_work('bakery',90,$1)`, ['k-work-0003'])),
  'a duration outside the catalog must be duration_not_allowed');
check(/job_reward_not_configured/.test(await errOf(`select public.game_start_work('bakery',120,$1)`, ['k-work-0004'])),
  'an allowed duration without a configured reward must be job_reward_not_configured');
const wStart = (await one(`select public.game_start_work('bakery',60,$1) as s`, ['k-work-0010'])).s;
const orderRow = (await su('select order_id, extract(epoch from (completes_at-started_at))::int secs from public.game_work_orders where user_id=$1', [F]))[0];
check(wStart.work_orders[0].status === 'active' && wStart.work_orders[0].job_code === 'bakery'
  && wStart.work_orders[0].duration_code === '60' && orderRow.secs >= 3599 && orderRow.secs <= 3601,
  'a started order must be active for 60 minutes');
check(/work_already_in_progress/.test(await errOf(`select public.game_start_work('bakery',60,$1)`, ['k-work-0011'])),
  'a second concurrent order must be work_already_in_progress');
const wReplay = (await one(`select public.game_start_work('bakery',60,$1) as s`, ['k-work-0010'])).s;
const orderCount = (await su('select count(*)::int n from public.game_work_orders where user_id=$1', [F]))[0].n;
check(wReplay.work_orders[0].order_id === wStart.work_orders[0].order_id && orderCount === 1,
  'a replayed work key must return the same single order');
check(/idempotency_key_reused/.test(await errOf(`select public.game_start_work('bakery',120,$1)`, ['k-work-0010'])),
  'the same key with a different duration must be idempotency_key_reused');
check(/work_order_not_finished/.test(await errOf('select public.game_claim_work($1)', [wStart.work_orders[0].order_id])),
  'claiming before completion must be work_order_not_finished');
check(/work_order_not_found/.test(await errOf('select public.game_claim_work($1)', ['99999999-9999-4999-8999-999999999999'])),
  'an unknown order must be work_order_not_found');
await as(B);
check(/work_order_not_found/.test(await errOf('select public.game_claim_work($1)', [wStart.work_orders[0].order_id])),
  'another player must not claim my order');
await as(F);
await su("update public.game_work_orders set started_at=now()-interval '61 minutes', completes_at=now()-interval '1 second' where user_id=$1 and idempotency_key='k-work-0010'", [F]);
const wClaim = (await one('select public.game_claim_work($1) as s', [wStart.work_orders[0].order_id])).s;
const workLedger = (await su('select delta, reason, balance_after, idempotency_key from public.game_wallet_ledger where user_id=$1', [F]))[0];
check(wClaim.wallet.coins === 50 && wClaim.work_orders[0].status === 'claimed' && wClaim.work_orders[0].claimed_at !== null
  && Number(workLedger.delta) === 50 && workLedger.reason === 'work_order' && Number(workLedger.balance_after) === 50
  && workLedger.idempotency_key === 'work:' + wStart.work_orders[0].order_id,
  'claiming a finished order must pay 50 coins into wallet and ledger exactly once');
const wClaim2 = (await one('select public.game_claim_work($1) as s', [wStart.work_orders[0].order_id])).s;
const workLedgerCount = (await su('select count(*)::int n from public.game_wallet_ledger where user_id=$1', [F]))[0].n;
check(wClaim2.wallet.coins === 50 && workLedgerCount === 1, 're-claiming must stay idempotent with no second payout');
const jobRow = (await su("select count(*)::int n from public.game_jobs where user_id=$1 and job_code='bakery'", [F]))[0].n;
check(jobRow === 1, 'starting work must create the job row');
check(wStart.job_catalog.length === 1 && wStart.job_catalog[0].job_code === 'bakery'
  && JSON.stringify(wStart.job_catalog[0].allowed_durations_minutes) === JSON.stringify([60])
  && Object.keys(wStart.job_catalog[0]).sort().join() === 'allowed_durations_minutes,display_name,job_code',
  'the snapshot job catalog must expose bakery with only the configured duration and no reward amounts');
check((await rows('select job_code from public.game_job_catalog')).some(x => x.job_code === 'bakery'),
  'the client role may read the granted catalog columns');
check(/permission denied/i.test(await errOf('select rewards_by_duration from public.game_job_catalog')),
  'reward amounts must stay hidden from the client role');

// equipment: validation, one-per-slot, foreign access
await as(G);
await one('select public.game_bootstrap()');
const eqRows = await su(`insert into public.game_equipment(user_id,item_code,slot,quality,level,affixes) values
 ($1,'wood','weapon','common',0,$2::jsonb),($1,'wood','weapon','common',0,$3::jsonb),
 ($1,'herb','accessory','common',0,$4::jsonb),($1,'stone','helmet','common',0,$5::jsonb)
 returning equipment_id`, [G, '[{"stat":"attack","value":"2"}]', '[{"stat":"defense","value":"1"}]',
  '[{"stat":"speed","value":"1"}]', '[{"stat":"attack","value":"abc"}]']);
const eq1 = eqRows[0].equipment_id, eq2 = eqRows[1].equipment_id, eqBad1 = eqRows[2].equipment_id, eqBad2 = eqRows[3].equipment_id;
check(/invalid_equipment_request/.test(await errOf('select public.game_equip_item($1,true)', [null])),
  'equipping null must be invalid_equipment_request');
check(/equipment_not_found/.test(await errOf('select public.game_equip_item($1,true)', ['88888888-8888-4888-8888-888888888888'])),
  'an unknown equipment id must be equipment_not_found');
check(/equipment_affix_invalid/.test(await errOf('select public.game_equip_item($1,true)', [eqBad1])),
  'an unknown affix stat must be equipment_affix_invalid');
check(/equipment_affix_invalid/.test(await errOf('select public.game_equip_item($1,true)', [eqBad2])),
  'a non-numeric affix value must be equipment_affix_invalid');
const equipped = s => Object.fromEntries(s.equipment.map(e => [e.equipment_id, e.is_equipped]));
const g1 = (await one('select public.game_equip_item($1,true) as s', [eq1])).s;
check(equipped(g1)[eq1] === true, 'equipping must mark the item as equipped');
const g2 = (await one('select public.game_equip_item($1,true) as s', [eq2])).s;
check(equipped(g2)[eq2] === true && equipped(g2)[eq1] === false, 'equipping a second weapon must unequip the first (one per slot)');
const g3 = (await one('select public.game_equip_item($1,false) as s', [eq2])).s;
check(equipped(g3)[eq2] === false, 'unequipping must work');
const g4 = (await one('select public.game_equip_item($1,false) as s', [eq2])).s;
check(equipped(g4)[eq2] === false, 'unequipping twice must stay a no-op');
await as(B);
check(/equipment_not_found/.test(await errOf('select public.game_equip_item($1,true)', [eq1])),
  'another player must not equip my item');
await as(G);

// configuration and battle records stay server-only; the client role cannot write
check(/permission denied/i.test(await errOf('select * from public.game_combat_rules')), 'the client role must not read combat rules');
check(/permission denied/i.test(await errOf('select * from public.game_monster_catalog')), 'the client role must not read the monster catalog');
check(/permission denied/i.test(await errOf('select * from public.game_drop_table')), 'the client role must not read drop rates');
check(/permission denied/i.test(await errOf('select * from public.game_explore_logs')), 'battle records must stay server-only');
check(/permission denied/i.test(await errOf(`insert into public.game_work_orders(user_id,job_code,duration_code,started_at,completes_at,idempotency_key)
 values ($1,'bakery','60',now(),now(),'x-12345678')`, [A])), 'the client role must not insert work orders directly');
check(/permission denied/i.test(await errOf('update public.game_inventory set quantity=1')), 'the client role must not write the inventory directly');

// a missing identity must be rejected everywhere
await as('');
check(/authentication_required/.test(await errOf('select public.game_get_snapshot()')), 'a missing identity must be rejected');
await as(A);

// client roles must not touch the wallet or the RPCs directly
check(/permission denied/i.test(await errOf('update public.game_wallets set coins=999999')), 'the client role must not write the wallet directly');
await db.query('set role anon');
check(/permission denied/i.test(await errOf('select public.game_get_snapshot()')), 'anon must not call the game RPCs');
check(/permission denied/i.test(await errOf('select * from public.game_cats')), 'anon must not read the game tables');

console.log('PGlite game check: ' + pass + ' passed, ' + fail + ' failed.');
process.exit(fail ? 1 : 0);
