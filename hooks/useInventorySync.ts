import { useEffect, useRef } from "react";
import { syncedInventory } from "../helpers/inventory";

export type InventoryRows = Map<string, { stock: number; trackStock: boolean; variants: Map<string, number> }>;
export function mergeInventory<T extends { id: string; stock?: number; trackStock?: boolean; variants?: { id: string; stock?: number }[] }>(product: T, rows: InventoryRows): T {
  const inventory = rows.get(product.id);
  if (!inventory) return product;
  return { ...product, stock: inventory.stock, trackStock: inventory.trackStock,
    variants: product.variants?.map((variant) => ({ ...variant, stock: inventory.variants.get(variant.id) ?? 0 })) };
}

/** Refresh visible inventory across sessions even when Realtime is not enabled on the project. */
export function useInventorySync(client: any, storeId: string | null | undefined, ids: string[], onUpdate: (rows: InventoryRows) => void, inactiveAsUnavailable = true) {
  const updateRef = useRef(onUpdate);
  updateRef.current = onUpdate;
  const key = [...new Set(ids)].sort().join(",");
  useEffect(() => {
    if (!storeId || !key) return;
    let active = true;
    let loading = false;
    const refresh = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const rows: InventoryRows = new Map();
        const productIds = key.split(",");
        for (let start = 0; start < productIds.length; start += 100) {
          const batch = productIds.slice(start, start + 100);
          const { data, error } = await client.from("products").select("id,stock,track_stock,is_active,product_variants(id,stock)").eq("store_id", storeId).in("id", batch);
          if (error) throw error;
          for (const row of data ?? []) rows.set(row.id, syncedInventory(row, inactiveAsUnavailable));
          for (const id of batch) if (!rows.has(id)) rows.set(id, { stock: 0, trackStock: true, variants: new Map() });
        }
        if (active) updateRef.current(rows);
      } catch (error) { console.error("No se pudo sincronizar el inventario", error); }
      finally { loading = false; }
    };
    void refresh();
    // Un sondeo cada 10 segundos multiplicaba el egress y los logs por cada
    // visitante del catálogo. Un minuto mantiene el inventario razonablemente
    // fresco; al volver a la pestaña o enfocarla se actualiza de inmediato y el
    // checkout vuelve a validar existencias antes de confirmar el pedido.
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [client, storeId, key, inactiveAsUnavailable]);
}
