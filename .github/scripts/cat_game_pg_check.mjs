// Runs the three cat-game migrations inside PGlite (a real Postgres engine compiled
// to WASM) and asserts the structural guarantees plus the core RPC behaviour.
// Usage: node .github/scripts/cat_game_pg_check.mjs [repo-root]
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const dir = process.argv[2] || '.';
const mig = f => fs.readFileSync(dir + '/supabase/migrations/' + f, 'utf8');
const A = '00000000-0000-4000-8000-00000000000a';
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
await su('insert into auth.users(id) values ($1)', [A]);
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

// client roles must not touch the wallet or the RPCs directly
check(/permission denied/i.test(await errOf('update public.game_wallets set coins=999999')), 'the client role must not write the wallet directly');
await db.query('set role anon');
check(/permission denied/i.test(await errOf('select public.game_get_snapshot()')), 'anon must not call the game RPCs');
check(/permission denied/i.test(await errOf('select * from public.game_cats')), 'anon must not read the game tables');

console.log('PGlite game check: ' + pass + ' passed, ' + fail + ' failed.');
process.exit(fail ? 1 : 0);
