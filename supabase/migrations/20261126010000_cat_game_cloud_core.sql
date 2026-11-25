-- Cat Game V2: cloud save foundation.
-- Keep privileged function implementations in a non-exposed schema.
create schema if not exists private;
-- Do not revoke schema USAGE from anon: this project already has existing
-- private-schema RPC/hooks used by the current app. Restrict object creation
-- instead, and grant only the game functions explicitly below.
revoke create on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
-- NOTE: This migration is staged in Git only. Do not apply until the
-- repository's missing historical migrations have been reconciled.
begin;

create table if not exists public.game_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  public_name text not null default '小橘',
  handle text unique,
  bio text not null default '',
  visibility text not null default 'friends' check (visibility in ('public','friends','private')),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_cats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  skin text not null default 'orange_cat',
  level integer not null default 1 check (level between 1 and 999),
  xp bigint not null default 0 check (xp >= 0),
  hp integer not null default 100 check (hp >= 0),
  max_hp integer not null default 100 check (max_hp > 0),
  check (hp <= max_hp),
  attack integer not null default 5 check (attack >= 0),
  defense integer not null default 2 check (defense >= 0),
  luck integer not null default 0 check (luck >= 0),
  mining_power integer not null default 5 check (mining_power >= 0),
  satiety integer not null default 100 check (satiety between 0 and 100),
  mood integer not null default 100 check (mood between 0 and 100),
  affection bigint not null default 0 check (affection >= 0),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  coins bigint not null default 0 check (coins >= 0),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_wallet_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta bigint not null check (delta <> 0),
  reason text not null,
  source_id text,
  idempotency_key text not null,
  balance_after bigint not null check (balance_after >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table if not exists public.game_item_catalog (
  item_code text primary key,
  category text not null,
  rarity text not null default 'common',
  stack_limit integer not null default 999 check (stack_limit > 0),
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true
);

create table if not exists public.game_inventory (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_code text not null references public.game_item_catalog(item_code),
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, item_code)
);

create table if not exists public.game_equipment (
  equipment_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_code text not null references public.game_item_catalog(item_code),
  slot text not null check (slot in ('weapon','helmet','armor','shoes','gloves','accessory')),
  quality text not null default 'common',
  level integer not null default 0 check (level >= 0),
  affixes jsonb not null default '[]'::jsonb check (jsonb_typeof(affixes) = 'array'),
  is_equipped boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists game_equipment_user_idx on public.game_equipment(user_id);
create unique index if not exists game_equipment_one_equipped_per_slot_idx
  on public.game_equipment(user_id, slot) where is_equipped;

create table if not exists public.game_jobs (
  user_id uuid not null references auth.users(id) on delete cascade,
  job_code text not null,
  level integer not null default 1 check (level between 1 and 50),
  xp bigint not null default 0 check (xp >= 0),
  specialization text,
  updated_at timestamptz not null default now(),
  primary key (user_id, job_code)
);

create table if not exists public.game_work_orders (
  order_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_code text not null,
  duration_code text not null,
  started_at timestamptz not null,
  completes_at timestamptz not null,
  status text not null default 'active' check (status in ('active','completed','claimed','cancelled')),
  claimed_at timestamptz,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  check (completes_at > started_at)
);
create index if not exists game_work_orders_user_status_idx on public.game_work_orders(user_id,status,completes_at);
create unique index if not exists game_work_orders_one_active_per_user_idx
  on public.game_work_orders(user_id) where status = 'active';

create table if not exists public.game_world_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  zone_code text not null,
  max_floor integer not null default 0 check (max_floor >= 0),
  unlocked_at timestamptz not null default now(),
  revision bigint not null default 1,
  primary key (user_id, zone_code)
);

create table if not exists public.game_task_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  task_code text not null,
  period_key text not null default 'once',
  progress integer not null default 0 check (progress >= 0),
  completed_at timestamptz,
  claimed_at timestamptz,
  primary key (user_id, task_code, period_key)
);

create table if not exists public.game_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_code text not null,
  unlocked_at timestamptz,
  progress integer not null default 0 check (progress >= 0),
  primary key (user_id, achievement_code)
);

