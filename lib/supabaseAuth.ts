import { supabase } from "./supabase";

export type User = {
  uid: string;
  id: string;
  email: string | null;
  displayName: string | null;
  user_metadata?: Record<string, any>;
};

const mapUser = (user: any | null): User | null => {
  if (!user) return null;
  return {
    uid: user.id,
    id: user.id,
    email: user.email ?? null,
    displayName:
      user.user_metadata?.display_name ??
      user.user_metadata?.full_name ??
      user.user_metadata?.name ??
      null,
    user_metadata: user.user_metadata ?? {},
  };
};

export const onAuthStateChanged = (
  _auth: unknown,
  callback: (user: User | null) => void,
) => {
  let active = true;

  supabase.auth.getUser().then(({ data }) => {
    if (active) callback(mapUser(data.user));
  });

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(mapUser(session?.user ?? null));
  });

  return () => {
    active = false;
    data.subscription.unsubscribe();
  };
};

export const createUserWithEmailAndPassword = async (
  _auth: unknown,
  email: string,
  password: string,
  displayName?: string,
) => {
  const cleanDisplayName = displayName?.trim();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: cleanDisplayName
      ? {
          data: {
            display_name: cleanDisplayName,
            full_name: cleanDisplayName,
          },
        }
      : undefined,
  });
  if (error) {
    if (
      error.status === 429 ||
      error.code === "over_email_send_rate_limit" ||
      error.code === "email_rate_limit_exceeded" ||
      error.message.toLowerCase().includes("rate limit")
    ) {
      error.message = "Supabase limitó temporalmente los correos de registro. Espera unos minutos e intenta de nuevo.";
    }
    throw error;
  }
  if (!data.user) throw new Error("No se pudo crear el usuario.");
  return { user: mapUser(data.user)!, session: data.session };
};

export const signInWithEmailAndPassword = async (
  _auth: unknown,
  email: string,
  password: string,
) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  if (!data.user) throw new Error("No se pudo iniciar sesion.");
  return { user: mapUser(data.user)! };
};

export const sendPasswordResetEmail = async (_auth: unknown, email: string) => {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  if (error) throw error;
};

export const updateProfile = async (
  _user: User,
  profile: { displayName?: string | null },
) => {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    return {
      ..._user,
      displayName: profile.displayName ?? _user.displayName,
      user_metadata: {
        ..._user.user_metadata,
        display_name: profile.displayName ?? "",
        full_name: profile.displayName ?? "",
      },
    };
  }

  const { data, error } = await supabase.auth.updateUser({
    data: {
      display_name: profile.displayName ?? "",
      full_name: profile.displayName ?? "",
    },
  });
  if (error) throw error;
  return mapUser(data.user);
};

export const signOut = async (_auth?: unknown) => {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};
