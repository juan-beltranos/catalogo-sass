-- Orden independiente de productos por categoria, sin modificar el orden global
-- existente en products.sort_order.
create table if not exists public.product_category_orders (
  store_id uuid not null references public.stores(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  sort_order integer not null,
  updated_at timestamptz not null default now(),
  primary key (category_id, product_id)
);

create index if not exists product_category_orders_lookup_idx
  on public.product_category_orders(store_id, category_id, sort_order, product_id);

alter table public.product_category_orders enable row level security;
drop policy if exists "owners read product category orders" on public.product_category_orders;
create policy "owners read product category orders"
on public.product_category_orders for select to authenticated
using (exists (
  select 1 from public.stores s
  where s.id = product_category_orders.store_id and s.owner_id = auth.uid()
));
drop policy if exists "public read product category orders" on public.product_category_orders;
create policy "public read product category orders"
on public.product_category_orders for select to anon
using (true);
grant select on public.product_category_orders to anon, authenticated;

-- Guarda una lista completa en una sola transaccion. Con categoria actualiza el
-- orden independiente; sin categoria actualiza el orden global ya existente.
create or replace function public.reorder_store_products(
  p_store_id uuid,
  p_product_ids uuid[],
  p_category_id uuid default null,
  p_start integer default 0
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_expected integer;
begin
  if not exists (select 1 from stores s where s.id = p_store_id and s.owner_id = auth.uid()) then
    raise exception 'store_access_denied';
  end if;

  select count(*) into v_expected
  from products p
  where p.store_id = p_store_id and p.id = any(coalesce(p_product_ids, array[]::uuid[]));
  if v_expected <> coalesce(array_length(p_product_ids, 1), 0) then
    raise exception 'invalid_product_list';
  end if;

  if p_category_id is null then
    update products p
    set sort_order = p_start + ordered.ordinality - 1,
        updated_at = now()
    from unnest(p_product_ids) with ordinality ordered(product_id, ordinality)
    where p.id = ordered.product_id and p.store_id = p_store_id;
    return;
  end if;

  if not exists (select 1 from categories c where c.id = p_category_id and c.store_id = p_store_id) then
    raise exception 'invalid_category';
  end if;
  if exists (
    select 1 from products p
    where p.store_id = p_store_id and p.id = any(p_product_ids)
      and not (p.category_id = p_category_id or p.category_ids @> array[p_category_id]::uuid[])
  ) then
    raise exception 'product_outside_category';
  end if;

  delete from product_category_orders
  where store_id = p_store_id and category_id = p_category_id;
  insert into product_category_orders(store_id, category_id, product_id, sort_order, updated_at)
  select p_store_id, p_category_id, ordered.product_id, ordered.ordinality - 1, now()
  from unnest(p_product_ids) with ordinality ordered(product_id, ordinality);
end $$;

revoke all on function public.reorder_store_products(uuid,uuid[],uuid,integer) from public, anon;
grant execute on function public.reorder_store_products(uuid,uuid[],uuid,integer) to authenticated;

-- Devuelve solo IDs; la lectura posterior de productos sigue protegida por las
-- politicas publicas existentes. Si no hay orden de categoria, cae al global.
create or replace function public.get_public_catalog_product_ids(
  p_store_id uuid,
  p_category_id uuid default null,
  p_offset integer default 0,
  p_limit integer default 21
) returns table(product_id uuid)
language sql stable security invoker set search_path = public as $$
  select p.id
  from products p
  left join product_category_orders pco
    on pco.store_id = p.store_id
   and pco.product_id = p.id
   and pco.category_id = p_category_id
  where p.store_id = p_store_id
    and p.is_active = true
    and (p_category_id is null
      or p.category_id = p_category_id
      or p.category_ids @> array[p_category_id]::uuid[])
  order by
    case when p_category_id is not null and pco.sort_order is not null then 0 else 1 end,
    pco.sort_order asc nulls last,
    p.sort_order asc nulls last,
    p.created_at desc,
    p.id
  offset greatest(p_offset, 0)
  limit greatest(p_limit, 0);
$$;

grant execute on function public.get_public_catalog_product_ids(uuid,uuid,integer,integer) to anon, authenticated;
