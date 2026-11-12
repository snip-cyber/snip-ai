create table if not exists public.snip_anonymous_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  install_hash text not null check (install_hash ~ '^[0-9a-f]{64}$'),
  period_key text not null,
  status text not null default 'reserved'
    check (status in ('reserved','committed','released')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  committed_at timestamptz
);

create index if not exists snip_anon_install_period_idx
on public.snip_anonymous_usage_reservations(install_hash, period_key, status);

alter table public.snip_anonymous_usage_reservations enable row level security;

create or replace function public.snip_anon_get_usage(p_install_hash text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_period text := to_char(now() at time zone 'UTC','YYYY-MM-DD');
  v_used integer;
begin
  if p_install_hash is null or p_install_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid installation identity';
  end if;

  select count(*) into v_used
  from snip_anonymous_usage_reservations
  where install_hash = p_install_hash and period_key = v_period
    and (status = 'committed' or
         (status = 'reserved' and expires_at > now()));

  return jsonb_build_object(
    'ok',true,'plan','anonymous','used',v_used,
    'limit',10,'remaining',greatest(0,10-v_used),
    'authenticated',false
  );
end;
$$;

create or replace function public.snip_anon_reserve_usage(p_install_hash text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_period text := to_char(now() at time zone 'UTC','YYYY-MM-DD');
  v_used integer;
  v_id uuid;
begin
  if p_install_hash is null or p_install_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid installation identity';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_install_hash || ':' || v_period, 0
  ));

  update snip_anonymous_usage_reservations
  set status = 'released'
  where install_hash = p_install_hash and period_key = v_period
    and status = 'reserved' and expires_at < now();

  select count(*) into v_used
  from snip_anonymous_usage_reservations
  where install_hash = p_install_hash and period_key = v_period
    and (status = 'committed' or
         (status = 'reserved' and expires_at > now()));

  if v_used >= 10 then
    return jsonb_build_object('ok',false,'limit',10,'used',v_used);
  end if;

  insert into snip_anonymous_usage_reservations(install_hash,period_key)
  values(p_install_hash,v_period)
  returning id into v_id;

  return jsonb_build_object(
    'ok',true,'reservation_id',v_id,'limit',10,'used',v_used
  );
end;
$$;

create or replace function public.snip_anon_commit_usage(
  p_install_hash text,
  p_reservation_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_count integer;
begin
  update snip_anonymous_usage_reservations
  set status = 'committed', committed_at = now()
  where id = p_reservation_id and install_hash = p_install_hash
    and status = 'reserved' and expires_at > now();

  get diagnostics v_count = row_count;
  return jsonb_build_object('ok',v_count = 1);
end;
$$;

create or replace function public.snip_anon_release_usage(
  p_install_hash text,
  p_reservation_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_count integer;
begin
  update snip_anonymous_usage_reservations
  set status = 'released'
  where id = p_reservation_id and install_hash = p_install_hash
    and status = 'reserved';

  get diagnostics v_count = row_count;
  return jsonb_build_object('ok',v_count = 1);
end;
$$;

revoke all on public.snip_anonymous_usage_reservations from public, anon, authenticated;
revoke all on function public.snip_anon_get_usage(text) from public, anon, authenticated;
revoke all on function public.snip_anon_reserve_usage(text) from public, anon, authenticated;
revoke all on function public.snip_anon_commit_usage(text,uuid) from public, anon, authenticated;
revoke all on function public.snip_anon_release_usage(text,uuid) from public, anon, authenticated;

grant execute on function public.snip_anon_get_usage(text) to service_role;
grant execute on function public.snip_anon_reserve_usage(text) to service_role;
grant execute on function public.snip_anon_commit_usage(text,uuid) to service_role;
grant execute on function public.snip_anon_release_usage(text,uuid) to service_role;
