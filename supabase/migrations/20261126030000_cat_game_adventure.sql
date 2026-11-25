-- Server-authoritative exploration, combat and equipment for Cat Game V2.
-- Every tunable number lives in the configuration tables below. The seeded rows are
-- RECOMMENDED starting values awaiting the owner's review; change them there.
-- Clients never read these tables: they only see what the snapshot and the battle
-- result expose. Staged in Git only; do not apply until migration-history
-- reconciliation is complete.
begin;

-- ---------------------------------------------------------------- configuration
create table if not exists public.game_combat_rules (
  id smallint primary key default 1 check (id = 1),
  crit_chance numeric not null check (crit_chance between 0 and 1),
  crit_multiplier numeric not null check (crit_multiplier >= 1),
  luck_crit_bonus numeric not null default 0 check (luck_crit_bonus >= 0),
  min_damage integer not null default 1 check (min_damage >= 1),
  max_turns integer not null check (max_turns between 1 and 200),
  hp_regen_per_minute numeric not null check (hp_regen_per_minute >= 0)
);
insert into public.game_combat_rules(id,crit_chance,crit_multiplier,luck_crit_bonus,min_damage,max_turns,hp_regen_per_minute) values
 (1,0.10,1.5,0.002,1,30,1)
on conflict (id) do nothing;

-- xp is progress inside the current level; each row is what the next level costs and grants.
create table if not exists public.game_level_xp (
  level integer primary key check (level between 1 and 999),
  xp_to_next bigint not null check (xp_to_next > 0),
  hp_gain integer not null default 0 check (hp_gain >= 0),
  attack_gain integer not null default 0 check (attack_gain >= 0),
  defense_gain integer not null default 0 check (defense_gain >= 0)
);
insert into public.game_level_xp(level,xp_to_next,hp_gain,attack_gain,defense_gain)
 select g,round(40*power(1.25,g-1))::bigint,10,1,1 from generate_series(1,30) g
on conflict (level) do nothing;

create table if not exists public.game_zone_catalog (
  zone_code text primary key,
  display_name text not null,
  description text not null default '',
  icon text not null default '🗺️',
  max_floor integer not null check (max_floor between 1 and 999),
  unlock_zone_code text references public.game_zone_catalog(zone_code),
  unlock_floor integer not null default 0 check (unlock_floor between 0 and 999),
  min_hp_to_enter integer not null default 1 check (min_hp_to_enter > 0),
  sort_order integer not null default 0,
  is_active boolean not null default false
);
insert into public.game_zone_catalog(zone_code,display_name,description,icon,max_floor,unlock_zone_code,unlock_floor,min_hp_to_enter,sort_order,is_active) values
 ('forest','静谧森林','采集、探索与初级怪物','🌳',10,null,0,20,10,true),
 ('mine','新手矿洞','矿石、宝箱与史莱姆','⛏️',15,'forest',5,30,20,true),
 ('ruins','地下遗迹','骷髅与遗迹守卫出没的深处','🏛️',20,'mine',8,40,30,true)
on conflict (zone_code) do nothing;

