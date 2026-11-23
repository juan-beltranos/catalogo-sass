-- Inventory is available in every plan. Existing untracked catalogs remain sellable.
alter table public.products add column track_stock boolean not null default false;
update public.products p set track_stock = true
where p.stock > 0 or exists (select 1 from public.product_variants v where v.product_id = p.id and v.stock > 0);
alter table public.products add constraint products_stock_nonnegative check (stock >= 0) not valid;
alter table public.product_variants add constraint variants_stock_nonnegative check (stock >= 0) not valid;

-- Historical orders are not deducted retroactively.
alter table public.orders add column inventory_reserved boolean not null default false;
create table public.order_inventory (
  order_id uuid not null references public.orders(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null,
  variant_id uuid,
  quantity integer not null check (quantity > 0),
  unique nulls not distinct (order_id, product_id, variant_id)
);
alter table public.order_inventory enable row level security;
revoke all on public.order_inventory from public, anon, authenticated;
grant all on public.order_inventory to service_role;

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
  v_current jsonb;
begin
  if not exists (
    select 1 from public.stores
    where id = p_store_id and owner_id = auth.uid()
  ) then
    raise exception 'No tienes permiso para modificar este producto';
  end if;

  -- Serialize edits against checkout; reject stale forms/Excel instead of restoring sold stock.
  perform 1 from public.products where id = p_product_id and store_id = p_store_id for update;
  if p_product->'expectedInventory' is not null and p_product->'expectedInventory' <> 'null'::jsonb then
    select jsonb_build_object('stock', coalesce(p.stock,0), 'trackStock', p.track_stock,
      'variants', coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'stock',coalesce(v.stock,0)) order by v.id)
        from public.product_variants v where v.product_id=p.id), '[]'::jsonb))
    into v_current from public.products p where p.id=p_product_id and p.store_id=p_store_id;
    if v_current is distinct from p_product->'expectedInventory' then
      raise exception 'El inventario cambió desde que abriste el producto. Recarga y vuelve a intentarlo.';
    end if;
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
      track_stock = coalesce((p_product->>'trackStock')::boolean, track_stock),
      stock = coalesce(nullif(p_product->>'stock', '')::integer, stock),
      sort_order = coalesce(nullif(p_product->>'order', '')::integer, sort_order),
      updated_at = now()
    where id = p_product_id and store_id = p_store_id;
    if not found then raise exception 'El producto no pertenece a esta tienda'; end if;
  else
    insert into public.products(
      id, store_id, category_id, category_ids, name, sku, description, base_price,
      wholesale_price, discount_type, discount_value, is_active,
      allow_cash_on_delivery, stock, track_stock, sort_order, created_at, updated_at
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
      coalesce((p_product->>'trackStock')::boolean, false),
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
    -- Variant IDs must survive edits, imports and existing order references.
    perform 1 from public.products where id=p_product_id and store_id=p_store_id for update;
    if exists (select 1 from jsonb_array_elements(p_variants) x
      join public.product_variants v on v.id = nullif(x->>'id','')::uuid
      where v.product_id <> p_product_id or v.store_id <> p_store_id) then
      raise exception 'Una variante no pertenece a este producto';
    end if;
    delete from public.product_variants v where v.product_id=p_product_id and v.store_id=p_store_id
      and not exists(select 1 from jsonb_array_elements(p_variants) x where x->>'id'=v.id::text);
    insert into public.product_variants(id,product_id,store_id,title,sku,price,stock,option_values,created_at,updated_at)
    select coalesce(nullif(x->>'id','')::uuid,gen_random_uuid()),p_product_id,p_store_id,
      coalesce(x->>'title',''),nullif(x->>'sku',''),coalesce((x->>'price')::numeric,0),
      coalesce((x->>'stock')::integer,0),coalesce(x->'optionValues','[]'::jsonb),now(),now()
    from jsonb_array_elements(p_variants) x
    on conflict(id) do update set title=excluded.title,sku=excluded.sku,price=excluded.price,
      stock=excluded.stock,option_values=excluded.option_values,updated_at=now();
  end if;
end;
$$;

grant execute on function public.sync_product_children(uuid, uuid, jsonb, jsonb, jsonb, jsonb)
  to authenticated;

-- Only the trusted order API may create a sale. Everything below shares one transaction.
create or replace function public.place_order_with_inventory(
  p_store_id uuid, p_order jsonb, p_items jsonb, p_fields jsonb default '[]', p_coupon_id uuid default null
) returns uuid language plpgsql security invoker set search_path=public as $$
declare
  v_order_id uuid := (p_order->>'id')::uuid;
  v_client_id uuid;
  v_existing_store uuid;
  v_product products%rowtype;
  v_need record;
  v_needs jsonb;
begin
  -- Duplicate requests wait for the first commit, then return the same order.
  perform pg_advisory_xact_lock(hashtextextended(v_order_id::text,0));
  select store_id into v_existing_store from orders where id=v_order_id;
  if found then
    if v_existing_store <> p_store_id then raise exception 'ID de pedido no disponible'; end if;
    return v_order_id;
  end if;
  if not exists(select 1 from stores where id=p_store_id and status::text <> 'inactive') then
    raise exception 'Tienda no disponible';
  end if;
  if jsonb_array_length(p_items)=0 then raise exception 'Pedido sin productos'; end if;
  perform 1 from product_kits k where k.id in (select nullif(x->>'kit_id','')::uuid from jsonb_array_elements(p_items) x)
    and k.store_id=p_store_id order by k.id for share;
  perform 1 from product_kit_items ki where ki.kit_id in (select nullif(x->>'kit_id','')::uuid from jsonb_array_elements(p_items) x)
    and ki.store_id=p_store_id order by ki.kit_id,ki.product_id for share;
  if exists(select 1 from jsonb_array_elements(p_items) x
    where coalesce((x->>'quantity')::numeric,0)<=0 or (x->>'quantity')::numeric <> trunc((x->>'quantity')::numeric)) then
    raise exception 'Cantidad inválida';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) x
    where (nullif(x->>'product_id','') is null) = (nullif(x->>'kit_id','') is null)) then
    raise exception 'Producto o kit inválido';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where nullif(x->>'kit_id','') is not null
    and (not exists(select 1 from product_kits k where k.id=(x->>'kit_id')::uuid and k.store_id=p_store_id and k.active)
      or not exists(select 1 from product_kit_items ki where ki.kit_id=(x->>'kit_id')::uuid and ki.store_id=p_store_id))) then
    raise exception 'Kit no disponible o sin componentes';
  end if;

  -- Lock every component in a consistent order before validating/decrementing any stock.
  select jsonb_agg(to_jsonb(aggregated)) into v_needs from (
    select product_id, variant_id, sum(quantity)::integer quantity from (
      select (x->>'product_id')::uuid product_id, nullif(x->>'variant_id','')::uuid variant_id,
        (x->>'quantity')::integer quantity from jsonb_array_elements(p_items) x where nullif(x->>'product_id','') is not null
      union all
      select ki.product_id, null::uuid, ki.quantity*(x->>'quantity')::integer
      from jsonb_array_elements(p_items) x join product_kit_items ki on ki.kit_id=nullif(x->>'kit_id','')::uuid and ki.store_id=p_store_id
    ) needs group by product_id,variant_id
  ) aggregated;
  for v_need in select * from jsonb_to_recordset(v_needs) as n(product_id uuid,variant_id uuid,quantity integer)
    order by product_id,variant_id nulls first
  loop
    select * into v_product from products where id=v_need.product_id and store_id=p_store_id for update;
    if not found or not v_product.is_active then raise exception 'Producto no disponible'; end if;
    if v_need.variant_id is null and exists(select 1 from product_variants where product_id=v_product.id) then
      raise exception 'Selecciona una variante para %. Los kits deben usar productos sin variantes.', v_product.name;
    end if;
    if v_need.variant_id is not null and not exists(select 1 from product_variants
      where id=v_need.variant_id and product_id=v_product.id and store_id=p_store_id) then
      raise exception 'Variante no disponible para %',v_product.name;
    end if;
    if v_product.track_stock then
      if v_need.variant_id is null then
        update products set stock=stock-v_need.quantity,updated_at=now()
        where id=v_product.id and stock>=v_need.quantity;
      else
        update product_variants set stock=stock-v_need.quantity,updated_at=now()
        where id=v_need.variant_id and product_id=v_product.id and stock>=v_need.quantity;
      end if;
      if not found then raise exception 'Stock insuficiente para %',v_product.name; end if;
    end if;
  end loop;

  insert into clients(store_id,name,phone,address,custom_fields,orders_count,total_spent,last_order_at,created_at,updated_at)
  values(p_store_id,p_order->>'customer_name',p_order->>'customer_phone',p_order->>'address',
    coalesce(p_order->'customer_fields','[]'::jsonb),1,(p_order->>'total')::numeric,now(),now(),now())
  on conflict(store_id,phone) where nullif(phone,'') is not null do update set name=excluded.name,address=excluded.address,custom_fields=excluded.custom_fields,
    orders_count=clients.orders_count+1,total_spent=clients.total_spent+excluded.total_spent,last_order_at=now(),updated_at=now()
  returning id into v_client_id;
  insert into orders(id,store_id,client_id,status,source,customer_name,customer_phone,address,
    delivery_method,shipping_cost,original_subtotal,discount,subtotal,total,applied_rules,notes,inventory_reserved)
  values(v_order_id,p_store_id,v_client_id,'new','whatsapp',p_order->>'customer_name',p_order->>'customer_phone',p_order->>'address',
    nullif(p_order->>'delivery_method',''),(p_order->>'shipping_cost')::numeric,(p_order->>'original_subtotal')::numeric,
    (p_order->>'discount')::numeric,(p_order->>'subtotal')::numeric,(p_order->>'total')::numeric,
    coalesce(p_order->'applied_rules','[]'),nullif(p_order->>'notes',''),true);

  insert into order_items(order_id,store_id,product_id,kit_id,variant_id,title,sku,quantity,unit_price,total)
  select v_order_id,p_store_id,nullif(x->>'product_id','')::uuid,nullif(x->>'kit_id','')::uuid,
    nullif(x->>'variant_id','')::uuid,x->>'title',nullif(x->>'sku',''),(x->>'quantity')::integer,
    (x->>'unit_price')::numeric,(x->>'total')::numeric from jsonb_array_elements(p_items) x;

  -- Snapshot kit components: later kit edits cannot alter the quantities returned on cancellation.
  insert into order_inventory(order_id,store_id,product_id,variant_id,quantity)
  select v_order_id,p_store_id,n.product_id,n.variant_id,n.quantity
  from jsonb_to_recordset(v_needs) as n(product_id uuid,variant_id uuid,quantity integer)
  join products p on p.id=n.product_id and p.track_stock;

  insert into order_custom_fields(order_id,store_id,field_key,label,value)
  select v_order_id,p_store_id,x->>'field_key',x->>'label',x->>'value' from jsonb_array_elements(p_fields) x;
  if p_coupon_id is not null then
    update coupons set used_count=used_count+1,updated_at=now()
      where id=p_coupon_id and store_id=p_store_id and active
      and (usage_limit is null or used_count<usage_limit);
    if not found then raise exception 'Cupón no disponible o sin usos restantes'; end if;
  end if;
  return v_order_id;
