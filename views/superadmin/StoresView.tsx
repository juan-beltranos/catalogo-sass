import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { getCatalogShareUrl } from "@/helpers/catalogLinks";
import { getSubscriptionPlanLimits, type SubscriptionPlan } from "@/helpers/subscriptionPlanLimits";

type Store = {
  id: string; name: string; slug: string; logoUrl: string; ownerUid: string; ownerEmail: string;
  whatsapp: string; address: string; city: string; businessType: string; source: string;
  isActive: boolean; createdAt: string; updatedAt: string; plan: SubscriptionPlan;
  registrationType: string | null; subscriptionStatus: string; endAt: string | null;
  hasActiveSubscription: boolean; orders: number; products: number; clients: number; categories: number; lastOrderAt: string | null;
};
type Summary = { stores: number; active: number; orders: number; products: number; clients: number; paid: number; paidActive: number };
const plans = { trial: "Prueba", basic: "Basic", pro: "Pro", premium: "Premium", subscription: "Suscripción completa" };
const date = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(new Date(value)) : "Sin registro";
const monthlyLabel = (store: Store) => {
  if (store.hasActiveSubscription) return `Mensualidad vigente hasta ${date(store.endAt)}`;
  if (store.registrationType !== "paid") return "Sin mensualidad contratada";
  if (store.subscriptionStatus === "canceled") return "Mensualidad cancelada";
  if (store.endAt && Date.parse(store.endAt) <= Date.now()) return `Mensualidad vencida el ${date(store.endAt)}`;
  return "Mensualidad pendiente de activación";
};
const number = (value: number) => new Intl.NumberFormat("es-CO").format(value);
const PAGE_SIZE = 12;
const field = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100";
const button = "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50";
const Logo = ({ store }: { store: Store }) => {
  const [failed, setFailed] = useState(false);
  return <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-100 bg-indigo-50 text-lg font-bold text-indigo-600">{store.logoUrl && !failed ? <img src={store.logoUrl} alt={`Logo de ${store.name}`} className="h-full w-full object-contain" onError={() => setFailed(true)} /> : store.name.slice(0, 2).toUpperCase()}</div>;
};
const Detail = ({ label, value }: { label: string; value?: string | null }) => <div className="min-w-0 rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm font-medium text-slate-800">{value || "Sin registro"}</dd></div>;

const planStyles: Record<string, { badge: string; strip: string; icon: string }> = {
  basic: { badge: "bg-sky-50 text-sky-700 ring-sky-100", strip: "from-sky-400 to-cyan-300", icon: "fa-layer-group" },
  pro: { badge: "bg-indigo-50 text-indigo-700 ring-indigo-100", strip: "from-indigo-500 to-violet-400", icon: "fa-bolt" },
  premium: { badge: "bg-amber-50 text-amber-800 ring-amber-100", strip: "from-amber-400 to-orange-300", icon: "fa-crown" },
  subscription: { badge: "bg-emerald-50 text-emerald-700 ring-emerald-100", strip: "from-emerald-500 to-teal-300", icon: "fa-gem" },
  trial: { badge: "bg-slate-100 text-slate-600 ring-slate-200", strip: "from-slate-400 to-slate-200", icon: "fa-hourglass-half" },
};

