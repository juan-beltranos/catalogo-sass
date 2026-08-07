alter table public.stores
  add column if not exists commerce_rules jsonb not null
  default '{"pricing":[],"shipping":[]}'::jsonb;

comment on column public.stores.commerce_rules is
  'Reglas configurables de precios por carrito y tarifas de envio.';

alter table public.orders
  add column if not exists original_subtotal bigint not null default 0,
  add column if not exists discount bigint not null default 0,
  add column if not exists applied_rules jsonb not null default '[]'::jsonb;

update public.orders
set original_subtotal = subtotal
where original_subtotal = 0 and subtotal > 0;
