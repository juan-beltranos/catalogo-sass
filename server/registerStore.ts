import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import ws from "ws";

type Env = Record<string, string | undefined>;

const LATAM_COUNTRY_CODES = new Set([
  "AR", "BO", "BR", "CL", "CO", "CR", "CU", "DO", "EC", "SV", "GT",
  "HT", "HN", "MX", "NI", "PA", "PY", "PE", "PR", "UY", "VE",
]);

export type RegisterStoreInput = {
  adminName?: unknown;
  email?: unknown;
  password?: unknown;
  storeName?: unknown;
  storeSlug?: unknown;
  businessType?: unknown;
  city?: unknown;
  countryCode?: unknown;
  whatsapp?: unknown;
  address?: unknown;
  source?: unknown;
};

export type RegisterStoreResult =
  | { ok: true; userId: string; storeId: string }
  | { ok: false; status: number; code: string; message: string };

const required = (env: Env, name: string) => {
  const value = env[name];
  if (!value) {
    const error = new Error(`Missing env ${name}`);
    (error as any).code = "missing_env";
    throw error;
  }
  return value;
};

const getAdminClient = (env: Env) =>
  createClient(
    env.VITE_PUBLIC_SUPABASE_URL || required(env, "VITE_SUPABASE_URL"),
    required(env, "SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      realtime: {
        transport: ws,
      },
    },
  );

const slugify = (input: string) =>
  input
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

const toErrorMessage = (error: any) =>
  String(error?.message || error || "").toLowerCase();

const validationError = (code: string, message: string): RegisterStoreResult => ({
  ok: false,
  status: 400,
  code,
  message,
});

const getUnknownColumn = (error: any) => {
  const message = String(error?.message || "");
  return message.match(/'([^']+)' column/)?.[1] ?? null;
};

const ensureProfile = async (
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
  email: string,
  adminName: string,
  now: Date,
) => {
  const payload: Record<string, any> = {
    id: userId,
    email,
    full_name: adminName,
    display_name: adminName,
    role: "owner",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "id" });
    if (!error) return;

    const unknownColumn = getUnknownColumn(error);
    if (unknownColumn && unknownColumn in payload && unknownColumn !== "id") {
      delete payload[unknownColumn];
      continue;
    }

    if (
      "role" in payload &&
      (String(error.code) === "23514" ||
        String(error.code) === "22P02" ||
        String(error.message || "").toLowerCase().includes("user_role"))
    ) {
      delete payload.role;
      continue;
    }

    throw error;
  }

  throw new Error("No se pudo crear el perfil del usuario.");
};

export async function registerStore(input: RegisterStoreInput, env: Env): Promise<RegisterStoreResult> {
  let createdUserId: string | null = null;
  let createdStoreId: string | null = null;

  try {
    const adminName = String(input.adminName || "").trim();
    const email = String(input.email || "").trim().toLowerCase();
    const password = String(input.password || "");
    const storeName = String(input.storeName || "").trim();
    const slug = slugify(String(input.storeSlug || storeName || ""));
    const businessType = String(input.businessType || "").trim();
    const city = String(input.city || "").trim();
    const countryCode = String(input.countryCode || "CO").trim().toUpperCase();
    const whatsapp = String(input.whatsapp || "").replace(/\D/g, "");
    const address = String(input.address || "").trim();

    if (!adminName) return validationError("missing_admin_name", "Escribe tu nombre.");
    if (!email) return validationError("missing_email", "Escribe tu email.");
    if (password.length < 6) {
      return validationError("weak_password", "La contrasena debe tener minimo 6 caracteres.");
    }
    if (!storeName || !slug || !businessType || !city || !whatsapp) {
      return validationError("missing_store_data", "Completa los datos del negocio.");
    }
    if (!LATAM_COUNTRY_CODES.has(countryCode) || !/^\d{8,15}$/.test(whatsapp)) {
      return validationError("invalid_whatsapp", "El país o el número de WhatsApp no es válido.");
    }

    const supabase = getAdminClient(env);

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: adminName,
        full_name: adminName,
      },
    });

    if (authError) throw authError;
    if (!authData.user) throw new Error("No se pudo crear el usuario.");
    createdUserId = authData.user.id;

    const now = new Date();
    await ensureProfile(supabase, createdUserId, email, adminName, now);

    const { data: store, error: storeError } = await supabase
      .from("stores")
      .insert({
        id: randomUUID(),
        owner_id: createdUserId,
        contact_email: email,
        name: storeName,
        slug,
        business_type: businessType,
        city,
        whatsapp,
        address,
        status: "active",
        brand_color: "#6366f1",
        shipping_settings: { countryCode },
        checkout_fields: [],
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .select("id")
      .single();

    if (storeError) throw storeError;
    createdStoreId = store.id;

    const { error: subscriptionError } = await supabase.from("subscriptions").insert({
      store_id: store.id,
      status: "active",
      trial_ends_at: null,
      current_period_ends_at: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
    if (subscriptionError) throw subscriptionError;

    return {
      ok: true,
      userId: createdUserId,
      storeId: store.id,
    };
  } catch (error: any) {
    console.error("Error creando registro:", error);

    if (createdUserId) {
      try {
        const supabase = getAdminClient(env);
        if (createdStoreId) {
          await supabase.from("stores").delete().eq("id", createdStoreId);
        }
        await supabase.from("profiles").delete().eq("id", createdUserId);
        await supabase.auth.admin.deleteUser(createdUserId);
      } catch (cleanupError) {
        console.error("No se pudo revertir el usuario creado:", cleanupError);
      }
    }

    const message = toErrorMessage(error);
    const code = String(error?.code || "");

    if (code === "missing_env") {
      return {
        ok: false,
        status: 500,
        code: "missing_env",
        message: "Falta configurar una variable de entorno del servidor.",
      };
    }

    if (
      code === "email_exists" ||
      code === "user_already_exists" ||
      message.includes("already registered") ||
      message.includes("already been registered") ||
      message.includes("already exists")
    ) {
      return { ok: false, status: 409, code: "user_already_exists", message: "Ese correo ya esta registrado." };
    }

    if (code === "23505" || message.includes("duplicate key")) {
      return { ok: false, status: 409, code: "duplicate_store", message: "El slug de la tienda ya esta en uso." };
    }

    if (code === "validation_failed" || message.includes("invalid email")) {
      return { ok: false, status: 400, code: "invalid_email", message: "El correo no es valido." };
    }

    return {
      ok: false,
      status: 500,
      code: code || "internal_error",
      message: error?.message || "No se pudo crear la cuenta/tienda.",
    };
  }
}
