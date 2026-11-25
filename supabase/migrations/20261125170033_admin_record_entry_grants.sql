-- One-time, recipient-approved work-record entry by an authenticated administrator.
create table if not exists private.record_entry_grants (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  grantor_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  record_id text,
  constraint record_entry_grant_expiry check (expires_at > created_at),
  constraint record_entry_grant_state check (
    not (consumed_at is not null and revoked_at is not null)
  )
);

alter table private.record_entry_grants enable row level security;
revoke all on table private.record_entry_grants from public, anon, authenticated;

create or replace function private.create_record_entry_grant()
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_code text := pg_catalog.gen_random_uuid()::text;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  update private.record_entry_grants
     set revoked_at = pg_catalog.now()
   where grantor_user_id = v_uid
     and consumed_at is null
     and revoked_at is null
     and expires_at > pg_catalog.now();

  insert into private.record_entry_grants
    (code_hash, grantor_user_id, expires_at)
  values
    (pg_catalog.encode(extensions.digest(v_code, 'sha256'), 'hex'),
     v_uid, pg_catalog.now() + interval '10 minutes');

  return v_code;
end;
$function$;

create or replace function private.revoke_record_entry_grants()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  update private.record_entry_grants
     set revoked_at = pg_catalog.now()
   where grantor_user_id = v_uid
     and consumed_at is null
     and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

