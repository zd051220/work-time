-- Server-authoritative work orders for Cat Game V2.
-- Staged in Git only; do not apply until migration-history reconciliation is complete.
begin;

create table if not exists public.game_job_catalog (
  job_code text primary key,
  display_name text not null,
  allowed_durations_minutes integer[] not null default array[60,120,240,480],
  rewards_by_duration jsonb not null default '{}'::jsonb check (jsonb_typeof(rewards_by_duration) = 'object'),
  is_active boolean not null default false,
  check (cardinality(allowed_durations_minutes) between 1 and 4),
  check (allowed_durations_minutes <@ array[60,120,240,480]::integer[])
);
insert into public.game_job_catalog(job_code,display_name) values
 ('bakery','面包店学徒'),('blacksmith','铁匠学徒'),('foraging','森林采集员'),
 ('mining','矿场助手'),('fishing','钓鱼学徒'),('delivery','村庄送货员')
on conflict (job_code) do nothing;

alter table public.game_job_catalog enable row level security;
drop policy if exists game_job_catalog_select_active on public.game_job_catalog;
create policy game_job_catalog_select_active on public.game_job_catalog
  for select to authenticated using (is_active);
revoke all on public.game_job_catalog from anon, authenticated;
-- Expose only display/configuration metadata. Reward amounts remain private to server functions.
grant select (job_code, display_name, allowed_durations_minutes, is_active)
  on public.game_job_catalog to authenticated;