-- Stats on floor N = base + per_floor * (N - floor_min).
create table if not exists public.game_monster_catalog (
  monster_code text primary key,
  zone_code text not null references public.game_zone_catalog(zone_code),
  display_name text not null,
  emoji text not null default '👾',
  floor_min integer not null check (floor_min >= 1),
  floor_max integer not null check (floor_max >= floor_min),
  hp integer not null check (hp > 0),
  attack integer not null check (attack >= 0),
  defense integer not null check (defense >= 0),
  hp_per_floor integer not null default 0 check (hp_per_floor >= 0),
  attack_per_floor integer not null default 0 check (attack_per_floor >= 0),
  defense_per_floor integer not null default 0 check (defense_per_floor >= 0),
  xp_reward bigint not null default 0 check (xp_reward >= 0),
  xp_per_floor bigint not null default 0 check (xp_per_floor >= 0),
  coin_min bigint not null default 0 check (coin_min >= 0),
  coin_max bigint not null default 0 check (coin_max >= coin_min),
  coin_per_floor bigint not null default 0 check (coin_per_floor >= 0),
  is_active boolean not null default false
);
insert into public.game_monster_catalog(monster_code,zone_code,display_name,emoji,floor_min,floor_max,hp,attack,defense,
  hp_per_floor,attack_per_floor,defense_per_floor,xp_reward,xp_per_floor,coin_min,coin_max,coin_per_floor,is_active) values
 ('slime_green','forest','绿色史莱姆','🟢',1,10,30,3,0,6,1,0,8,3,1,3,1,true),
 ('forest_wolf','forest','野狼','🐺',4,10,45,6,1,7,1,0,14,4,2,5,1,true),
 ('rock_slime','mine','岩石史莱姆','🟤',1,15,60,7,2,9,1,0,18,5,3,6,1,true),
 ('cave_bat','mine','洞穴蝙蝠','🦇',6,15,70,11,1,10,1,0,26,6,4,8,1,true),
 ('skeleton_guard','ruins','骷髅卫兵','💀',1,20,110,14,5,14,1,0,45,9,8,15,2,true),
 ('ruins_guard','ruins','遗迹守卫','🗿',10,20,160,20,8,16,1,0,70,12,12,22,2,true)
on conflict (monster_code) do nothing;

insert into public.game_item_catalog(item_code,category,rarity,stack_limit,metadata) values
 ('wood','material','common',999,'{"name":"木材"}'),
 ('herb','material','common',999,'{"name":"草药"}'),
 ('stone','material','common',999,'{"name":"石头"}'),
 ('copper_ore','material','common',999,'{"name":"铜矿石"}'),
 ('coal','material','common',999,'{"name":"煤"}'),
 ('ancient_shard','material','rare',99,'{"name":"古老碎片"}')
on conflict (item_code) do nothing;

-- Each row is an independent roll on a win; only wins drop anything.
create table if not exists public.game_drop_table (
  drop_id integer generated always as identity primary key,
  zone_code text not null references public.game_zone_catalog(zone_code),
  item_code text not null references public.game_item_catalog(item_code),
  floor_min integer not null default 1 check (floor_min >= 1),
  floor_max integer not null default 9999 check (floor_max >= floor_min),
  chance numeric not null check (chance between 0 and 1),
  min_qty integer not null default 1 check (min_qty >= 0),
  max_qty integer not null default 1 check (max_qty >= min_qty)
);
insert into public.game_drop_table(zone_code,item_code,floor_min,floor_max,chance,min_qty,max_qty) values
 ('forest','herb',1,10,0.50,1,2),
 ('forest','wood',1,10,0.35,1,2),
 ('mine','stone',1,15,0.60,1,3),
 ('mine','copper_ore',3,15,0.30,1,2),
 ('mine','coal',8,15,0.15,1,1),
 ('ruins','stone',1,20,0.40,1,2),
 ('ruins','copper_ore',1,20,0.25,1,2),
 ('ruins','ancient_shard',1,20,0.20,1,1)
on conflict do nothing;