function StoreCard({ store, onOpen, onCopy }: {
  store: Store;
  onOpen: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onCopy: () => void;
}) {
  const theme = planStyles[store.plan || "trial"] || planStyles.trial;
  const limit = getSubscriptionPlanLimits(store.plan).products;
  const expired = store.registrationType === "paid" && !store.hasActiveSubscription;
  const metrics = [
    { label: "Pedidos", value: store.orders, icon: "fa-bag-shopping", color: "text-indigo-500" },
    { label: "Productos", value: store.products, icon: "fa-box", color: "text-sky-500" },
    { label: "Clientes", value: store.clients, icon: "fa-users", color: "text-violet-500" },
    { label: "Categorías", value: store.categories, icon: "fa-shapes", color: "text-amber-500" },
  ];
  return (
    <article className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition duration-200 hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-950/5 motion-reduce:transition-none">
      <div className={`h-1 w-full bg-gradient-to-r ${theme.strip}`} />
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5 sm:px-6">
        <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold ring-1 ring-inset ${theme.badge}`}>
          <i className={`fa-solid ${theme.icon}`} aria-hidden="true" />
          {store.plan ? plans[store.plan] : "Sin plan"}
        </span>
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${store.isActive ? "text-emerald-700" : "text-slate-500"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${store.isActive ? "bg-emerald-500" : "bg-slate-400"}`} />
          {store.isActive ? "Tienda activa" : "Tienda inactiva"}
        </span>
      </div>
      <div className="flex items-center gap-3 px-5 pb-5 pt-5 sm:gap-4 sm:px-6">
        <div className="shrink-0 rounded-[20px] bg-white p-1.5 ring-1 ring-slate-100 shadow-sm"><Logo store={store} /></div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-base font-bold leading-snug tracking-tight text-slate-900 sm:text-lg">{store.name}</h3>
          <p className="mt-1 truncate text-xs text-slate-500" title={store.ownerEmail}>{store.ownerEmail || "Sin correo registrado"}</p>
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-400"><i className="fa-solid fa-location-dot mt-0.5" aria-hidden="true" /><span className="break-words">{[store.businessType, store.city].filter(Boolean).join(" · ") || "Ubicación sin registrar"}</span></p>
        </div>
      </div>
      <dl className="mx-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-100 bg-slate-100 sm:mx-6 sm:grid-cols-4">
        {metrics.map(metric => <div key={metric.label} className="bg-slate-50/90 px-3 py-3.5">
          <dt className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500"><i className={`fa-solid ${metric.icon} ${metric.color}`} aria-hidden="true" />{metric.label}</dt>
          <dd className="mt-1.5 text-xl font-bold tracking-tight text-slate-800 tabular-nums">{number(metric.value)}</dd>
        </div>)}
      </dl>
      <div className="mx-5 mb-5 mt-4 sm:mx-6">
        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500"><span>Capacidad de productos</span><span className="font-semibold text-slate-600">{limit ? `${number(store.products)} / ${number(limit)}` : "Sin límite"}</span></div>
        {limit && <div role="progressbar" aria-label={`Uso de productos de ${store.name}`} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(store.products, limit)} aria-valuetext={`${store.products} de ${limit} productos`} className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${store.products >= limit ? "bg-amber-400" : "bg-indigo-400"}`} style={{ width: `${Math.min(100, store.products / limit * 100)}%` }} /></div>}
      </div>
      <div className={`mx-5 mb-5 flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-xs sm:mx-6 ${store.hasActiveSubscription ? "bg-emerald-50 text-emerald-700" : expired ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-500"}`}>
        <i className={`fa-solid mt-0.5 ${store.hasActiveSubscription ? "fa-circle-check" : expired ? "fa-circle-exclamation" : "fa-credit-card"}`} aria-hidden="true" />
        <span className="leading-relaxed">{monthlyLabel(store)}</span>
      </div>
      <div className="mt-auto border-t border-slate-100 bg-slate-50/50 px-5 py-4 sm:px-6">
        <p className="mb-3 flex items-center gap-1.5 text-[11px] text-slate-400"><i className="fa-regular fa-clock" aria-hidden="true" />{store.lastOrderAt ? `Último pedido · ${date(store.lastOrderAt)}` : "Todavía no tiene pedidos"}</p>
        <div className="flex gap-2">
          <button onClick={onOpen} className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"><span>Gestionar tienda</span><i className="fa-solid fa-arrow-right text-xs transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" /></button>
          {store.slug && <>
            <a className={`${button} !px-3 text-slate-500 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`} href={getCatalogShareUrl(store.slug)} target="_blank" rel="noreferrer" title="Abrir catálogo" aria-label={`Abrir tienda ${store.name}`}><i className="fa-solid fa-arrow-up-right-from-square" /></a>
            <button className={`${button} !px-3 text-slate-500 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`} title="Copiar enlace" aria-label={`Copiar enlace de ${store.name}`} onClick={onCopy}><i className="fa-regular fa-copy" /></button>
          </>}
        </div>
      </div>
    </article>
  );
}

