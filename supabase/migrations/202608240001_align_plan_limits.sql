-- Alinea las reglas reales con la oferta comercial de Basic, Pro y Premium.
create or replace function public.enforce_store_plan_limits() returns trigger
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_plan text;
  v_limit integer;
  v_count integer;
begin
  select plan into v_plan from subscriptions where store_id = new.store_id;
  if tg_table_name = 'products' then
    v_limit := case v_plan when 'basic' then 50 when 'pro' then 200 else null end;
  elsif tg_table_name = 'categories' then
    v_limit := case v_plan when 'basic' then 5 when 'pro' then 10 else null end;
  end if;
  if v_limit is null then return new; end if;
  execute format('select count(*) from public.%I where store_id = $1', tg_table_name)
    into v_count using new.store_id;
  if v_count >= v_limit then
    raise exception using errcode = 'P0001', message = format('plan_limit_exceeded:%s:%s', tg_table_name, v_limit);
  end if;
  return new;
end $$;

create or replace function public.enforce_product_media_plan_limits() returns trigger
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_plan text;
  v_limit integer;
  v_count integer;
begin
  select plan into v_plan from public.subscriptions where store_id = new.store_id;
  if tg_table_name = 'product_images' then
    v_limit := case v_plan when 'basic' then 3 when 'pro' then 5 else null end;
  elsif tg_table_name = 'product_videos' then
    v_limit := case v_plan when 'basic' then 0 when 'pro' then 1 else null end;
  end if;
  if v_limit is null then return new; end if;
  execute format('select count(*) from public.%I where product_id = $1', tg_table_name)
    into v_count using new.product_id;
  if v_count >= v_limit then
    raise exception using errcode = 'P0001', message = format('plan_media_limit_exceeded:%s:%s', tg_table_name, v_limit);
  end if;
  return new;
end $$;

drop trigger if exists enforce_product_image_plan_limit on public.product_images;
create trigger enforce_product_image_plan_limit before insert on public.product_images
for each row execute function public.enforce_product_media_plan_limits();

drop trigger if exists enforce_product_video_plan_limit on public.product_videos;
create trigger enforce_product_video_plan_limit before insert on public.product_videos
for each row execute function public.enforce_product_media_plan_limits();
