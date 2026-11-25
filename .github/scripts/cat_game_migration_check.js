#!/usr/bin/env node
'use strict';
const fs = require('fs');
const file = 'supabase/migrations/20261126010000_cat_game_cloud_core.sql';
const workFile = 'supabase/migrations/20261126020000_cat_game_work_orders.sql';
const adventureFile = 'supabase/migrations/20261126030000_cat_game_adventure.sql';
const sql = fs.readFileSync(file, 'utf8');
const workSql = fs.readFileSync(workFile, 'utf8');
const adventureSql = fs.readFileSync(adventureFile, 'utf8');
let failures = 0;
function check(ok, message) {
  if (!ok) { failures++; console.error('FAIL ' + file + ': ' + message); }
}
const code = (sql + '\n' + workSql + '\n' + adventureSql).replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const workCode = workSql.replace(/--[^\n]*/g, '');
const adventureCode = adventureSql.replace(/--[^\n]*/g, '');
const tables = [...code.matchAll(/create table if not exists public\.(game_[a-z_]+)/gi)].map(m => m[1]);
const rls = [...code.matchAll(/alter table public\.(game_[a-z_]+) enable row level security/gi)].map(m => m[1]);
const definers = [...code.matchAll(/create or replace function (private\.[\w]+\([^)]*\))[\s\S]*?security definer/gi)].map(m => m[1]);
const wrappers = [...code.matchAll(/create or replace function (public\.game_[\w]+\([^)]*\))[\s\S]*?security invoker/gi)].map(m => m[1]);
check(/create schema if not exists private/i.test(code), 'private schema must exist before function creation');
check(!/revoke\s+all\s+on\s+schema\s+private\s+from\s+public\s*,\s*anon/i.test(code), 'must not revoke existing anon USAGE on shared private schema');
check(/revoke create on schema private from public, anon, authenticated/i.test(code), 'must revoke CREATE on private schema');
check(tables.length === 19, 'expected 19 game tables (13 plus combat rules, levels, zones, monsters, drops, battle records), found ' + tables.length);
check(rls.length === 19 && tables.every(t => rls.includes(t)), 'every game table must have RLS enabled');
check(definers.length === 9 && definers.every(f => f.startsWith('private.game_')), 'nine private SECURITY DEFINER definitions (bootstrap, three snapshot versions, start, claim, regen, equip, explore) are expected, found ' + definers.join(' '));
check((code.match(/if\s+v_uid\s+is\s+null\s+then/gi) || [] ).length === 9, 'each privileged function must reject a missing auth.uid()');
check(wrappers.length === 6 && wrappers.every(f => f.startsWith('public.game_')), 'the six public RPC wrappers must be SECURITY INVOKER');
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
if (failures) { console.error('Game migration audit failed: ' + failures + ' issue(s)'); process.exit(1); }
console.log('Game migration audit passed: 19 RLS tables, nine private privileged functions, six invoker wrappers, server-timed idempotent work orders, server-rolled battles, no client write grants.');
