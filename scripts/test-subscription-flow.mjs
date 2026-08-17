import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const baseUrl = process.env.TEST_APP_URL || "http://127.0.0.1:3000";
const supabaseUrl = process.env.VITE_PUBLIC_SUPABASE_URL;
const anonKey = process.env.VITE_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const webhookSecret = process.env.MAKE_WEBHOOK_SECRET;

if (!supabaseUrl || !anonKey || !serviceKey || !webhookSecret) {
  throw new Error("Faltan variables de entorno para la prueba integral.");
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: ws },
});
const visitor = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: ws },
});

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = `codex-subscription-${runId}@example.com`;
const password = `Test-${runId}!`;
const slug = `codex-subscription-${runId}`;
let userId;
let storeId;
const results = [];

const check = (name, condition, details = undefined) => {
  results.push({
    test: name,
    status: condition ? "PASS" : "FAIL",
    ...(condition || !details ? {} : { details }),
  });
};

const requestJson = async (path, init) => {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} devolvió ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
};

const loadSubscription = async () => {
  const { data, error } = await admin
    .from("subscriptions")
    .select("subscription_status, subscription_end_at, trial_start_at, plan, registration_type")
    .eq("store_id", storeId)
    .single();
  if (error) throw error;
  return data;
};

const loadPublicStore = async () => {
  const { data, error } = await visitor.rpc("get_public_catalog_store", { p_slug: slug });
  if (error) throw error;
  return data;
};

try {
  const registration = await requestJson("/api/register-store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      adminName: "Codex Integration Test",
      email,
      password,
      storeName: `Codex Test ${runId}`,
      storeSlug: slug,
      businessType: "Pruebas",
      city: "Bogotá",
      countryCode: "CO",
      whatsapp: "3001234567",
      address: "Dirección de prueba",
      token: "basic-ssdfg-123654-asadfsf-987878",
    }),
  });
  userId = registration.userId;
  storeId = registration.storeId;
  check("registro por token", registration.registrationType === "token");

  let subscription = await loadSubscription();
  check("plan base creado", subscription.plan === "basic");
  check("sin suscripción mensual pagada", subscription.registration_type === "token");

  let publicStore = await loadPublicStore();
  check("catálogo disponible desde el registro", publicStore?.catalogAccess === true);

  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const { error: ageError } = await admin
    .from("subscriptions")
    .update({ trial_start_at: eightDaysAgo, updated_at: new Date().toISOString() })
    .eq("store_id", storeId);
  if (ageError) throw ageError;
  subscription = await loadSubscription();
  check("habilitación del pago después de 7 días", Date.parse(subscription.trial_start_at) <= Date.now() - 7 * 86400000);

  const paymentOne = await requestJson("/api/activate-subscription", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${webhookSecret}`,
    },
    body: JSON.stringify({ event_id: `codex-payment-1-${runId}`, store_id: storeId, amount: 50000, currency: "COP" }),
  });
  check("webhook de pago aprobado", paymentOne.ok === true && paymentOne.duplicate === false);

  subscription = await loadSubscription();
  check("módulos habilitados tras pago", subscription.subscription_status === "active" && subscription.registration_type === "paid");
  check("vigencia de 30 días creada", Date.parse(subscription.subscription_end_at) > Date.now() + 29 * 86400000);

  const duplicate = await requestJson("/api/activate-subscription", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${webhookSecret}`,
    },
    body: JSON.stringify({ event_id: `codex-payment-1-${runId}`, store_id: storeId, amount: 50000, currency: "COP" }),
  });
  check("pago idempotente", duplicate.duplicate === true);

  const { error: expiryError } = await admin
    .from("subscriptions")
    .update({
      subscription_status: "past_due",
      subscription_end_at: new Date(Date.now() - 86400000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("store_id", storeId);
  if (expiryError) throw expiryError;
  subscription = await loadSubscription();
  check("bloqueo por falta de pago", subscription.subscription_status === "past_due" && Date.parse(subscription.subscription_end_at) < Date.now());

  publicStore = await loadPublicStore();
  check("catálogo permanece tras vencimiento", publicStore?.catalogAccess === true);

  const renewal = await requestJson("/api/activate-subscription", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${webhookSecret}`,
    },
    body: JSON.stringify({ event_id: `codex-payment-2-${runId}`, store_id: storeId, amount: 50000, currency: "COP" }),
  });
  check("renovación aprobada", renewal.ok === true && renewal.duplicate === false);
  subscription = await loadSubscription();
  check("módulos rehabilitados tras renovación", subscription.subscription_status === "active" && Date.parse(subscription.subscription_end_at) > Date.now());

  const ok = results.every((result) => result.status === "PASS");
  console.log(JSON.stringify({ ok, email, password, slug, results }, null, 2));
  if (!ok) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ ok: false, email, password, slug, results, error: error.message }, null, 2));
  process.exitCode = 1;
} finally {
  if (storeId) await admin.from("stores").delete().eq("id", storeId);
  if (userId) {
    await admin.from("profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId);
  }
}
