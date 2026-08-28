import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import type { Coupon } from "@/types";

type CouponForm = { code: string; description: string; discountType: "percent" | "amount"; discountValue: number; minimumSubtotal: number; usageLimit: string; startsAt: string; expiresAt: string; active: boolean };
const emptyForm: CouponForm = { code: "", description: "", discountType: "percent", discountValue: 10, minimumSubtotal: 0, usageLimit: "", startsAt: "", expiresAt: "", active: true };
const money = (value: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);

const CouponsView: React.FC = () => {
  const { user } = useAuth();
  const [storeId, setStoreId] = useState("");
  const [items, setItems] = useState<Coupon[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (!user?.uid) return;
    const { data: store, error: storeError } = await supabase.from("stores").select("id").eq("owner_id", user.uid).maybeSingle();
    if (storeError || !store) return setError(storeError?.message || "No se encontró la tienda.");
    setStoreId(store.id);
    const { data, error } = await supabase.from("coupons").select("*").eq("store_id", store.id).order("created_at", { ascending: false });
    if (error) return setError(error.message);
    setItems((data || []).map((row: any) => ({ id: row.id, storeId: row.store_id, code: row.code, description: row.description, discountType: row.discount_type, discountValue: Number(row.discount_value), minimumSubtotal: Number(row.minimum_subtotal), usageLimit: row.usage_limit, usedCount: row.used_count, startsAt: row.starts_at, expiresAt: row.expires_at, active: row.active })));
  };
  useEffect(() => { load(); }, [user?.uid]);

  const activeCount = useMemo(() => items.filter((item) => item.active).length, [items]);
  const startCreate = () => { setEditingId(null); setForm(emptyForm); setOpen(true); setError(""); };
  const startEdit = (item: Coupon) => { setEditingId(item.id); setForm({ code: item.code, description: item.description || "", discountType: item.discountType, discountValue: item.discountValue, minimumSubtotal: item.minimumSubtotal, usageLimit: item.usageLimit == null ? "" : String(item.usageLimit), startsAt: item.startsAt?.slice(0, 16) || "", expiresAt: item.expiresAt?.slice(0, 16) || "", active: item.active }); setOpen(true); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    const code = form.code.trim().toUpperCase().replace(/\s+/g, "");
    if (code.length < 3) return setError("El código debe tener al menos 3 caracteres.");
    if (form.discountValue <= 0 || (form.discountType === "percent" && form.discountValue > 100)) return setError("Revisa el valor del descuento.");
    if (form.startsAt && form.expiresAt && new Date(form.expiresAt) <= new Date(form.startsAt)) return setError("La fecha de fin debe ser posterior al inicio.");
    setBusy(true);
    const payload = { store_id: storeId, code, description: form.description.trim() || null, discount_type: form.discountType, discount_value: Math.round(form.discountValue), minimum_subtotal: Math.max(0, Math.round(form.minimumSubtotal)), usage_limit: form.usageLimit ? Math.max(1, Number(form.usageLimit)) : null, starts_at: form.startsAt ? new Date(form.startsAt).toISOString() : null, expires_at: form.expiresAt ? new Date(form.expiresAt).toISOString() : null, active: form.active, updated_at: new Date().toISOString() };
    const result = editingId ? await supabase.from("coupons").update(payload).eq("id", editingId).eq("store_id", storeId) : await supabase.from("coupons").insert(payload);
    setBusy(false); if (result.error) return setError(result.error.code === "23505" ? "Ese código ya existe." : result.error.message);
    setOpen(false); await load();
  };
  const toggle = async (item: Coupon) => { await supabase.from("coupons").update({ active: !item.active, updated_at: new Date().toISOString() }).eq("id", item.id); await load(); };

  return <div className="space-y-6">
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-indigo-600"><i className="fa-solid fa-crown" /> Plan mensual</div><h1 className="text-3xl font-black text-gray-900 mt-2">Cupones</h1><p className="text-gray-500 mt-1">Crea incentivos medibles y deja que el sistema valide cada descuento.</p></div><button onClick={startCreate} className="rounded-xl bg-indigo-600 px-5 py-3 text-white font-bold hover:bg-indigo-700"><i className="fa-solid fa-plus mr-2" />Nuevo cupón</button></div>
    <div className="grid sm:grid-cols-3 gap-4"><div className="bg-white border rounded-2xl p-5"><p className="text-sm text-gray-500">Cupones creados</p><p className="text-2xl font-black mt-1">{items.length}</p></div><div className="bg-white border rounded-2xl p-5"><p className="text-sm text-gray-500">Activos</p><p className="text-2xl font-black mt-1 text-emerald-600">{activeCount}</p></div><div className="bg-white border rounded-2xl p-5"><p className="text-sm text-gray-500">Usos acumulados</p><p className="text-2xl font-black mt-1">{items.reduce((sum, item) => sum + item.usedCount, 0)}</p></div></div>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}
    <div className="bg-white border rounded-2xl overflow-hidden">{items.length === 0 ? <div className="p-12 text-center"><i className="fa-solid fa-ticket text-4xl text-indigo-200" /><h2 className="font-black text-lg mt-4">Tu primera campaña empieza aquí</h2><p className="text-gray-500 mt-1">Crea un código para compartirlo en redes o WhatsApp.</p></div> : <div className="divide-y">{items.map(item => <div key={item.id} className="p-5 flex flex-col md:flex-row md:items-center gap-4"><div className="h-12 w-12 rounded-xl bg-indigo-50 text-indigo-600 grid place-items-center"><i className="fa-solid fa-ticket" /></div><div className="flex-1"><div className="flex items-center gap-2"><code className="font-black text-gray-900 tracking-wider">{item.code}</code><span className={`text-xs px-2 py-1 rounded-full font-bold ${item.active ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{item.active ? "Activo" : "Pausado"}</span></div><p className="text-sm text-gray-500 mt-1">{item.discountType === "percent" ? `${item.discountValue}% de descuento` : `${money(item.discountValue)} de descuento`}{item.minimumSubtotal ? ` · Compra mínima ${money(item.minimumSubtotal)}` : ""} · {item.usedCount}{item.usageLimit ? `/${item.usageLimit}` : ""} usos</p></div><div className="flex gap-2"><button onClick={() => toggle(item)} className="border rounded-xl px-3 py-2 text-sm font-bold">{item.active ? "Pausar" : "Activar"}</button><button onClick={() => startEdit(item)} className="border rounded-xl px-3 py-2 text-sm font-bold"><i className="fa-solid fa-pen mr-2" />Editar</button></div></div>)}</div>}</div>
    {open && <div className="fixed inset-0 z-50 bg-black/40 p-4 grid place-items-center"><form onSubmit={save} className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-auto"><div className="p-6 border-b flex justify-between"><div><h2 className="text-xl font-black">{editingId ? "Editar cupón" : "Nuevo cupón"}</h2><p className="text-sm text-gray-500">Define reglas claras para proteger tu margen.</p></div><button type="button" onClick={() => setOpen(false)} aria-label="Cerrar"><i className="fa-solid fa-xmark" /></button></div><div className="p-6 grid sm:grid-cols-2 gap-4"><label className="sm:col-span-2 text-sm font-bold">Código<input value={form.code} onChange={e => setForm({...form, code:e.target.value.toUpperCase()})} className="mt-1 w-full border rounded-xl p-3 uppercase" placeholder="BIENVENIDA10" /></label><label className="sm:col-span-2 text-sm font-bold">Descripción<input value={form.description} onChange={e => setForm({...form, description:e.target.value})} className="mt-1 w-full border rounded-xl p-3" placeholder="Para nuevos clientes" /></label><label className="text-sm font-bold">Tipo<select value={form.discountType} onChange={e => setForm({...form, discountType:e.target.value as any})} className="mt-1 w-full border rounded-xl p-3 bg-white"><option value="percent">Porcentaje</option><option value="amount">Valor fijo</option></select></label><label className="text-sm font-bold">Descuento<input type="number" min="1" value={form.discountValue} onChange={e => setForm({...form, discountValue:Number(e.target.value)})} className="mt-1 w-full border rounded-xl p-3" /></label><label className="text-sm font-bold">Compra mínima<input type="number" min="0" value={form.minimumSubtotal} onChange={e => setForm({...form, minimumSubtotal:Number(e.target.value)})} className="mt-1 w-full border rounded-xl p-3" /></label><label className="text-sm font-bold">Límite de usos<input type="number" min="1" value={form.usageLimit} onChange={e => setForm({...form, usageLimit:e.target.value})} className="mt-1 w-full border rounded-xl p-3" placeholder="Sin límite" /></label><label className="text-sm font-bold">Empieza<input type="datetime-local" value={form.startsAt} onChange={e => setForm({...form, startsAt:e.target.value})} className="mt-1 w-full border rounded-xl p-3" /></label><label className="text-sm font-bold">Termina<input type="datetime-local" value={form.expiresAt} onChange={e => setForm({...form, expiresAt:e.target.value})} className="mt-1 w-full border rounded-xl p-3" /></label><label className="sm:col-span-2 flex gap-3 items-center"><input type="checkbox" checked={form.active} onChange={e => setForm({...form, active:e.target.checked})} /><span className="font-bold">Disponible para clientes</span></label>{error && <p className="sm:col-span-2 text-sm text-red-600">{error}</p>}</div><div className="p-6 border-t flex justify-end gap-3"><button type="button" onClick={() => setOpen(false)} className="border rounded-xl px-5 py-3 font-bold">Cancelar</button><button disabled={busy} className="bg-indigo-600 text-white rounded-xl px-5 py-3 font-bold disabled:opacity-50">{busy ? "Guardando..." : "Guardar cupón"}</button></div></form></div>}
  </div>;
};
export default CouponsView;
