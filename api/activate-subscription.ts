import { createClient } from "@supabase/supabase-js";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
};

const getAdminClient = () =>
  createClient(
    required("VITE_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

const getFutureDate = (value: any, now: Date): Date | null => {
  if (!value) return null;
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date > now ? date : null;
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Metodo no permitido" });
    return;
  }

  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) {
      res.status(400).json({ ok: false, message: "El campo email es obligatorio" });
      return;
    }

    const supabase = getAdminClient();
    const { data: store, error: storeError } = await supabase
      .from("stores")
      .select("*")
      .eq("ownerEmail", email)
      .limit(1)
      .maybeSingle();

    if (storeError) throw storeError;
    if (!store) {
      res.status(404).json({
        ok: false,
        message: "No se encontro una tienda asociada a este correo",
      });
      return;
    }

    const now = new Date();
    const currentSubscriptionEndDate = getFutureDate(store.subscriptionEndAt, now);
    const currentTrialEndDate =
      getFutureDate(store.trialEndsAt, now) || getFutureDate(store.trialEndsAtMs, now);
    const baseDate =
      currentSubscriptionEndDate ||
      (store.hasFreeTrial === true &&
      store.freeTrialStatus === "active" &&
      currentTrialEndDate
        ? currentTrialEndDate
        : now);
    const newEndDate = new Date(baseDate);
    newEndDate.setMonth(newEndDate.getMonth() + 1);

    const updatePayload = {
      hasActiveSubscription: true,
      subscriptionType: "subscription",
      subscriptionStatus: "active",
      subscriptionStartAt: now.toISOString(),
      subscriptionEndAt: newEndDate.toISOString(),
      subscriptionLastPaymentAt: now.toISOString(),
      freeTrialStatus:
        store.hasFreeTrial === true ? "converted" : store.freeTrialStatus ?? null,
      ownerEmail: email,
      updatedAt: now.toISOString(),
    };

    const { error: updateError } = await supabase
      .from("stores")
      .update(updatePayload)
      .eq("id", store.id);
    if (updateError) throw updateError;

    const { data: payment, error: paymentError } = await supabase
      .from("subscriptionPayments")
      .insert({
        email,
        ownerUid: store.ownerUid ?? null,
        storeId: store.id,
        status: "approved",
        type: "monthly_subscription",
        hadFreeTrial: store.hasFreeTrial === true,
        previousFreeTrialStatus: store.freeTrialStatus ?? null,
        previousTrialEndsAt: store.trialEndsAt ?? null,
        previousTrialEndsAtMs: store.trialEndsAtMs ?? null,
        createdAt: now.toISOString(),
        subscriptionStartAt: now.toISOString(),
        subscriptionBaseDate: baseDate.toISOString(),
        subscriptionEndAt: newEndDate.toISOString(),
      })
      .select("id")
      .single();
    if (paymentError) throw paymentError;

    res.status(200).json({
      ok: true,
      message: "Suscripcion activada correctamente",
      storeId: store.id,
      subscriptionStartAt: now,
      subscriptionBaseDate: baseDate,
      subscriptionEndAt: newEndDate,
      paymentId: payment.id,
    });
  } catch (error: any) {
    console.error("Error activando suscripcion:", error);
    res.status(500).json({ ok: false, message: "Error interno del servidor" });
  }
}
