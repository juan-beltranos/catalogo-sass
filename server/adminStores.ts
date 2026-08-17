import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { SUPER_ADMIN_EMAIL } from "../lib/superAdmin.js";

type Env = Record<string, string | undefined>;

const clients = (env: Env) => {
  const url = env.VITE_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_PUBLIC_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error("Falta configuración de Supabase para administración.");
  return {
    auth: createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: WebSocket as any },
    }),
    admin: createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: WebSocket as any },
    }),
  };
};

export async function adminStoresAction(input: any, authorization?: string, env: Env = process.env) {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "Sesión requerida." };

  const { auth, admin } = clients(env);
  const { data: userData, error: userError } = await auth.auth.getUser(token);
  const email = userData.user?.email?.trim().toLowerCase();
  if (userError || !userData.user) return { ok: false, status: 401, error: "La sesión expiró." };
  if (email !== SUPER_ADMIN_EMAIL) return { ok: false, status: 403, error: "Acceso restringido." };

  const action = String(input.action || "list");
  if (action === "update-status") {
    const storeId = String(input.storeId || "");
    if (!storeId) return { ok: false, status: 400, error: "Tienda requerida." };
    const { error } = await admin.from("stores").update({
      status: input.isActive === false ? "inactive" : "active",
      updated_at: new Date().toISOString(),
    }).eq("id", storeId);
    if (error) return { ok: false, status: 400, error: error.message };
    return { ok: true, status: 200 };
  }

  const page = Math.max(1, Number(input.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(input.pageSize || 20)));
  const from = (page - 1) * pageSize;
  const { data: stores, error, count } = await admin
    .from("stores")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) return { ok: false, status: 400, error: error.message };

  const storeIds = (stores || []).map((store: any) => store.id);
  const { data: subscriptions, error: subscriptionsError } = storeIds.length
    ? await admin.from("subscriptions").select("*").in("store_id", storeIds)
    : { data: [], error: null };
  if (subscriptionsError) return { ok: false, status: 400, error: subscriptionsError.message };
  const subscriptionByStore = new Map((subscriptions || []).map((subscription: any) => [subscription.store_id, subscription]));

  const rows = (stores || []).map((store: any) => {
    const subscription: any = subscriptionByStore.get(store.id);
    const endAt = subscription?.subscription_end_at ?? subscription?.current_period_ends_at ?? null;
    const hasActiveSubscription = ["active", "trial"].includes(subscription?.subscription_status) &&
      Boolean(endAt) && Date.now() <= Date.parse(endAt);
    return {
      id: store.id,
      name: store.name ?? "Sin nombre",
      slug: store.slug ?? "",
      ownerUid: store.owner_id ?? "",
      ownerEmail: store.owner_email ?? store.contact_email ?? "",
      whatsapp: store.whatsapp ?? "",
      isActive: store.status !== "inactive",
      hasActiveSubscription,
      subscriptionStatus: subscription?.subscription_status ?? subscription?.status ?? "inactive",
      businessType: store.business_type ?? "",
      city: store.city ?? "",
      source: store.source ?? "",
      createdAt: store.created_at,
      updatedAt: store.updated_at,
    };
  });

  return { ok: true, status: 200, stores: rows, total: count ?? rows.length, hasNext: from + rows.length < (count ?? 0) };
}
