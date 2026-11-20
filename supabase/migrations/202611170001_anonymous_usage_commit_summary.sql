create or replace function public.snip_anon_commit_usage(
  p_install_hash text,
  p_reservation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_period text;
  v_used integer;
begin
  if p_install_hash is null
     or p_install_hash !~ '^[0-9a-f]{64}$'
     or p_reservation_id is null then
    raise exception 'Invalid installation identity or reservation';
  end if;

  update public.snip_anonymous_usage_reservations
  set status = 'committed',
      committed_at = pg_catalog.now()
  where id = p_reservation_id
    and install_hash = p_install_hash
    and status = 'reserved'
    and expires_at > pg_catalog.now()
  returning period_key into v_period;

  get diagnostics v_count = row_count;

  if v_count <> 1 then
    return pg_catalog.jsonb_build_object('ok', false);
  end if;

  select count(*) into v_used
  from public.snip_anonymous_usage_reservations
  where install_hash = p_install_hash
    and period_key = v_period
    and (
      status = 'committed'
      or (status = 'reserved' and expires_at > pg_catalog.now())
    );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'plan', 'anonymous',
    'used', v_used,
    'limit', 10,
    'remaining', pg_catalog.greatest(0, 10 - v_used),
    'authenticated', false
  );
end;
$$;

revoke all on function public.snip_anon_commit_usage(text,uuid)
from public, anon, authenticated;

grant execute on function public.snip_anon_commit_usage(text,uuid)
to service_role;