export default function StoresView() {
  const [stores, setStores] = useState<Store[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [total, setTotal] = useState(0), [page, setPage] = useState(1);
  const [search, setSearch] = useState(""), [term, setTerm] = useState("");
  const [status, setStatus] = useState("all"), [plan, setPlan] = useState("all");
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Store | null>(null), [draft, setDraft] = useState("");
  const [version, setVersion] = useState(0);
  const requestId = useRef(0), opener = useRef<HTMLButtonElement | null>(null), dialog = useRef<HTMLDivElement | null>(null);
  const request = useCallback(async (payload: Record<string, unknown>) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("La sesión expiró. Inicia sesión nuevamente.");
    const response = await fetch("/api/admin-stores", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo completar la operación.");
    return result;
  }, []);
  useEffect(() => { const timer = setTimeout(() => { setTerm(search); setPage(1); }, 350); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true); setError("");
    request({ action: "list", page, pageSize: PAGE_SIZE, search: term, status, plan })
      .then(result => { if (id === requestId.current) { setStores(result.stores); setSummary(result.summary); setTotal(result.total); } })
      .catch(e => { if (id === requestId.current) { setError(e.message); setStores([]); setSummary(null); setTotal(0); } })
      .finally(() => { if (id === requestId.current) setLoading(false); });
    return () => { requestId.current++; };
  }, [request, page, term, status, plan, version]);
  useEffect(() => {
    if (!selected) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) setSelected(null);
      if (e.key === "Tab") {
        const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], select:not(:disabled), [tabindex="0"]') || []);
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", handleKey); opener.current?.focus(); };
  }, [selected?.id, saving]);
  const copy = async (store: Store) => { try { await navigator.clipboard.writeText(getCatalogShareUrl(store.slug)); setNotice("Enlace copiado."); } catch { setError("No se pudo copiar el enlace."); } };
  const mutate = async (store: Store, action: "update-plan" | "update-status") => {
    if (saving) return;
    if (action === "update-status" && !window.confirm(`¿Deseas ${store.isActive ? "desactivar" : "activar"} ${store.name}?`)) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const result = await request({ action, storeId: store.id, ...(action === "update-plan" ? { plan: draft } : { isActive: !store.isActive }) });
      setSelected(current => current?.id === store.id ? { ...current, ...(action === "update-plan" ? { plan: result.subscription.plan } : { isActive: result.store.status === "active" }) } : current);
      setNotice(action === "update-plan" ? "Versión del plan actualizada. Se conservan el pago y la vigencia." : "Estado de la tienda actualizado.");
      setVersion(v => v + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); }
    finally { setSaving(false); }
  };
  const limits = getSubscriptionPlanLimits((draft || null) as SubscriptionPlan);
  const cards: [string, keyof Summary, string][] = [["Tiendas registradas", "stores", "fa-store"], ["Tiendas activas", "active", "fa-circle-check"], ["Clientes mensuales", "paid", "fa-credit-card"], ["Pedidos totales", "orders", "fa-cart-shopping"], ["Productos", "products", "fa-box"], ["Clientes", "clients", "fa-users"]];
  const feedback = <>{error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}{notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}</>;
  return <main className="min-h-screen bg-slate-50 text-slate-900"><div className="mx-auto max-w-[1500px] space-y-6 p-4 sm:p-8">
    <nav className="flex flex-wrap items-center justify-between gap-3"><Link to="/admin" className="text-sm font-semibold text-slate-600 hover:text-indigo-600"><i className="fa-solid fa-arrow-left mr-2" />Volver a mi panel</Link><span className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700"><i className="fa-solid fa-shield-halved mr-2" />Acceso de administrador</span></nav>
    <header className="flex flex-col gap-5 rounded-3xl bg-slate-900 p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-8"><div><p className="text-xs font-semibold uppercase tracking-[.2em] text-indigo-300">CatalogSaaS · Administración global</p><h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Todas tus tiendas, en un lugar</h1><p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-300">Supervisa la actividad, consulta los datos de cada negocio y administra sus versiones de plan.</p></div><button onClick={() => setVersion(v => v + 1)} disabled={loading || saving} className="self-start rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold hover:bg-white/20 disabled:opacity-50"><i className={`fa-solid fa-arrows-rotate mr-2 ${loading ? "animate-spin" : ""}`} />Actualizar datos</button></header>
    {!selected && feedback}
    <section aria-label="Métricas globales" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">{cards.map(([label, key, icon]) => <div key={key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><i className={`fa-solid ${icon} text-indigo-500`} /><p className="mt-4 text-2xl font-bold">{summary ? number(summary[key]) : "—"}</p><p className="mt-1 text-xs text-slate-500">{label}</p>{key === "paid" && summary && <p className="mt-2 text-[11px] text-slate-500">{number(summary.paidActive)} vigentes · {number(Math.max(0, summary.paid - summary.paidActive))} sin vigencia</p>}</div>)}</section>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">Directorio de tiendas</h2><span className="text-xs text-slate-500">{loading ? "Consultando…" : `${number(total)} resultados`} · Más recientes primero</span></div><div className="mt-4 grid gap-3 md:grid-cols-[1fr_180px_200px]"><label><span className="sr-only">Buscar tiendas</span><input className={field} value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por tienda, correo, ciudad o WhatsApp" /></label><label><span className="sr-only">Estado de tienda</span><select className={field} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="all">Todos los estados</option><option value="active">Activas</option><option value="inactive">Inactivas</option></select></label><label><span className="sr-only">Versión del plan</span><select className={field} value={plan} onChange={e => { setPlan(e.target.value); setPage(1); }}><option value="all">Todas las versiones</option>{Object.entries(plans).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div></div>
    {loading ? <div role="status" className="p-16 text-center text-slate-500"><i className="fa-solid fa-spinner animate-spin mr-2" />Cargando tiendas y métricas…</div> : !stores.length ? <div className="p-16 text-center text-slate-500">{error ? "No fue posible cargar las tiendas. Usa Actualizar datos para reintentar." : "No hay tiendas que coincidan con los filtros."}</div> : <div className="grid gap-5 bg-slate-50/70 p-4 sm:p-5 lg:grid-cols-2">{stores.map(store => <StoreCard key={store.id} store={store} onCopy={() => copy(store)} onOpen={e => { opener.current = e.currentTarget; setSelected(store); setDraft(store.plan || ""); setError(""); setNotice(""); }} />)}</div>}
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-4 text-sm"><span className="text-slate-500">Página {page} de {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span><div className="flex gap-2"><button className={button} disabled={loading || page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</button><button className={button} disabled={loading || page * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>Siguiente</button></div></footer></section><p className="text-xs text-slate-400">Las métricas superiores abarcan toda la plataforma. Los filtros se aplican al directorio. Los pedidos incluyen todos los estados.</p>
    {selected && <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-sm" onClick={() => { if (!saving) setSelected(null); }}><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="store-title" tabIndex={-1} className="h-full w-full max-w-2xl overflow-y-auto bg-white p-5 shadow-2xl outline-none sm:p-8" onClick={e => e.stopPropagation()}><div className="flex items-start gap-3"><Logo store={selected} /><div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">Ficha de tienda</p><h2 id="store-title" className="mt-1 break-words text-2xl font-bold">{selected.name}</h2></div><button className={button} disabled={saving} aria-label="Cerrar detalles" onClick={() => setSelected(null)}><i className="fa-solid fa-xmark" /></button></div><div className="mt-5 space-y-3">{feedback}</div><dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2"><Detail label="Correo de contacto" value={selected.ownerEmail} /><Detail label="WhatsApp" value={selected.whatsapp} /><Detail label="Tipo de negocio" value={selected.businessType} /><Detail label="Ciudad" value={selected.city} /><Detail label="Dirección" value={selected.address} /><Detail label="Origen del registro" value={selected.source} /><Detail label="Registro" value={date(selected.createdAt)} /><Detail label="Última actualización" value={date(selected.updatedAt)} /><Detail label="ID de tienda" value={selected.id} /><Detail label="ID de propietario" value={selected.ownerUid} /><Detail label="Último pedido" value={date(selected.lastOrderAt)} /><Detail label="Estado de tienda" value={selected.isActive ? "Activa" : "Inactiva"} /></dl>{selected.slug && <div className="mt-4 rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">Enlace público</p><a href={getCatalogShareUrl(selected.slug)} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm text-indigo-600 hover:underline">{getCatalogShareUrl(selected.slug)}</a><button className="mt-3 text-xs font-semibold text-indigo-600" onClick={() => copy(selected)}>Copiar enlace</button></div>}
    <section className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-5"><h3 className="font-bold">Administrar versión del plan</h3><dl className="mt-3 grid grid-cols-2 gap-3"><Detail label="Estado de suscripción" value={({ active: "Activa", trial: "Prueba", past_due: "Pago pendiente", canceled: "Cancelada", inactive: "Sin suscripción" } as Record<string, string>)[selected.subscriptionStatus] || selected.subscriptionStatus} /><Detail label="Vencimiento" value={date(selected.endAt)} /><Detail label="Modalidad" value={({ trial: "Prueba", token: "Compra de versión base", paid: "Mensualidad" } as Record<string, string>)[selected.registrationType || ""]} /><Detail label="Módulos mensuales" value={selected.hasActiveSubscription ? "Habilitados" : "Sin mensualidad vigente"} /></dl><label htmlFor="plan-version" className="mt-5 block text-sm font-semibold">Nueva versión</label><select id="plan-version" className={`${field} mt-2`} value={draft} disabled={saving || !selected.plan} onChange={e => setDraft(e.target.value)}>{!selected.plan && <option value="">Sin suscripción registrada</option>}{Object.entries(plans).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><p className="mt-3 text-xs leading-relaxed text-slate-600">{limits.products ?? "Sin límite de"} productos · {limits.categories ?? "Sin límite de"} categorías. Al bajar de versión, el contenido existente se conserva y los límites se aplican a nuevas altas.</p><p className="mt-2 text-xs leading-relaxed text-slate-500">Esta acción cambia la versión de contenido. Conserva el origen, los pagos y la fecha de vencimiento; la mensualidad se gestiona mediante el flujo de pagos existente.</p><button disabled={saving || !selected.plan || draft === selected.plan} onClick={() => mutate(selected, "update-plan")} className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? "Guardando…" : "Guardar versión del plan"}</button></section>
    <section className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 p-4"><div><h3 className="text-sm font-bold">Disponibilidad de la tienda</h3><p className="mt-1 text-xs text-slate-500">Controla el acceso al catálogo público.</p></div><button className={`${button} ${selected.isActive ? "text-red-600" : "text-emerald-700"}`} disabled={saving} onClick={() => mutate(selected, "update-status")}>{selected.isActive ? "Desactivar tienda" : "Activar tienda"}</button></section>
    </div></div>}
  </div></main>;
}
