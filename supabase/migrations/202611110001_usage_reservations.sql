create table if not exists public.snip_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  plan text not null check (plan in ('free','pro','unlimited')),
  period_key text not null,
  status text not null default 'reserved'
    check (status in ('reserved','committed','released')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  committed_at timestamptz
);

create index if not exists snip_usage_user_period_idx
on public.snip_usage_reservations(user_id, period_key, status);

alter table public.snip_usage_reservations enable row level security;

create or replace function public.snip_reserve_usage(
  p_user_id uuid,
  p_plan text
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_period text;
  v_limit integer;
  v_used integer;
  v_id uuid;
begin
  if p_plan is null or p_plan not in ('free','pro','unlimited') then
    raise exception 'Invalid plan';
  end if;

  v_period := case
    when p_plan = 'pro' then to_char(now() at time zone 'UTC','YYYY-MM')
    else to_char(now() at time zone 'UTC','YYYY-MM-DD')
  end;

  v_limit := case when p_plan = 'free' then 10
                  when p_plan = 'pro' then 500
                  else null end;

  perform pg_advisory_xact_lock(hashtextextended(
    p_user_id::text || ':' || v_period, 0
  ));

  update snip_usage_reservations
  set status = 'released'
  where user_id = p_user_id and period_key = v_period
    and status = 'reserved' and expires_at < now();

  select count(*) into v_used
  from snip_usage_reservations
  where user_id = p_user_id and period_key = v_period
    and (status = 'committed' or
         (status = 'reserved' and expires_at > now()));

  if v_limit is not null and v_used >= v_limit then
    return jsonb_build_object('ok',false,'limit',v_limit,'used',v_used);
  end if;

  insert into snip_usage_reservations(user_id,plan,period_key)
  values(p_user_id,p_plan,v_period)
  returning id into v_id;

  return jsonb_build_object(
    'ok',true,'reservation_id',v_id,
    'limit',v_limit,'used',v_used
  );
end;
$$;

create or replace function public.snip_commit_usage(
  p_user_id uuid,
  p_reservation_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_count integer;
begin
  update snip_usage_reservations
  set status = 'committed', committed_at = now()
  where id = p_reservation_id and user_id = p_user_id
    and status = 'reserved' and expires_at > now();

  get diagnostics v_count = row_count;
  return jsonb_build_object('ok',v_count = 1);
end;
$$;

create or replace function public.snip_release_usage(
  p_user_id uuid,
  p_reservation_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_count integer;
begin
  update snip_usage_reservations
  set status = 'released'
  where id = p_reservation_id and user_id = p_user_id
    and status = 'reserved';

  get diagnostics v_count = row_count;
  return jsonb_build_object('ok',v_count = 1);
end;
$$;

revoke all on public.snip_usage_reservations from public, anon, authenticated;
revoke all on function public.snip_reserve_usage(uuid,text) from public, anon, authenticated;
revoke all on function public.snip_commit_usage(uuid,uuid) from public, anon, authenticated;
revoke all on function public.snip_release_usage(uuid,uuid) from public, anon, authenticated;

grant execute on function public.snip_reserve_usage(uuid,text) to service_role;
grant execute on function public.snip_commit_usage(uuid,uuid) to service_role;
grant execute on function public.snip_release_usage(uuid,uuid) to service_role;
