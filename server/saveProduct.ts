import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

type Env = Record<string, string | undefined>;

const productPayload = (product: any) => ({
  name: String(product.name || "").trim(),
  sku: String(product.sku || "").trim() || null,
  description: String(product.description || "").trim() || null,
  base_price: Number(product.price || 0),
  wholesale_price: product.wholesalePrice == null ? null : Number(product.wholesalePrice),
  discount_type: product.discount?.type ?? null,
  discount_value: product.discount?.value ?? null,
  category_id: product.categoryId || null,
  category_ids: Array.from(new Set([
    ...(Array.isArray(product.categoryIds) ? product.categoryIds.filter(Boolean) : []),
    ...(product.categoryId ? [product.categoryId] : []),
  ])),
  is_active: product.isActive !== false,
  allow_cash_on_delivery: product.allowsCashOnDelivery !== false,
  updated_at: new Date().toISOString(),
});

export async function saveProduct(
  input: any,
  authorization: string | undefined,
  env: Env = process.env,
) {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "Sesion requerida." };

  const url = env.VITE_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_PUBLIC_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { ok: false, status: 500, error: "Falta configuracion de Supabase." };

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
    realtime: { transport: WebSocket as any },
  });
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return { ok: false, status: 401, error: "La sesion expiro." };

  const storeId = String(input.storeId || "");
  const productId = String(input.productId || randomUUID());
  const product = input.product || {};
  if (!storeId || !productPayload(product).name) {
    return { ok: false, status: 400, error: "Faltan datos del producto." };
  }
  const basePrice = Number(product.price || 0);
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    return { ok: false, status: 400, error: "El precio del producto debe ser mayor que cero." };
  }
  if (variants.some((variant: any) => !Number.isFinite(Number(variant.price)) || Number(variant.price) <= 0)) {
    return { ok: false, status: 400, error: "Todas las variantes deben tener un precio mayor que cero." };
  }
  if (product.discount) {
    const discountValue = Number(product.discount.value || 0);
    const discountType = product.discount.type;
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      return { ok: false, status: 400, error: "El descuento debe ser mayor que cero." };
    }
    if (discountType === "percent" && discountValue >= 100) {
      return { ok: false, status: 400, error: "El descuento porcentual debe estar entre 1% y 99%." };
    }
    const lowestPrice = variants.length
      ? Math.min(...variants.map((variant: any) => Number(variant.price)))
      : basePrice;
    if (discountType === "amount" && discountValue >= lowestPrice) {
      return { ok: false, status: 400, error: "El descuento debe ser menor que el precio más bajo." };
    }
    if (discountType !== "percent" && discountType !== "amount") {
      return { ok: false, status: 400, error: "El tipo de descuento no es válido." };
    }
  }

  const { data: store, error: storeError } = await client
    .from("stores")
    .select("id")
    .eq("id", storeId)
    .eq("owner_id", userData.user.id)
    .maybeSingle();
  if (storeError) return { ok: false, status: 400, error: storeError.message };
  if (!store) return { ok: false, status: 403, error: "No puedes editar esta tienda." };

  const { error: saveError } = await client.rpc("save_product_full", {
    p_product_id: productId,
    p_store_id: storeId,
    p_product: product,
    p_images: product.images ?? [],
    p_videos: product.videos ?? [],
    p_options: product.options ?? [],
    p_variants: product.variants ?? [],
  });
  if (saveError) return { ok: false, status: 400, error: saveError.message };

  return { ok: true, status: 200, productId };
}
