/** Stock is optional until the merchant enables inventory for a product. */
export const MAX_STOCK = 2147483647;

export function parseStock(value: unknown): number {
  const text = String(value ?? "").trim();
  const stock = Number(text);
  if (!text || !Number.isSafeInteger(stock) || stock < 0 || stock > MAX_STOCK) {
    throw new Error("El stock debe ser un número entero entre 0 y 2147483647.");
  }
  return stock;
}

type StockProduct = {
  trackStock?: boolean;
  stock?: number;
  variants?: { id: string; stock?: number }[];
};

export function availableStock(product?: StockProduct | null, variantId?: string | null): number | undefined {
  if (!product?.trackStock) return undefined;
  if (product.variants?.length) {
    if (!variantId) return product.variants.reduce((sum, variant) => sum + Number(variant.stock ?? 0), 0);
    return Number(product.variants.find((variant) => variant.id === variantId)?.stock ?? 0);
  }
  return Number(product.stock ?? 0);
}

export function inventorySnapshot(product: StockProduct) {
  return {
    stock: Number(product.stock ?? 0),
    trackStock: product.trackStock === true,
    variants: (product.variants ?? []).map(({ id, stock }) => ({ id, stock: Number(stock ?? 0) }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function exportInventoryFields(product: StockProduct) {
  return {
    "Controlar stock": product.trackStock ? "Sí" : "No",
    Stock: Number(product.stock ?? 0),
    "Stock disponible": availableStock(product) ?? "Sin límite",
    "Inventario original": JSON.stringify(inventorySnapshot(product)),
  };
}

export function parseInventoryFields(row: Record<string, unknown>) {
  const fields: { stock?: number; trackStock?: boolean; expectedInventory?: unknown } = {};
  const hasStock = String(row.Stock ?? "").trim() !== "";
  if (hasStock) fields.stock = parseStock(row.Stock);
  const tracking = String(row["Controlar stock"] ?? "").trim().toLowerCase();
  if (tracking && !/^(sí|si|yes|true|1|no|false|0)$/.test(tracking)) throw new Error("Controlar stock debe ser Sí o No.");
  if (tracking) fields.trackStock = /^(sí|si|yes|true|1)$/.test(tracking);
  else if (hasStock) fields.trackStock = true;
  const original = String(row["Inventario original"] ?? "").trim();
  if (original) {
    fields.expectedInventory = JSON.parse(original);
    if (!fields.expectedInventory || typeof fields.expectedInventory !== "object") throw new Error("Inventario original inválido. Exporta nuevamente el archivo.");
  }
  return fields;
}
