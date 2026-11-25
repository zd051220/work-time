#!/usr/bin/env node
'use strict';
const fs = require('fs');
const file = 'supabase/migrations/20261126010000_cat_game_cloud_core.sql';
const workFile = 'supabase/migrations/20261126020000_cat_game_work_orders.sql';
const adventureFile = 'supabase/migrations/20261126030000_cat_game_adventure.sql';
const rewardsFile = 'supabase/migrations/20261126040000_cat_game_job_rewards.sql';
const shopFile = 'supabase/migrations/20261126050000_cat_game_shop.sql';
const sql = fs.readFileSync(file, 'utf8');
const workSql = fs.readFileSync(workFile, 'utf8');
const adventureSql = fs.readFileSync(adventureFile, 'utf8');
const rewardsSql = fs.readFileSync(rewardsFile, 'utf8');
const shopSql = fs.readFileSync(shopFile, 'utf8');
let failures = 0;
function check(ok, message) {
  if (!ok) { failures++; console.error('FAIL ' + file + ': ' + message); }
}
const shopCode = shopSql.replace(/--[^\n]*/g, '');
const code = (sql + '\n' + workSql + '\n' + adventureSql + '\n' + rewardsSql + '\n' + shopSql).replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const workCode = workSql.replace(/--[^\n]*/g, '');
const adventureCode = adventureSql.replace(/--[^\n]*/g, '');
const tables = [...code.matchAll(/create table if not exists public\.(game_[a-z_]+)/gi)].map(m => m[1]);
const rls = [...code.matchAll(/alter table public\.(game_[a-z_]+) enable row level security/gi)].map(m => m[1]);
const definers = [...code.matchAll(/create or replace function (private\.[\w]+\([^)]*\))[\s\S]*?security definer/gi)].map(m => m[1]);
const wrappers = [...code.matchAll(/create or replace function (public\.game_[\w]+\([^)]*\))[\s\S]*?security invoker/gi)].map(m => m[1]);
check(/create schema if not exists private/i.test(code), 'private schema must exist before function creation');
check(!/revoke\s+all\s+on\s+schema\s+private\s+from\s+public\s*,\s*anon/i.test(code), 'must not revoke existing anon USAGE on shared private schema');
check(/revoke create on schema private from public, anon, authenticated/i.test(code), 'must revoke CREATE on private schema');
check(tables.length === 20, 'expected 20 game tables (13 core/job tables plus six combat tables, battle records and the shop catalog), found ' + tables.length);
check(rls.length === 20 && tables.every(t => t === 'game_shop_catalog' || rls.includes(t)), 'every game table holding client data must have RLS enabled');
check(definers.length === 11 && definers.every(f => f.startsWith('private.game_')), 'eleven private SECURITY DEFINER definitions (bootstrap, three snapshots, start, claim, regen, equip, explore, report helper, buy) are expected, found ' + definers.join(' '));
check((code.match(/if\s+v_uid\s+is\s+null\s+then/gi) || [] ).length === 11, 'each privileged function definition must reject a missing auth.uid()');
check(wrappers.length === 7 && wrappers.every(f => f.startsWith('public.game_')), 'the seven public RPC wrappers must be SECURITY INVOKER');
check(/revoke all on function private\.game_bootstrap\(\) from public, anon, authenticated/i.test(code), 'bootstrap private EXECUTE must be revoked before explicit grant');
check(/revoke all on function private\.game_get_snapshot\(\) from public, anon, authenticated/i.test(code), 'snapshot private EXECUTE must be revoked before explicit grant');
check(/revoke all on function private\.game_start_work\(text,integer,text\) from public,anon,authenticated/i.test(code), 'start-work private EXECUTE must be revoked');
check(/revoke all on function private\.game_claim_work\(uuid\) from public,anon,authenticated/i.test(code), 'claim-work private EXECUTE must be revoked');
check(/revoke all on function private\.game_equip_item\(uuid,boolean\) from public,anon,authenticated/i.test(adventureCode) && /revoke all on function private\.game_start_explore\(text,integer,text\) from public,anon,authenticated/i.test(adventureCode), 'equip and explore private EXECUTE must be revoked before the explicit grant');
check(/create table if not exists public\.game_job_catalog/i.test(code) && /alter table public\.game_job_catalog enable row level security/i.test(code), 'job catalog must exist with RLS');
check(/pg_advisory_xact_lock\(hashtextextended\(v_uid::text,0\)\)/i.test(workCode), 'work commands must serialize per user');
check((adventureCode.match(/pg_advisory_xact_lock\(hashtextextended\(v_uid::text,0\)\)/gi) || []).length === 2, 'equip and explore must take the same per-user lock as work commands');
check(/v_now<v_order\.completes_at/i.test(workCode), 'claim must reject unfinished work orders');
check(/rewards_by_duration/i.test(workCode) && /job_reward_not_configured/i.test(workCode), 'payouts must come from server-owned job configuration');
check(!/grant\s+(?:insert|update|delete|all)\s+on\s+(?:table\s+)?public\.game_/i.test(code), 'client roles must not receive direct game table write grants');
check(!/grant\s+(?:select|insert|update|delete|all)\s+on\s+(?:table\s+)?public\.game_(?:combat_rules|level_xp|zone_catalog|monster_catalog|drop_table|explore_logs)\b/i.test(code), 'combat configuration and battle records must stay server-only');
check(!/create policy[^;]*on public\.game_(?:combat_rules|level_xp|zone_catalog|monster_catalog|drop_table|explore_logs)\b/i.test(code), 'combat configuration and battle records must not get client policies');
check(code.includes('game_work_orders_one_active_per_user_idx') && code.includes("where status = 'active'"), 'database must enforce one active work order per user');
check(code.includes('game_equipment_one_equipped_per_slot_idx') && code.includes('where is_equipped'), 'database must enforce one equipped item per slot');
check(code.includes('check (hp <= max_hp)'), 'cat HP must not exceed max HP');
check(/grant select \(job_code, display_name, allowed_durations_minutes, is_active\)\s+on public\.game_job_catalog to authenticated/i.test(workCode), 'job catalog reward amounts must not be directly readable by clients');
check(!/from public\.game_job_catalog where job_code=v_order\.job_code and is_active/i.test(workCode), 'disabling a job must not block claiming an already-started order');
check(code.includes("'work_orders', coalesce((select jsonb_agg"), 'snapshot must include active/completed work order state');
check(/'server_now',\s*clock_timestamp\(\)/i.test(workCode), 'snapshot must carry server time so clients never gate claims on the device clock');
check(/c\.status='claimed' order by c\.claimed_at desc,\s*c\.order_id limit 10/i.test(adventureCode), 'the latest snapshot must keep bounding the claimed work order history');
check(/raise exception 'work_already_in_progress'/i.test(workCode), 'a second active work order must raise a readable server error');
check(/jc\.rewards_by_duration \? d::text/i.test(adventureCode), 'the latest snapshot must keep exposing only durations that have a server-configured reward');
// ---- exploration, combat and equipment
check(/raise exception 'zone_locked'/i.test(adventureCode) && /raise exception 'floor_locked'/i.test(adventureCode) && /p_floor>v_reached\+1/i.test(adventureCode), 'zones and floors must open only through recorded progress');
check(/if v_cat\.hp<v_zone\.min_hp_to_enter then raise exception 'cat_too_weak'/i.test(adventureCode), 'entering with too little HP must be refused by the server');
check(/v_coins<0 or v_coins>100000 then raise exception 'invalid_server_reward'/i.test(adventureCode), 'explore payouts must obey the same cap as work orders');
check(/insert into public\.game_wallet_ledger\([\s\S]{0,200}?'explore'/i.test(adventureCode), 'coin drops must go through the wallet ledger');
check(/unique \(user_id, idempotency_key\)/i.test(adventureCode) && /idempotency_key_reused/i.test(adventureCode) && /private\.game_explore_result\(v_prev\)/i.test(adventureCode), 'a retried explore request must return the stored battle instead of rolling again');
check(/order by random\(\) limit 1/i.test(adventureCode) && /v_is_crit:=random\(\)<v_crit/i.test(adventureCode) && /if random\(\)<v_drop\.chance then/i.test(adventureCode), 'monster choice, crits and drops must be rolled by the server');
check(/where e\.user_id=v_uid and e\.is_equipped/i.test(adventureCode) && /raise exception 'equipment_affix_invalid'/i.test(adventureCode), 'combat must read equipped bonuses server-side and refuse malformed ones');
check(/if v_outcome='win' then[\s\S]*?v_xp_gain:=/i.test(adventureCode) && /game_explore_logs\(explore_id[\s\S]*?v_outcome,jsonb_array_length/i.test(adventureCode), 'only a win may pay xp, coins or drops');
check(/updated_at = v_cat\.updated_at and hp < max_hp/i.test(adventureCode), 'HP recovery must not overwrite a concurrent change');
check(/for v_i in 1\.\.v_rules\.max_turns loop/i.test(adventureCode), 'a battle must stop at the configured turn limit');
const zoneBlock = (adventureCode.match(/'zones',coalesce\(\(([\s\S]*?)'level',\(select/) || [])[1] || '';
check(zoneBlock.length > 300 && !/xp|coin|chance|hp_reward|crit|attack|defense/i.test(zoneBlock.replace(/min_hp_to_enter/g, '')), 'the snapshot must expose zone display data only, never monster or reward configuration');
check(/revoke all on function private\.game_explore_result\(public\.game_explore_logs\) from public,anon,authenticated/i.test(adventureCode), 'the battle report helper must not be callable by clients');
check(/create or replace function private\.game_get_snapshot\(\)[\s\S]*?perform private\.game_cat_settle\(\);/i.test(adventureCode), 'the latest snapshot must apply time-based HP recovery');
// ---- job rewards and the village shop
check((rewardsSql.match(/update public\.game_job_catalog set is_active=true, rewards_by_duration=/gi) || []).length === 6, 'all six seeded jobs must receive configured rewards');
check(!/client|front[- ]?end/i.test(rewardsSql.replace(/--[^\n]*/g, '')), 'reward amounts must never be written from client-side code');
check(/create table if not exists public\.game_shop_catalog/i.test(shopCode) && /alter table public\.game_shop_catalog enable row level security/i.test(shopCode), 'the shop catalog must exist with RLS');
check(/revoke all on public\.game_shop_catalog from anon, authenticated/i.test(shopCode), 'shop catalog must have no client grants at all');
check(/price_coins bigint not null check \(price_coins between 1 and 100000\)/i.test(shopCode), 'every good must cost coins so each purchase writes a ledger idempotency record');
check(/if exists\(select 1 from public\.game_wallet_ledger[\s\S]*?'shop:'\|\|p_idempotency_key\) then[\s\S]*?return private\.game_get_snapshot\(\);/i.test(shopCode), 'a replayed purchase must return the snapshot without charging again');
check(/pg_advisory_xact_lock\(hashtextextended\(v_uid::text,0\)\)/i.test(shopCode) && /v_balance < v_good\.price_coins then raise exception 'shop_insufficient_coins'/i.test(shopCode), 'purchases must serialize per user and refuse overspending');
check(/v_cat\.level < v_good\.min_level then raise exception 'shop_level_required'/i.test(shopCode), 'level-gated goods must be refused by the server');
check(shopCode.includes('values(v_uid,v_good.item_code,v_good.slot,v_good.quality,0,v_good.affixes)') &&
  shopCode.includes("values(v_uid,-v_good.price_coins,'shop',v_new.equipment_id::text,'shop:'||p_idempotency_key,v_balance)"),
  'a purchase must deliver server-defined affixes and ledger the debit');
check(/revoke all on function private\.game_buy_item\(text,text\) from public,anon,authenticated/i.test(shopCode) && /grant execute on function public\.game_buy_item\(text,text\) to authenticated/i.test(shopCode), 'the buy RPC must follow the same definer/invoker split as every other game RPC');
check(/'shop',coalesce\(\(select jsonb_agg\(jsonb_build_object\(/i.test(shopCode) && !/price_coins[\s\S]{0,80}rewards_by_duration/i.test(shopCode), 'the snapshot must expose shop display fields without leaking secret configuration');
if (failures) { console.error('Game migration audit failed: ' + failures + ' issue(s)'); process.exit(1); }
console.log('Game migration audit passed: 20 game tables, ten private privileged functions, seven invoker wrappers, server-timed work orders, server-rolled battles, server-authoritative shop, no client write grants.');
