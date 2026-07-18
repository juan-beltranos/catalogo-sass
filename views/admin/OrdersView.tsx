import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  where,
  getDocs,
  limit,
  QueryDocumentSnapshot,
  DocumentData,
  startAfter,
  endBefore,
  limitToLast,
} from "@/lib/supabaseFirestore";
import { db, supabase } from "@/lib/supabase";
import { getStoreForOwner } from "@/lib/storeLookup";
import { useAuth } from "../../context/AuthContext";
import { Order, OrderItem, OrderStatus } from "@/types";
import { formatCOP, formatDate, waTo } from "@/helpers";
import Paginator from "@/components/catalog/Paginator";

const statusMap: Record<OrderStatus, { label: string; color: string }> = {
  new: { label: "Nuevo", color: "bg-yellow-100 text-yellow-800" },
  confirmed: { label: "Confirmado", color: "bg-blue-100 text-blue-800" },
  preparing: {
    label: "En preparación",
    color: "bg-indigo-100 text-indigo-800",
  },
  delivered: { label: "Entregado", color: "bg-green-100 text-green-800" },
  cancelled: { label: "Cancelado", color: "bg-red-100 text-red-800" },
};

const shippingMethodMeta: Record<
  string,
  { label: string; icon: string; badge: string }
> = {
  cod: {
    label: "Contra entrega",
    icon: "fa-solid fa-money-bill-wave",
    badge: "bg-green-100 text-green-700",
  },
  carrier: {
    label: "Transportadora",
    icon: "fa-solid fa-truck",
    badge: "bg-blue-100 text-blue-700",
  },
};

const PAGE_SIZE = 10;

