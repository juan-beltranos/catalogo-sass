-- Categorías múltiples sin romper la categoría principal usada por versiones anteriores.
alter table public.products
  add column if not exists category_ids uuid[] not null default '{}'::uuid[];

update public.products
set category_ids = array[category_id]
where category_id is not null
  and not (category_ids @> array[category_id]);

create index if not exists products_category_ids_gin_idx
  on public.products using gin (category_ids);

create index if not exists products_store_active_created_idx
  on public.products (store_id, is_active, created_at desc);

-- Mantiene productos coherentes cuando el administrador elimina una categoría.
create or replace function public.remove_deleted_category_from_products()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.products
  set category_ids = array_remove(category_ids, old.id),
      category_id = case
        when category_id = old.id then (array_remove(category_ids, old.id))[1]
        else category_id
      end,
      updated_at = now()
  where store_id = old.store_id
    and (category_id = old.id or category_ids @> array[old.id]);
  return old;
end;
$$;

drop trigger if exists remove_category_from_products on public.categories;
create trigger remove_category_from_products
before delete on public.categories
for each row execute function public.remove_deleted_category_from_products();

create or replace function public.save_product_full(
  p_product_id uuid,
  p_store_id uuid,
  p_product jsonb,
  p_images jsonb,
  p_videos jsonb,
  p_options jsonb,
  p_variants jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_category_ids uuid[];
  v_primary_category_id uuid;
begin
  if not exists (
    select 1 from public.stores
    where id = p_store_id and owner_id = auth.uid()
  ) then
    raise exception 'No tienes permiso para modificar este producto';
  end if;

  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[])
  into v_category_ids
  from jsonb_array_elements_text(coalesce(p_product->'categoryIds', '[]'::jsonb)) as ids(value)
  where nullif(value, '') is not null;

  v_primary_category_id := nullif(p_product->>'categoryId', '')::uuid;
  if v_primary_category_id is null and cardinality(v_category_ids) > 0 then
    v_primary_category_id := v_category_ids[1];
  end if;
  if v_primary_category_id is not null and not (v_category_ids @> array[v_primary_category_id]) then
    v_category_ids := array_prepend(v_primary_category_id, v_category_ids);
  end if;

  -- Impide asociar categorías de otra tienda incluso ante una petición manipulada.
  if exists (
    select 1 from unnest(v_category_ids) category_id
    where not exists (
      select 1 from public.categories c
      where c.id = category_id and c.store_id = p_store_id
    )
  ) then
    raise exception 'Una o más categorías no pertenecen a esta tienda';
  end if;

  if exists (select 1 from public.products where id = p_product_id) then
    update public.products set
      name = trim(coalesce(p_product->>'name', '')),
      sku = nullif(trim(coalesce(p_product->>'sku', '')), ''),
      description = nullif(trim(coalesce(p_product->>'description', '')), ''),
      base_price = coalesce((p_product->>'price')::numeric, 0),
      wholesale_price = nullif(p_product->>'wholesalePrice', '')::numeric,
      discount_type = nullif(p_product->'discount'->>'type', '')::public.discount_type,
      discount_value = nullif(p_product->'discount'->>'value', '')::numeric,
      category_id = v_primary_category_id,
      category_ids = v_category_ids,
      is_active = coalesce((p_product->>'isActive')::boolean, true),
      allow_cash_on_delivery = coalesce((p_product->>'allowsCashOnDelivery')::boolean, true),
      stock = coalesce(nullif(p_product->>'stock', '')::integer, stock),
      sort_order = coalesce(nullif(p_product->>'order', '')::integer, sort_order),
      updated_at = now()
    where id = p_product_id and store_id = p_store_id;
    if not found then raise exception 'El producto no pertenece a esta tienda'; end if;
  else
    insert into public.products(
      id, store_id, category_id, category_ids, name, sku, description, base_price,
      wholesale_price, discount_type, discount_value, is_active,
      allow_cash_on_delivery, stock, sort_order, created_at, updated_at
    ) values (
      p_product_id, p_store_id, v_primary_category_id, v_category_ids,
      trim(coalesce(p_product->>'name', '')),
      nullif(trim(coalesce(p_product->>'sku', '')), ''),
      nullif(trim(coalesce(p_product->>'description', '')), ''),
      coalesce((p_product->>'price')::numeric, 0),
      nullif(p_product->>'wholesalePrice', '')::numeric,
      nullif(p_product->'discount'->>'type', '')::public.discount_type,
      nullif(p_product->'discount'->>'value', '')::numeric,
      coalesce((p_product->>'isActive')::boolean, true),
      coalesce((p_product->>'allowsCashOnDelivery')::boolean, true),
      coalesce((p_product->>'stock')::integer, 0),
      coalesce((p_product->>'order')::integer, 0), now(), now()
    );
  end if;

  perform public.sync_product_children(
    p_product_id, p_store_id, p_images, p_videos, p_options, p_variants
  );
end;
$$;

grant execute on function public.save_product_full(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb)
  to authenticated;
