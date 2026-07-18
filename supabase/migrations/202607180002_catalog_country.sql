-- Expone el pais de la tienda al catalogo sin publicar columnas privadas.
alter function public.get_public_catalog_store(text)
  rename to get_public_catalog_store_base;

create function public.get_public_catalog_store(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.get_public_catalog_store_base(p_slug) || jsonb_build_object(
    'countryCode', coalesce(
      (select s.shipping_settings->>'countryCode'
       from public.stores s
       where lower(s.slug) = lower(trim(p_slug))
       limit 1),
      'CO'
    )
  );
$$;

revoke all on function public.get_public_catalog_store(text) from public;
grant execute on function public.get_public_catalog_store(text) to anon, authenticated;

