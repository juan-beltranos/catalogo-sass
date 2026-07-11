import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "@/lib/supabaseFirestore";
import { db } from "@/lib/supabase";
import { getStoreForOwner } from "@/lib/storeLookup";
import { useAuth } from "../../context/AuthContext";
import type { Order, OrderStatus } from "@/types";
import { Store } from "@/interfaces";
import { formatCOP, relativeTime, safeDate, startOfToday } from "@/helpers";
import { getCatalogShareUrl } from "@/helpers/catalogLinks";


const statusBadge: Record<OrderStatus, { label: string; color: string }> = {
  new: { label: "Nuevo", color: "bg-yellow-100 text-yellow-800" },
  confirmed: { label: "Confirmado", color: "bg-blue-100 text-blue-800" },
  preparing: { label: "En preparación", color: "bg-indigo-100 text-indigo-800" },
  delivered: { label: "Entregado", color: "bg-green-100 text-green-800" },
  cancelled: { label: "Cancelado", color: "bg-red-100 text-red-800" },
};

// Caché en módulo: evita re-fetch al navegar entre vistas sin recargar la app.
// Se invalida manualmente si el storeId cambia.
type DashboardCache = {
  storeId: string;
  productsCount: number;
  ordersCount: number;
  clientsCount: number;
  revenueTotal: number;
  ordersToday: number;
  recentOrders: Order[];
  fetchedAt: number; // timestamp ms — TTL de 60 s para no mostrar datos obsoletos
};
let dashboardCache: DashboardCache | null = null;
const CACHE_TTL_MS = 60_000;

const StatCard: React.FC<{
  title: string;
  value: string;
  icon: string;
  color: string;
  hint?: string;
}> = ({ title, value, icon, color, hint }) => (
  <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
    <div>
      <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">
        {title}
      </p>
      <div className="flex items-baseline gap-2 mt-1">
        <p className="text-3xl font-bold text-gray-900">{value}</p>
        {hint ? (
          <span className="text-xs font-medium text-gray-600 bg-gray-50 px-2 py-0.5 rounded-full">
            {hint}
          </span>
        ) : null}
      </div>
    </div>
    <div
      className={`h-12 w-12 rounded-xl ${color} flex items-center justify-center text-white text-xl shadow-inner`}
    >
      <i className={`fa-solid ${icon}`}></i>
    </div>
  </div>
);

