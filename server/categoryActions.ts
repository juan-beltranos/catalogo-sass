import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

type Env = Record<string, string | undefined>;

export async function runCategoryAction(input: any, authorization?: string, env: Env = process.env) {
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
  const { data: store, error: storeError } = await client.from("stores").select("id")
    .eq("id", storeId).eq("owner_id", userData.user.id).maybeSingle();
  if (storeError) return { ok: false, status: 400, error: storeError.message };
  if (!store) return { ok: false, status: 403, error: "No puedes editar esta tienda." };

  const action = String(input.action || "save");
  if (action === "delete") {
    const { error } = await client.from("categories").delete()
      .eq("id", String(input.categoryId || "")).eq("store_id", storeId);
    if (error) return { ok: false, status: 400, error: error.message };
    return { ok: true, status: 200 };
  }

  if (action === "reorder") {
    const categories = Array.isArray(input.categories) ? input.categories : [];
    for (const category of categories) {
      const { error } = await client.from("categories").update({
        sort_order: Number(category.order || 0),
        updated_at: new Date().toISOString(),
      }).eq("id", String(category.id || "")).eq("store_id", storeId);
      if (error) return { ok: false, status: 400, error: error.message };
    }
    return { ok: true, status: 200 };
  }

  const categoryId = String(input.categoryId || randomUUID());
  const name = String(input.name || "").trim();
  if (!name) return { ok: false, status: 400, error: "Escribe el nombre de la categoria." };
  const now = new Date().toISOString();
  const payload = { name, sort_order: Number(input.order || 0), updated_at: now };
  const request = input.categoryId
    ? client.from("categories").update(payload).eq("id", categoryId).eq("store_id", storeId)
    : client.from("categories").insert({
      id: categoryId, store_id: storeId, ...payload, created_at: now,
    });
  const { error } = await request;
  if (error) return { ok: false, status: 400, error: error.message };
  return { ok: true, status: 200, categoryId };
}
