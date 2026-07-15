-- Modelo SaaS canonico. Ejecutar en Supabase SQL Editor o con `supabase db push`.
create extension if not exists pgcrypto;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  trial_start_at timestamptz not null default now(),
  subscription_status text not null default 'trial',
  subscription_end_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions add column if not exists trial_start_at timestamptz;
alter table public.subscriptions add column if not exists subscription_status text;
alter table public.subscriptions add column if not exists subscription_end_at timestamptz;
update public.subscriptions
set trial_start_at = coalesce(trial_start_at, created_at, now()),
    subscription_status = coalesce(subscription_status, 'trial'),
    subscription_end_at = coalesce(subscription_end_at, coalesce(created_at, now()) + interval '7 days');
-- Migra columnas del esquema anterior cuando existen, sin impedir instalaciones limpias.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='subscriptions' and column_name='status') then
    -- Sentencias separadas: evita mezclar text con el enum subscription_status dentro de CASE.
    execute $sql$update public.subscriptions set subscription_status = 'trial' where status::text = 'trialing'$sql$;
    execute $sql$update public.subscriptions set subscription_status = 'active' where status::text = 'active'$sql$;
    execute $sql$update public.subscriptions set subscription_status = 'past_due' where status::text = 'past_due'$sql$;
    execute $sql$update public.subscriptions set subscription_status = 'canceled' where status::text = 'canceled'$sql$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='subscriptions' and column_name='current_period_ends_at') then
    execute $sql$update public.subscriptions set subscription_end_at = coalesce(current_period_ends_at, subscription_end_at)$sql$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='subscriptions' and column_name='trial_ends_at') then
    execute $sql$update public.subscriptions set subscription_end_at = coalesce(trial_ends_at, subscription_end_at) where subscription_status = 'trial'$sql$;
  end if;
end $$;
alter table public.subscriptions alter column trial_start_at set default now();
alter table public.subscriptions alter column trial_start_at set not null;
alter table public.subscriptions alter column subscription_status set default 'trial';
alter table public.subscriptions alter column subscription_status set not null;
alter table public.subscriptions alter column subscription_end_at set default (now() + interval '7 days');
alter table public.subscriptions alter column subscription_end_at set not null;
alter table public.subscriptions drop constraint if exists subscriptions_subscription_status_check;
alter table public.subscriptions add constraint subscriptions_subscription_status_check
  check (subscription_status in ('trial', 'active', 'past_due', 'canceled'));
create unique index if not exists subscriptions_store_id_key on public.subscriptions(store_id);

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  store_id uuid not null references public.stores(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  provider text not null default 'local_go',
  status text not null default 'approved',
  amount numeric(12,2),
  currency text,
  payload jsonb not null default '{}'::jsonb,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.subscription_payments add column if not exists event_id text;
alter table public.subscription_payments add column if not exists subscription_id uuid references public.subscriptions(id) on delete cascade;
alter table public.subscription_payments add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.subscription_payments add column if not exists provider text default 'local_go';
alter table public.subscription_payments add column if not exists amount numeric(12,2);
alter table public.subscription_payments add column if not exists currency text;
alter table public.subscription_payments add column if not exists payload jsonb default '{}'::jsonb;
alter table public.subscription_payments add column if not exists paid_at timestamptz default now();
create unique index if not exists subscription_payments_event_id_key
  on public.subscription_payments(event_id) where event_id is not null;

-- Una sola transaccion registra el pago y activa/extiende la suscripcion.
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

  insert into subscriptions(store_id, trial_start_at, subscription_status, subscription_end_at)
  values (v_store_id, now(), 'active', now() + interval '30 days')
  on conflict (store_id) do update set
    subscription_status = 'active',
    subscription_end_at = greatest(now(), subscriptions.subscription_end_at) + interval '30 days',
    updated_at = now()
  returning subscriptions.subscription_end_at into v_end;
  return query select v_store_id, v_end, false;
end $$;
revoke all on function public.activate_subscription_payment(text,uuid,uuid,numeric,text,jsonb) from public, anon, authenticated;
grant execute on function public.activate_subscription_payment(text,uuid,uuid,numeric,text,jsonb) to service_role;

alter table public.subscriptions enable row level security;
drop policy if exists "owners read subscriptions" on public.subscriptions;
create policy "owners read subscriptions" on public.subscriptions for select to authenticated
using (exists (select 1 from public.stores s where s.id = store_id and s.owner_id = auth.uid()));
alter table public.subscription_payments enable row level security;
drop policy if exists "owners read payments" on public.subscription_payments;
create policy "owners read payments" on public.subscription_payments for select to authenticated
using (exists (select 1 from public.stores s where s.id = store_id and s.owner_id = auth.uid()));
