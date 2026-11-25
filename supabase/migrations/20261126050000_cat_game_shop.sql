-- Cat Game V2: the village shop. Coins earned from work and exploring can be
-- spent here on equipment; purchases are server-authoritative, idempotent and
-- ledgered. Affix values are copied from the server-side catalog at purchase
-- time, so a malformed catalog row can never reach a battle.
-- Staged in Git only; apply to the running database in the SQL editor.
begin;

-- Equipment items must exist in the shared catalog before they can be sold or owned.
insert into public.game_item_catalog(item_code,category,rarity,stack_limit,metadata) values
 ('wood_sword','equipment','common',1,'{"name":"木剑"}'),
 ('leather_cap','equipment','common',1,'{"name":"皮帽"}'),
 ('leather_armor','equipment','common',1,'{"name":"皮甲"}'),
 ('grass_shoes','equipment','common',1,'{"name":"草鞋"}'),
 ('leather_gloves','equipment','common',1,'{"name":"皮手套"}'),
 ('lucky_bell','equipment','common',1,'{"name":"幸运铃铛"}'),
 ('copper_sword','equipment','uncommon',1,'{"name":"铜剑"}'),
 ('copper_helm','equipment','uncommon',1,'{"name":"铜盔"}'),
 ('copper_armor','equipment','uncommon',1,'{"name":"铜甲"}'),
 ('miner_boots','equipment','uncommon',1,'{"name":"矿工靴"}'),
 ('miner_gloves','equipment','uncommon',1,'{"name":"矿工手套"}'),
 ('explorer_charm','equipment','rare',1,'{"name":"探险家护符"}')
on conflict (item_code) do nothing;

create table if not exists public.game_shop_catalog (
  shop_code text primary key,
  item_code text not null references public.game_item_catalog(item_code),
  slot text not null check (slot in ('weapon','helmet','armor','shoes','gloves','accessory')),
  display_name text not null,
  icon text not null default '🎁',
  quality text not null default 'common',
  affixes jsonb not null default '[]'::jsonb check (jsonb_typeof(affixes) = 'array'),
  price_coins bigint not null check (price_coins between 1 and 100000),
  min_level integer not null default 1 check (min_level between 1 and 999),
  sort_order integer not null default 0,
  is_active boolean not null default false
);
-- Every price must be positive so a purchase always writes a wallet-ledger row,
-- which is what makes the idempotency key replayable.
insert into public.game_shop_catalog(shop_code,item_code,slot,display_name,icon,quality,affixes,price_coins,min_level,sort_order,is_active) values
 ('wood_sword','wood_sword','weapon','木剑','🗡️','common','[{"stat":"attack","value":"2"}]',100,1,10,true),
 ('leather_cap','leather_cap','helmet','皮帽','🧢','common','[{"stat":"defense","value":"1"}]',80,1,20,true),
 ('grass_shoes','grass_shoes','shoes','草鞋','👟','common','[{"stat":"defense","value":"1"}]',60,1,30,true),
 ('leather_gloves','leather_gloves','gloves','皮手套','🧤','common','[{"stat":"attack","value":"1"}]',70,1,40,true),
 ('leather_armor','leather_armor','armor','皮甲','🥋','common','[{"stat":"defense","value":"3"}]',150,1,50,true),
 ('lucky_bell','lucky_bell','accessory','幸运铃铛','🔔','common','[{"stat":"luck","value":"5"}]',200,1,60,true),
 ('copper_sword','copper_sword','weapon','铜剑','⚔️','uncommon','[{"stat":"attack","value":"6"}]',500,5,110,true),
 ('copper_helm','copper_helm','helmet','铜盔','🪖','uncommon','[{"stat":"defense","value":"3"}]',400,5,120,true),
 ('miner_boots','miner_boots','shoes','矿工靴','🥾','uncommon','[{"stat":"defense","value":"2"}]',300,5,130,true),
 ('miner_gloves','miner_gloves','gloves','矿工手套','⛏️','uncommon','[{"stat":"attack","value":"3"}]',350,5,140,true),
 ('copper_armor','copper_armor','armor','铜甲','🛡️','uncommon','[{"stat":"defense","value":"8"}]',700,5,150,true),
 ('explorer_charm','explorer_charm','accessory','探险家护符','🧿','rare','[{"stat":"luck","value":"12"}]',600,5,160,true)
on conflict (shop_code) do nothing;

