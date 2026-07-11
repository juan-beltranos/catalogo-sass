import { formatCOP } from "@/helpers";
import { Product } from "@/interfaces";
import { Variant } from "@/types";

export type Discount = { type: "percent" | "amount"; value: number } | null | undefined;

export const hasValidDiscount = (discount: Discount) => {
    if (!discount) return false;
    const v = Number(discount.value || 0);
    return v > 0;
};

export const applyDiscount = (base: number, discount: Discount) => {
    const price = Number(base || 0);
    if (!price) return 0;
    if (!hasValidDiscount(discount)) return price;

    if (discount!.type === "percent") {
        const pct = Math.min(100, Math.max(0, Number(discount!.value) || 0));
        return Math.max(0, Math.round(price * (1 - pct / 100)));
    }

    const amt = Math.max(0, Number(discount!.value) || 0);
    return Math.max(0, price - amt);
};

export const discountBadgeText = (discount: Discount) => {
    if (!hasValidDiscount(discount)) return null;

    if (discount!.type === "percent") {
        const pct = Math.min(100, Math.max(0, Number(discount!.value) || 0));
        return pct ? `-${pct}%` : null;
    }

    const amt = Math.max(0, Number(discount!.value) || 0);
    return amt ? `-${formatCOP(amt)}` : null;
};

// Precio base (sin descuento) según variante o producto
export const getBaseUnitPrice = (p: Product, v?: Variant, isWholesale = false) => {
    const wholesalePrice = Number(p.wholesalePrice || 0);
    if (isWholesale && wholesalePrice > 0) return wholesalePrice;
    return v ? Number(v.price || 0) : Number(p.price || 0);
};

// Precio final (con descuento) según variante o producto
export const getFinalUnitPrice = (p: Product, v?: Variant, isWholesale = false) =>
    isWholesale && Number(p.wholesalePrice || 0) > 0
        ? getBaseUnitPrice(p, v, true)
        : applyDiscount(getBaseUnitPrice(p, v), (p as any).discount);

// Para cards: si tiene variantes, muestra "Desde ..." ya con descuento aplicado
export const getProductCardPrice = (p: Product, isWholesale = false) => {
    const wholesalePrice = Number(p.wholesalePrice || 0);
    if (isWholesale && wholesalePrice > 0) {
        return { hasVariants: false, base: wholesalePrice, final: wholesalePrice };
    }
    const vars = (p.variants || []) as Variant[];
    const hasVars = vars.length > 0;

    if (!hasVars) {
        const base = Number(p.price || 0);
        const final = getFinalUnitPrice(p);
        return { hasVariants: false, base, final };
    }

    const prices = vars.map(v => Number(v.price || 0)).filter(n => n > 0);
    const minBase = prices.length ? Math.min(...prices) : 0;
    const minFinal = applyDiscount(minBase, (p as any).discount);

    return { hasVariants: true, base: minBase, final: minFinal };
};