-- One row per battle that was actually fought; also the idempotency record.
create table if not exists public.game_explore_logs (
  explore_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  zone_code text not null,
  floor integer not null check (floor >= 1),
  outcome text not null check (outcome in ('win','lose')),
  turns integer not null check (turns >= 1),
  monster_code text not null,
  monster_hp integer not null,
  xp_gain bigint not null default 0 check (xp_gain >= 0),
  coin_gain bigint not null default 0 check (coin_gain >= 0),
  drops jsonb not null default '[]'::jsonb check (jsonb_typeof(drops) = 'array'),
  hp_after integer not null check (hp_after >= 0),
  level_after integer not null,
  level_up boolean not null default false,
  replay jsonb not null default '[]'::jsonb check (jsonb_typeof(replay) = 'array'),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index if not exists game_explore_logs_user_idx on public.game_explore_logs(user_id,created_at desc);

alter table public.game_combat_rules enable row level security;
alter table public.game_level_xp enable row level security;
alter table public.game_zone_catalog enable row level security;
alter table public.game_monster_catalog enable row level security;
alter table public.game_drop_table enable row level security;
alter table public.game_explore_logs enable row level security;
-- No policies and no grants: configuration, drop rates and battle records stay server-only.
revoke all on public.game_combat_rules, public.game_level_xp, public.game_zone_catalog,
  public.game_monster_catalog, public.game_drop_table, public.game_explore_logs
  from anon, authenticated;

-- ---------------------------------------------------------------- regen
-- HP recovers with elapsed time since the cat row last changed. Whole periods are
-- applied and the leftover seconds are kept, so frequent reads do not slow recovery.
create or replace function private.game_cat_settle()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_cat public.game_cats%rowtype;
  v_now timestamptz := clock_timestamp();
  v_rate numeric; v_elapsed numeric; v_periods integer; v_leftover numeric;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select * into v_cat from public.game_cats where user_id = v_uid;
  if not found or v_cat.hp >= v_cat.max_hp then return; end if;
  select hp_regen_per_minute into v_rate from public.game_combat_rules where id = 1;
  if v_rate is null or v_rate <= 0 then return; end if;

  v_elapsed := extract(epoch from (v_now - v_cat.updated_at));
  v_periods := floor(v_elapsed * v_rate / 60);
  if v_periods < 1 then return; end if;
  v_leftover := v_elapsed - v_periods * 60 / v_rate;

  -- The updated_at guard keeps a concurrent change from being overwritten.
  update public.game_cats
    set hp = least(max_hp, hp + v_periods),
        updated_at = v_now - make_interval(secs => v_leftover),
        revision = revision + 1
    where user_id = v_uid and updated_at = v_cat.updated_at and hp < max_hp;
end;
$function$;

create or replace function private.game_get_snapshot()
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_uid uuid := auth.uid(); v_result jsonb;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  perform private.game_cat_settle();
  select jsonb_build_object(
    'server_now',clock_timestamp(),
    'profile',(select to_jsonb(p) from public.game_profiles p where p.user_id=v_uid),
    'cat',(select to_jsonb(c) from public.game_cats c where c.user_id=v_uid),
    'wallet',(select to_jsonb(w) from public.game_wallets w where w.user_id=v_uid),
    'inventory',coalesce((select jsonb_agg(to_jsonb(i) order by i.item_code) from public.game_inventory i where i.user_id=v_uid),'[]'::jsonb),
    'equipment',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from public.game_equipment e where e.user_id=v_uid),'[]'::jsonb),
    'jobs',coalesce((select jsonb_agg(to_jsonb(j) order by j.job_code) from public.game_jobs j where j.user_id=v_uid),'[]'::jsonb),
    -- Open orders in full, plus only the latest claimed ones, so the snapshot does not grow without bound.
    'work_orders',coalesce((select jsonb_agg(to_jsonb(o) order by o.started_at desc) from (
      select w.* from public.game_work_orders w
      where w.user_id=v_uid and (w.status in ('active','completed') or w.order_id in (
        select c.order_id from public.game_work_orders c
        where c.user_id=v_uid and c.status='claimed' order by c.claimed_at desc,c.order_id limit 10))
    ) o),'[]'::jsonb),
    -- Only durations with a server-configured reward are exposed; reward amounts stay private.
    'job_catalog',coalesce((select jsonb_agg(jsonb_build_object('job_code',jc.job_code,'display_name',jc.display_name,
      'allowed_durations_minutes',coalesce((select array(select d from unnest(jc.allowed_durations_minutes) d
        where jc.rewards_by_duration ? d::text order by d)),'{}'::integer[])) order by jc.job_code)
      from public.game_job_catalog jc where jc.is_active),'[]'::jsonb),
    'world',coalesce((select jsonb_agg(to_jsonb(wp) order by wp.zone_code) from public.game_world_progress wp where wp.user_id=v_uid),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(to_jsonb(tp) order by tp.task_code) from public.game_task_progress tp where tp.user_id=v_uid),'[]'::jsonb),
    'achievements',coalesce((select jsonb_agg(to_jsonb(a) order by a.achievement_code) from public.game_achievements a where a.user_id=v_uid),'[]'::jsonb),
    -- Display data only: no monster stats, drop rates or reward amounts leave the server here.
    'zones',coalesce((select jsonb_agg(jsonb_build_object(
        'zone_code',z.zone_code,'display_name',z.display_name,'description',z.description,'icon',z.icon,
        'max_floor',z.max_floor,'min_hp_to_enter',z.min_hp_to_enter,
        'unlock_zone_code',z.unlock_zone_code,'unlock_floor',z.unlock_floor,
        'reached_floor',coalesce((select w.max_floor from public.game_world_progress w where w.user_id=v_uid and w.zone_code=z.zone_code),0),
        'unlocked',z.unlock_zone_code is null or coalesce((select w.max_floor from public.game_world_progress w
          where w.user_id=v_uid and w.zone_code=z.unlock_zone_code),0)>=z.unlock_floor)
      order by z.sort_order,z.zone_code) from public.game_zone_catalog z where z.is_active),'[]'::jsonb),
    'level',(select jsonb_build_object('xp_to_next',l.xp_to_next) from public.game_level_xp l
      where l.level=(select c.level from public.game_cats c where c.user_id=v_uid)),
    'item_names',coalesce((select jsonb_object_agg(ic.item_code,coalesce(ic.metadata->>'name',ic.item_code))
      from public.game_item_catalog ic where ic.is_active),'{}'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

-- ---------------------------------------------------------------- equipment
create or replace function private.game_equip_item(p_equipment_id uuid,p_equipped boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid(); v_item public.game_equipment%rowtype; v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if p_equipment_id is null or p_equipped is null then
    raise exception 'invalid_equipment_request' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  select * into v_item from public.game_equipment
    where equipment_id=p_equipment_id and user_id=v_uid for update;
  if not found then raise exception 'equipment_not_found' using errcode = 'P0002'; end if;
  if v_item.is_equipped=p_equipped then return private.game_get_snapshot(); end if;
  if p_equipped then
    -- Only well-formed bonuses may affect a battle.
    if exists(select 1 from jsonb_array_elements(v_item.affixes) a
              where ((a->>'stat') is distinct from 'attack' and (a->>'stat') is distinct from 'defense'
                  and (a->>'stat') is distinct from 'luck' and (a->>'stat') is distinct from 'mining_power')
                 or (a->>'value') is null or (a->>'value') !~ '^-?[0-9]{1,6}$'
                 or abs((a->>'value')::integer)>9999) then
      raise exception 'equipment_affix_invalid' using errcode = '55000';
    end if;
    update public.game_equipment set is_equipped=false where user_id=v_uid and slot=v_item.slot and is_equipped;
  end if;
  update public.game_equipment set is_equipped=p_equipped where equipment_id=p_equipment_id;
  update public.game_profiles set revision=revision+1,updated_at=v_now where user_id=v_uid;
  return private.game_get_snapshot();
end;
$function$;

-- ---------------------------------------------------------------- exploration
create or replace function private.game_start_explore(p_zone_code text,p_floor integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid(); v_now timestamptz := clock_timestamp(); v_explore_id uuid := gen_random_uuid();
  v_cat public.game_cats%rowtype; v_zone public.game_zone_catalog%rowtype; v_rules public.game_combat_rules%rowtype;
  v_mon public.game_monster_catalog%rowtype; v_prev public.game_explore_logs%rowtype; v_drop record;
  v_gain public.game_level_xp%rowtype;
  v_reached integer; v_step integer; v_i integer;
  v_atk integer; v_def integer; v_luck integer; v_atk_bonus integer; v_def_bonus integer; v_luck_bonus integer;
  v_crit numeric; v_hp integer; v_max_hp integer; v_atk_gain integer := 0; v_def_gain integer := 0;
  v_m_hp integer; v_m_max_hp integer; v_m_atk integer; v_m_def integer;
  v_dmg integer; v_is_crit boolean; v_turns jsonb := '[]'::jsonb; v_outcome text := 'lose';
  v_level integer; v_xp bigint; v_xp_gain bigint := 0; v_coins bigint := 0; v_drops jsonb := '[]'::jsonb;
  v_qty integer; v_low bigint; v_high bigint; v_balance bigint;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if p_zone_code is null or length(p_zone_code)>40 or p_floor is null or p_floor<1 or p_floor>999
     or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 120 then
    raise exception 'invalid_explore_request' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  -- A retried request returns the battle that was already fought; nothing is rolled again.
  select * into v_prev from public.game_explore_logs where user_id=v_uid and idempotency_key=p_idempotency_key;
  if found then
    if v_prev.zone_code<>p_zone_code or v_prev.floor<>p_floor then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return private.game_get_snapshot() || jsonb_build_object('explore', private.game_explore_result(v_prev));
  end if;

  perform private.game_cat_settle();
  select * into v_cat from public.game_cats where user_id=v_uid for update;
  if not found then raise exception 'game_profile_not_initialized' using errcode = '55000'; end if;
  select * into v_rules from public.game_combat_rules where id=1;
  if not found then raise exception 'combat_not_configured' using errcode = '55000'; end if;
  select * into v_zone from public.game_zone_catalog where zone_code=p_zone_code and is_active;
  if not found then raise exception 'zone_unavailable' using errcode = '22023'; end if;
  if p_floor>v_zone.max_floor then raise exception 'floor_out_of_range' using errcode = '22023'; end if;
  -- Zones unlock through recorded progress; floors cannot be skipped.
  select coalesce(max(max_floor),0) into v_reached from public.game_world_progress
    where user_id=v_uid and zone_code=v_zone.unlock_zone_code;
  if v_reached<v_zone.unlock_floor then raise exception 'zone_locked' using errcode = '55000'; end if;
  select coalesce(max(max_floor),0) into v_reached from public.game_world_progress
    where user_id=v_uid and zone_code=p_zone_code;
  if p_floor>v_reached+1 then raise exception 'floor_locked' using errcode = '55000'; end if;
  if v_cat.hp<v_zone.min_hp_to_enter then raise exception 'cat_too_weak' using errcode = '55000'; end if;
  select * into v_mon from public.game_monster_catalog
    where zone_code=p_zone_code and is_active and floor_min<=p_floor and floor_max>=p_floor
    order by random() limit 1;
  if not found then raise exception 'floor_not_configured' using errcode = '55000'; end if;

  -- Equipped bonuses are read server-side; malformed values are ignored rather than trusted.
  select coalesce(sum(case when a->>'stat'='attack' and (a->>'value') ~ '^-?[0-9]{1,6}$' then (a->>'value')::integer end),0),
         coalesce(sum(case when a->>'stat'='defense' and (a->>'value') ~ '^-?[0-9]{1,6}$' then (a->>'value')::integer end),0),
         coalesce(sum(case when a->>'stat'='luck' and (a->>'value') ~ '^-?[0-9]{1,6}$' then (a->>'value')::integer end),0)
    into v_atk_bonus,v_def_bonus,v_luck_bonus
    from public.game_equipment e cross join lateral jsonb_array_elements(e.affixes) a
    where e.user_id=v_uid and e.is_equipped;
  v_atk:=greatest(0,v_cat.attack+v_atk_bonus);
  v_def:=greatest(0,v_cat.defense+v_def_bonus);
  v_luck:=greatest(0,v_cat.luck+v_luck_bonus);
  v_crit:=least(0.95,v_rules.crit_chance+v_luck*v_rules.luck_crit_bonus);
  v_hp:=v_cat.hp; v_max_hp:=v_cat.max_hp; v_level:=v_cat.level; v_xp:=v_cat.xp;
  v_step:=p_floor-v_mon.floor_min;
  v_m_max_hp:=v_mon.hp+v_mon.hp_per_floor*v_step; v_m_hp:=v_m_max_hp;
  v_m_atk:=v_mon.attack+v_mon.attack_per_floor*v_step;
  v_m_def:=v_mon.defense+v_mon.defense_per_floor*v_step;

  -- The cat strikes first. Every roll happens here, on the server.
  for v_i in 1..v_rules.max_turns loop
    v_is_crit:=random()<v_crit;
    v_dmg:=greatest(v_rules.min_damage,v_atk-v_m_def);
    if v_is_crit then v_dmg:=round(v_dmg*v_rules.crit_multiplier)::integer; end if;
    v_m_hp:=v_m_hp-v_dmg;
    v_turns:=v_turns||jsonb_build_object('turn',v_i,'actor','cat','damage',v_dmg,'crit',v_is_crit,'hp',greatest(v_m_hp,0));
    if v_m_hp<=0 then v_outcome:='win'; exit; end if;
    v_dmg:=greatest(v_rules.min_damage,v_m_atk-v_def);
    v_hp:=v_hp-v_dmg;
    v_turns:=v_turns||jsonb_build_object('turn',v_i,'actor','monster','damage',v_dmg,'hp',greatest(v_hp,0));
    if v_hp<=0 then exit; end if;
  end loop;

  if v_outcome='win' then
    v_xp_gain:=greatest(0,v_mon.xp_reward+v_mon.xp_per_floor*v_step);
    v_xp:=v_xp+v_xp_gain;
    v_low:=v_mon.coin_min+v_mon.coin_per_floor*v_step;
    v_high:=greatest(v_low,v_mon.coin_max+v_mon.coin_per_floor*v_step);
    v_coins:=v_low+floor(random()*(v_high-v_low+1))::bigint;
    if v_coins<0 or v_coins>100000 then raise exception 'invalid_server_reward' using errcode = '22023'; end if;
    for v_drop in select * from public.game_drop_table
                  where zone_code=p_zone_code and floor_min<=p_floor and floor_max>=p_floor loop
      if random()<v_drop.chance then
        v_qty:=v_drop.min_qty+floor(random()*(v_drop.max_qty-v_drop.min_qty+1))::integer;
        if v_qty>0 then
          update public.game_inventory set quantity=least(quantity+v_qty,
              (select stack_limit from public.game_item_catalog where item_code=v_drop.item_code)),updated_at=v_now
            where user_id=v_uid and item_code=v_drop.item_code;
          if not found then
            insert into public.game_inventory(user_id,item_code,quantity)
              values(v_uid,v_drop.item_code,least(v_qty,
                (select stack_limit from public.game_item_catalog where item_code=v_drop.item_code)));
          end if;
          v_drops:=v_drops||jsonb_build_object('item_code',v_drop.item_code,'quantity',v_qty);
        end if;
      end if;
    end loop;
    insert into public.game_world_progress(user_id,zone_code,max_floor) values(v_uid,p_zone_code,p_floor)
      on conflict(user_id,zone_code) do update
        set max_floor=greatest(public.game_world_progress.max_floor,excluded.max_floor),
            revision=public.game_world_progress.revision+1;
    loop
      select * into v_gain from public.game_level_xp where level=v_level;
      exit when not found or v_xp<v_gain.xp_to_next;
      v_xp:=v_xp-v_gain.xp_to_next; v_level:=v_level+1;
      v_max_hp:=v_max_hp+v_gain.hp_gain; v_hp:=v_hp+v_gain.hp_gain;
      v_atk_gain:=v_atk_gain+v_gain.attack_gain; v_def_gain:=v_def_gain+v_gain.defense_gain;
    end loop;
  end if;

  update public.game_cats set level=v_level,xp=v_xp,hp=greatest(0,v_hp),max_hp=v_max_hp,
    attack=v_cat.attack+v_atk_gain,defense=v_cat.defense+v_def_gain,revision=revision+1,updated_at=v_now
    where user_id=v_uid;
  if v_coins>0 then
    select coins into v_balance from public.game_wallets where user_id=v_uid for update;
    if not found then raise exception 'game_profile_not_initialized' using errcode = '55000'; end if;
    v_balance:=v_balance+v_coins;
    update public.game_wallets set coins=v_balance,revision=revision+1,updated_at=v_now where user_id=v_uid;
    insert into public.game_wallet_ledger(user_id,delta,reason,source_id,idempotency_key,balance_after)
      values(v_uid,v_coins,'explore',v_explore_id::text,'explore:'||v_explore_id::text,v_balance);
  end if;
  insert into public.game_explore_logs(explore_id,user_id,zone_code,floor,outcome,turns,monster_code,monster_hp,
    xp_gain,coin_gain,drops,hp_after,level_after,level_up,replay,idempotency_key)
    values(v_explore_id,v_uid,p_zone_code,p_floor,v_outcome,jsonb_array_length(v_turns),v_mon.monster_code,v_m_max_hp,
      v_xp_gain,v_coins,v_drops,greatest(0,v_hp),v_level,v_level>v_cat.level,v_turns,p_idempotency_key);
  update public.game_profiles set revision=revision+1,updated_at=v_now where user_id=v_uid;
  select * into v_prev from public.game_explore_logs where explore_id=v_explore_id;
  return private.game_get_snapshot() || jsonb_build_object('explore', private.game_explore_result(v_prev));
end;
$function$;

-- Builds the client-facing battle report from a stored battle. Same shape for a
-- fresh result and for an idempotent replay of an earlier request.
create or replace function private.game_explore_result(p_log public.game_explore_logs)
returns jsonb language sql stable set search_path = ''
as $function$
  select jsonb_build_object(
    'outcome',p_log.outcome,'zone_code',p_log.zone_code,'floor',p_log.floor,
    'monster_name',m.display_name,'monster_emoji',m.emoji,'monster_hp',p_log.monster_hp,
    'turns',p_log.replay,'xp',p_log.xp_gain,'coins',p_log.coin_gain,'drops',p_log.drops,
    'hp_after',p_log.hp_after,'level_after',p_log.level_after,'level_up',p_log.level_up)
  from public.game_monster_catalog m where m.monster_code=p_log.monster_code;
$function$;
revoke all on function private.game_explore_result(public.game_explore_logs) from public,anon,authenticated;

-- ---------------------------------------------------------------- grants and public entry points
revoke all on function private.game_get_snapshot() from public,anon,authenticated;
revoke all on function private.game_cat_settle() from public,anon,authenticated;
revoke all on function private.game_equip_item(uuid,boolean) from public,anon,authenticated;
revoke all on function private.game_start_explore(text,integer,text) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.game_get_snapshot() to authenticated;
grant execute on function private.game_equip_item(uuid,boolean) to authenticated;
grant execute on function private.game_start_explore(text,integer,text) to authenticated;

create or replace function public.game_equip_item(p_equipment_id uuid,p_equipped boolean)
returns jsonb language sql security invoker set search_path = ''
as $function$ select private.game_equip_item(p_equipment_id,p_equipped); $function$;
create or replace function public.game_start_explore(p_zone_code text,p_floor integer,p_idempotency_key text)
returns jsonb language sql security invoker set search_path = ''
as $function$ select private.game_start_explore(p_zone_code,p_floor,p_idempotency_key); $function$;
revoke all on function public.game_equip_item(uuid,boolean) from public,anon,authenticated;
revoke all on function public.game_start_explore(text,integer,text) from public,anon,authenticated;
grant execute on function public.game_equip_item(uuid,boolean) to authenticated;
grant execute on function public.game_start_explore(text,integer,text) to authenticated;

commit;