alter table public.game_shop_catalog enable row level security;
-- No policies and no grants: prices and stock stay server-only; the snapshot
-- exposes exactly the fields the shop UI needs.
revoke all on public.game_shop_catalog from anon, authenticated;

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
    'work_orders',coalesce((select jsonb_agg(to_jsonb(o) order by o.started_at desc) from (
      select w.* from public.game_work_orders w
      where w.user_id=v_uid and (w.status in ('active','completed') or w.order_id in (
        select c.order_id from public.game_work_orders c
        where c.user_id=v_uid and c.status='claimed' order by c.claimed_at desc,c.order_id limit 10))
    ) o),'[]'::jsonb),
    'job_catalog',coalesce((select jsonb_agg(jsonb_build_object('job_code',jc.job_code,'display_name',jc.display_name,
      'allowed_durations_minutes',coalesce((select array(select d from unnest(jc.allowed_durations_minutes) d
        where jc.rewards_by_duration ? d::text order by d)),'{}'::integer[])) order by jc.job_code)
      from public.game_job_catalog jc where jc.is_active),'[]'::jsonb),
    'world',coalesce((select jsonb_agg(to_jsonb(wp) order by wp.zone_code) from public.game_world_progress wp where wp.user_id=v_uid),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(to_jsonb(tp) order by tp.task_code) from public.game_task_progress tp where tp.user_id=v_uid),'[]'::jsonb),
    'achievements',coalesce((select jsonb_agg(to_jsonb(a) order by a.achievement_code) from public.game_achievements a where a.user_id=v_uid),'[]'::jsonb),
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
      from public.game_item_catalog ic where ic.is_active),'{}'::jsonb),
    -- Shop goods are public by design; these are the display fields only.
    'shop',coalesce((select jsonb_agg(jsonb_build_object(
        'shop_code',s.shop_code,'display_name',s.display_name,'icon',s.icon,'slot',s.slot,'quality',s.quality,
        'affixes',s.affixes,'price_coins',s.price_coins,'min_level',s.min_level)
      order by s.sort_order,s.shop_code) from public.game_shop_catalog s where s.is_active),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

create or replace function private.game_buy_item(p_shop_code text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid(); v_good public.game_shop_catalog%rowtype;
  v_new public.game_equipment%rowtype; v_cat public.game_cats%rowtype;
  v_balance bigint; v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='28000'; end if;
  if p_shop_code is null or length(p_shop_code)>40 or p_idempotency_key is null
     or length(p_idempotency_key) not between 8 and 120 then
    raise exception 'invalid_shop_request' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  -- A retried purchase returns the snapshot without charging or duplicating the
  -- item: the ledger row written by the first attempt is the idempotency record.
  if exists(select 1 from public.game_wallet_ledger
            where user_id=v_uid and idempotency_key='shop:'||p_idempotency_key) then
    return private.game_get_snapshot();
  end if;
  select * into v_good from public.game_shop_catalog where shop_code=p_shop_code and is_active for share;
  if not found then raise exception 'shop_item_not_available' using errcode='22023'; end if;
  select * into v_cat from public.game_cats where user_id=v_uid;
  if not found then raise exception 'game_profile_not_initialized' using errcode='55000'; end if;
  if v_cat.level < v_good.min_level then raise exception 'shop_level_required' using errcode='55000'; end if;
  select coins into v_balance from public.game_wallets where user_id=v_uid for update;
  if not found then raise exception 'game_profile_not_initialized' using errcode='55000'; end if;
  if v_balance < v_good.price_coins then raise exception 'shop_insufficient_coins' using errcode='55000'; end if;
  v_balance := v_balance - v_good.price_coins;
  update public.game_wallets set coins=v_balance,revision=revision+1,updated_at=v_now where user_id=v_uid;
  insert into public.game_equipment(user_id,item_code,slot,quality,level,affixes)
    values(v_uid,v_good.item_code,v_good.slot,v_good.quality,0,v_good.affixes)
    returning * into v_new;
  insert into public.game_wallet_ledger(user_id,delta,reason,source_id,idempotency_key,balance_after)
    values(v_uid,-v_good.price_coins,'shop',v_new.equipment_id::text,'shop:'||p_idempotency_key,v_balance);
  update public.game_profiles set revision=revision+1,updated_at=v_now where user_id=v_uid;
  return private.game_get_snapshot();
end;
$function$;

revoke all on function private.game_get_snapshot() from public,anon,authenticated;
revoke all on function private.game_buy_item(text,text) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.game_get_snapshot() to authenticated;
grant execute on function private.game_buy_item(text,text) to authenticated;

create or replace function public.game_buy_item(p_shop_code text,p_idempotency_key text)
returns jsonb language sql security invoker set search_path = ''
as $function$ select private.game_buy_item(p_shop_code,p_idempotency_key); $function$;
revoke all on function public.game_buy_item(text,text) from public,anon,authenticated;
grant execute on function public.game_buy_item(text,text) to authenticated;

commit;
