import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { evaluateCommerceRules } from "../helpers/commerceRules.js";

type Env = Record<string, string | undefined>;
const client = (env: Env) => createClient(
  env.VITE_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL || "",
  env.SUPABASE_SERVICE_ROLE_KEY || "",
  { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket as any } },
);

const missingColumn = (error: any, column: string) => {
  const message = String(error?.message || "").toLowerCase();
  return (error?.code === "PGRST204" || message.includes("schema cache")) && message.includes(`'${column.toLowerCase()}'`);
};

export async function createPublicOrder(input: any, env: Env = process.env) {
  const admin = client(env);
  const storeId = String(input.storeId || "");
  const order = input.order || {};
  const { data: store } = await admin.from("stores").select("id,status,shipping_settings,commerce_rules,checkout_fields").eq("id", storeId).maybeSingle();
  if (!store || store.status === "inactive") return { ok: false, status: 404, error: "Tienda no disponible." };
  if (!order.id || !Array.isArray(order.items) || !order.items.length) {
    return { ok: false, status: 400, error: "Pedido incompleto." };
  }
  const configuredFields = Array.isArray(store.checkout_fields) ? store.checkout_fields : [];
  const answers = Array.isArray(order.customFields) ? order.customFields : [];
  const missingRequired = configuredFields.find((field: any) => field.enabled !== false && field.required === true &&
    !answers.find((answer: any) => answer.id === field.id && String(answer.value || "").trim()));
  if (missingRequired) return { ok: false, status: 400, error: `Falta completar: ${missingRequired.label || "campo obligatorio"}.` };

  const productIds = [...new Set(order.items.map((item: any) => String(item.productId || "")).filter(Boolean))] as string[];
  const variantIds = [...new Set(order.items.map((item: any) => String(item.variantId || "")).filter(Boolean))] as string[];
  const { data: productRows, error: productsError } = await admin.from("products")
    .select("id,base_price,wholesale_price,discount_type,discount_value,is_active,allow_cash_on_delivery")
    .eq("store_id", storeId).in("id", productIds);
  if (productsError) return { ok: false, status: 400, error: productsError.message };
  const { data: variantRows, error: variantsError } = variantIds.length
    ? await admin.from("product_variants").select("id,product_id,price").in("id", variantIds)
    : { data: [], error: null };
  if (variantsError) return { ok: false, status: 400, error: variantsError.message };
  const productsById = new Map((productRows || []).map((row: any) => [row.id, row]));
  const variantsById = new Map((variantRows || []).map((row: any) => [row.id, row]));
  let canonicalItems: any[];
  try {
    canonicalItems = order.items.map((item: any) => {
    const product: any = productsById.get(String(item.productId || ""));
    if (!product || product.is_active === false) throw new Error(`Producto no disponible: ${item.productName || "producto"}`);
    const variant: any = item.variantId ? variantsById.get(String(item.variantId)) : null;
    if (item.variantId && (!variant || variant.product_id !== product.id)) throw new Error(`Variante no disponible: ${item.productName || "producto"}`);
    const wholesale = item.priceType === "wholesale" && Number(product.wholesale_price || 0) > 0;
    const variantPrice = Number(variant?.price || 0);
    let unitPrice = wholesale
      ? Number(product.wholesale_price)
      : variant && variantPrice > 0 ? variantPrice : Number(product.base_price || 0);
    const discountValue = Number(product.discount_value || 0);
    const validPercent = product.discount_type === "percent" && discountValue > 0 && discountValue < 100;
    const validAmount = product.discount_type === "amount" && discountValue > 0 && discountValue < unitPrice;
    if (!wholesale && (validPercent || validAmount)) {
      unitPrice = validPercent
        ? Math.round(unitPrice * (1 - discountValue / 100))
        : unitPrice - discountValue;
    }
    const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
      return { ...item, qty, unitPrice: Math.max(0, Math.round(unitPrice)), subtotal: Math.max(0, Math.round(unitPrice)) * qty };
    });
  } catch (error) {
    return { ok: false, status: 400, error: error instanceof Error ? error.message : "Producto no disponible." };
  }
  order.items = canonicalItems;
  const quantity = canonicalItems.reduce((sum: number, item: any) => sum + item.qty, 0);
  const originalSubtotal = canonicalItems.reduce((sum: number, item: any) => sum + item.subtotal, 0);
  const requestedMethod = order.shippingMethod === "cod" ? "pickup"
    : order.shippingMethod === "carrier" ? "local" : order.shippingMethod;
  const method = ["pickup", "local", "national"].includes(requestedMethod) ? requestedMethod : null;
  const shipping = store.shipping_settings || {};
  const allowedMethods = (Array.isArray(shipping.methods) ? shipping.methods : ["pickup"])
    .map((item: string) => item === "cod" ? "pickup" : item === "carrier" ? "local" : item);
  if (shipping.enabled && allowedMethods.length > 0 && !method) {
    return { ok: false, status: 400, error: "Selecciona un metodo de envio valido." };
  }
  if (shipping.enabled && method && !allowedMethods.includes(method)) {
    return { ok: false, status: 400, error: "Metodo de envio no disponible." };
  }
  const baseShippingCost = !shipping.enabled || !method ? 0
    : method === "pickup" ? Number(shipping.costPickup ?? shipping.costCOD ?? 0)
    : method === "local" ? Number(shipping.costLocal ?? shipping.costCarrier ?? 0)
    : Number(shipping.costNational || 0);
  const calculated = evaluateCommerceRules({ quantity, subtotal: originalSubtotal, shippingMethod: method, baseShippingCost }, store.commerce_rules);
  order.originalSubtotal = calculated.originalSubtotal;
  order.discount = calculated.discount;
  order.subtotal = calculated.subtotal;
  order.shippingCost = calculated.shippingCost;
  order.shippingMethod = method;
  order.total = calculated.total;
  order.appliedRules = calculated.appliedRules;

  const { data: existingOrder } = await admin.from("orders").select("id").eq("id", order.id).maybeSingle();
  if (existingOrder) return { ok: true, status: 200, orderId: order.id };

  const phone = String(order.customer?.phone || "").replace(/\D/g, "") || `9${String(order.id).replace(/\D/g, "").slice(-14).padStart(14, "0")}`;
  const customerName = String(order.customer?.name || "").trim() || "Cliente sin nombre";
  const customerAddress = String(order.customer?.address || "").trim();
  const { data: existingClient, error: clientLookupError } = await admin
    .from("clients").select("id,orders_count,total_spent").eq("store_id", storeId).eq("phone", phone).maybeSingle();
  if (clientLookupError) return { ok: false, status: 400, error: clientLookupError.message };

  let clientId = existingClient?.id;
  let createdClient = false;
  if (existingClient) {
    const clientChanges: any = {
      name: customerName, address: customerAddress, custom_fields: answers,
      orders_count: Number(existingClient.orders_count || 0) + 1,
      total_spent: Number(existingClient.total_spent || 0) + Number(order.total || 0),
      last_order_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    let { error } = await admin.from("clients").update(clientChanges).eq("id", existingClient.id);
    if (missingColumn(error, "custom_fields")) {
      delete clientChanges.custom_fields;
      ({ error } = await admin.from("clients").update(clientChanges).eq("id", existingClient.id));
    }
    if (error) return { ok: false, status: 400, error: error.message };
  } else {
    const clientRow: any = {
      store_id: storeId, name: customerName, phone, address: customerAddress, custom_fields: answers,
      orders_count: 1, total_spent: Number(order.total || 0),
      last_order_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    let { data: created, error } = await admin.from("clients").insert(clientRow).select("id").single();
    if (missingColumn(error, "custom_fields")) {
      delete clientRow.custom_fields;
      ({ data: created, error } = await admin.from("clients").insert(clientRow).select("id").single());
    }
    if (error) return { ok: false, status: 400, error: error.message };
    clientId = created!.id;
    createdClient = true;
  }

  const rollbackClient = async () => {
    if (!clientId) return;
    if (createdClient) {
      await admin.from("clients").delete().eq("id", clientId);
      return;
    }
    await admin.from("clients").update({
      orders_count: Number(existingClient?.orders_count || 0),
      total_spent: Number(existingClient?.total_spent || 0),
      updated_at: new Date().toISOString(),
    }).eq("id", clientId);
  };

  const orderRow: any = {
    id: order.id, store_id: storeId, client_id: clientId, status: "new", source: "whatsapp",
    customer_name: customerName, customer_phone: phone, address: customerAddress,
    delivery_method: order.shippingMethod || null, shipping_cost: Number(order.shippingCost || 0),
    original_subtotal: Number(order.originalSubtotal || order.subtotal || 0), discount: Number(order.discount || 0),
    subtotal: Number(order.subtotal || 0), total: Number(order.total || 0), applied_rules: order.appliedRules || [],
    notes: String(order.notes || "").trim() || null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  let { error: orderError } = await admin.from("orders").insert(orderRow);
  if (missingColumn(orderError, "notes")) {
    delete orderRow.notes;
    ({ error: orderError } = await admin.from("orders").insert(orderRow));
  }
  if (orderError) {
    await rollbackClient();
    return { ok: false, status: 400, error: orderError.message };
  }

  const itemRows = order.items.map((item: any) => ({
    order_id: order.id, store_id: storeId, product_id: item.productId || null,
    variant_id: item.variantId || null, title: item.productName || "", sku: item.sku || null,
    quantity: Number(item.qty || 1), unit_price: Number(item.unitPrice || 0), total: Number(item.subtotal || 0),
  }));
  const { error: itemsError } = await admin.from("order_items").insert(itemRows);
  if (itemsError) {
    await admin.from("orders").delete().eq("id", order.id).eq("store_id", storeId);
    await rollbackClient();
    return { ok: false, status: 400, error: itemsError.message };
  }

  const fields = (order.customFields || []).filter((field: any) => field?.value).map((field: any) => ({
    order_id: order.id, store_id: storeId, field_key: field.id || field.label,
    label: field.label || "", value: String(field.value),
  }));
  if (fields.length) await admin.from("order_custom_fields").insert(fields);
  return { ok: true, status: 200, orderId: order.id, calculation: {
    originalSubtotal: order.originalSubtotal, discount: order.discount, subtotal: order.subtotal,
    shippingCost: order.shippingCost, total: order.total, appliedRules: order.appliedRules,
  } };
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
