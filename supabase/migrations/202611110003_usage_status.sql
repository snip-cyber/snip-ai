create or replace function public.snip_get_usage(
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

  select count(*) into v_used
  from snip_usage_reservations
  where user_id = p_user_id and period_key = v_period
    and (status = 'committed' or
         (status = 'reserved' and expires_at > now()));

  return jsonb_build_object(
    'ok', true, 'plan', p_plan, 'used', v_used,
    'limit', v_limit,
    'remaining', case when v_limit is null then null
                      else greatest(0, v_limit - v_used) end,
    'authenticated', true
  );
end;
$$;

revoke all on function public.snip_get_usage(uuid,text) from public, anon, authenticated;
grant execute on function public.snip_get_usage(uuid,text) to service_role;
