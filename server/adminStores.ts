import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { SUPER_ADMIN_EMAIL } from "../lib/superAdmin.js";

type Env = Record<string, string | undefined>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plans = ["trial", "basic", "pro", "premium", "subscription"];
const checked = <T extends { error: any }>(result: T): T => {
  if (result.error) throw new Error(result.error.message);
  return result;
};

export async function adminStoresAction(input: any, authorization?: string, env: Env = process.env) {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "Sesión requerida." };
  const url = env.VITE_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Falta configuración de Supabase para administración.");
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  });
  // La autorización se valida en Auth, nunca con datos enviados por el navegador.
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { ok: false, status: 401, error: "La sesión expiró." };
  if (data.user.email?.trim().toLowerCase() !== SUPER_ADMIN_EMAIL || !data.user.email_confirmed_at)
    return { ok: false, status: 403, error: "Acceso restringido." };
  const action = input.action || "list";
  if (!["list", "update-status", "update-plan"].includes(action))
    return { ok: false, status: 400, error: "Acción inválida." };

  if (action !== "list") {
    if (!uuid.test(String(input.storeId || ""))) return { ok: false, status: 400, error: "Tienda inválida." };
    if (action === "update-plan") {
      if (!plans.includes(input.plan)) return { ok: false, status: 400, error: "Plan inválido." };
      // Cambia la versión sin alterar pagos, origen ni vigencia de la suscripción.
      const result = await admin.from("subscriptions").update({ plan: input.plan, updated_at: new Date().toISOString() })
        .eq("store_id", input.storeId).select("plan, subscription_status, subscription_end_at").maybeSingle();
      if (result.error) return { ok: false, status: 400, error: result.error.message };
      if (!result.data) return { ok: false, status: 404, error: "La tienda no tiene una suscripción registrada." };
      return { ok: true, status: 200, subscription: result.data };
    }
    if (typeof input.isActive !== "boolean") return { ok: false, status: 400, error: "Estado inválido." };
    const result = await admin.from("stores").update({ status: input.isActive ? "active" : "inactive", updated_at: new Date().toISOString() })
      .eq("id", input.storeId).select("id, status").maybeSingle();
    if (result.error) return { ok: false, status: 400, error: result.error.message };
    if (!result.data) return { ok: false, status: 404, error: "Tienda no encontrada." };
    return { ok: true, status: 200, store: result.data };
  }

  const page = Number(input.page ?? 1), pageSize = Number(input.pageSize ?? 12);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50)
    return { ok: false, status: 400, error: "Paginación inválida." };
  const search = String(input.search || "").trim().slice(0, 120).replace(/[^\p{L}\p{N}@+ ._-]/gu, "");
  const plan = String(input.plan || "all"), status = String(input.status || "all");
  if ((plan !== "all" && !plans.includes(plan)) || !["all", "active", "inactive"].includes(status))
    return { ok: false, status: 400, error: "Filtro inválido." };
  const from = (page - 1) * pageSize;
  let query = admin.from("stores").select("*, subscriptions!inner(*)", { count: "exact" });
  // La relación no es obligatoria salvo al filtrar por versión.
  if (plan === "all") query = admin.from("stores").select("*, subscriptions(*)", { count: "exact" });
  else query = query.eq("subscriptions.plan", plan);
  if (status !== "all") query = query.eq("status", status);
  if (search) query = query.or(["name", "slug", "contact_email", "whatsapp", "city"].map(column => `${column}.ilike.%${search}%`).join(","));
  const countQuery = (table: string) => admin.from(table).select("id", { count: "exact", head: true });
  const results = await Promise.all([
    query.order("created_at", { ascending: false }).order("id").range(from, from + pageSize - 1),
    countQuery("stores"), countQuery("stores").eq("status", "active"),
    countQuery("orders"), countQuery("products"), countQuery("clients"),
    countQuery("subscriptions").eq("subscription_status", "active").eq("registration_type", "paid").gt("subscription_end_at", new Date().toISOString()),
    countQuery("subscriptions").eq("registration_type", "paid"),
  ]);
  results.forEach(checked);
  const stores = results[0].data || [];
  const rows = await Promise.all(stores.map(async (store: any) => {
    const counts = await Promise.all(["orders", "products", "clients", "categories"].map(table => countQuery(table).eq("store_id", store.id)));
    counts.forEach(checked);
    const recent = checked(await admin.from("orders").select("created_at").eq("store_id", store.id).order("created_at", { ascending: false }).limit(1));
    const sub = Array.isArray(store.subscriptions) ? store.subscriptions[0] : store.subscriptions;
    return {
      id: store.id, name: store.name || "Sin nombre", slug: store.slug || "", logoUrl: store.logo_url || "",
      ownerUid: store.owner_id || "", ownerEmail: store.owner_email || store.contact_email || "",
      whatsapp: store.whatsapp || "", address: store.address || "", city: store.city || "",
      businessType: store.business_type || "", source: store.source || "", isActive: store.status !== "inactive",
      createdAt: store.created_at, updatedAt: store.updated_at, plan: sub?.plan || null,
      registrationType: sub?.registration_type || null, subscriptionStatus: sub?.subscription_status || "inactive",
      endAt: sub?.subscription_end_at || null,
      hasActiveSubscription: sub?.subscription_status === "active" && sub?.registration_type === "paid" && Date.parse(sub?.subscription_end_at) > Date.now(),
      orders: counts[0].count || 0, products: counts[1].count || 0, clients: counts[2].count || 0, categories: counts[3].count || 0,
      lastOrderAt: recent.data?.[0]?.created_at || null,
    };
  }));
  const total = results[0].count || 0;
  return { ok: true, status: 200, stores: rows, total, hasNext: from + rows.length < total,
    summary: { stores: results[1].count, active: results[2].count, orders: results[3].count, products: results[4].count, clients: results[5].count, paid: results[7].count, paidActive: results[6].count } };
}