const DashboardView: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);

  const [productsCount, setProductsCount] = useState(0);
  const [ordersCount, setOrdersCount] = useState(0);
  const [clientsCount, setClientsCount] = useState(0);
  const [revenueTotal, setRevenueTotal] = useState(0);
  const [ordersToday, setOrdersToday] = useState(0);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);

  const catalogUrl = useMemo(() => {
    if (!store?.slug) return "";
    return getCatalogShareUrl(store.slug);
  }, [store?.slug]);

  // 1) Cargar tienda por ownerUid
  useEffect(() => {
    if (!user) return;

    const run = async () => {
      setLoading(true);
      try {
        const storeResult = await getStoreForOwner(user.uid);
        if (!storeResult) {
          setStore(null);
          setLoading(false);
          return;
        }

        const data = storeResult.data;
        setStore({
          id: storeResult.id,
          name: data.name ?? "Mi tienda",
          slug: data.slug ?? "",
          whatsapp: data.whatsapp ?? "",
          isActive: data.isActive ?? true,
        });
      } catch (e) {
        console.error(e);
        setStore(null);
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [user]);

  // 2) Cargar stats — optimizado:
  //    • Agrupa los 3 getCountFromServer en un Promise.all (1 round-trip)
  //    • Un solo getDocs(limit 5) para pedidos recientes
  //    • Un solo getDocs(limit 50) para revenue + ordersToday en lugar de 200
  //    • Caché con TTL de 60 s: navegar a otra sección y volver no genera lecturas
  useEffect(() => {
    if (!store?.id) return;

    const now = Date.now();
    const cached = dashboardCache;

    if (
      cached &&
      cached.storeId === store.id &&
      now - cached.fetchedAt < CACHE_TTL_MS
    ) {
      setProductsCount(cached.productsCount);
      setOrdersCount(cached.ordersCount);
      setClientsCount(cached.clientsCount);
      setRevenueTotal(cached.revenueTotal);
      setOrdersToday(cached.ordersToday);
      setRecentOrders(cached.recentOrders);
      return;
    }

    const run = async () => {
      try {
        const productsRef = collection(db, "stores", store.id, "products");
        const ordersRef = collection(db, "stores", store.id, "orders");
        const clientsRef = collection(db, "stores", store.id, "clients");

        // Batch: 3 counts + últimos 50 pedidos en paralelo (4 lecturas de índice)
        // Los 50 pedidos sirven tanto para "recientes" como para revenue/ordersToday.
        const qRecent = query(ordersRef, orderBy("createdAt", "desc"), limit(50));

        const [pSnap, oSnap, cSnap, ordersSnap] = await Promise.all([
          getCountFromServer(productsRef),
          getCountFromServer(ordersRef),
          getCountFromServer(clientsRef),
          getDocs(qRecent),
        ]);

        const pCount = pSnap.data().count || 0;
        const oCount = oSnap.data().count || 0;
        const cCount = cSnap.data().count || 0;

        // Pedidos recientes (solo los primeros 5 para la tabla)
        const recent: Order[] = ordersSnap.docs.slice(0, 5).map((docu) => {
          const x = docu.data() as any;
          const customer = x.customer ?? {
            name: x.customerName ?? "",
            phone: x.customerPhone ?? "",
            address: x.customerAddress ?? "",
          };
          return {
            id: docu.id,
            status: (x.status ?? "new") as OrderStatus,
            channel: x.channel ?? "whatsapp",
            customer,
            notes: x.notes ?? "",
            items: x.items ?? [],
            total: Number(x.total ?? 0),
            createdAt: x.createdAt,
            updatedAt: x.updatedAt,
          } as Order;
        });

        // Revenue + ordersToday — calculados sobre los mismos 50 docs (sin lectura extra)
        let revenue = 0;
        let today = 0;
        const todayStart = startOfToday().getTime();

        ordersSnap.docs.forEach((d) => {
          const x = d.data() as any;
          revenue += Number(x.total ?? 0);
          const created = safeDate(x.createdAt);
          if (created && created.getTime() >= todayStart) today += 1;
        });

        setProductsCount(pCount);
        setOrdersCount(oCount);
        setClientsCount(cCount);
        setRevenueTotal(revenue);
        setOrdersToday(today);
        setRecentOrders(recent);

        // Guardar en caché
        dashboardCache = {
          storeId: store.id,
          productsCount: pCount,
          ordersCount: oCount,
          clientsCount: cCount,
          revenueTotal: revenue,
          ordersToday: today,
          recentOrders: recent,
          fetchedAt: Date.now(),
        };
      } catch (e) {
        console.error(e);
      }
    };

    run();
  }, [store?.id]);

  const copyCatalog = async () => {
    if (!catalogUrl) return;
    try {
      await navigator.clipboard.writeText(catalogUrl);
      alert("Link copiado ✅");
    } catch {
      alert("No se pudo copiar el link.");
    }
  };

  if (loading) {
    return (
      <div className="p-10 text-center text-gray-500">
        Cargando panel...
      </div>
    );
  }

  if (!store) {
    return (
      <div className="p-10 text-center text-gray-500">
        No se encontró una tienda asociada a este usuario.
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Panel de Control</h1>
          <p className="text-gray-500 mt-1">
            {store.name} • Resumen del negocio
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => window.open(catalogUrl, "_blank", "noopener,noreferrer")}
            className="px-4 py-2 rounded-lg border bg-white hover:bg-gray-50 text-sm font-semibold"
            disabled={!catalogUrl}
          >
            <i className="fa-solid fa-arrow-up-right-from-square mr-2"></i>
            Ver catálogo
          </button>
          <button
            onClick={copyCatalog}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 text-sm font-semibold"
            disabled={!catalogUrl}
          >
            <i className="fa-solid fa-link mr-2"></i>
            Copiar link
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Productos"
          value={`${productsCount}`}
          icon="fa-box"
          color="bg-indigo-600"
        />
        <StatCard
          title="Pedidos"
          value={`${ordersCount}`}
          icon="fa-cart-shopping"
          color="bg-emerald-600"
          hint={ordersToday ? `+${ordersToday} hoy` : undefined}
        />
        <StatCard
          title="Clientes"
          value={`${clientsCount}`}
          icon="fa-users"
          color="bg-amber-600"
        />
        <StatCard
          title="Ingresos"
          value={formatCOP(revenueTotal)}
          icon="fa-sack-dollar"
          color="bg-rose-600"
          hint="últ. 50 pedidos"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent orders */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex justify-between items-center">
            <h2 className="font-bold text-gray-900">Últimos pedidos</h2>
            <button
              onClick={() => navigate("/admin/orders")}
              className="text-sm text-indigo-600 font-semibold hover:underline"
            >
              Ver todos
            </button>
          </div>

          {recentOrders.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                    <th className="px-6 py-3 font-semibold">Pedido</th>
                    <th className="px-6 py-3 font-semibold">Cliente</th>
                    <th className="px-6 py-3 font-semibold">Estado</th>
                    <th className="px-6 py-3 font-semibold text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recentOrders.map((o) => (
                    <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="text-xs font-mono text-indigo-600 font-bold">
                          #{o.id.substring(0, 8)}
                        </div>
                        <div className="text-xs text-gray-400">{relativeTime(o.createdAt)}</div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900 font-semibold">
                          {o.customer?.name || "Cliente"}
                        </div>
                        <div className="text-xs text-gray-500">
                          {o.customer?.phone || ""}
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${statusBadge[o.status]?.color}`}
                        >
                          {statusBadge[o.status]?.label || o.status}
                        </span>
                      </td>

                      <td className="px-6 py-4 text-sm text-gray-900 text-right font-semibold">
                        {formatCOP(o.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-12 text-center text-gray-400 italic">
              Aún no tienes pedidos.
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="font-bold text-gray-900 mb-6">Acciones rápidas</h2>

          <div className="space-y-3">
            <button
              onClick={() => navigate("/admin/products")}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-indigo-600 hover:bg-indigo-50 transition-all text-sm font-medium text-gray-700 group"
            >
              <div className="h-8 w-8 rounded bg-gray-100 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                <i className="fa-solid fa-plus text-xs"></i>
              </div>
              Nuevo producto
            </button>

            <button
              onClick={copyCatalog}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-indigo-600 hover:bg-indigo-50 transition-all text-sm font-medium text-gray-700 group"
              disabled={!catalogUrl}
            >
              <div className="h-8 w-8 rounded bg-gray-100 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                <i className="fa-solid fa-share-nodes text-xs"></i>
              </div>
              Compartir catálogo (copiar link)
            </button>

            <button
              onClick={() => window.open(catalogUrl, "_blank", "noopener,noreferrer")}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-indigo-600 hover:bg-indigo-50 transition-all text-sm font-medium text-gray-700 group"
              disabled={!catalogUrl}
            >
              <div className="h-8 w-8 rounded bg-gray-100 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                <i className="fa-solid fa-arrow-up-right-from-square text-xs"></i>
              </div>
              Abrir catálogo público
            </button>
          </div>

          <div className="mt-8">
            <h2 className="font-bold text-gray-900 mb-4">Información</h2>
            <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Slug</span>
                <span className="font-mono text-gray-900">{store.slug || "-"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">WhatsApp</span>
                <span className="font-mono text-gray-900">{store.whatsapp || "-"}</span>
              </div>
              <div className="pt-2">
                <div className="text-xs text-gray-400">Link del catálogo</div>
                <div className="text-xs font-mono break-all text-gray-700">{catalogUrl || "-"}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardView;
