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

  update public.products set
    name = trim(coalesce(p_product->>'name', '')),
    sku = nullif(trim(coalesce(p_product->>'sku', '')), ''),
    description = nullif(trim(coalesce(p_product->>'description', '')), ''),
    base_price = coalesce((p_product->>'price')::numeric, 0),
    wholesale_price = nullif(p_product->>'wholesalePrice', '')::numeric,
    discount_type = nullif(p_product->'discount'->>'type', ''),
    discount_value = nullif(p_product->'discount'->>'value', '')::numeric,
    category_id = nullif(p_product->>'categoryId', '')::uuid,
    is_active = coalesce((p_product->>'isActive')::boolean, true),
    allow_cash_on_delivery = coalesce((p_product->>'allowsCashOnDelivery')::boolean, true),
    updated_at = now()
  where id = p_product_id and store_id = p_store_id;

  if not found then
    raise exception 'Producto no encontrado';
  end if;

  perform public.sync_product_children(
    p_product_id, p_store_id, p_images, p_videos, p_options, p_variants
  );
end;
$$;

grant execute on function public.save_product_full(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb)
  to authenticated;
