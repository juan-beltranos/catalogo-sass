import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const allowedColumns = new Set([
  "name", "slug", "description", "whatsapp", "status", "brand_color",
  "logo_url", "banner_url", "instagram", "facebook", "contact_email",
  "phone", "location", "shipping_settings", "checkout_fields", "updated_at",
]);

export async function updateStoreSettings(
  input: { storeId?: string; changes?: Record<string, unknown> },
  authorization: string | undefined,
  env: Record<string, string | undefined> = process.env,
) {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "Sesión requerida." };

  const url = env.VITE_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { ok: false, status: 500, error: "Falta configuración de Supabase." };

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return { ok: false, status: 401, error: "La sesión expiró." };

  const storeId = String(input.storeId || "");
  const { data: store, error: storeError } = await admin
    .from("stores")
    .select("id")
    .eq("id", storeId)
    .eq("owner_id", userData.user.id)
    .maybeSingle();
  if (storeError) return { ok: false, status: 500, error: storeError.message };
  if (!store) return { ok: false, status: 403, error: "No puedes editar esta tienda." };

  const changes = Object.fromEntries(
    Object.entries(input.changes || {}).filter(([key]) => allowedColumns.has(key)),
  );
  const { error } = await admin.from("stores").update(changes).eq("id", storeId);
  if (error) return { ok: false, status: 400, error: error.message };
  return { ok: true, status: 200 };
}
