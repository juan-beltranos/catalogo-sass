-- Expone el costo configurable del nuevo metodo de envio nacional.
create or replace function public.get_public_catalog_store(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'slug', s.slug,
    'whatsapp', s.whatsapp,
    'address', s.address,
    'description', s.description,
    'isActive', s.status <> 'inactive',
    'brandColor', s.brand_color,
    'logoUrl', s.logo_url,
    'bannerUrl', s.banner_url,
    'instagram', s.instagram,
    'facebook', s.facebook,
    'email', s.contact_email,
    'phone', s.phone,
    'location', s.location,
    'checkoutFields', coalesce(s.checkout_fields, '[]'::jsonb),
    'commerceRules', coalesce(s.commerce_rules, '{"pricing":[],"shipping":[]}'::jsonb),
    'shippingEnabled', coalesce((s.shipping_settings->>'enabled')::boolean, false),
    'shippingMethods', coalesce(s.shipping_settings->'methods', '["pickup"]'::jsonb),
    'shippingCostPickup', coalesce((s.shipping_settings->>'costPickup')::numeric, (s.shipping_settings->>'costCOD')::numeric, 0),
    'shippingCostLocal', coalesce((s.shipping_settings->>'costLocal')::numeric, (s.shipping_settings->>'costCarrier')::numeric, 0),
    'shippingCostCOD', coalesce((s.shipping_settings->>'costCOD')::numeric, 0),
    'shippingCostCarrier', coalesce((s.shipping_settings->>'costCarrier')::numeric, 0),
    'shippingCostNational', coalesce((s.shipping_settings->>'costNational')::numeric, 0),
    'shippingNote', coalesce(s.shipping_settings->>'note', ''),
    'shippingHidePrices', coalesce((s.shipping_settings->>'hidePrices')::boolean, false),
    'countryCode', coalesce(s.shipping_settings->>'countryCode', 'CO'),
    'hasActiveSubscription', coalesce(
      sub.subscription_status in ('active', 'trial')
      and sub.subscription_end_at >= now(), false
    ),
    'subscriptionStatus', coalesce(sub.subscription_status, 'inactive'),
    'subscriptionType', case when sub.subscription_status = 'trial' then 'free_trial' else 'subscription' end,
    'subscriptionEndAt', sub.subscription_end_at,
    'subscriptionEndsAt', sub.subscription_end_at,
    'trialEndsAtMs', case
      when sub.subscription_status = 'trial'
      then floor(extract(epoch from sub.subscription_end_at) * 1000)
      else null
    end,
    'hasFreeTrial', sub.subscription_status = 'trial',
    'freeTrialStatus', case when sub.subscription_status = 'trial' then 'active' else null end
  )
  from public.stores s
  left join public.subscriptions sub on sub.store_id = s.id
  where lower(s.slug) = lower(trim(p_slug))
  limit 1;
$$;

revoke all on function public.get_public_catalog_store(text) from public;
grant execute on function public.get_public_catalog_store(text) to anon, authenticated;
