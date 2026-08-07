import React from "react";
import type { CommerceRules, PricingRule, ShippingRule } from "@/types";

type Props = { value: CommerceRules; onChange: (value: CommerceRules) => void };
const numberOrUndefined = (value: string) => value === "" ? undefined : Number(value);

export default function CommerceRulesEditor({ value, onChange }: Props) {
  const patchPrice = (id: string, patch: Partial<PricingRule>) => onChange({ ...value,
    pricing: value.pricing.map((rule) => rule.id === id ? { ...rule, ...patch } : rule) });
  const patchShipping = (id: string, patch: Partial<ShippingRule>) => onChange({ ...value,
    shipping: value.shipping.map((rule) => rule.id === id ? { ...rule, ...patch } : rule) });
  const addPrice = () => onChange({ ...value, pricing: [...value.pricing, { id: `price_${Date.now()}`,
    name: "Precio por cantidad", enabled: true, priority: value.pricing.length + 1,
    condition: { minQuantity: 1, maxQuantity: 1 }, action: "fixed_subtotal", value: 0, stopProcessing: true }] });
  const addShipping = () => onChange({ ...value, shipping: [...value.shipping, { id: `shipping_${Date.now()}`,
    name: "Tarifa por condicion", enabled: true, priority: value.shipping.length + 1,
    shippingMethod: "all", condition: { minQuantity: 1 }, action: "fixed_cost", value: 0, stopProcessing: true }] });

  return <div className="bg-white border rounded-xl p-6 space-y-6">
    <div><h2 className="font-bold text-gray-900">Reglas de precios y envio</h2>
      <p className="mt-1 text-xs text-gray-500">Crea paquetes, descuentos y tarifas automaticas. Gana la regla activa con mayor prioridad.</p></div>
    <section className="space-y-3">
      <div className="flex items-center justify-between"><div><h3 className="text-sm font-bold">Precios y promociones</h3>
        <p className="text-xs text-gray-400">La cantidad es el total de unidades del carrito.</p></div>
        <button type="button" onClick={addPrice} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white">+ Agregar</button></div>
      {!value.pricing.length && <Empty text="Se usaran los precios normales." />}
      {value.pricing.map((rule) => <div key={rule.id} className="space-y-3 rounded-xl border p-4">
        <RuleHeader name={rule.name} enabled={rule.enabled} onName={(name) => patchPrice(rule.id, { name })}
          onEnabled={(enabled) => patchPrice(rule.id, { enabled })}
          onDelete={() => onChange({ ...value, pricing: value.pricing.filter((item) => item.id !== rule.id) })} />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
          <NumberField label="Cantidad min." value={rule.condition.minQuantity} onChange={(minQuantity) => patchPrice(rule.id, { condition: { ...rule.condition, minQuantity } })} />
          <NumberField label="Cantidad max." value={rule.condition.maxQuantity} onChange={(maxQuantity) => patchPrice(rule.id, { condition: { ...rule.condition, maxQuantity } })} />
          <NumberField label="Subtotal min." value={rule.condition.minSubtotal} onChange={(minSubtotal) => patchPrice(rule.id, { condition: { ...rule.condition, minSubtotal } })} />
          <SelectField label="Accion" value={rule.action} onChange={(action) => patchPrice(rule.id, { action: action as PricingRule["action"] })}
            options={[["fixed_subtotal", "Subtotal fijo"], ["percent_discount", "Descuento %"], ["amount_discount", "Descuento fijo"]]} />
          <NumberField label="Valor" value={rule.value} onChange={(v) => patchPrice(rule.id, { value: v || 0 })} />
          <NumberField label="Prioridad" value={rule.priority} onChange={(v) => patchPrice(rule.id, { priority: v || 0 })} />
        </div>
      </div>)}
    </section>
    <section className="space-y-3 border-t pt-5">
      <div className="flex items-center justify-between"><div><h3 className="text-sm font-bold">Condiciones de envio</h3>
        <p className="text-xs text-gray-400">Modifican el costo base del metodo seleccionado.</p></div>
        <button type="button" onClick={addShipping} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white">+ Agregar</button></div>
      {!value.shipping.length && <Empty text="Se usara el costo normal de envio." />}
      {value.shipping.map((rule) => <div key={rule.id} className="space-y-3 rounded-xl border p-4">
        <RuleHeader name={rule.name} enabled={rule.enabled} onName={(name) => patchShipping(rule.id, { name })}
          onEnabled={(enabled) => patchShipping(rule.id, { enabled })}
          onDelete={() => onChange({ ...value, shipping: value.shipping.filter((item) => item.id !== rule.id) })} />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-7">
          <NumberField label="Cantidad min." value={rule.condition.minQuantity} onChange={(minQuantity) => patchShipping(rule.id, { condition: { ...rule.condition, minQuantity } })} />
          <NumberField label="Cantidad max." value={rule.condition.maxQuantity} onChange={(maxQuantity) => patchShipping(rule.id, { condition: { ...rule.condition, maxQuantity } })} />
          <NumberField label="Subtotal min." value={rule.condition.minSubtotal} onChange={(minSubtotal) => patchShipping(rule.id, { condition: { ...rule.condition, minSubtotal } })} />
          <SelectField label="Metodo" value={rule.shippingMethod || "all"} onChange={(shippingMethod) => patchShipping(rule.id, { shippingMethod: shippingMethod as ShippingRule["shippingMethod"] })} options={[["all", "Todos"], ["cod", "Contra entrega"], ["carrier", "Transportadora"]]} />
          <SelectField label="Accion" value={rule.action} onChange={(action) => patchShipping(rule.id, { action: action as ShippingRule["action"] })} options={[["fixed_cost", "Costo fijo"], ["free_shipping", "Envio gratis"], ["amount_discount", "Descontar valor"]]} />
          <NumberField label="Valor" value={rule.value} disabled={rule.action === "free_shipping"} onChange={(v) => patchShipping(rule.id, { value: v || 0 })} />
          <NumberField label="Prioridad" value={rule.priority} onChange={(v) => patchShipping(rule.id, { priority: v || 0 })} />
        </div>
      </div>)}
    </section>
  </div>;
}

const Empty = ({ text }: { text: string }) => <div className="rounded-lg border border-dashed p-4 text-center text-xs text-gray-400">{text}</div>;
const RuleHeader = ({ name, enabled, onName, onEnabled, onDelete }: any) => <div className="flex gap-2">
  <input className="min-w-0 flex-1 rounded-lg border p-2 text-sm font-semibold" value={name} onChange={(e) => onName(e.target.value)} />
  <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} /> Activa</label>
  <button type="button" className="px-2 text-red-500" onClick={onDelete} aria-label="Eliminar regla"><i className="fa-solid fa-trash" /></button></div>;
const NumberField = ({ label, value, onChange, disabled }: any) => <label className="text-xs text-gray-500">{label}<input type="number" min="0" disabled={disabled} className="mt-1 w-full rounded border p-2 disabled:bg-gray-100" value={value ?? ""} onChange={(e) => onChange(numberOrUndefined(e.target.value))} /></label>;
const SelectField = ({ label, value, onChange, options }: any) => <label className="text-xs text-gray-500">{label}<select className="mt-1 w-full rounded border p-2" value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([key, text]: string[]) => <option key={key} value={key}>{text}</option>)}</select></label>;