const OrdersView: React.FC = () => {
  const { user } = useAuth();

  const [storeId, setStoreId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);

  const [pageFirstDoc, setPageFirstDoc] =
    useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [pageLastDoc, setPageLastDoc] =
    useState<QueryDocumentSnapshot<DocumentData> | null>(null);

  const [history, setHistory] = useState<QueryDocumentSnapshot<DocumentData>[]>(
    [],
  );

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [filterStatus, setFilterStatus] = useState<OrderStatus | "all">("all");

  const activeRequestId = useRef(0);

  // 1) Obtener storeId por ownerUid
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

  // 2) Cargar pedidos paginados
  useEffect(() => {
    if (!storeId) return;

    setLoading(true);
    setPage(1);
    setHistory([]);
    setPageFirstDoc(null);
    setPageLastDoc(null);
    setHasNext(false);

    loadOrdersPage("first", filterStatus);
  }, [storeId, filterStatus]);

  const counters = useMemo(() => {
    const c: Record<OrderStatus, number> = {
      new: 0,
      confirmed: 0,
      preparing: 0,
      delivered: 0,
      cancelled: 0,
    };
    for (const o of orders) c[o.status] = (c[o.status] || 0) + 1;
    return c;
  }, [orders]);

  const handleUpdateStatus = async (
    orderId: string,
    newStatus: OrderStatus,
  ) => {
    if (!storeId) return;
    const previousOrders = orders;
    const previousSelectedOrder = selectedOrder;
    const updatedAt = new Date();

    const patchOrder = (order: Order): Order => ({
      ...order,
      status: newStatus,
      updatedAt,
    } as Order);

    setOrders((current) => {
      const updated = current.map((order) => (order.id === orderId ? patchOrder(order) : order));
      return filterStatus === "all" ? updated : updated.filter((order) => order.status === filterStatus);
    });
    setSelectedOrder((current) => (current?.id === orderId ? patchOrder(current) : current));

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const response = await fetch("/api/order-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session?.access_token || ""}`,
        },
        body: JSON.stringify({ storeId, orderId, status: newStatus }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "No se pudo actualizar el estado.");
    } catch (error) {
      console.error("Error updating status:", error);
      setOrders(previousOrders);
      setSelectedOrder(previousSelectedOrder);
      alert("Error al actualizar estado");
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (!storeId) return;
    if (!window.confirm("¿Eliminar este pedido de la base de datos?")) return;

    try {
      await deleteDoc(doc(db, "stores", storeId, "orders", orderId));
      setOrders((current) => current.filter((order) => order.id !== orderId));
      setSelectedOrder((current) => (current?.id === orderId ? null : current));
      await loadFirstOrdersPage();
    } catch (error) {
      console.error("Error deleting order:", error);
      alert("Error al eliminar");
    }
  };

  const mapDocToOrder = (d: QueryDocumentSnapshot<DocumentData>) => {
    const x = d.data() as any;

    const customer = x.customer ?? {
      name: x.customerName ?? "",
      phone: x.customerPhone ?? "",
      address: x.customerAddress ?? "",
    };

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
          Number(it.unitPrice ?? it.price ?? 0) *
            Number(it.qty ?? it.quantity ?? 1),
      ),
    }));

    const o: Order = {
      id: d.id,
      status: (x.status as OrderStatus) ?? "new",
      channel: x.channel ?? "whatsapp",
      customer,
      notes: x.notes ?? "",
      items,
      subtotal: Number(x.subtotal ?? x.total ?? 0),
      shippingMethod: x.shippingMethod ?? null,
      shippingCost: Number(x.shippingCost ?? 0),
      customFields: Array.isArray(x.customFields)
        ? x.customFields
        : Array.isArray(customer.customFields)
          ? customer.customFields
          : [],
      total: Number(x.total ?? 0),
      createdAt: x.createdAt,
      updatedAt: x.updatedAt,
    } as any;

    return o;
  };

  const loadOrdersPage = async (
    mode: "first" | "next" | "prev",
    status: OrderStatus | "all",
  ) => {
    if (!storeId) return;

    activeRequestId.current += 1;
    const reqId = activeRequestId.current;

    setLoadingPage(true);

    try {
      const baseRef = collection(db, "stores", storeId, "orders");

      let qBase =
        status === "all"
          ? query(baseRef, orderBy("createdAt", "desc"))
          : query(
              baseRef,
              where("status", "==", status),
              orderBy("createdAt", "desc"),
            );

      if (mode === "next") {
        if (!pageLastDoc) return;
        qBase = query(qBase, startAfter(pageLastDoc));
      }

      if (mode === "prev") {
        if (!pageFirstDoc) return;
        qBase = query(
          qBase,
          endBefore(pageFirstDoc),
          limitToLast(PAGE_SIZE + 1),
        );
      } else {
        qBase = query(qBase, limit(PAGE_SIZE + 1));
      }

      const snap = await getDocs(qBase);

      if (reqId !== activeRequestId.current) return;

      const docs = snap.docs;
      const nextExists = docs.length > PAGE_SIZE;
      const pageDocs = nextExists ? docs.slice(0, PAGE_SIZE) : docs;

      setOrders(pageDocs.map(mapDocToOrder));
      setHasNext(nextExists);
      setPageFirstDoc(pageDocs[0] ?? null);
      setPageLastDoc(pageDocs[pageDocs.length - 1] ?? null);
    } catch (err) {
      console.error("Error loading orders page:", err);
    } finally {
      if (reqId === activeRequestId.current) {
        setLoadingPage(false);
        setLoading(false);
      }
    }
  };

  const loadFirstOrdersPage = async () => {
    setPage(1);
    setHistory([]);
    await loadOrdersPage("first", filterStatus);
  };

  const goNextOrders = async () => {
    if (!hasNext || loadingPage) return;
    if (pageFirstDoc) setHistory((h) => [...h, pageFirstDoc]);
    setPage((p) => p + 1);
    await loadOrdersPage("next", filterStatus);
  };

  const goPrevOrders = async () => {
    if (history.length === 0 || loadingPage) return;
    setHistory((h) => h.slice(0, -1));
    setPage((p) => Math.max(1, p - 1));
    await loadOrdersPage("prev", filterStatus);
  };

  // Helper: método de envío de un pedido
  const getShippingMeta = (order: any) => {
    const method = order.shippingMethod;
    if (!method) return null;
    return shippingMethodMeta[method] ?? null;
  };

  const escapeHtml = (value: any) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const handlePrintOrderPdf = (order: Order) => {
    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) {
      alert("Permite las ventanas emergentes para generar el PDF del pedido.");
      return;
    }

    const shippingMeta = getShippingMeta(order);
    const shippingCost = Number((order as any).shippingCost ?? 0);
    const subtotal = Number((order as any).subtotal ?? order.total ?? 0);
    const customFields = Array.isArray((order as any).customFields)
      ? (order as any).customFields.filter((field: any) => field?.value)
      : [];

    const itemsRows = order.items
      .map(
        (item) => `
          <tr>
            <td>
              <strong>${escapeHtml(item.productName)}</strong>
              ${item.sku ? `<div class="muted">SKU: ${escapeHtml(item.sku)}</div>` : ""}
              ${
                item.variantTitle
                  ? `<div class="muted">${escapeHtml(item.variantTitle)}</div>`
                  : ""
              }
            </td>
            <td class="center">${escapeHtml(item.qty)}</td>
            <td class="right">${escapeHtml(formatCOP(item.unitPrice))}</td>
            <td class="right">${escapeHtml(formatCOP(item.subtotal))}</td>
          </tr>
        `,
      )
      .join("");

    const customRows = customFields
      .map(
        (field: any) => `
          <div><strong>${escapeHtml(field.label)}:</strong> ${escapeHtml(field.value)}</div>
        `,
      )
      .join("");

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Pedido ${escapeHtml(order.id.substring(0, 8))}</title>
          <style>
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; color: #111827; margin: 0; padding: 32px; }
            header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #111827; padding-bottom: 16px; margin-bottom: 24px; }
            h1 { margin: 0 0 6px; font-size: 24px; }
            h2 { margin: 0 0 10px; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; }
            .muted { color: #6b7280; font-size: 12px; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
            .box { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }
            .line { margin: 5px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th { background: #f3f4f6; color: #4b5563; font-size: 11px; text-transform: uppercase; text-align: left; }
            th, td { border-bottom: 1px solid #e5e7eb; padding: 10px; vertical-align: top; }
            .center { text-align: center; }
            .right { text-align: right; }
            tfoot td { font-weight: 700; }
            .total td { background: #eef2ff; color: #3730a3; font-size: 16px; }
            @media print { body { padding: 18mm; } }
          </style>
        </head>
        <body>
          <header>
            <div>
              <h1>Pedido #${escapeHtml(order.id.substring(0, 8))}</h1>
              <div class="muted">${escapeHtml(formatDate(order.createdAt))}</div>
              <div class="muted">Canal: ${escapeHtml(order.channel || "whatsapp")}</div>
            </div>
            <div class="right">
              <strong>${escapeHtml(statusMap[order.status]?.label || order.status)}</strong>
              ${shippingMeta ? `<div class="muted">${escapeHtml(shippingMeta.label)}</div>` : ""}
            </div>
          </header>

          <section class="grid">
            <div class="box">
              <h2>Cliente</h2>
              <div class="line"><strong>Nombre:</strong> ${escapeHtml(order.customer?.name)}</div>
              <div class="line"><strong>Telefono:</strong> ${escapeHtml(order.customer?.phone)}</div>
              <div class="line"><strong>Direccion:</strong> ${escapeHtml(order.customer?.address)}</div>
              ${order.notes ? `<div class="line"><strong>Notas:</strong> ${escapeHtml(order.notes)}</div>` : ""}
            </div>
            <div class="box">
              <h2>Datos adicionales</h2>
              ${customRows || '<div class="muted">Sin datos adicionales.</div>'}
            </div>
          </section>

          <section>
            <h2>Productos</h2>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th class="center">Cant.</th>
                  <th class="right">Precio</th>
                  <th class="right">Subtotal</th>
                </tr>
              </thead>
              <tbody>${itemsRows}</tbody>
              <tfoot>
                ${
                  (order as any).shippingMethod
                    ? `
                      <tr>
                        <td colspan="3" class="right">Subtotal</td>
                        <td class="right">${escapeHtml(formatCOP(subtotal))}</td>
                      </tr>
                      <tr>
                        <td colspan="3" class="right">Envio${shippingMeta ? ` (${escapeHtml(shippingMeta.label)})` : ""}</td>
                        <td class="right">${shippingCost > 0 ? escapeHtml(formatCOP(shippingCost)) : "Gratis"}</td>
                      </tr>
                    `
                    : ""
                }
                <tr class="total">
                  <td colspan="3" class="right">TOTAL</td>
                  <td class="right">${escapeHtml(formatCOP(order.total))}</td>
                </tr>
              </tfoot>
            </table>
          </section>
          <script>
            window.onload = () => {
              window.focus();
              window.print();
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  if (!storeId && loading) {
    return (
      <div className="p-8 text-center text-gray-500">Cargando tienda...</div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pedidos</h1>
          <p className="text-gray-500 mt-1">
            Monitorea y actualiza el estado de tus pedidos.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filterStatus}
            disabled={loadingPage || loading}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="border rounded-lg px-3 py-2 text-sm disabled:opacity-60"
          >
            <option value="all">Todos ({orders.length})</option>
            <option value="new">Nuevos ({counters.new})</option>
            <option value="confirmed">
              Confirmados ({counters.confirmed})
            </option>
            <option value="preparing">
              En preparación ({counters.preparing})
            </option>
            <option value="delivered">Entregados ({counters.delivered})</option>
            <option value="cancelled">Cancelados ({counters.cancelled})</option>
          </select>
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
                  <th className="px-6 py-4 font-semibold">ID / Fecha</th>
                  <th className="px-6 py-4 font-semibold">Cliente</th>
                  <th className="px-6 py-4 font-semibold">Envío</th>
                  <th className="px-6 py-4 font-semibold">Estado</th>
                  <th className="px-6 py-4 font-semibold">Total</th>
                  <th className="px-6 py-4 font-semibold text-right">
                    Acciones
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {orders.map((order) => {
                  const shippingMeta = getShippingMeta(order);
                  const shippingCost = (order as any).shippingCost ?? 0;

                  return (
                    <tr
                      key={order.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div className="text-xs font-mono text-indigo-600 font-bold mb-1">
                          #{order.id.substring(0, 8)}
                        </div>
                        <div className="text-xs text-gray-400">
                          {formatDate(order.createdAt)}
                        </div>
                        <div className="text-[10px] text-gray-400 mt-1">
                          Canal: {order.channel || "whatsapp"}
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-gray-900">
                          {order.customer?.name}
                        </div>
                        <div className="text-xs text-gray-500">
                          {order.customer?.phone}
                        </div>
                        <div className="text-xs text-gray-400 truncate max-w-[200px]">
                          {order.customer?.address}
                        </div>
                      </td>

                      {/* ── Columna de envío ── */}
                      <td className="px-6 py-4">
                        {shippingMeta ? (
                          <div className="space-y-1">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${shippingMeta.badge}`}
                            >
                              <i
                                className={`${shippingMeta.icon} text-[10px]`}
                              />
                              {shippingMeta.label}
                            </span>
                            {shippingCost > 0 && (
                              <div className="text-xs text-gray-400 pl-0.5">
                                +{formatCOP(shippingCost)}
                              </div>
                            )}
                            {shippingCost === 0 && (
                              <div className="text-xs text-green-600 font-semibold pl-0.5">
                                Gratis
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300 italic">
                            —
                          </span>
                        )}
                      </td>

                      <td className="px-6 py-4">
                        <select
                          value={order.status}
                          onChange={(e) =>
                            handleUpdateStatus(
                              order.id,
                              e.target.value as OrderStatus,
                            )
                          }
                          className={`text-xs font-bold px-3 py-2 rounded-full border-none outline-none cursor-pointer ${statusMap[order.status]?.color}`}
                        >
                          {Object.entries(statusMap).map(([val, meta]) => (
                            <option key={val} value={val}>
                              {meta.label}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td className="px-6 py-4 text-sm font-bold text-gray-900">
                        {formatCOP(order.total)}
                      </td>

                      <td className="px-6 py-4 text-right space-x-2">
                        <button
                          onClick={() => setSelectedOrder(order)}
                          className="text-gray-400 hover:text-indigo-600 p-2"
                          title="Ver detalles"
                        >
                          <i className="fa-solid fa-eye"></i>
                        </button>

                        <button
                          onClick={() => handlePrintOrderPdf(order)}
                          className="text-gray-400 hover:text-slate-700 p-2"
                          title="Guardar pedido en PDF"
                        >
                          <i className="fa-solid fa-file-pdf"></i>
                        </button>

                        <a
                          href={waTo(order.customer?.phone || "")}
                          target="_blank"
                          rel="noreferrer"
                          className="text-gray-400 hover:text-green-600 p-2 inline-block"
                          title="WhatsApp cliente"
                        >
                          <i className="fa-brands fa-whatsapp"></i>
                        </a>

                        <button
                          onClick={() => handleDeleteOrder(order.id)}
                          className="text-gray-400 hover:text-red-600 p-2"
                          title="Eliminar"
                        >
                          <i className="fa-solid fa-trash-can"></i>
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {orders.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-6 py-12 text-center text-gray-500 italic"
                    >
                      No hay pedidos para este filtro.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <Paginator
              page={page}
              hasNext={hasNext}
              hasPrev={history.length > 0}
              loading={loadingPage}
              onNext={goNextOrders}
              onPrev={goPrevOrders}
            />
          </div>
        )}
      </div>

      {/* ── Order Detail Modal ── */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setSelectedOrder(null)}
          ></div>

          <div className="relative bg-white w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 border-b flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold">
                  Pedido #{selectedOrder.id.substring(0, 8)}
                </h3>
                <div className="text-xs text-gray-400 mt-1">
                  {formatDate(selectedOrder.createdAt)}
                </div>
              </div>

              <button
                onClick={() => setSelectedOrder(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <i className="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Datos del cliente */}
                <div>
                  <h4 className="text-xs font-bold uppercase text-gray-400 mb-2">
                    Entrega
                  </h4>
                  <div className="space-y-1 text-sm">
                    <p>
                      <strong>Nombre:</strong> {selectedOrder.customer?.name}
                    </p>
                    <p>
                      <strong>Teléfono:</strong> {selectedOrder.customer?.phone}
                    </p>
                    <p>
                      <strong>Dirección:</strong>{" "}
                      {selectedOrder.customer?.address}
                    </p>
                    {selectedOrder.notes ? (
                      <p className="text-gray-500">
                        <strong>Notas:</strong> {selectedOrder.notes}
                      </p>
                    ) : null}
                    {Array.isArray((selectedOrder as any).customFields) &&
                    (selectedOrder as any).customFields.length > 0 ? (
                      <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
                        <div className="mb-2 text-xs font-bold uppercase text-gray-400">
                          Datos adicionales
                        </div>
                        <div className="space-y-1">
                          {(selectedOrder as any).customFields
                            .filter((field: any) => field?.value)
                            .map((field: any) => (
                              <p key={field.id || field.label} className="text-gray-600">
                                <strong>{field.label}:</strong> {field.value}
                              </p>
                            ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Estado + envío */}
                <div className="space-y-4">
                  <div>
                    <h4 className="text-xs font-bold uppercase text-gray-400 mb-2">
                      Estado
                    </h4>
                    <div className="flex items-center gap-3">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-bold ${statusMap[selectedOrder.status].color}`}
                      >
                        {statusMap[selectedOrder.status].label}
                      </span>
                      <a
                        href={waTo(
                          selectedOrder.customer?.phone || "",
                          `Hola ${selectedOrder.customer?.name || ""}, sobre tu pedido #${selectedOrder.id.substring(0, 8)}...`,
                        )}
                        target="_blank"
                        rel="noreferrer"
                        className="text-green-600 text-sm font-semibold"
                      >
                        WhatsApp cliente
                      </a>
                    </div>
                  </div>

                  {/* ── Bloque de envío en el modal ── */}
                  {(() => {
                    const sm = getShippingMeta(selectedOrder);
                    const sc = (selectedOrder as any).shippingCost ?? 0;
                    if (!sm) return null;
                    return (
                      <div>
                        <h4 className="text-xs font-bold uppercase text-gray-400 mb-2">
                          Método de envío
                        </h4>
                        <div
                          className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold ${sm.badge}`}
                        >
                          <i className={sm.icon} />
                          {sm.label}
                          {sc > 0 ? (
                            <span className="ml-1 font-semibold opacity-80">
                              · {formatCOP(sc)}
                            </span>
                          ) : (
                            <span className="ml-1 font-semibold opacity-70">
                              · Gratis
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Productos */}
              <div>
                <h4 className="text-xs font-bold uppercase text-gray-400 mb-3">
                  Productos
                </h4>
                <div className="bg-gray-50 rounded-xl overflow-hidden border border-gray-100">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="bg-gray-100 text-gray-500 text-[10px] uppercase font-bold">
                        <th className="px-4 py-2">Item</th>
                        <th className="px-4 py-2 text-center">Cant.</th>
                        <th className="px-4 py-2 text-right">Precio</th>
                        <th className="px-4 py-2 text-right">Subtotal</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-gray-200">
                      {selectedOrder.items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="px-4 py-3 text-gray-700 font-medium">
                            <div>{item.productName}</div>
                            {item.sku ? (
                              <div className="text-xs text-gray-400">
                                SKU: {item.sku}
                              </div>
                            ) : null}
                            {item.variantTitle ? (
                              <div className="text-xs text-gray-400">
                                {item.variantTitle}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-center">{item.qty}</td>
                          <td className="px-4 py-3 text-right">
                            {formatCOP(item.unitPrice)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {formatCOP(item.subtotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>

                    <tfoot>
                      {/* Subtotal fila — solo si hay envío */}
                      {(selectedOrder as any).shippingMethod && (
                        <>
                          <tr className="text-gray-500 text-sm">
                            <td
                              colSpan={3}
                              className="px-4 py-2 text-right font-semibold"
                            >
                              Subtotal
                            </td>
                            <td className="px-4 py-2 text-right">
                              {formatCOP(
                                (selectedOrder as any).subtotal ??
                                  selectedOrder.total,
                              )}
                            </td>
                          </tr>
                          <tr className="text-gray-500 text-sm">
                            <td
                              colSpan={3}
                              className="px-4 py-2 text-right font-semibold"
                            >
                              Envío ({getShippingMeta(selectedOrder)?.label})
                            </td>
                            <td className="px-4 py-2 text-right">
                              {(selectedOrder as any).shippingCost > 0 ? (
                                formatCOP((selectedOrder as any).shippingCost)
                              ) : (
                                <span className="text-green-600 font-bold">
                                  Gratis
                                </span>
                              )}
                            </td>
                          </tr>
                        </>
                      )}
                      <tr className="bg-indigo-50 font-bold text-indigo-700">
                        <td colSpan={3} className="px-4 py-3 text-right">
                          TOTAL
                        </td>
                        <td className="px-4 py-3 text-right">
                          {formatCOP(selectedOrder.total)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>

            <div className="p-6 border-t flex justify-end gap-2">
              <button
                onClick={() => handlePrintOrderPdf(selectedOrder)}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-bold transition-all"
              >
                Guardar PDF
              </button>
              <button
                onClick={() => setSelectedOrder(null)}
                className="px-6 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 font-bold transition-all"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrdersView;
