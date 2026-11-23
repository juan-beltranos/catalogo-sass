import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { evaluateCommerceRules } from "../helpers/commerceRules.js";

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
  const { data: store } = await admin.from("stores").select("id,status,shipping_settings,commerce_rules,checkout_fields").eq("id", storeId).maybeSingle();
  if (!store || store.status === "inactive") return { ok: false, status: 404, error: "Tienda no disponible." };
  if (!order.id || !Array.isArray(order.items) || !order.items.length) {
    return { ok: false, status: 400, error: "Pedido incompleto." };
  }
  if (order.items.some((item: any) => !Number.isSafeInteger(item.qty) || item.qty <= 0 || item.qty > 2147483647)) {
    return { ok: false, status: 400, error: "Las cantidades deben ser números enteros mayores que cero." };
  }
  const { data: existingOrder } = await admin.from("orders")
    .select("id,original_subtotal,discount,subtotal,shipping_cost,total,applied_rules").eq("id", order.id).eq("store_id", storeId).maybeSingle();
  if (existingOrder) return { ok: true, status: 200, orderId: existingOrder.id, calculation: {
    originalSubtotal: existingOrder.original_subtotal, discount: existingOrder.discount, subtotal: existingOrder.subtotal,
    shippingCost: existingOrder.shipping_cost, total: existingOrder.total, appliedRules: existingOrder.applied_rules,
  } };
  const configuredFields = Array.isArray(store.checkout_fields) ? store.checkout_fields : [];
  const answers = Array.isArray(order.customFields) ? order.customFields : [];
  const missingRequired = configuredFields.find((field: any) => field.enabled !== false && field.required === true &&
    !answers.find((answer: any) => answer.id === field.id && String(answer.value || "").trim()));
  if (missingRequired) return { ok: false, status: 400, error: `Falta completar: ${missingRequired.label || "campo obligatorio"}.` };

  const productIds = [...new Set(order.items.filter((item: any) => item.itemType !== "kit").map((item: any) => String(item.productId || "")).filter(Boolean))] as string[];
  const kitIds = [...new Set(order.items.filter((item: any) => item.itemType === "kit").map((item: any) => String(item.kitId || item.productId || "")).filter(Boolean))] as string[];
  if (kitIds.length) {
    const { data: paidAccess, error: paidAccessError } = await admin.rpc("has_paid_monthly_access", { p_store_id: storeId });
    if (paidAccessError || paidAccess !== true) return { ok: false, status: 400, error: "Los kits no están disponibles en este momento." };
  }
  const variantIds = [...new Set(order.items.map((item: any) => String(item.variantId || "")).filter(Boolean))] as string[];
  const { data: productRows, error: productsError } = productIds.length
    ? await admin.from("products").select("id,base_price,wholesale_price,discount_type,discount_value,is_active,allow_cash_on_delivery").eq("store_id", storeId).in("id", productIds)
    : { data: [], error: null };
  if (productsError) return { ok: false, status: 400, error: productsError.message };
  const { data: variantRows, error: variantsError } = variantIds.length
    ? await admin.from("product_variants").select("id,product_id,price").in("id", variantIds)
    : { data: [], error: null };
  if (variantsError) return { ok: false, status: 400, error: variantsError.message };
  const productsById = new Map((productRows || []).map((row: any) => [row.id, row]));
  const variantsById = new Map((variantRows || []).map((row: any) => [row.id, row]));
  const { data: kitRows, error: kitsError } = kitIds.length
    ? await admin.from("product_kits").select("id,name,price,active").eq("store_id", storeId).in("id", kitIds)
    : { data: [], error: null };
  if (kitsError) return { ok: false, status: 400, error: kitsError.message };
  const kitsById = new Map((kitRows || []).map((row: any) => [row.id, row]));
  let canonicalItems: any[];
  try {
    canonicalItems = order.items.map((item: any) => {
    if (item.itemType === "kit") {
      const kit: any = kitsById.get(String(item.kitId || item.productId || ""));
      if (!kit || kit.active === false) throw new Error(`Kit no disponible: ${item.productName || "kit"}`);
      const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
      const unitPrice = Math.max(0, Math.round(Number(kit.price || 0)));
      return { ...item, productId: kit.id, kitId: kit.id, productName: kit.name, qty, unitPrice, subtotal: unitPrice * qty };
    }
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
  let appliedCoupon: any = null;
  if (String(order.couponCode || "").trim()) {
    const { data: couponData, error: couponError } = await admin.rpc("validate_catalog_coupon", {
      p_store_id: storeId,
      p_code: String(order.couponCode).trim(),
      p_subtotal: calculated.subtotal,
    });
    if (couponError || !couponData?.valid) return { ok: false, status: 400, error: couponError?.message || couponData?.message || "Cupón no válido." };
    appliedCoupon = couponData;
  }
  const couponDiscount = Math.min(calculated.subtotal, Number(appliedCoupon?.discount || 0));
  order.originalSubtotal = calculated.originalSubtotal;
  order.discount = calculated.discount + couponDiscount;
  order.subtotal = calculated.subtotal - couponDiscount;
  order.shippingCost = calculated.shippingCost;
  order.shippingMethod = method;
  order.total = calculated.total - couponDiscount;
  order.appliedRules = [...calculated.appliedRules, ...(appliedCoupon ? [{ id: appliedCoupon.couponId, name: `Cupón ${appliedCoupon.code}`, amount: couponDiscount, kind: "pricing" }] : [])];

  const phone = String(order.customer?.phone || "").replace(/\D/g, "") || ("9" + String(order.id).replace(/\D/g, "").slice(-14).padStart(14, "0"));
  const orderRow = {
    id: order.id, customer_name: String(order.customer?.name || "").trim() || "Cliente sin nombre",
    customer_phone: phone, address: String(order.customer?.address || "").trim(),
    customer_fields: answers, delivery_method: method,
    shipping_cost: order.shippingCost, original_subtotal: order.originalSubtotal,
    discount: order.discount, subtotal: order.subtotal, total: order.total, applied_rules: order.appliedRules,
    notes: String(order.notes || "").trim() || null,
  };
  const itemRows = canonicalItems.map((item: any) => ({
    product_id: item.itemType === "kit" ? null : item.productId,
    kit_id: item.itemType === "kit" ? item.kitId : null,
    variant_id: item.variantId || null, title: item.productName || "", sku: item.sku || null,
    quantity: item.qty, unit_price: item.unitPrice, total: item.subtotal,
  }));
  const fields = answers.filter((field: any) => field?.value).map((field: any) => ({
    field_key: field.id || field.label, label: field.label || "", value: String(field.value),
  }));
  const { error: saveError } = await admin.rpc("place_order_with_inventory", {
    p_store_id: storeId, p_order: orderRow, p_items: itemRows, p_fields: fields,
    p_coupon_id: appliedCoupon?.couponId || null,
  });
  if (saveError) return { ok: false, status: saveError.message.includes("Stock") ? 409 : 400, error: saveError.message };
  const { data: saved } = await admin.from("orders")
    .select("original_subtotal,discount,subtotal,shipping_cost,total,applied_rules")
    .eq("id", order.id).eq("store_id", storeId).maybeSingle();
  return { ok: true, status: 200, orderId: order.id, calculation: {
    originalSubtotal: saved?.original_subtotal ?? order.originalSubtotal, discount: saved?.discount ?? order.discount, subtotal: saved?.subtotal ?? order.subtotal,
    shippingCost: saved?.shipping_cost ?? order.shippingCost, total: saved?.total ?? order.total, appliedRules: saved?.applied_rules ?? order.appliedRules,
  } };
}

export async function updateOrderStatus(input: any, authorization?: string, env: Env = process.env) {
  const admin = client(env);
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "Sesión requerida." };
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return { ok: false, status: 401, error: "Sesión inválida." };
  const { data: store } = await admin.from("stores").select("id").eq("id", input.storeId).eq("owner_id", authData.user.id).maybeSingle();
  if (!store) return { ok: false, status: 403, error: "No tienes permiso para modificar este pedido." };
  if (input.action === "delete") {
    const { data, error } = await admin.from("orders").delete().eq("id", input.orderId).eq("store_id", store.id).select("id").maybeSingle();
    if (error) return { ok: false, status: 409, error: error.message };
    return data ? { ok: true, status: 200, orderId: data.id } : { ok: false, status: 404, error: "Pedido no encontrado." };
  }
  if (!["new", "confirmed", "preparing", "delivered", "cancelled"].includes(input.status)) return { ok: false, status: 400, error: "Estado inválido." };
  const { data, error } = await admin.from("orders").update({ status: input.status, updated_at: new Date().toISOString() })
    .eq("id", input.orderId).eq("store_id", store.id).select("id").maybeSingle();
  if (error) return { ok: false, status: 409, error: error.message };
  if (!data) return { ok: false, status: 404, error: "Pedido no encontrado." };
  return { ok: true, status: 200, orderId: data.id };
}
