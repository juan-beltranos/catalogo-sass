-- Un cliente por numero dentro de cada tienda.
do $$
declare
  duplicate record;
begin
  for duplicate in
    select store_id, phone, (array_agg(id order by created_at nulls last, id))[1] as keeper_id
    from public.clients
    where nullif(phone, '') is not null
    group by store_id, phone
    having count(*) > 1
  loop
    update public.orders
       set client_id = duplicate.keeper_id
     where store_id = duplicate.store_id
       and client_id in (
         select id from public.clients
          where store_id = duplicate.store_id and phone = duplicate.phone
       );

    delete from public.clients
     where store_id = duplicate.store_id
       and phone = duplicate.phone
       and id <> duplicate.keeper_id;

    update public.clients c
       set orders_count = (select count(*) from public.orders o where o.client_id = c.id),
           total_spent = coalesce((select sum(o.total) from public.orders o where o.client_id = c.id), 0),
           last_order_at = (select max(o.created_at) from public.orders o where o.client_id = c.id),
           updated_at = now()
     where c.id = duplicate.keeper_id;
  end loop;
end $$;

create unique index if not exists clients_store_phone_unique
  on public.clients(store_id, phone)
  where nullif(phone, '') is not null;
