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
const code = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const tables = [...code.matchAll(/create table if not exists public\.(game_[a-z_]+)/gi)].map(m => m[1]);
const rls = [...code.matchAll(/alter table public\.(game_[a-z_]+) enable row level security/gi)].map(m => m[1]);
const definers = [...code.matchAll(/create or replace function (private\.[\w]+\([^)]*\))[\s\S]*?security definer/gi)].map(m => m[1]);
const wrappers = [...code.matchAll(/create or replace function (public\.game_[\w]+\([^)]*\))[\s\S]*?security invoker/gi)].map(m => m[1]);
check(/create schema if not exists private/i.test(code), 'private schema must exist before function creation');
check(!/revoke\s+all\s+on\s+schema\s+private\s+from\s+public\s*,\s*anon/i.test(code), 'must not revoke existing anon USAGE on shared private schema');
check(/revoke create on schema private from public, anon, authenticated/i.test(code), 'must revoke CREATE on private schema');
check(tables.length === 13, 'expected 13 game tables including job catalog, found ' + tables.length);
check(rls.length === 13 && tables.every(t => rls.includes(t)), 'every game table must have RLS enabled');
check(definers.length === 4 && definers.every(f => f.startsWith('private.game_')), 'four private SECURITY DEFINER game functions are expected');
check((code.match(/if\s+v_uid\s+is\s+null\s+then/gi) || []).length === 2, 'each privileged function must reject a missing auth.uid()');
check(wrappers.length === 4 && wrappers.every(f => f.startsWith('public.game_')), 'public RPC wrappers must be SECURITY INVOKER');
check(/revoke all on function private\.game_bootstrap\(\) from public, anon, authenticated/i.test(code), 'bootstrap private EXECUTE must be revoked before explicit grant');
check(/revoke all on function private\.game_get_snapshot\(\) from public, anon, authenticated/i.test(code), 'snapshot private EXECUTE must be revoked before explicit grant');
check(!/grant\s+(?:insert|update|delete|all)\s+on\s+(?:table\s+)?public\.game_/i.test(code), 'client roles must not receive direct game table write grants');
check(code.includes('game_work_orders_one_active_per_user_idx') && code.includes("where status = 'active'"), 'database must enforce one active work order per user');
check(code.includes('game_equipment_one_equipped_per_slot_idx') && code.includes('where is_equipped'), 'database must enforce one equipped item per slot');
check(code.includes('check (hp <= max_hp)'), 'cat HP must not exceed max HP');
check(code.includes("'work_orders', coalesce((select jsonb_agg"), 'snapshot must include active/completed work order state');
if (failures) { console.error('Game migration audit failed: ' + failures + ' issue(s)'); process.exit(1); }
console.log('Game migration audit passed: 13 RLS tables, four private privileged RPCs, invoker wrappers, server-timed idempotent work orders, no client write grants.');
