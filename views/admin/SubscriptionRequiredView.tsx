import React from "react";
import { useAuth } from "@/context/AuthContext";
import { useSubscriptionAccess } from "@/hooks/useSubscriptionAccess";
import { Link } from "react-router-dom";

const PAYMENT_URL = import.meta.env.VITE_LOCAL_GO_PAYMENT_URL || "";

const SubscriptionRequiredView: React.FC = () => {
  const { user } = useAuth();
  const { endAt, refresh, loading } = useSubscriptionAccess();
  const paymentUrl = PAYMENT_URL
    ? `${PAYMENT_URL}${PAYMENT_URL.includes("?") ? "&" : "?"}reference=${encodeURIComponent(user?.email || "")}`
    : "";
  return (
    <main className="min-h-screen bg-slate-50 grid place-items-center p-6">
      <section className="w-full max-w-lg rounded-3xl bg-white border border-slate-200 shadow-xl p-8 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-indigo-100 text-indigo-700 text-2xl"><i className="fa-solid fa-lock" /></div>
        <h1 className="mt-6 text-3xl font-bold text-slate-900">Suscripción requerida</h1>
        <p className="mt-3 text-slate-600">Tu periodo de prueba o plan terminó. Activa tu suscripción para recuperar el acceso a todos los módulos.</p>
        {endAt && <p className="mt-3 text-sm text-slate-500">Acceso vencido: {new Intl.DateTimeFormat("es-CO", { dateStyle: "long" }).format(new Date(endAt))}</p>}
        <a href={paymentUrl || undefined} target="_blank" rel="noopener noreferrer"
          aria-disabled={!paymentUrl}
          className={`mt-7 flex w-full items-center justify-center rounded-xl px-5 py-3 font-semibold text-white ${paymentUrl ? "bg-indigo-600 hover:bg-indigo-700" : "bg-slate-400 cursor-not-allowed"}`}>
          Suscribirme<i className="fa-solid fa-arrow-up-right-from-square ml-2" />
        </a>
        {!paymentUrl && <p className="mt-2 text-xs text-red-600">Falta configurar VITE_LOCAL_GO_PAYMENT_URL.</p>}
        <Link to="/admin/subscription" className="mt-4 block text-sm font-semibold text-indigo-700 hover:underline">
          Ver detalles y opciones de pago
        </Link>
        <button type="button" onClick={refresh} disabled={loading} className="mt-4 text-sm font-semibold text-indigo-700 hover:underline disabled:opacity-50">Ya pagué, verificar de nuevo</button>
      </section>
    </main>
  );
};
export default SubscriptionRequiredView;
