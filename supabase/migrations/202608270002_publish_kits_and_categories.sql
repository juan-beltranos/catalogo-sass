-- Extiende instalaciones donde el módulo de kits ya fue creado.
alter table public.product_kits
  add column if not exists category_ids uuid[] not null default '{}'::uuid[];

create index if not exists product_kits_category_ids_idx
  on public.product_kits using gin(category_ids);

alter table public.order_items
  add column if not exists kit_id uuid references public.product_kits(id) on delete set null;

create index if not exists order_items_kit_id_idx on public.order_items(kit_id);

grant execute on function public.has_paid_monthly_access(uuid) to anon, authenticated;
