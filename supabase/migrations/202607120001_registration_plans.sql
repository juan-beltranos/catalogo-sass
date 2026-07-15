-- Planes por token, restricciones de modulos y limites de contenido.
alter table public.subscriptions add column if not exists plan text;
alter table public.subscriptions add column if not exists registration_type text;

update public.subscriptions
set plan = coalesce(plan, case when subscription_status = 'trial' then 'trial' else 'subscription' end),
    registration_type = coalesce(registration_type, case when subscription_status = 'trial' then 'trial' else 'paid' end);

alter table public.subscriptions alter column plan set not null;
alter table public.subscriptions alter column registration_type set not null;
alter table public.subscriptions drop constraint if exists subscriptions_plan_check;
alter table public.subscriptions add constraint subscriptions_plan_check
  check (plan in ('trial', 'basic', 'pro', 'premium', 'subscription'));
alter table public.subscriptions drop constraint if exists subscriptions_registration_type_check;
alter table public.subscriptions add constraint subscriptions_registration_type_check
  check (registration_type in ('trial', 'token', 'paid'));

create or replace function public.enforce_store_plan_limits() returns trigger
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_plan text;
  v_limit integer;
  v_count integer;
begin
  select plan into v_plan from subscriptions where store_id = new.store_id;
  if tg_table_name = 'products' then
    v_limit := case v_plan when 'basic' then 30 when 'pro' then 200 else null end;
  elsif tg_table_name = 'categories' then
    v_limit := case v_plan when 'basic' then 3 when 'pro' then 6 else null end;
  end if;
  if v_limit is null then return new; end if;
  execute format('select count(*) from public.%I where store_id = $1', tg_table_name)
    into v_count using new.store_id;
  if v_count >= v_limit then
    raise exception using errcode = 'P0001', message = format('plan_limit_exceeded:%s:%s', tg_table_name, v_limit);
  end if;
  return new;
end $$;

drop trigger if exists enforce_product_plan_limit on public.products;
create trigger enforce_product_plan_limit before insert on public.products
for each row execute function public.enforce_store_plan_limits();
drop trigger if exists enforce_category_plan_limit on public.categories;
create trigger enforce_category_plan_limit before insert on public.categories
for each row execute function public.enforce_store_plan_limits();

-- Una suscripcion pagada es un unico acceso completo: todos los modulos y sin limites.
create or replace function public.activate_subscription_payment(
  p_event_id text,
  p_store_id uuid default null,
  p_user_id uuid default null,
  p_amount numeric default null,
  p_currency text default null,
  p_payload jsonb default '{}'::jsonb
) returns table(store_id uuid, subscription_end_at timestamptz, duplicate boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid;
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

  insert into subscription_payments(event_id, store_id, user_id, provider, status, amount, currency, payload, paid_at)
  values (p_event_id, v_store_id, p_user_id, 'local_go', 'approved', p_amount, upper(p_currency), coalesce(p_payload, '{}'::jsonb), now());

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
  returning subscriptions.subscription_end_at into v_end;
  return query select v_store_id, v_end, false;
end $$;

revoke all on function public.activate_subscription_payment(text,uuid,uuid,numeric,text,jsonb) from public, anon, authenticated;
grant execute on function public.activate_subscription_payment(text,uuid,uuid,numeric,text,jsonb) to service_role;
