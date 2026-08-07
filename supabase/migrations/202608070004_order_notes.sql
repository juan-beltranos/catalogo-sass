-- Almacena las notas principales del formulario en el pedido.
-- Tambien se conserva como respuesta del formulario para compatibilidad.
alter table public.orders
  add column if not exists notes text;

-- Corrige contadores que pudieron incrementarse por intentos fallidos antes
-- de que el guardado tuviera compensacion automatica.
update public.clients c
set orders_count = stats.order_count,
    total_spent = stats.total_spent,
    updated_at = now()
from (
  select c2.id,
    count(o.id)::integer as order_count,
    coalesce(sum(o.total), 0) as total_spent
  from public.clients c2
  left join public.orders o on o.client_id = c2.id and o.store_id = c2.store_id
  group by c2.id
) stats
where c.id = stats.id;
