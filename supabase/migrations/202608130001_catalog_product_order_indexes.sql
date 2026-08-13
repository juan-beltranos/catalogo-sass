-- Optimiza el catálogo público al listar primero los productos más recientes.
-- Se separan los índices para "Todos" y para el filtro por categoría.
create index if not exists products_public_catalog_recent_idx
  on public.products (store_id, created_at desc)
  where is_active = true;

create index if not exists products_public_catalog_category_recent_idx
  on public.products (store_id, category_id, created_at desc)
  where is_active = true;
