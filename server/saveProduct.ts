import { createClient } from "@supabase/supabase-js";
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
  const productId = String(input.productId || "");
  const product = input.product || {};
  if (!storeId || !productId || !productPayload(product).name) {
    return { ok: false, status: 400, error: "Faltan datos del producto." };
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

  return { ok: true, status: 200 };
}
