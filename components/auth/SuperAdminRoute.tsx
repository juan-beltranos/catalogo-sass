import React from "react";
import { useAuth } from "@/context/AuthContext";

export const SUPER_ADMIN_EMAIL = "inteliasb@gmail.com";

const SuperAdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) return <div className="min-h-screen grid place-items-center text-gray-500">Verificando acceso...</div>;
  if (!user || user.email?.trim().toLowerCase() !== SUPER_ADMIN_EMAIL) {
    return (
      <main className="min-h-screen grid place-items-center bg-gray-50 p-4">
        <section className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600"><i className="fa-solid fa-lock" /></div>
          <h1 className="mt-4 text-xl font-black text-gray-900">Acceso restringido</h1>
          <p className="mt-2 text-sm text-gray-600">Este panel solo está disponible para el superadministrador.</p>
          <div className="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
            Sesión actual: <b>{user?.email || "sin iniciar sesión"}</b>
          </div>
          <p className="mt-3 text-xs text-gray-500">Debes iniciar sesión con: {SUPER_ADMIN_EMAIL}</p>
          <a href="/#/admin/login" className="mt-5 inline-flex rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Ir al inicio de sesión</a>
        </section>
      </main>
    );
  }

  return <>{children}</>;
};

export default SuperAdminRoute;
