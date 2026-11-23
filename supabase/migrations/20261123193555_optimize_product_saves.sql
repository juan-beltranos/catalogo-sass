-- Product writes filter every child table by product_id. PostgreSQL does not
-- create indexes automatically for foreign keys; without these indexes each
-- save scans the complete media/options/variants tables several times.
create index if not exists product_images_product_id_idx
  on public.product_images (product_id);
create index if not exists product_videos_product_id_idx
  on public.product_videos (product_id);
create index if not exists product_options_product_id_idx
  on public.product_options (product_id);
create index if not exists product_variants_product_id_idx
  on public.product_variants (product_id);
create index if not exists product_kit_items_product_id_idx
  on public.product_kit_items (product_id);

-- Keep the product transaction short. save_product_full already locks an
-- existing product before changing it, so sync_product_children must not issue
-- a second row-lock query while synchronizing variants.
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
    where id = p_store_id and owner_id = (select auth.uid())
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
    if exists (
      select 1
      from jsonb_array_elements(p_variants) x
      join public.product_variants v on v.id = nullif(x->>'id', '')::uuid
      where v.product_id <> p_product_id or v.store_id <> p_store_id
    ) then
      raise exception 'Una variante no pertenece a este producto';
    end if;

    delete from public.product_variants v
    where v.product_id = p_product_id
      and v.store_id = p_store_id
      and not exists (
        select 1 from jsonb_array_elements(p_variants) x
        where x->>'id' = v.id::text
      );

    insert into public.product_variants(
      id, product_id, store_id, title, sku, price, stock,
      option_values, created_at, updated_at
    )
    select coalesce(nullif(x->>'id', '')::uuid, gen_random_uuid()),
      p_product_id, p_store_id, coalesce(x->>'title', ''),
      nullif(x->>'sku', ''), coalesce((x->>'price')::numeric, 0),
      coalesce((x->>'stock')::integer, 0),
      coalesce(x->'optionValues', '[]'::jsonb), now(), now()
    from jsonb_array_elements(p_variants) x
    on conflict (id) do update set
      title = excluded.title,
      sku = excluded.sku,
      price = excluded.price,
      stock = excluded.stock,
      option_values = excluded.option_values,
      updated_at = now();
  end if;
end;
$$;

revoke all on function public.sync_product_children(uuid, uuid, jsonb, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.sync_product_children(uuid, uuid, jsonb, jsonb, jsonb, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
