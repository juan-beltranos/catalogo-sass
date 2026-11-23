import React from "react";
import { MAX_STOCK } from "@/helpers/inventory";

export default function StockEditor({ enabled, stock, hasVariants, onEnabledChange, onStockChange }: {
  enabled: boolean; stock: number; hasVariants: boolean;
  onEnabledChange: (enabled: boolean) => void; onStockChange: (stock: number) => void;
}) {
  return <div className="rounded-lg border p-4 space-y-3">
    <label className="flex items-center gap-2 font-medium text-sm">
      <input type="checkbox" checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} />
      Controlar stock
    </label>
    {enabled && !hasVariants && <label className="block text-sm">
      Unidades disponibles
      <input aria-label="Stock del producto" type="number" min={0} max={MAX_STOCK} step={1} required
        value={stock} onChange={(e) => onStockChange(e.target.value === "" ? 0 : e.target.valueAsNumber)}
        className="mt-1 w-full rounded border p-2" />
    </label>}
    <p className="text-xs text-gray-500">{!enabled ? "Disponible sin límite de unidades."
      : hasVariants ? "Las existencias se controlan por variante. Configura las unidades de cada variante abajo."
      : "Cada pedido descuenta unidades. Al cancelar, se devuelven automáticamente. Con 0 unidades aparece agotado."}</p>
  </div>;
}
