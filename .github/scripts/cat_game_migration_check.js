#!/usr/bin/env node
'use strict';
const fs = require('fs');
const file = 'supabase/migrations/20261126010000_cat_game_cloud_core.sql';
const workFile = 'supabase/migrations/20261126020000_cat_game_work_orders.sql';
const sql = fs.readFileSync(file, 'utf8');
const workSql = fs.readFileSync(workFile, 'utf8');
let failures = 0;
function check(ok, message) {
  if (!ok) { failures++; console.error('FAIL ' + file + ': ' + message); }
}
const code = (sql + '\n' + workSql).replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const tables = [...code.matchAll(/create table if not exists public\.(game_[a-z_]+)/gi)].map(m => m[1]);
const rls = [...code.matchAll(/alter table public\.(game_[a-z_]+) enable row level security/gi)].map(m => m[1]);
const definers = [...code.matchAll(/create or replace function (private\.[\w]+\([^)]*\))[\s\S]*?security definer/gi)].map(m => m[1]);
const wrappers = [...code.matchAll(/create or replace function (public\.game_[\w]+\([^)]*\))[\s\S]*?security invoker/gi)].map(m => m[1]);
check(/create schema if not exists private/i.test(code), 'private schema must exist before function creation');
check(!/revoke\s+all\s+on\s+schema\s+private\s+from\s+public\s*,\s*anon/i.test(code), 'must not revoke existing anon USAGE on shared private schema');
check(/revoke create on schema private from public, anon, authenticated/i.test(code), 'must revoke CREATE on private schema');
check(tables.length === 13, 'expected 13 game tables including job catalog, found ' + tables.length);
check(rls.length === 13 && tables.every(t => rls.includes(t)), 'every game table must have RLS enabled');
check(definers.length === 5 && definers.every(f => f.startsWith('private.game_')), 'five private SECURITY DEFINER definitions including snapshot replacement are expected');
check((code.match(/if\s+v_uid\s+is\s+null\s+then/gi) || [] ).length === 5, 'each privileged function must reject a missing auth.uid()');
check(wrappers.length === 4 && wrappers.every(f => f.startsWith('public.game_')), 'public RPC wrappers must be SECURITY INVOKER');
check(/revoke all on function private\.game_bootstrap\(\) from public, anon, authenticated/i.test(code), 'bootstrap private EXECUTE must be revoked before explicit grant');
check(/revoke all on function private\.game_get_snapshot\(\) from public, anon, authenticated/i.test(code), 'snapshot private EXECUTE must be revoked before explicit grant');
check(/revoke all on function private\.game_start_work\(text,integer,text\) from public,anon,authenticated/i.test(code), 'start-work private EXECUTE must be revoked');
check(/revoke all on function private\.game_claim_work\(uuid\) from public,anon,authenticated/i.test(code), 'claim-work private EXECUTE must be revoked');
check(/create table if not exists public\.game_job_catalog/i.test(code) && /alter table public\.game_job_catalog enable row level security/i.test(code), 'job catalog must exist with RLS');
check(/pg_advisory_xact_lock\(hashtextextended\(v_uid::text,0\)\)/i.test(workSql), 'work commands must serialize per user');
check(/v_now<v_order\.completes_at/i.test(workSql), 'claim must reject unfinished work orders');
check(/rewards_by_duration/i.test(workSql) && /job_reward_not_configured/i.test(workSql), 'payouts must come from server-owned job configuration');
check(!/grant\s+(?:insert|update|delete|all)\s+on\s+(?:table\s+)?public\.game_/i.test(code), 'client roles must not receive direct game table write grants');
check(code.includes('game_work_orders_one_active_per_user_idx') && code.includes("where status = 'active'"), 'database must enforce one active work order per user');
check(code.includes('game_equipment_one_equipped_per_slot_idx') && code.includes('where is_equipped'), 'database must enforce one equipped item per slot');
check(code.includes('check (hp <= max_hp)'), 'cat HP must not exceed max HP');
check(/grant select \\(job_code, display_name, allowed_durations_minutes, is_active\\)\\s+on public\\.game_job_catalog to authenticated/i.test(workSql), 'job catalog reward amounts must not be directly readable by clients');
check(!/from public\\.game_job_catalog where job_code=v_order\\.job_code and is_active/i.test(workSql), 'disabling a job must not block claiming an already-started order');
check(code.includes("'work_orders', coalesce((select jsonb_agg"), 'snapshot must include active/completed work order state');
if (failures) { console.error('Game migration audit failed: ' + failures + ' issue(s)'); process.exit(1); }
console.log('Game migration audit passed: 13 RLS tables, four private privileged RPCs, invoker wrappers, server-timed idempotent work orders, no client write grants.');
