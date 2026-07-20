-- Actualiza el producto y todos sus datos relacionados dentro de la misma transaccion.
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
begin
  if not exists (
    select 1 from public.stores
    where id = p_store_id and owner_id = auth.uid()
  ) then
    raise exception 'No tienes permiso para modificar este producto';
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
      category_id = nullif(p_product->>'categoryId', '')::uuid,
      is_active = coalesce((p_product->>'isActive')::boolean, true),
      allow_cash_on_delivery = coalesce((p_product->>'allowsCashOnDelivery')::boolean, true),
      stock = coalesce(nullif(p_product->>'stock', '')::integer, stock),
      sort_order = coalesce(nullif(p_product->>'order', '')::integer, sort_order),
      updated_at = now()
    where id = p_product_id and store_id = p_store_id;

    if not found then
      raise exception 'El producto no pertenece a esta tienda';
    end if;
  else
    insert into public.products(
      id, store_id, category_id, name, sku, description, base_price,
      wholesale_price, discount_type, discount_value, is_active,
      allow_cash_on_delivery, stock, sort_order, created_at, updated_at
    ) values (
      p_product_id, p_store_id, nullif(p_product->>'categoryId', '')::uuid,
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
