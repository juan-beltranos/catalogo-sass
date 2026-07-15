import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import ws from "ws";

const secretMatches = (authorization: unknown) => {
  const expected = process.env.MAKE_WEBHOOK_SECRET || "";
  const received = String(authorization || "").replace(/^Bearer\s+/i, "");
  if (!expected || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
};

export default async function handler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, code: "method_not_allowed" });
  if (!secretMatches(req.headers.authorization)) {
    return res.status(401).json({ ok: false, code: "unauthorized" });
  }

  const body = req.body ?? {};
  const eventId = String(body.event_id || req.headers["x-idempotency-key"] || "").trim();
  let storeId = body.store_id ? String(body.store_id) : null;
  let userId = body.user_id ? String(body.user_id) : null;
  const email = String(body.email || "").trim().toLowerCase();
  if (!eventId || (!email && !storeId && !userId)) {
    return res.status(400).json({ ok: false, code: "invalid_payload", message: "event_id y email son obligatorios" });
  }

  const url = process.env.VITE_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ ok: false, code: "server_misconfigured" });

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws as any },
  });

  // Local Go/Make identifica al cliente por el mismo correo registrado en la tienda.
  if (email) {
    const { data: store, error: storeError } = await supabase
      .from("stores")
      .select("id, owner_id, name, created_at")
      .ilike("contact_email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (storeError) {
      console.error("Error buscando tienda por email:", storeError.code, storeError.message);
      return res.status(500).json({ ok: false, code: "store_lookup_failed" });
    }
    if (!store) {
      return res.status(404).json({ ok: false, code: "store_not_found", message: "No existe una tienda con ese correo" });
    }
    storeId = store.id;
    userId = store.owner_id;
  }

  const { data, error } = await supabase.rpc("activate_subscription_payment", {
    p_event_id: eventId,
    p_store_id: storeId,
    p_user_id: userId,
    p_amount: body.amount == null ? null : Number(body.amount),
    p_currency: body.currency ? String(body.currency) : null,
    p_payload: body,
  });
  if (error) {
    const notFound = error.message.includes("store_not_found");
    console.error("activate_subscription_payment:", error.code, error.message);
    return res.status(notFound ? 404 : 500).json({ ok: false, code: notFound ? "store_not_found" : "activation_failed" });
  }
  const result = data?.[0];
  return res.status(200).json({
    ok: true,
    email: email || undefined,
    store_id: result?.store_id,
    subscription_end_at: result?.subscription_end_at,
    duplicate: result?.duplicate ?? false,
  });
}
