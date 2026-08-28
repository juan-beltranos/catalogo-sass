import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const baseUrl = process.env.TEST_APP_URL || "http://127.0.0.1:3000";
const admin = createClient(process.env.VITE_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, realtime: { transport: ws } });
const visitor = createClient(process.env.VITE_PUBLIC_SUPABASE_URL, process.env.VITE_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false }, realtime: { transport: ws } });
const secret = process.env.MAKE_WEBHOOK_SECRET;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
let storeId; let userId; const results = [];
const check = (test, condition, details) => { results.push({ test, status: condition ? "PASS" : "FAIL", ...(!condition && details ? { details } : {}) }); };
const request = async (path, body, authorization) => { const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(body) }); const json = await response.json().catch(() => ({})); return { response, json }; };

try {
  const registration = await request("/api/register-store", { adminName: "Prueba módulos", email: `modules-${runId}@example.com`, password: `Test-${runId}!`, storeName: `Módulos ${runId}`, storeSlug: `modules-${runId}`, businessType: "Pruebas", city: "Bogotá", countryCode: "CO", whatsapp: "3001234567", address: "Prueba", token: "basic-ssdfg-123654-asadfsf-987878" });
  if (!registration.response.ok) throw new Error(`Registro: ${JSON.stringify(registration.json)}`);
  storeId = registration.json.storeId; userId = registration.json.userId;

  let access = await visitor.rpc("has_paid_monthly_access", { p_store_id: storeId });
  check("módulos públicos ocultos sin mensualidad", access.data === false && !access.error, access.error?.message);

  const payment = await request("/api/activate-subscription", { event_id: `modules-payment-${runId}`, store_id: storeId, amount: 50000, currency: "COP" }, `Bearer ${secret}`);
  check("activación mensual", payment.response.ok && payment.json.ok === true, JSON.stringify(payment.json));
  access = await visitor.rpc("has_paid_monthly_access", { p_store_id: storeId });
  check("módulos públicos habilitados con mensualidad", access.data === true && !access.error, access.error?.message);

  const categoryId = crypto.randomUUID();
  const productA = crypto.randomUUID(); const productB = crypto.randomUUID();
  const kitId = crypto.randomUUID(); const couponId = crypto.randomUUID();
  let operation = await admin.from("categories").insert({ id: categoryId, store_id: storeId, name: "Prueba kits", sort_order: 0 });
  if (operation.error) throw operation.error;
  operation = await admin.from("products").insert([
    { id: productA, store_id: storeId, category_id: categoryId, category_ids: [categoryId], name: "Producto A", base_price: 10000, is_active: true },
    { id: productB, store_id: storeId, category_id: categoryId, category_ids: [categoryId], name: "Producto B", base_price: 8000, is_active: true },
  ]); if (operation.error) throw operation.error;
  operation = await admin.from("product_kits").insert({ id: kitId, store_id: storeId, name: "Kit prueba", price: 15000, compare_at_price: 18000, active: true, category_ids: [categoryId] }); if (operation.error) throw operation.error;
  operation = await admin.from("product_kit_items").insert([{ kit_id: kitId, store_id: storeId, product_id: productA, quantity: 1, sort_order: 0 }, { kit_id: kitId, store_id: storeId, product_id: productB, quantity: 1, sort_order: 1 }]); if (operation.error) throw operation.error;
  operation = await admin.from("coupons").insert({ id: couponId, store_id: storeId, code: "PRUEBA10", discount_type: "percent", discount_value: 10, minimum_subtotal: 10000, active: true }); if (operation.error) throw operation.error;

  const publicKits = await visitor.from("product_kits").select("id,category_ids,product_kit_items(product_id,quantity)").eq("store_id", storeId);
  check("kit público con productos y categoría", !publicKits.error && publicKits.data?.length === 1 && publicKits.data[0].category_ids.includes(categoryId) && publicKits.data[0].product_kit_items.length === 2, publicKits.error?.message);
  const coupon = await visitor.rpc("validate_catalog_coupon", { p_store_id: storeId, p_code: "prueba10", p_subtotal: 15000 });
  check("cupón público válido y normalizado", coupon.data?.valid === true && coupon.data?.code === "PRUEBA10" && Number(coupon.data?.discount) === 1500, coupon.error?.message || JSON.stringify(coupon.data));

  const orderId = crypto.randomUUID();
  const placed = await request("/api/public-order", { storeId, order: { id: orderId, customer: { name: "Cliente prueba", phone: "3001234567", address: "Dirección" }, customFields: [], items: [{ itemType: "kit", kitId, productId: kitId, productName: "Precio manipulado", unitPrice: 1, qty: 1 }], couponCode: "PRUEBA10", shippingMethod: null } });
  check("pedido con kit y cupón aceptado", placed.response.ok && placed.json.ok === true, JSON.stringify(placed.json));
  check("precio del kit recalculado en servidor", Number(placed.json?.calculation?.originalSubtotal) === 15000 && Number(placed.json?.calculation?.total) === 13500, JSON.stringify(placed.json?.calculation));
  const savedItems = await admin.from("order_items").select("product_id,kit_id,unit_price,total").eq("order_id", orderId);
  check("pedido guarda referencia al kit", !savedItems.error && savedItems.data?.[0]?.kit_id === kitId && savedItems.data?.[0]?.product_id === null && Number(savedItems.data?.[0]?.unit_price) === 15000, savedItems.error?.message);

  await admin.from("subscriptions").update({ subscription_status: "past_due", subscription_end_at: new Date(Date.now() - 60000).toISOString() }).eq("store_id", storeId);
  access = await visitor.rpc("has_paid_monthly_access", { p_store_id: storeId });
  const hiddenKits = await visitor.from("product_kits").select("id").eq("store_id", storeId);
  const blockedCoupon = await visitor.rpc("validate_catalog_coupon", { p_store_id: storeId, p_code: "PRUEBA10", p_subtotal: 15000 });
  check("módulos se ocultan al vencer", access.data === false && hiddenKits.data?.length === 0 && blockedCoupon.data?.valid === false, JSON.stringify({ access: access.data, kits: hiddenKits.data, coupon: blockedCoupon.data }));
  const blockedOrder = await request("/api/public-order", { storeId, order: { id: crypto.randomUUID(), customer: { name: "Cliente", phone: "3009876543", address: "Dirección" }, customFields: [], items: [{ itemType: "kit", kitId, productId: kitId, productName: "Kit prueba", unitPrice: 15000, qty: 1 }], shippingMethod: null } });
  check("pedido antiguo con kit se rechaza tras vencer", blockedOrder.response.status === 400 && blockedOrder.json?.ok === false, JSON.stringify(blockedOrder.json));

  const ok = results.every((item) => item.status === "PASS"); console.log(JSON.stringify({ ok, results }, null, 2)); if (!ok) process.exitCode = 1;
} catch (error) { console.error(JSON.stringify({ ok: false, results, error: error.message }, null, 2)); process.exitCode = 1; }
finally { if (storeId) await admin.from("stores").delete().eq("id", storeId); if (userId) { await admin.from("profiles").delete().eq("id", userId); await admin.auth.admin.deleteUser(userId); } }
