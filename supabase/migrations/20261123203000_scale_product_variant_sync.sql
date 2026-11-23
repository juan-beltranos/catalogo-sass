-- Synchronizing variants used to compare every stored variant against every
-- JSON item (O(existing_variants * submitted_variants)). Materialize the IDs
-- once so products with large variant matrices stay below statement_timeout.
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
declare
  v_variant_ids uuid[];
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
    select coalesce(
      array_agg(nullif(x->>'id', '')::uuid)
        filter (where nullif(x->>'id', '') is not null),
      '{}'::uuid[]
    )
    into v_variant_ids
    from jsonb_array_elements(p_variants) x;

    if exists (
      select 1
      from public.product_variants v
      where v.id = any(v_variant_ids)
        and (v.product_id <> p_product_id or v.store_id <> p_store_id)
    ) then
      raise exception 'Una variante no pertenece a este producto';
    end if;

    delete from public.product_variants v
    where v.product_id = p_product_id
      and v.store_id = p_store_id
      and not (v.id = any(v_variant_ids));

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
