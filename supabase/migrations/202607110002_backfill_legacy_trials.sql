-- Backfill de lanzamiento: concede una prueba completa a tiendas creadas antes
-- de activar el nuevo modelo SaaS. Cambia la fecha de corte si el despliegue fue otro dia.
-- Estas instrucciones permiten ejecutarlo incluso si la tabla conserva el esquema anterior.
alter table public.subscriptions
  add column if not exists trial_start_at timestamptz;
alter table public.subscriptions
  add column if not exists subscription_status text;
alter table public.subscriptions
  add column if not exists subscription_end_at timestamptz;

do $$
declare
  v_rollout_at timestamptz := '2026-07-11 00:00:00+00';
begin
  -- Usuarios antiguos que nunca tuvieron una fila de suscripcion.
  insert into public.subscriptions (
    store_id, trial_start_at, subscription_status, subscription_end_at, created_at, updated_at
  )
  select s.id, now(), 'trial', now() + interval '7 days', now(), now()
  from public.stores s
  where s.created_at < v_rollout_at
    and not exists (
      select 1 from public.subscriptions sub where sub.store_id = s.id
    );

  -- Usuarios antiguos cuyo trial fue calculado desde su registro historico.
  -- Nunca toca planes activos/pagados, cancelados ni past_due.
  update public.subscriptions sub
  set trial_start_at = now(),
      subscription_status = 'trial',
      subscription_end_at = now() + interval '7 days',
      updated_at = now()
  from public.stores s
  where s.id = sub.store_id
    and s.created_at < v_rollout_at
    and sub.subscription_status = 'trial'
    and sub.subscription_end_at <= now();
end $$;
