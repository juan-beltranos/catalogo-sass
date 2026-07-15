import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

export type SubscriptionAccess = {
  loading: boolean;
  allowed: boolean;
  status: "trial" | "active" | "past_due" | "canceled" | null;
  endAt: string | null;
  plan: "trial" | "basic" | "pro" | "premium" | "subscription" | null;
  registrationType: "trial" | "token" | "paid" | null;
  restrictedModules: boolean;
  productLimit: number | null;
  categoryLimit: number | null;
  tokenIntroActive: boolean;
  error: string | null;
  refresh: () => void;
};

export function useSubscriptionAccess(): SubscriptionAccess {
  const { user, loading: authLoading } = useAuth();
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<Omit<SubscriptionAccess, "refresh">>({
    loading: true, allowed: false, status: null, endAt: null, plan: null, registrationType: null,
    restrictedModules: false, productLimit: null, categoryLimit: null, tokenIntroActive: false, error: null,
  });

  useEffect(() => {
    let active = true;
    if (authLoading) return;
    if (!user) {
      setState({ loading: false, allowed: false, status: null, endAt: null, plan: null, registrationType: null, restrictedModules: false, productLimit: null, categoryLimit: null, tokenIntroActive: false, error: null });
      return;
    }
    setState((current) => ({ ...current, loading: true, error: null }));
    (async () => {
      const { data: store, error: storeError } = await supabase
        .from("stores").select("id").eq("owner_id", user.uid).limit(1).maybeSingle();
      if (storeError) throw storeError;
      if (!store) throw new Error("No hay una tienda asociada a este usuario.");
      const { data, error } = await supabase.from("subscriptions")
        .select("subscription_status, subscription_end_at, trial_start_at, plan, registration_type")
        .eq("store_id", store.id).maybeSingle();
      if (error) throw error;
      const status = (data?.subscription_status ?? null) as SubscriptionAccess["status"];
      const endAt = data?.subscription_end_at ?? null;
      // Un plan activo se permite hasta su fecha final; un trial solo mientras no expire.
      const hasTime = Boolean(endAt) && Date.parse(endAt) > Date.now();
      const allowed = (status === "active" || status === "trial") && hasTime;
      const plan = (data?.plan ?? (status === "trial" ? "trial" : null)) as SubscriptionAccess["plan"];
      const registrationType = (data?.registration_type ?? (status === "trial" ? "trial" : "paid")) as SubscriptionAccess["registrationType"];
      const restrictedModules = registrationType === "token";
      const productLimit = plan === "basic" ? 30 : plan === "pro" ? 200 : null;
      const categoryLimit = plan === "basic" ? 3 : plan === "pro" ? 6 : null;
      const registeredAt = data?.trial_start_at ? Date.parse(data.trial_start_at) : 0;
      const tokenIntroActive = restrictedModules && registeredAt > 0 && Date.now() < registeredAt + 7 * 24 * 60 * 60 * 1000;
      if (active) setState({ loading: false, allowed, status, endAt, plan, registrationType, restrictedModules, productLimit, categoryLimit, tokenIntroActive, error: null });
    })().catch((error) => {
      console.error("Error verificando suscripcion:", error);
      if (active) setState({ loading: false, allowed: false, status: null, endAt: null, plan: null, registrationType: null, restrictedModules: false, productLimit: null, categoryLimit: null, tokenIntroActive: false, error: error.message });
    });
    return () => { active = false; };
  }, [authLoading, user?.uid, version]);

  return { ...state, refresh: () => setVersion((value) => value + 1) };
}