alter table public.game_profiles enable row level security;
alter table public.game_cats enable row level security;
alter table public.game_wallets enable row level security;
alter table public.game_wallet_ledger enable row level security;
alter table public.game_item_catalog enable row level security;
alter table public.game_inventory enable row level security;
alter table public.game_equipment enable row level security;
alter table public.game_jobs enable row level security;
alter table public.game_work_orders enable row level security;
alter table public.game_world_progress enable row level security;
alter table public.game_task_progress enable row level security;
alter table public.game_achievements enable row level security;

do $policies$
declare
  t text;
begin
  foreach t in array array[
    'game_profiles','game_cats','game_wallets','game_wallet_ledger',
    'game_inventory','game_equipment','game_jobs','game_work_orders',
    'game_world_progress','game_task_progress','game_achievements'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
  end loop;
end
$policies$;

drop policy if exists game_item_catalog_select_active on public.game_item_catalog;
create policy game_item_catalog_select_active on public.game_item_catalog
  for select to authenticated using (is_active);

revoke all on public.game_profiles, public.game_cats, public.game_wallets,
  public.game_wallet_ledger, public.game_item_catalog, public.game_inventory,
  public.game_equipment, public.game_jobs, public.game_work_orders,
  public.game_world_progress, public.game_task_progress, public.game_achievements
  from anon, authenticated;

grant select on public.game_profiles, public.game_cats, public.game_wallets,
  public.game_wallet_ledger, public.game_inventory, public.game_equipment,
  public.game_jobs, public.game_work_orders, public.game_world_progress,
  public.game_task_progress, public.game_achievements to authenticated;
grant select on public.game_item_catalog to authenticated;

create or replace function private.game_bootstrap()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  insert into public.game_profiles(user_id) values (v_uid)
    on conflict (user_id) do nothing;
  insert into public.game_cats(user_id) values (v_uid)
    on conflict (user_id) do nothing;
  insert into public.game_wallets(user_id) values (v_uid)
    on conflict (user_id) do nothing;

  return private.game_get_snapshot();
end;
$function$;

create or replace function private.game_get_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select jsonb_build_object(
    'profile', (select to_jsonb(p) from public.game_profiles p where p.user_id = v_uid),
    'cat', (select to_jsonb(c) from public.game_cats c where c.user_id = v_uid),
    'wallet', (select to_jsonb(w) from public.game_wallets w where w.user_id = v_uid),
    'inventory', coalesce((select jsonb_agg(to_jsonb(i) order by i.item_code) from public.game_inventory i where i.user_id = v_uid), '[]'::jsonb),
    'equipment', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from public.game_equipment e where e.user_id = v_uid), '[]'::jsonb),
    'jobs', coalesce((select jsonb_agg(to_jsonb(j) order by j.job_code) from public.game_jobs j where j.user_id = v_uid), '[]'::jsonb),
    'work_orders', coalesce((select jsonb_agg(to_jsonb(o) order by o.started_at desc) from public.game_work_orders o where o.user_id = v_uid and o.status in ('active','completed')), '[]'::jsonb),
    'world', coalesce((select jsonb_agg(to_jsonb(wp) order by wp.zone_code) from public.game_world_progress wp where wp.user_id = v_uid), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(to_jsonb(tp) order by tp.task_code) from public.game_task_progress tp where tp.user_id = v_uid), '[]'::jsonb),
    'achievements', coalesce((select jsonb_agg(to_jsonb(a) order by a.achievement_code) from public.game_achievements a where a.user_id = v_uid), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

-- Keep privileged SECURITY DEFINER implementations outside the exposed API schema.
-- The public RPC entry points below run as SECURITY INVOKER and delegate only
-- to these narrowly scoped functions after the authenticated identity is checked.
revoke all on function private.game_bootstrap() from public, anon, authenticated;
revoke all on function private.game_get_snapshot() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.game_bootstrap() to authenticated;
grant execute on function private.game_get_snapshot() to authenticated;

create or replace function public.game_bootstrap()
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.game_bootstrap();
$function$;

create or replace function public.game_get_snapshot()
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.game_get_snapshot();
$function$;

revoke all on function public.game_bootstrap() from public, anon, authenticated;
revoke all on function public.game_get_snapshot() from public, anon, authenticated;
grant execute on function public.game_bootstrap() to authenticated;
grant execute on function public.game_get_snapshot() to authenticated;

commit;