create or replace function private.game_get_snapshot()
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_uid uuid := auth.uid(); v_result jsonb;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  select jsonb_build_object(
    'profile',(select to_jsonb(p) from public.game_profiles p where p.user_id=v_uid),
    'cat',(select to_jsonb(c) from public.game_cats c where c.user_id=v_uid),
    'wallet',(select to_jsonb(w) from public.game_wallets w where w.user_id=v_uid),
    'inventory',coalesce((select jsonb_agg(to_jsonb(i) order by i.item_code) from public.game_inventory i where i.user_id=v_uid),'[]'::jsonb),
    'equipment',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from public.game_equipment e where e.user_id=v_uid),'[]'::jsonb),
    'jobs',coalesce((select jsonb_agg(to_jsonb(j) order by j.job_code) from public.game_jobs j where j.user_id=v_uid),'[]'::jsonb),
    'work_orders',coalesce((select jsonb_agg(to_jsonb(o) order by o.started_at desc) from public.game_work_orders o where o.user_id=v_uid and o.status in ('active','completed','claimed')),'[]'::jsonb),
    'job_catalog',coalesce((select jsonb_agg(jsonb_build_object('job_code',jc.job_code,'display_name',jc.display_name,'allowed_durations_minutes',jc.allowed_durations_minutes) order by jc.job_code) from public.game_job_catalog jc where jc.is_active),'[]'::jsonb),
    'world',coalesce((select jsonb_agg(to_jsonb(wp) order by wp.zone_code) from public.game_world_progress wp where wp.user_id=v_uid),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(to_jsonb(tp) order by tp.task_code) from public.game_task_progress tp where tp.user_id=v_uid),'[]'::jsonb),
    'achievements',coalesce((select jsonb_agg(to_jsonb(a) order by a.achievement_code) from public.game_achievements a where a.user_id=v_uid),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

create or replace function private.game_start_work(p_job_code text,p_duration_minutes integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid(); v_catalog public.game_job_catalog%rowtype;
  v_existing public.game_work_orders%rowtype; v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if p_job_code is null or length(p_job_code)>40 or p_duration_minutes is null
     or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 120 then
    raise exception 'invalid_work_order_request' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  select * into v_existing from public.game_work_orders where user_id=v_uid and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.job_code<>p_job_code or v_existing.duration_code<>p_duration_minutes::text then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return private.game_get_snapshot();
  end if;
  select * into v_catalog from public.game_job_catalog where job_code=p_job_code and is_active for share;
  if not found then raise exception 'job_unavailable' using errcode = '22023'; end if;
  if not (p_duration_minutes=any(v_catalog.allowed_durations_minutes)) then
    raise exception 'duration_not_allowed' using errcode = '22023';
  end if;
  if not (v_catalog.rewards_by_duration ? p_duration_minutes::text) then
    raise exception 'job_reward_not_configured' using errcode = '55000';
  end if;
  insert into public.game_jobs(user_id,job_code) values(v_uid,p_job_code) on conflict do nothing;
  insert into public.game_work_orders(user_id,job_code,duration_code,started_at,completes_at,status,idempotency_key)
    values(v_uid,p_job_code,p_duration_minutes::text,v_now,v_now+make_interval(mins=>p_duration_minutes),'active',p_idempotency_key);
  update public.game_profiles set revision=revision+1,updated_at=v_now where user_id=v_uid;
  return private.game_get_snapshot();
end;
$function$;

create or replace function private.game_claim_work(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid(); v_order public.game_work_orders%rowtype;
  v_catalog public.game_job_catalog%rowtype; v_payout jsonb;
  v_coins bigint; v_balance bigint; v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if p_order_id is null then raise exception 'invalid_work_order' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  select * into v_order from public.game_work_orders
    where order_id=p_order_id and user_id=v_uid for update;
  if not found then raise exception 'work_order_not_found' using errcode = 'P0002'; end if;
  if v_order.status='claimed' then return private.game_get_snapshot(); end if;
  if v_order.status<>'active' then raise exception 'work_order_not_claimable' using errcode = '55000'; end if;
  if v_now<v_order.completes_at then raise exception 'work_order_not_finished' using errcode = '55000'; end if;
  -- A job may be disabled for new starts without invalidating an order already in progress.
  select * into v_catalog from public.game_job_catalog where job_code=v_order.job_code;
  if not found then raise exception 'job_unavailable' using errcode = '55000'; end if;
  v_payout:=v_catalog.rewards_by_duration->v_order.duration_code;
  if v_payout is null or jsonb_typeof(v_payout)<>'object' or not(v_payout?'coins')
     or (v_payout->>'coins') !~ '^[0-9]{1,9}$' then
    raise exception 'job_reward_not_configured' using errcode = '55000';
  end if;
  v_coins:=(v_payout->>'coins')::bigint;
  if v_coins<0 or v_coins>100000 then raise exception 'invalid_server_reward' using errcode = '22023'; end if;
  select coins into v_balance from public.game_wallets where user_id=v_uid for update;
  if not found then raise exception 'game_profile_not_initialized' using errcode = '55000'; end if;
  if v_coins>0 then
    v_balance:=v_balance+v_coins;
    update public.game_wallets set coins=v_balance,revision=revision+1,updated_at=v_now where user_id=v_uid;
    insert into public.game_wallet_ledger(user_id,delta,reason,source_id,idempotency_key,balance_after)
      values(v_uid,v_coins,'work_order',v_order.order_id::text,'work:'||v_order.order_id::text,v_balance)
      on conflict(user_id,idempotency_key) do nothing;
  end if;
  update public.game_work_orders set status='claimed',claimed_at=v_now where order_id=v_order.order_id;
  update public.game_profiles set revision=revision+1,updated_at=v_now where user_id=v_uid;
  return private.game_get_snapshot();
end;
$function$;

revoke all on function private.game_get_snapshot() from public,anon,authenticated;
revoke all on function private.game_start_work(text,integer,text) from public,anon,authenticated;
revoke all on function private.game_claim_work(uuid) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.game_get_snapshot() to authenticated;
grant execute on function private.game_start_work(text,integer,text) to authenticated;
grant execute on function private.game_claim_work(uuid) to authenticated;

create or replace function public.game_start_work(p_job_code text,p_duration_minutes integer,p_idempotency_key text)
returns jsonb language sql security invoker set search_path = ''
as $function$ select private.game_start_work(p_job_code,p_duration_minutes,p_idempotency_key); $function$;
create or replace function public.game_claim_work(p_order_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $function$ select private.game_claim_work(p_order_id); $function$;
revoke all on function public.game_start_work(text,integer,text) from public,anon,authenticated;
revoke all on function public.game_claim_work(uuid) from public,anon,authenticated;
grant execute on function public.game_start_work(text,integer,text) to authenticated;
grant execute on function public.game_claim_work(uuid) to authenticated;

commit;
