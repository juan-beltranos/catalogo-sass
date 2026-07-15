-- Compatibilidad con esquemas legacy donde subscription_payments.subscription_id es obligatorio.
alter table public.subscription_payments
  add column if not exists subscription_id uuid references public.subscriptions(id) on delete cascade;

update public.subscription_payments sp
set subscription_id = sub.id
from public.subscriptions sub
where sub.store_id = sp.store_id
  and sp.subscription_id is null;

create index if not exists subscription_payments_subscription_id_idx
  on public.subscription_payments(subscription_id);

-- Corrige activaciones hechas sobre planes por token cuya fecha tecnica era 9999.
update public.subscriptions
set subscription_end_at = now() + interval '30 days',
    updated_at = now()
where registration_type = 'paid'
  and subscription_status = 'active'
  and subscription_end_at > now() + interval '1 year';

create or replace function public.activate_subscription_payment(
  p_event_id text,
  p_store_id uuid default null,
  p_user_id uuid default null,
  p_amount numeric default null,
  p_currency text default null,
  p_payload jsonb default '{}'::jsonb
) returns table(store_id uuid, subscription_end_at timestamptz, duplicate boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_store_id uuid;
  v_subscription_id uuid;
  v_end timestamptz;
begin
  if nullif(trim(p_event_id), '') is null then raise exception 'event_id_required'; end if;
  select s.id into v_store_id from stores s
   where (p_store_id is not null and s.id = p_store_id)
      or (p_store_id is null and p_user_id is not null and s.owner_id = p_user_id)
   order by s.created_at limit 1;
  if v_store_id is null then raise exception 'store_not_found'; end if;

  if exists (select 1 from subscription_payments sp where sp.event_id = p_event_id) then
    return query select sub.store_id, sub.subscription_end_at, true
      from subscriptions sub where sub.store_id = v_store_id;
    return;
  end if;

  insert into subscriptions(store_id, trial_start_at, subscription_status, subscription_end_at, plan, registration_type)
  values (v_store_id, now(), 'active', now() + interval '30 days', 'subscription', 'paid')
  on conflict (store_id) do update set
    subscription_status = 'active',
    subscription_end_at = case
      when subscriptions.registration_type = 'token'
        or subscriptions.subscription_end_at > now() + interval '1 year'
      then now() + interval '30 days'
      else greatest(now(), subscriptions.subscription_end_at) + interval '30 days'
    end,
    plan = 'subscription',
    registration_type = 'paid',
    updated_at = now()
  returning subscriptions.id, subscriptions.subscription_end_at
    into v_subscription_id, v_end;

  insert into subscription_payments(
    event_id, subscription_id, store_id, user_id, provider, status, amount, currency, payload, paid_at
  ) values (
    p_event_id, v_subscription_id, v_store_id, p_user_id, 'local_go', 'approved',
    p_amount, upper(p_currency), coalesce(p_payload, '{}'::jsonb), now()
  );

  return query select v_store_id, v_end, false;
end $$;

revoke all on function public.activate_subscription_payment(text,uuid,uuid,numeric,text,jsonb) from public, anon, authenticated;
grant execute on function public.activate_subscription_payment(text,uuid,uuid,numeric,text,jsonb) to service_role;
