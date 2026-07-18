import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

type Env = Record<string, string | undefined>;
const client = (env: Env) => createClient(
  env.VITE_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL || "",
  env.SUPABASE_SERVICE_ROLE_KEY || "",
  { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket as any } },
);

export async function createPublicOrder(input: any, env: Env = process.env) {
  const admin = client(env);
  const storeId = String(input.storeId || "");
  const order = input.order || {};
  const { data: store } = await admin.from("stores").select("id,status").eq("id", storeId).maybeSingle();
  if (!store || store.status === "inactive") return { ok: false, status: 404, error: "Tienda no disponible." };
  if (!order.id || !order.customer?.phone || !Array.isArray(order.items) || !order.items.length) {
    return { ok: false, status: 400, error: "Pedido incompleto." };
  }

  const { data: existingOrder } = await admin.from("orders").select("id").eq("id", order.id).maybeSingle();
  if (existingOrder) return { ok: true, status: 200, orderId: order.id };

  const phone = String(order.customer.phone).replace(/\D/g, "");
  const { data: existingClient, error: clientLookupError } = await admin
    .from("clients").select("id,orders_count,total_spent").eq("store_id", storeId).eq("phone", phone).maybeSingle();
  if (clientLookupError) return { ok: false, status: 400, error: clientLookupError.message };

  let clientId = existingClient?.id;
  if (existingClient) {
    const { error } = await admin.from("clients").update({
      name: order.customer.name, address: order.customer.address,
      orders_count: Number(existingClient.orders_count || 0) + 1,
      total_spent: Number(existingClient.total_spent || 0) + Number(order.total || 0),
      last_order_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", existingClient.id);
    if (error) return { ok: false, status: 400, error: error.message };
  } else {
    const { data: created, error } = await admin.from("clients").insert({
      store_id: storeId, name: order.customer.name, phone, address: order.customer.address,
      orders_count: 1, total_spent: Number(order.total || 0),
      last_order_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).select("id").single();
    if (error) return { ok: false, status: 400, error: error.message };
    clientId = created.id;
  }

  const { error: orderError } = await admin.from("orders").insert({
    id: order.id, store_id: storeId, client_id: clientId, status: "new", source: "whatsapp",
    customer_name: order.customer.name, customer_phone: phone, address: order.customer.address,
    delivery_method: order.shippingMethod || null, shipping_cost: Number(order.shippingCost || 0),
    subtotal: Number(order.subtotal || 0), total: Number(order.total || 0),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  if (orderError) return { ok: false, status: 400, error: orderError.message };

  const itemRows = order.items.map((item: any) => ({
    order_id: order.id, store_id: storeId, product_id: item.productId || null,
    variant_id: item.variantId || null, title: item.productName || "", sku: item.sku || null,
    quantity: Number(item.qty || 1), unit_price: Number(item.unitPrice || 0), total: Number(item.subtotal || 0),
  }));
  const { error: itemsError } = await admin.from("order_items").insert(itemRows);
  if (itemsError) return { ok: false, status: 400, error: itemsError.message };

  const fields = (order.customFields || []).filter((field: any) => field?.value).map((field: any) => ({
    order_id: order.id, store_id: storeId, field_key: field.id || field.label,
    label: field.label || "", value: String(field.value),
  }));
  if (fields.length) await admin.from("order_custom_fields").insert(fields);
  return { ok: true, status: 200, orderId: order.id };
}

export async function updateOrderStatus(input: any, authorization?: string, env: Env = process.env) {
  const admin = client(env);
  const token = authorization?.replace(/^Bearer\s+/i, "");
  const { data: authData } = await admin.auth.getUser(token || "");
  if (!authData.user) return { ok: false, status: 401, error: "Sesión inválida." };
  const allowed = new Set(["new", "confirmed", "preparing", "delivered", "cancelled"]);
  if (!allowed.has(input.status)) return { ok: false, status: 400, error: "Estado inválido." };
  const { data: store } = await admin.from("stores").select("id").eq("id", input.storeId).eq("owner_id", authData.user.id).maybeSingle();
  if (!store) return { ok: false, status: 403, error: "Sin acceso a la tienda." };
  const { error } = await admin.from("orders").update({ status: input.status, updated_at: new Date().toISOString() })
    .eq("id", input.orderId).eq("store_id", input.storeId);
  return error ? { ok: false, status: 400, error: error.message } : { ok: true, status: 200 };
}