end $$;
revoke all on function public.place_order_with_inventory(uuid,jsonb,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.place_order_with_inventory(uuid,jsonb,jsonb,jsonb,uuid) to service_role;

create or replace function public.sync_order_inventory_status()
returns trigger language plpgsql security invoker set search_path=public as $$
declare v_line record; v_return boolean; v_reserve boolean;
begin
  v_return := old.inventory_reserved and (tg_op='DELETE' or new.status::text='cancelled');
  v_reserve := tg_op='UPDATE' and not old.inventory_reserved and old.status::text='cancelled' and new.status::text<>'cancelled';
  if v_return or v_reserve then
    for v_line in select * from order_inventory where order_id=old.id order by product_id,variant_id nulls first loop
      perform 1 from products where id=v_line.product_id and store_id=old.store_id for update;
      if v_line.variant_id is null then
        update products set stock=stock+case when v_return then v_line.quantity else -v_line.quantity end,updated_at=now()
        where id=v_line.product_id and store_id=old.store_id and (v_return or stock>=v_line.quantity);
      else
        update product_variants set stock=stock+case when v_return then v_line.quantity else -v_line.quantity end,updated_at=now()
        where id=v_line.variant_id and product_id=v_line.product_id and store_id=old.store_id and (v_return or stock>=v_line.quantity);
      end if;
      if v_reserve and not found then raise exception 'Stock insuficiente o producto eliminado. No se puede reactivar el pedido.'; end if;
    end loop;
  end if;
  if tg_op='DELETE' then return old; end if;
  if v_return then new.inventory_reserved:=false; end if;
  if v_reserve then new.inventory_reserved:=true; end if;
  return new;
end $$;
revoke all on function public.sync_order_inventory_status() from public,anon,authenticated;
create trigger orders_inventory_status before update of status or delete on public.orders
for each row execute function public.sync_order_inventory_status();

notify pgrst,'reload schema';

