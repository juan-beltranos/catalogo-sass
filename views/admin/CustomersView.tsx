import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  where,
  getDocs,
  deleteDoc,
  doc,
} from "@/lib/supabaseFirestore";
import { db } from "@/lib/supabase";
import { getStoreForOwner } from "@/lib/storeLookup";
import { useAuth } from "../../context/AuthContext";
import { formatCOP, formatDate, normalizePhone, phoneForWhatsApp } from "@/helpers";
import { Client, Order, OrderItem, OrderStatus } from "@/types";
import Paginator from "@/components/catalog/Paginator";

const PAGE_SIZE = 20;


const CustomersView: React.FC = () => {
  const { user } = useAuth();

  const [storeId, setStoreId] = useState<string | null>(null);

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientOrders, setClientOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // 1) obtener storeId por ownerUid
  useEffect(() => {
    if (!user) return;

    const fetchStore = async () => {
      const store = await getStoreForOwner(user.uid);
      if (store) setStoreId(store.id);
      else {
        console.error("No se encontró tienda para este usuario");
        setStoreId(null);
        setLoading(false);
      }
    };

    fetchStore();
  }, [user]);

  // 2) escuchar clients de la tienda
  useEffect(() => {
    if (!storeId) return;

    setLoading(true);

    const qClients = query(
      collection(db, "stores", storeId, "clients"),
      orderBy("lastOrderAt", "desc")
    );

    const unsub = onSnapshot(
      qClients,
      (snapshot) => {
        const data: Client[] = snapshot.docs.map((d) => {
          const x = d.data() as any;
          const rawPhone = normalizePhone(x.phone ?? d.id);
          const phone = phoneForWhatsApp(rawPhone);

          return {
            id: d.id,
            uuid: x.uuid,
            rawPhone,
            name: x.name ?? "Cliente",
            phone,
            address: x.address ?? "",
            totalOrders: Number(x.totalOrders ?? x.ordersCount ?? 0),
            totalSpent: Number(x.totalSpent ?? x.totalSpentCOP ?? 0),
            lastOrderAt: x.lastOrderAt ?? x.lastOrderDate,
            createdAt: x.createdAt,
            updatedAt: x.updatedAt,
          };
        });

        setClients(data);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
        alert("Error al cargar clientes");
      }
    );

    return () => unsub();
  }, [storeId]);

  // KPIs
  const kpis = useMemo(() => {
    const totalClients = clients.length;
    const totalSpent = clients.reduce((acc, c) => acc + (c.totalSpent || 0), 0);
    const totalOrders = clients.reduce((acc, c) => acc + (c.totalOrders || 0), 0);
    return { totalClients, totalSpent, totalOrders };
  }, [clients]);

  // filtro por búsqueda
  const filteredClients = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return clients;

    return clients.filter((c) => {
      const name = (c.name || "").toLowerCase();
      const phone = normalizePhone(c.phone);
      return name.includes(s) || phone.includes(normalizePhone(s));
    });
  }, [clients, search]);
  const totalPages = Math.max(1, Math.ceil(filteredClients.length / PAGE_SIZE));
  const paginatedClients = useMemo(
    () => filteredClients.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredClients, page],
  );

  useEffect(() => setPage(1), [search]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const handleViewDetails = async (client: Client) => {
    if (!storeId) return;

    setSelectedClient(client);
    setLoadingOrders(true);
    setClientOrders([]);

    const phone = normalizePhone(client.phone);
    const rawPhone = normalizePhone((client as any).rawPhone || client.phone);
    const internationalPhone = phoneForWhatsApp(phone);

    try {
      const ordersCol = collection(db, "stores", storeId, "orders");

      const clientUuid = String((client as any).uuid || "");
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientUuid)) {
        const linkedSnap = await getDocs(query(
          ordersCol,
          where("clientId", "==", clientUuid),
          orderBy("createdAt", "desc"),
        ));
        if (!linkedSnap.empty) {
          setClientOrders(linkedSnap.docs.map(mapOrderDocToOrder));
          return;
        }
      }

      // ✅ 1) intento principal: clientId
      let q1 = query(
        ordersCol,
        where("customerPhone", "==", internationalPhone),
        orderBy("createdAt", "desc")
      );

      const snap1 = await getDocs(q1);

      // ✅ si hay resultados, parsea y listo
      if (!snap1.empty) {
        const orders = snap1.docs.map(mapOrderDocToOrder);
        setClientOrders(orders);
        return;
      }

      // ✅ 2) fallback: customer.phone (por si antes no guardabas clientId)
      const q2 = query(
        ordersCol,
        where("customerPhone", "==", rawPhone),
        orderBy("createdAt", "desc")
      );

      const snap2 = await getDocs(q2);
      const orders2 = snap2.docs.map(mapOrderDocToOrder);
      setClientOrders(orders2);

    } catch (error: any) {
      console.error("Error loading customer history:", error);

      // ✅ fallback sin orderBy (por si falta índice)
      try {
        const ordersCol = collection(db, "stores", storeId, "orders");
        const phone = normalizePhone(client.phone);

        const qNoIndex = query(ordersCol, where("customerPhone", "==", phone));
        const snap = await getDocs(qNoIndex);

        const orders = snap.docs
          .map(mapOrderDocToOrder)
          // orden manual por createdAt si existe
          .sort((a, b) => {
            const ta = (a.createdAt?.seconds ?? 0);
            const tb = (b.createdAt?.seconds ?? 0);
            return tb - ta;
          });

        setClientOrders(orders);
      } catch (e2) {
        console.error("Fallback also failed:", e2);
        alert("No se pudo cargar el historial del cliente.");
      }
    } finally {
      setLoadingOrders(false);
    }
  };

  const handleDeleteClient = async (client: Client) => {
    if (!storeId) return;
    const label = client.name || client.phone || "este cliente";
    if (!window.confirm(`¿Eliminar a ${label} de clientes? Sus pedidos no se borrarán.`)) return;

    try {
      await deleteDoc(doc(db, "stores", storeId, "clients", client.id));
      setClients((current) => current.filter((c) => c.id !== client.id));
      setSelectedClient((current) => (current?.id === client.id ? null : current));
    } catch (error) {
      console.error("Error deleting client:", error);
      alert("No se pudo eliminar el cliente.");
    }
  };

  const mapOrderDocToOrder = (d: any): Order => {
    const x = d.data() as any;

    const items: OrderItem[] = (x.items ?? []).map((it: any) => ({
      productId: it.productId ?? it.id ?? "",
      productName: it.productName ?? it.name ?? "",
      sku: it.sku ?? null,
      variantId: it.variantId ?? null,
      variantTitle: it.variantTitle ?? null,
      unitPrice: Number(it.unitPrice ?? it.price ?? 0),
      qty: Number(it.qty ?? it.quantity ?? 1),
      subtotal: Number(
        it.subtotal ??
        (Number(it.unitPrice ?? it.price ?? 0) * Number(it.qty ?? it.quantity ?? 1))
      ),
    }));

    const customer = x.customer ?? {
      name: x.customerName ?? "",
      phone: x.customerPhone ?? "",
      address: x.customerAddress ?? "",
    };

    return {
      id: d.id,
      status: (x.status ?? "new") as OrderStatus,
      channel: (x.channel ?? "whatsapp") as "whatsapp" | "manual",
      customer,
      notes: x.notes ?? "",
      items,
      total: Number(x.total ?? 0),
      createdAt: x.createdAt,
      updatedAt: x.updatedAt,
    };
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert("Copiado ✅");
    } catch {
      alert("No se pudo copiar");
    }
  };

  const initials = (name: string) => (name?.trim()?.[0] ? name.trim()[0].toUpperCase() : "C");

  if (!storeId && loading) return <div className="p-8 text-center text-gray-500">Cargando tienda...</div>;

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clientes</h1>
          <p className="text-gray-500 mt-1">
            Personas que han realizado pedidos en tu tienda.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o teléfono..."
            className="w-full md:w-80 px-4 py-2 border rounded-lg"
          />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border rounded-xl p-5">
          <div className="text-xs uppercase text-gray-400 font-bold">Clientes</div>
          <div className="text-2xl font-black text-gray-900 mt-2">{kpis.totalClients}</div>
        </div>
        <div className="bg-white border rounded-xl p-5">
          <div className="text-xs uppercase text-gray-400 font-bold">Pedidos acumulados</div>
          <div className="text-2xl font-black text-gray-900 mt-2">{kpis.totalOrders}</div>
        </div>
        <div className="bg-white border rounded-xl p-5">
          <div className="text-xs uppercase text-gray-400 font-bold">Total vendido a clientes</div>
          <div className="text-2xl font-black text-indigo-600 mt-2">{formatCOP(kpis.totalSpent)}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-600"></div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-6 py-4 font-semibold">Cliente</th>
                  <th className="px-6 py-4 font-semibold">Pedidos</th>
                  <th className="px-6 py-4 font-semibold">Total gastado</th>
                  <th className="px-6 py-4 font-semibold">Última compra</th>
                  <th className="px-6 py-4 font-semibold text-right">Acciones</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {paginatedClients.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">
                          {initials(c.name)}
                        </div>
                        <div>
                          <div className="text-sm font-bold text-gray-900">{c.name}</div>
                          <div className="text-xs text-gray-500 flex items-center gap-2">
                            <span>{c.phone}</span>
                            <button
                              className="text-gray-400 hover:text-indigo-600"
                              onClick={() => copyToClipboard(c.phone)}
                              title="Copiar"
                            >
                              <i className="fa-regular fa-copy"></i>
                            </button>
                          </div>
                          {c.address ? (
                            <div className="text-xs text-gray-400 max-w-[340px] truncate">
                              {c.address}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-700 font-medium">{c.totalOrders}</span>
                    </td>

                    <td className="px-6 py-4">
                      <span className="text-sm font-bold text-indigo-600">{formatCOP(c.totalSpent)}</span>
                    </td>

                    <td className="px-6 py-4 text-xs text-gray-400">
                      {formatDate(c.lastOrderAt)}
                    </td>

                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleViewDetails(c)}
                          className="text-indigo-600 hover:text-indigo-800 font-bold text-xs"
                        >
                          Ver historial
                        </button>
                        <button
                          onClick={() => handleDeleteClient(c)}
                          className="text-gray-400 hover:text-red-600 p-2"
                          title="Eliminar cliente"
                        >
                          <i className="fa-solid fa-trash-can"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {filteredClients.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500 italic">
                      No hay clientes para mostrar.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {!loading && filteredClients.length > PAGE_SIZE ? (
          <Paginator
            page={page}
            hasPrev={page > 1}
            hasNext={page < totalPages}
            onPrev={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
          />
        ) : null}
      </div>

      {/* Drawer */}
      {selectedClient && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setSelectedClient(null)}
          ></div>

          <div className="relative bg-white w-full max-w-lg h-full shadow-2xl flex flex-col animate-slide-in-right">
            <div className="p-8 border-b">
              <div className="flex justify-between items-start mb-6">
                <div className="h-16 w-16 rounded-full bg-indigo-600 text-white flex items-center justify-center text-2xl font-bold">
                  {initials(selectedClient.name)}
                </div>
                <button
                  onClick={() => setSelectedClient(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <i className="fa-solid fa-xmark text-xl"></i>
                </button>
              </div>

              <h2 className="text-2xl font-bold text-gray-900">{selectedClient.name}</h2>
              <p className="text-gray-500">{selectedClient.phone}</p>

              <div className="mt-6 grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                  <p className="text-[10px] uppercase font-bold text-gray-400">Total gastado</p>
                  <p className="text-lg font-bold text-indigo-600">{formatCOP(selectedClient.totalSpent)}</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                  <p className="text-[10px] uppercase font-bold text-gray-400">Pedidos</p>
                  <p className="text-lg font-bold text-gray-900">{selectedClient.totalOrders}</p>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8">
              <h3 className="text-sm font-bold uppercase text-gray-400 tracking-wider mb-6">
                Historial de pedidos
              </h3>

              {loadingOrders ? (
                <div className="flex justify-center py-10">
                  <i className="fa-solid fa-circle-notch animate-spin text-indigo-600 text-2xl"></i>
                </div>
              ) : (
                <div className="space-y-4">
                  {clientOrders.map((order) => (
                    <div
                      key={order.id}
                      className="p-4 rounded-xl border border-gray-100 hover:border-indigo-100 transition-colors"
                    >
                      <div className="flex justify-between mb-2">
                        <span className="text-xs font-bold text-indigo-600">
                          #{order.id.substring(0, 8)}
                        </span>
                        <span className="text-[10px] text-gray-400">{formatDate(order.createdAt)}</span>
                      </div>

                      <div className="text-sm text-gray-700 font-medium mb-3">
                        {order.items.length} items • <strong>{formatCOP(order.total)}</strong>
                      </div>

                      <div className="flex gap-1 overflow-x-auto no-scrollbar">
                        {order.items.slice(0, 8).map((it, i) => (
                          <span
                            key={i}
                            className="text-[9px] bg-gray-100 px-2 py-0.5 rounded whitespace-nowrap"
                          >
                            {it.productName}
                            {it.variantTitle ? ` (${it.variantTitle})` : ""}
                          </span>
                        ))}
                        {order.items.length > 8 ? (
                          <span className="text-[9px] bg-gray-100 px-2 py-0.5 rounded whitespace-nowrap">
                            +{order.items.length - 8}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}

                  {clientOrders.length === 0 && (
                    <p className="text-center text-gray-400 italic text-sm py-10">
                      No se encontraron pedidos.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="p-8 border-t bg-gray-50">
              {selectedClient.address ? (
                <p className="text-xs text-gray-500 mb-4 flex gap-2">
                  <i className="fa-solid fa-location-dot"></i>
                  {selectedClient.address}
                </p>
              ) : null}

              <div className="flex gap-2">
                <button
                  onClick={() => handleDeleteClient(selectedClient)}
                  className="flex-1 border border-red-200 text-red-600 rounded-lg py-3 font-bold hover:bg-red-50"
                >
                  Eliminar
                </button>

                <button
                  onClick={() => copyToClipboard(selectedClient.phone)}
                  className="flex-1 border rounded-lg py-3 font-bold text-gray-700"
                >
                  Copiar teléfono
                </button>

                <a
                  href={`https://wa.me/${phoneForWhatsApp(selectedClient.phone)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 bg-green-500 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-green-600 transition-all shadow-lg shadow-green-100"
                >
                  <i className="fa-brands fa-whatsapp"></i>
                  WhatsApp
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slide-in-right {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in-right { animation: slide-in-right 0.3s ease-out; }
      `}</style>
    </div>
  );
};

export default CustomersView;
