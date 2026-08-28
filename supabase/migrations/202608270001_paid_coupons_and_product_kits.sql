-- Módulos premium: cupones y kits. Solo una suscripción mensual pagada vigente
-- puede administrar o publicar estos recursos.
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  code text not null,
  description text,
  discount_type text not null check (discount_type in ('percent','amount')),
  discount_value numeric(12,2) not null check (discount_value > 0),
  minimum_subtotal numeric(12,2) not null default 0 check (minimum_subtotal >= 0),
  usage_limit integer check (usage_limit is null or usage_limit > 0),
  used_count integer not null default 0 check (used_count >= 0),
  starts_at timestamptz,
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_dates_check check (expires_at is null or starts_at is null or expires_at > starts_at)
);
create unique index if not exists coupons_store_code_key on public.coupons(store_id, upper(code));
create index if not exists coupons_store_active_idx on public.coupons(store_id, active);

create table if not exists public.product_kits (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  description text,
  price numeric(12,2) not null check (price > 0),
  compare_at_price numeric(12,2),
  image_url text,
  active boolean not null default true,
  category_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.product_kits add column if not exists category_ids uuid[] not null default '{}'::uuid[];
create index if not exists product_kits_store_active_idx on public.product_kits(store_id, active);
create index if not exists product_kits_category_ids_idx on public.product_kits using gin(category_ids);

create table if not exists public.product_kit_items (
  id uuid primary key default gen_random_uuid(),
  kit_id uuid not null references public.product_kits(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  sort_order integer not null default 0,
  unique(kit_id, product_id)
);

alter table public.order_items add column if not exists kit_id uuid references public.product_kits(id) on delete set null;

create or replace function public.has_paid_monthly_access(p_store_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.subscriptions s where s.store_id=p_store_id
    and s.subscription_status='active' and s.registration_type='paid'
    and s.subscription_end_at > now());
$$;
grant execute on function public.has_paid_monthly_access(uuid) to anon, authenticated;

alter table public.coupons enable row level security;
alter table public.product_kits enable row level security;
alter table public.product_kit_items enable row level security;

drop policy if exists "paid owners manage coupons" on public.coupons;
create policy "paid owners manage coupons" on public.coupons for all to authenticated
using (has_paid_monthly_access(store_id) and exists(select 1 from stores s where s.id=store_id and s.owner_id=auth.uid()))
with check (has_paid_monthly_access(store_id) and exists(select 1 from stores s where s.id=store_id and s.owner_id=auth.uid()));
drop policy if exists "paid owners manage kits" on public.product_kits;
create policy "paid owners manage kits" on public.product_kits for all to authenticated
using (has_paid_monthly_access(store_id) and exists(select 1 from stores s where s.id=store_id and s.owner_id=auth.uid()))
with check (has_paid_monthly_access(store_id) and exists(select 1 from stores s where s.id=store_id and s.owner_id=auth.uid()));
drop policy if exists "paid owners manage kit items" on public.product_kit_items;
create policy "paid owners manage kit items" on public.product_kit_items for all to authenticated
using (has_paid_monthly_access(store_id) and exists(select 1 from stores s where s.id=store_id and s.owner_id=auth.uid()))
with check (has_paid_monthly_access(store_id) and exists(select 1 from stores s where s.id=store_id and s.owner_id=auth.uid()));

-- Lectura pública únicamente mientras el módulo esté pagado y publicado.
create policy "public reads active paid kits" on public.product_kits for select to anon
using (active and has_paid_monthly_access(store_id));
create policy "public reads active paid kit items" on public.product_kit_items for select to anon
using (has_paid_monthly_access(store_id) and exists(select 1 from product_kits k where k.id=kit_id and k.active));

-- Valida cupones sin exponer la lista de códigos.
create or replace function public.validate_catalog_coupon(p_store_id uuid, p_code text, p_subtotal numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c coupons%rowtype; v_discount numeric;
begin
  if not has_paid_monthly_access(p_store_id) then return jsonb_build_object('valid',false,'message','Cupón no disponible.'); end if;
  select * into c from coupons where store_id=p_store_id and upper(code)=upper(trim(p_code)) and active limit 1;
  if c.id is null then return jsonb_build_object('valid',false,'message','El código no es válido.'); end if;
  if c.starts_at is not null and c.starts_at>now() then return jsonb_build_object('valid',false,'message','El cupón aún no está disponible.'); end if;
  if c.expires_at is not null and c.expires_at<=now() then return jsonb_build_object('valid',false,'message','El cupón venció.'); end if;
  if c.usage_limit is not null and c.used_count>=c.usage_limit then return jsonb_build_object('valid',false,'message','El cupón alcanzó su límite de usos.'); end if;
  if p_subtotal<c.minimum_subtotal then return jsonb_build_object('valid',false,'message','La compra mínima es '||c.minimum_subtotal||'.'); end if;
  v_discount := case when c.discount_type='percent' then round(p_subtotal*least(c.discount_value,100)/100) else least(c.discount_value,p_subtotal) end;
  return jsonb_build_object('valid',true,'couponId',c.id,'code',upper(c.code),'discount',v_discount,'message','Cupón aplicado.');
end $$;
grant execute on function public.validate_catalog_coupon(uuid,text,numeric) to anon, authenticated;