create or replace function private.admin_create_record_for_user(
  p_code text,
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin uuid := auth.uid();
  v_grant private.record_entry_grants%rowtype;
  v_id text;
  v_date date;
  v_start text;
  v_end text;
  v_work text;
  v_paid text;
  v_unpaid text;
  v_duration text;
  v_wage numeric;
  v_hours numeric;
  v_pay numeric;
begin
  if v_admin is null or not exists (
    select 1 from private.feedback_admins a where a.user_id = v_admin
  ) then
    raise exception 'Administrator account required' using errcode = '42501';
  end if;

  if p_code is null or p_code !~ '^[0-9a-fA-F-]{36}$' then
    raise exception 'Invalid or expired authorization code' using errcode = '22023';
  end if;

  if p_record is null or pg_catalog.jsonb_typeof(p_record) <> 'object'
     or not (p_record ?& array['date','start','end','work','paid','unpaid','duration','wage','hours','pay']) then
    raise exception 'Incomplete record data' using errcode = '22023';
  end if;

  select * into v_grant
    from private.record_entry_grants g
   where g.code_hash = pg_catalog.encode(extensions.digest(pg_catalog.lower(p_code), 'sha256'), 'hex')
   for update;

  if not found
     or v_grant.expires_at <= pg_catalog.now()
     or v_grant.consumed_at is not null
     or v_grant.revoked_at is not null
     or v_grant.grantor_user_id = v_admin then
    raise exception 'Invalid, expired, used, or revoked authorization code' using errcode = '22023';
  end if;

  if coalesce(p_record->>'date', '') !~ '^\d{4}-\d{2}-\d{2}
    raise exception 'Invalid date or time format' using errcode = '22023';
  end if;

  begin
    v_date := (p_record->>'date')::date;
    v_wage := (p_record->>'wage')::numeric;
    v_hours := (p_record->>'hours')::numeric;
    v_pay := (p_record->>'pay')::numeric;
  exception when others then
    raise exception 'Invalid numeric or date value' using errcode = '22023';
  end;

  if v_wage is null or v_hours is null or v_pay is null
     or v_wage <= 0 or v_wage > 1000000
     or v_hours <= 0 or v_hours > 24
     or v_pay < 0 or v_pay > 10000000 then
    raise exception 'Wage, hours, or pay is outside the allowed range' using errcode = '22023';
  end if;

  v_start := p_record->>'start';
  v_end := p_record->>'end';
  v_work := p_record->>'work';
  v_paid := p_record->>'paid';
  v_unpaid := p_record->>'unpaid';
  v_duration := p_record->>'duration';
  v_id := 'admin-' || pg_catalog.gen_random_uuid()::text;

  insert into public.records
    (user_id, id, date, start_time, end_time, work, paid, unpaid, duration,
     wage, hours, pay, started, updated_at)
  values
    (v_grant.grantor_user_id, v_id, v_date, v_start, v_end, v_work, v_paid,
     v_unpaid, v_duration, v_wage, v_hours, v_pay, 0, pg_catalog.now());

  update private.record_entry_grants
     set consumed_at = pg_catalog.now(),
         consumed_by = v_admin,
         record_id = v_id
   where code_hash = v_grant.code_hash;

  return pg_catalog.jsonb_build_object('ok', true, 'record_id', v_id, 'date', v_date);
end;
$function$;

revoke all on function private.create_record_entry_grant() from public, anon;
revoke all on function private.revoke_record_entry_grants() from public, anon;
revoke all on function private.admin_create_record_for_user(text, jsonb) from public, anon;
grant execute on function private.create_record_entry_grant() to authenticated;
grant execute on function private.revoke_record_entry_grants() to authenticated;
grant execute on function private.admin_create_record_for_user(text, jsonb) to authenticated;

create or replace function public.record_entry_grant_create()
returns text
language sql
security invoker
set search_path = ''
as $function$ select private.create_record_entry_grant(); $function$;

create or replace function public.record_entry_grant_revoke()
returns integer
language sql
security invoker
set search_path = ''
as $function$ select private.revoke_record_entry_grants(); $function$;

create or replace function public.admin_create_record_for_user(p_code text, p_record jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$ select private.admin_create_record_for_user(p_code, p_record); $function$;

revoke all on function public.record_entry_grant_create() from public, anon;
revoke all on function public.record_entry_grant_revoke() from public, anon;
revoke all on function public.admin_create_record_for_user(text, jsonb) from public, anon;
grant execute on function public.record_entry_grant_create() to authenticated;
grant execute on function public.record_entry_grant_revoke() to authenticated;
grant execute on function public.admin_create_record_for_user(text, jsonb) to authenticated;

     or coalesce(p_record->>'start', '') !~ '^([01]\d|2[0-3]):[0-5]\d
    raise exception 'Invalid date or time format' using errcode = '22023';
  end if;

  begin
    v_date := (p_record->>'date')::date;
    v_wage := (p_record->>'wage')::numeric;
    v_hours := (p_record->>'hours')::numeric;
    v_pay := (p_record->>'pay')::numeric;
  exception when others then
    raise exception 'Invalid numeric or date value' using errcode = '22023';
  end;

  if v_wage <= 0 or v_wage > 1000000
     or v_hours <= 0 or v_hours > 24
     or v_pay < 0 or v_pay > 10000000 then
    raise exception 'Wage, hours, or pay is outside the allowed range' using errcode = '22023';
  end if;

  v_start := p_record->>'start';
  v_end := p_record->>'end';
  v_work := p_record->>'work';
  v_paid := p_record->>'paid';
  v_unpaid := p_record->>'unpaid';
  v_duration := p_record->>'duration';
  v_id := 'admin-' || pg_catalog.gen_random_uuid()::text;

  insert into public.records
    (user_id, id, date, start_time, end_time, work, paid, unpaid, duration,
     wage, hours, pay, started, updated_at)
  values
    (v_grant.grantor_user_id, v_id, v_date, v_start, v_end, v_work, v_paid,
     v_unpaid, v_duration, v_wage, v_hours, v_pay, 0, pg_catalog.now());

  update private.record_entry_grants
     set consumed_at = pg_catalog.now(),
         consumed_by = v_admin,
         record_id = v_id
   where code_hash = v_grant.code_hash;

  return pg_catalog.jsonb_build_object('ok', true, 'record_id', v_id, 'date', v_date);
end;
$function$;

revoke all on function private.create_record_entry_grant() from public, anon;
revoke all on function private.revoke_record_entry_grants() from public, anon;
revoke all on function private.admin_create_record_for_user(text, jsonb) from public, anon;
grant execute on function private.create_record_entry_grant() to authenticated;
grant execute on function private.revoke_record_entry_grants() to authenticated;
grant execute on function private.admin_create_record_for_user(text, jsonb) to authenticated;

create or replace function public.record_entry_grant_create()
returns text
language sql
security invoker
set search_path = ''
as $function$ select private.create_record_entry_grant(); $function$;

create or replace function public.record_entry_grant_revoke()
returns integer
language sql
security invoker
set search_path = ''
as $function$ select private.revoke_record_entry_grants(); $function$;

create or replace function public.admin_create_record_for_user(p_code text, p_record jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$ select private.admin_create_record_for_user(p_code, p_record); $function$;

revoke all on function public.record_entry_grant_create() from public, anon;
revoke all on function public.record_entry_grant_revoke() from public, anon;
revoke all on function public.admin_create_record_for_user(text, jsonb) from public, anon;
grant execute on function public.record_entry_grant_create() to authenticated;
grant execute on function public.record_entry_grant_revoke() to authenticated;
grant execute on function public.admin_create_record_for_user(text, jsonb) to authenticated;

     or coalesce(p_record->>'end', '') !~ '^([01]\d|2[0-3]):[0-5]\d
    raise exception 'Invalid date or time format' using errcode = '22023';
  end if;

  begin
    v_date := (p_record->>'date')::date;
    v_wage := (p_record->>'wage')::numeric;
    v_hours := (p_record->>'hours')::numeric;
    v_pay := (p_record->>'pay')::numeric;
  exception when others then
    raise exception 'Invalid numeric or date value' using errcode = '22023';
  end;

  if v_wage <= 0 or v_wage > 1000000
     or v_hours <= 0 or v_hours > 24
     or v_pay < 0 or v_pay > 10000000 then
    raise exception 'Wage, hours, or pay is outside the allowed range' using errcode = '22023';
  end if;

  v_start := p_record->>'start';
  v_end := p_record->>'end';
  v_work := p_record->>'work';
  v_paid := p_record->>'paid';
  v_unpaid := p_record->>'unpaid';
  v_duration := p_record->>'duration';
  v_id := 'admin-' || pg_catalog.gen_random_uuid()::text;

  insert into public.records
    (user_id, id, date, start_time, end_time, work, paid, unpaid, duration,
     wage, hours, pay, started, updated_at)
  values
    (v_grant.grantor_user_id, v_id, v_date, v_start, v_end, v_work, v_paid,
     v_unpaid, v_duration, v_wage, v_hours, v_pay, 0, pg_catalog.now());

  update private.record_entry_grants
     set consumed_at = pg_catalog.now(),
         consumed_by = v_admin,
         record_id = v_id
   where code_hash = v_grant.code_hash;

  return pg_catalog.jsonb_build_object('ok', true, 'record_id', v_id, 'date', v_date);
end;
$function$;

revoke all on function private.create_record_entry_grant() from public, anon;
revoke all on function private.revoke_record_entry_grants() from public, anon;
revoke all on function private.admin_create_record_for_user(text, jsonb) from public, anon;
grant execute on function private.create_record_entry_grant() to authenticated;
grant execute on function private.revoke_record_entry_grants() to authenticated;
grant execute on function private.admin_create_record_for_user(text, jsonb) to authenticated;

create or replace function public.record_entry_grant_create()
returns text
language sql
security invoker
set search_path = ''
as $function$ select private.create_record_entry_grant(); $function$;

create or replace function public.record_entry_grant_revoke()
returns integer
language sql
security invoker
set search_path = ''
as $function$ select private.revoke_record_entry_grants(); $function$;

create or replace function public.admin_create_record_for_user(p_code text, p_record jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$ select private.admin_create_record_for_user(p_code, p_record); $function$;

revoke all on function public.record_entry_grant_create() from public, anon;
revoke all on function public.record_entry_grant_revoke() from public, anon;
revoke all on function public.admin_create_record_for_user(text, jsonb) from public, anon;
grant execute on function public.record_entry_grant_create() to authenticated;
grant execute on function public.record_entry_grant_revoke() to authenticated;
grant execute on function public.admin_create_record_for_user(text, jsonb) to authenticated;

     or coalesce(p_record->>'work', '') !~ '^\d{1,3}:[0-5]\d:[0-5]\d
    raise exception 'Invalid date or time format' using errcode = '22023';
  end if;

  begin
    v_date := (p_record->>'date')::date;
    v_wage := (p_record->>'wage')::numeric;
    v_hours := (p_record->>'hours')::numeric;
    v_pay := (p_record->>'pay')::numeric;
  exception when others then
    raise exception 'Invalid numeric or date value' using errcode = '22023';
  end;

  if v_wage <= 0 or v_wage > 1000000
     or v_hours <= 0 or v_hours > 24
     or v_pay < 0 or v_pay > 10000000 then
    raise exception 'Wage, hours, or pay is outside the allowed range' using errcode = '22023';
  end if;

  v_start := p_record->>'start';
  v_end := p_record->>'end';
  v_work := p_record->>'work';
  v_paid := p_record->>'paid';
  v_unpaid := p_record->>'unpaid';
  v_duration := p_record->>'duration';
  v_id := 'admin-' || pg_catalog.gen_random_uuid()::text;

  insert into public.records
    (user_id, id, date, start_time, end_time, work, paid, unpaid, duration,
     wage, hours, pay, started, updated_at)
  values
    (v_grant.grantor_user_id, v_id, v_date, v_start, v_end, v_work, v_paid,
     v_unpaid, v_duration, v_wage, v_hours, v_pay, 0, pg_catalog.now());

  update private.record_entry_grants
     set consumed_at = pg_catalog.now(),
         consumed_by = v_admin,
         record_id = v_id
   where code_hash = v_grant.code_hash;

  return pg_catalog.jsonb_build_object('ok', true, 'record_id', v_id, 'date', v_date);
end;
$function$;

revoke all on function private.create_record_entry_grant() from public, anon;
revoke all on function private.revoke_record_entry_grants() from public, anon;
revoke all on function private.admin_create_record_for_user(text, jsonb) from public, anon;
grant execute on function private.create_record_entry_grant() to authenticated;
grant execute on function private.revoke_record_entry_grants() to authenticated;
grant execute on function private.admin_create_record_for_user(text, jsonb) to authenticated;

create or replace function public.record_entry_grant_create()
returns text
language sql
security invoker
set search_path = ''
as $function$ select private.create_record_entry_grant(); $function$;

create or replace function public.record_entry_grant_revoke()
returns integer
language sql
security invoker
set search_path = ''
as $function$ select private.revoke_record_entry_grants(); $function$;

create or replace function public.admin_create_record_for_user(p_code text, p_record jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$ select private.admin_create_record_for_user(p_code, p_record); $function$;

revoke all on function public.record_entry_grant_create() from public, anon;
revoke all on function public.record_entry_grant_revoke() from public, anon;
revoke all on function public.admin_create_record_for_user(text, jsonb) from public, anon;
grant execute on function public.record_entry_grant_create() to authenticated;
grant execute on function public.record_entry_grant_revoke() to authenticated;
grant execute on function public.admin_create_record_for_user(text, jsonb) to authenticated;

     or coalesce(p_record->>'paid', '') !~ '^\d{1,3}:[0-5]\d:[0-5]\d
    raise exception 'Invalid date or time format' using errcode = '22023';
  end if;

  begin
    v_date := (p_record->>'date')::date;
    v_wage := (p_record->>'wage')::numeric;
    v_hours := (p_record->>'hours')::numeric;
    v_pay := (p_record->>'pay')::numeric;
  exception when others then
    raise exception 'Invalid numeric or date value' using errcode = '22023';
  end;

  if v_wage <= 0 or v_wage > 1000000
     or v_hours <= 0 or v_hours > 24
     or v_pay < 0 or v_pay > 10000000 then
    raise exception 'Wage, hours, or pay is outside the allowed range' using errcode = '22023';
  end if;

  v_start := p_record->>'start';
  v_end := p_record->>'end';
  v_work := p_record->>'work';
  v_paid := p_record->>'paid';
  v_unpaid := p_record->>'unpaid';
  v_duration := p_record->>'duration';
  v_id := 'admin-' || pg_catalog.gen_random_uuid()::text;

  insert into public.records
    (user_id, id, date, start_time, end_time, work, paid, unpaid, duration,
     wage, hours, pay, started, updated_at)
  values
    (v_grant.grantor_user_id, v_id, v_date, v_start, v_end, v_work, v_paid,
     v_unpaid, v_duration, v_wage, v_hours, v_pay, 0, pg_catalog.now());

  update private.record_entry_grants
     set consumed_at = pg_catalog.now(),
         consumed_by = v_admin,
         record_id = v_id
   where code_hash = v_grant.code_hash;

  return pg_catalog.jsonb_build_object('ok', true, 'record_id', v_id, 'date', v_date);
end;
$function$;

revoke all on function private.create_record_entry_grant() from public, anon;
revoke all on function private.revoke_record_entry_grants() from public, anon;
revoke all on function private.admin_create_record_for_user(text, jsonb) from public, anon;
grant execute on function private.create_record_entry_grant() to authenticated;
grant execute on function private.revoke_record_entry_grants() to authenticated;
grant execute on function private.admin_create_record_for_user(text, jsonb) to authenticated;

create or replace function public.record_entry_grant_create()
returns text
language sql
security invoker
set search_path = ''
as $function$ select private.create_record_entry_grant(); $function$;

create or replace function public.record_entry_grant_revoke()
returns integer
language sql
security invoker
set search_path = ''
as $function$ select private.revoke_record_entry_grants(); $function$;

create or replace function public.admin_create_record_for_user(p_code text, p_record jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$ select private.admin_create_record_for_user(p_code, p_record); $function$;

revoke all on function public.record_entry_grant_create() from public, anon;
revoke all on function public.record_entry_grant_revoke() from public, anon;
revoke all on function public.admin_create_record_for_user(text, jsonb) from public, anon;
grant execute on function public.record_entry_grant_create() to authenticated;
grant execute on function public.record_entry_grant_revoke() to authenticated;
grant execute on function public.admin_create_record_for_user(text, jsonb) to authenticated;

     or coalesce(p_record->>'unpaid', '') !~ '^\d{1,3}:[0-5]\d:[0-5]\d
    raise exception 'Invalid date or time format' using errcode = '22023';
  end if;

  begin
    v_date := (p_record->>'date')::date;
    v_wage := (p_record->>'wage')::numeric;
    v_hours := (p_record->>'hours')::numeric;
    v_pay := (p_record->>'pay')::numeric;
  exception when others then
    raise exception 'Invalid numeric or date value' using errcode = '22023';
  end;

  if v_wage <= 0 or v_wage > 1000000
     or v_hours <= 0 or v_hours > 24
     or v_pay < 0 or v_pay > 10000000 then
    raise exception 'Wage, hours, or pay is outside the allowed range' using errcode = '22023';
  end if;

  v_start := p_record->>'start';
  v_end := p_record->>'end';
  v_work := p_record->>'work';
  v_paid := p_record->>'paid';
  v_unpaid := p_record->>'unpaid';
  v_duration := p_record->>'duration';
  v_id := 'admin-' || pg_catalog.gen_random_uuid()::text;

  insert into public.records
    (user_id, id, date, start_time, end_time, work, paid, unpaid, duration,
     wage, hours, pay, started, updated_at)
  values
    (v_grant.grantor_user_id, v_id, v_date, v_start, v_end, v_work, v_paid,
     v_unpaid, v_duration, v_wage, v_hours, v_pay, 0, pg_catalog.now());

  update private.record_entry_grants
     set consumed_at = pg_catalog.now(),
         consumed_by = v_admin,
         record_id = v_id
   where code_hash = v_grant.code_hash;

  return pg_catalog.jsonb_build_object('ok', true, 'record_id', v_id, 'date', v_date);
end;
$function$;

revoke all on function private.create_record_entry_grant() from public, anon;
revoke all on function private.revoke_record_entry_grants() from public, anon;
revoke all on function private.admin_create_record_for_user(text, jsonb) from public, anon;
grant execute on function private.create_record_entry_grant() to authenticated;
grant execute on function private.revoke_record_entry_grants() to authenticated;
grant execute on function private.admin_create_record_for_user(text, jsonb) to authenticated;

create or replace function public.record_entry_grant_create()
returns text
language sql
security invoker
set search_path = ''
as $function$ select private.create_record_entry_grant(); $function$;

create or replace function public.record_entry_grant_revoke()
returns integer
language sql
security invoker
set search_path = ''
as $function$ select private.revoke_record_entry_grants(); $function$;

create or replace function public.admin_create_record_for_user(p_code text, p_record jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$ select private.admin_create_record_for_user(p_code, p_record); $function$;

revoke all on function public.record_entry_grant_create() from public, anon;
revoke all on function public.record_entry_grant_revoke() from public, anon;
revoke all on function public.admin_create_record_for_user(text, jsonb) from public, anon;
grant execute on function public.record_entry_grant_create() to authenticated;
grant execute on function public.record_entry_grant_revoke() to authenticated;
grant execute on function public.admin_create_record_for_user(text, jsonb) to authenticated;

     or coalesce(p_record->>'duration', '') !~ '^\d{1,3}:[0-5]\d:[0-5]\d
    raise exception 'Invalid date or time format' using errcode = '22023';
  end if;

  begin
    v_date := (p_record->>'date')::date;
    v_wage := (p_record->>'wage')::numeric;
    v_hours := (p_record->>'hours')::numeric;
    v_pay := (p_record->>'pay')::numeric;
  exception when others then
    raise exception 'Invalid numeric or date value' using errcode = '22023';
  end;

  if v_wage <= 0 or v_wage > 1000000
     or v_hours <= 0 or v_hours > 24
     or v_pay < 0 or v_pay > 10000000 then
    raise exception 'Wage, hours, or pay is outside the allowed range' using errcode = '22023';
  end if;

  v_start := p_record->>'start';
  v_end := p_record->>'end';
  v_work := p_record->>'work';
  v_paid := p_record->>'paid';
  v_unpaid := p_record->>'unpaid';
  v_duration := p_record->>'duration';
  v_id := 'admin-' || pg_catalog.gen_random_uuid()::text;

  insert into public.records
    (user_id, id, date, start_time, end_time, work, paid, unpaid, duration,
     wage, hours, pay, started, updated_at)
  values
    (v_grant.grantor_user_id, v_id, v_date, v_start, v_end, v_work, v_paid,
     v_unpaid, v_duration, v_wage, v_hours, v_pay, 0, pg_catalog.now());

  update private.record_entry_grants
     set consumed_at = pg_catalog.now(),
         consumed_by = v_admin,
         record_id = v_id
   where code_hash = v_grant.code_hash;

  return pg_catalog.jsonb_build_object('ok', true, 'record_id', v_id, 'date', v_date);
end;
$function$;

revoke all on function private.create_record_entry_grant() from public, anon;
revoke all on function private.revoke_record_entry_grants() from public, anon;
revoke all on function private.admin_create_record_for_user(text, jsonb) from public, anon;
grant execute on function private.create_record_entry_grant() to authenticated;
grant execute on function private.revoke_record_entry_grants() to authenticated;
grant execute on function private.admin_create_record_for_user(text, jsonb) to authenticated;

create or replace function public.record_entry_grant_create()
returns text
language sql
security invoker
set search_path = ''
as $function$ select private.create_record_entry_grant(); $function$;

create or replace function public.record_entry_grant_revoke()
returns integer
language sql
security invoker
set search_path = ''
as $function$ select private.revoke_record_entry_grants(); $function$;

create or replace function public.admin_create_record_for_user(p_code text, p_record jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$ select private.admin_create_record_for_user(p_code, p_record); $function$;

revoke all on function public.record_entry_grant_create() from public, anon;
revoke all on function public.record_entry_grant_revoke() from public, anon;
revoke all on function public.admin_create_record_for_user(text, jsonb) from public, anon;
grant execute on function public.record_entry_grant_create() to authenticated;
grant execute on function public.record_entry_grant_revoke() to authenticated;
grant execute on function public.admin_create_record_for_user(text, jsonb) to authenticated;
 then
    raise exception 'Invalid date or time format' using errcode = '22023';
  end if;

  begin
    v_date := (p_record->>'date')::date;
    v_wage := (p_record->>'wage')::numeric;
    v_hours := (p_record->>'hours')::numeric;
    v_pay := (p_record->>'pay')::numeric;
  exception when others then
    raise exception 'Invalid numeric or date value' using errcode = '22023';
  end;

  if v_wage <= 0 or v_wage > 1000000
     or v_hours <= 0 or v_hours > 24
     or v_pay < 0 or v_pay > 10000000 then
    raise exception 'Wage, hours, or pay is outside the allowed range' using errcode = '22023';
  end if;

  v_start := p_record->>'start';
  v_end := p_record->>'end';
  v_work := p_record->>'work';
  v_paid := p_record->>'paid';
  v_unpaid := p_record->>'unpaid';
  v_duration := p_record->>'duration';
  v_id := 'admin-' || pg_catalog.gen_random_uuid()::text;

  insert into public.records
    (user_id, id, date, start_time, end_time, work, paid, unpaid, duration,
     wage, hours, pay, started, updated_at)
  values
    (v_grant.grantor_user_id, v_id, v_date, v_start, v_end, v_work, v_paid,
     v_unpaid, v_duration, v_wage, v_hours, v_pay, 0, pg_catalog.now());

  update private.record_entry_grants
     set consumed_at = pg_catalog.now(),
         consumed_by = v_admin,
         record_id = v_id
   where code_hash = v_grant.code_hash;

  return pg_catalog.jsonb_build_object('ok', true, 'record_id', v_id, 'date', v_date);
end;
$function$;

revoke all on function private.create_record_entry_grant() from public, anon;
revoke all on function private.revoke_record_entry_grants() from public, anon;
revoke all on function private.admin_create_record_for_user(text, jsonb) from public, anon;
grant execute on function private.create_record_entry_grant() to authenticated;
grant execute on function private.revoke_record_entry_grants() to authenticated;
grant execute on function private.admin_create_record_for_user(text, jsonb) to authenticated;

create or replace function public.record_entry_grant_create()
returns text
language sql
security invoker
set search_path = ''
as $function$ select private.create_record_entry_grant(); $function$;

create or replace function public.record_entry_grant_revoke()
returns integer
language sql
security invoker
set search_path = ''
as $function$ select private.revoke_record_entry_grants(); $function$;

create or replace function public.admin_create_record_for_user(p_code text, p_record jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$ select private.admin_create_record_for_user(p_code, p_record); $function$;

revoke all on function public.record_entry_grant_create() from public, anon;
revoke all on function public.record_entry_grant_revoke() from public, anon;
revoke all on function public.admin_create_record_for_user(text, jsonb) from public, anon;
grant execute on function public.record_entry_grant_create() to authenticated;
grant execute on function public.record_entry_grant_revoke() to authenticated;
grant execute on function public.admin_create_record_for_user(text, jsonb) to authenticated;
