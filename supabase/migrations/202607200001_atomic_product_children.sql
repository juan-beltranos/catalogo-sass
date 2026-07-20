-- Sincroniza todos los datos relacionados de un producto en una sola transaccion.
-- Si alguna insercion falla, PostgreSQL revierte tambien los deletes anteriores.
create or replace function public.sync_product_children(
  p_product_id uuid,
  p_store_id uuid,
  p_images jsonb default null,
  p_videos jsonb default null,
  p_options jsonb default null,
  p_variants jsonb default null
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

  if p_images is not null then
    delete from public.product_images where product_id = p_product_id;
    insert into public.product_images(product_id, store_id, url, r2_key, sort_order, created_at)
    select p_product_id, p_store_id, item->>'url',
      coalesce(item->>'publicId', item->>'path'), (ordinality - 1)::integer, now()
    from jsonb_array_elements(p_images) with ordinality as entries(item, ordinality);
  end if;

  if p_videos is not null then
    delete from public.product_videos where product_id = p_product_id;
    insert into public.product_videos(product_id, store_id, url, r2_key, sort_order, created_at)
    select p_product_id, p_store_id, item->>'url', item->>'path',
      (ordinality - 1)::integer, now()
    from jsonb_array_elements(p_videos) with ordinality as entries(item, ordinality);
  end if;

  if p_options is not null then
    delete from public.product_options where product_id = p_product_id;
    insert into public.product_options(product_id, store_id, name, values, sort_order)
    select p_product_id, p_store_id, item->>'name',
      coalesce(item->'values', '[]'::jsonb), (ordinality - 1)::integer
    from jsonb_array_elements(p_options) with ordinality as entries(item, ordinality);
  end if;

  if p_variants is not null then
    delete from public.product_variants where product_id = p_product_id;
    insert into public.product_variants(
      product_id, store_id, title, sku, price, stock, option_values, created_at, updated_at
    )
    select p_product_id, p_store_id, coalesce(item->>'title', ''),
      nullif(item->>'sku', ''), coalesce((item->>'price')::numeric, 0),
      coalesce((item->>'stock')::integer, 0),
      coalesce(item->'optionValues', '[]'::jsonb), now(), now()
    from jsonb_array_elements(p_variants) with ordinality as entries(item, ordinality);
  end if;
end;
$$;

grant execute on function public.sync_product_children(uuid, uuid, jsonb, jsonb, jsonb, jsonb)
  to authenticated;
