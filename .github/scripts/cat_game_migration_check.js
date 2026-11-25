#!/usr/bin/env node
'use strict';
const fs = require('fs');
const file = 'supabase/migrations/20261126010000_cat_game_cloud_core.sql';
const sql = fs.readFileSync(file, 'utf8');
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
check(tables.length === 12, 'expected 12 game tables, found ' + tables.length);
check(rls.length === 12 && tables.every(t => rls.includes(t)), 'every game table must have RLS enabled');
check(definers.length === 2 && definers.every(f => f.startsWith('private.game_')), 'only two private SECURITY DEFINER game functions are allowed');
check((code.match(/if\s+v_uid\s+is\s+null\s+then/gi) || []).length === 2, 'each privileged function must reject a missing auth.uid()');
check(wrappers.length === 2 && wrappers.every(f => f.startsWith('public.game_')), 'public RPC wrappers must be SECURITY INVOKER');
check(/revoke all on function private\.game_bootstrap\(\) from public, anon, authenticated/i.test(code), 'bootstrap private EXECUTE must be revoked before explicit grant');
check(/revoke all on function private\.game_get_snapshot\(\) from public, anon, authenticated/i.test(code), 'snapshot private EXECUTE must be revoked before explicit grant');
check(!/grant\s+(?:insert|update|delete|all)\s+on\s+(?:table\s+)?public\.game_/i.test(code), 'client roles must not receive direct game table write grants');
if (failures) { console.error('Game migration audit failed: ' + failures + ' issue(s)'); process.exit(1); }
console.log('Game migration audit passed: 12 RLS tables, private privileged RPCs, invoker wrappers, no client write grants.');
