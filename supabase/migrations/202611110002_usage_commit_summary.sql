create or replace function public.snip_commit_usage(
  p_user_id uuid,
  p_reservation_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_count integer;
  v_plan text;
  v_period text;
  v_used integer;
  v_limit integer;
begin
  update snip_usage_reservations
  set status = 'committed', committed_at = now()
  where id = p_reservation_id and user_id = p_user_id
    and status = 'reserved' and expires_at > now()
  returning plan, period_key into v_plan, v_period;

  get diagnostics v_count = row_count;

  if v_count <> 1 then
    return jsonb_build_object('ok', false);
  end if;

  v_limit := case when v_plan = 'free' then 10
                  when v_plan = 'pro' then 500
                  else null end;

  select count(*) into v_used
  from snip_usage_reservations
  where user_id = p_user_id and period_key = v_period
    and (status = 'committed' or
         (status = 'reserved' and expires_at > now()));

  return jsonb_build_object(
    'ok', true,
    'plan', v_plan,
    'used', v_used,
    'limit', v_limit,
    'remaining', case when v_limit is null then null
                      else greatest(0, v_limit - v_used) end
  );
end;
$$;
