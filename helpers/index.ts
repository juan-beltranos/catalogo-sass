import { CartItem, Product } from "@/types";
import { buildInternationalPhone, formatStoreCurrency, getLatamCountry } from "@/helpers/latamCountries";

let activeCurrencyCountry = "CO";
export const setActiveCurrencyCountry = (countryCode?: string) => {
    activeCurrencyCountry = String(countryCode || "CO").toUpperCase();
};
export const getActiveCurrencyCode = () => getLatamCountry(activeCurrencyCountry).currency;

export function slugify(input: string) {
    return input
        .toLowerCase()
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // quita acentos
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "");
}

export function formatCOP(value: number) {
    return formatStoreCurrency(value, activeCurrencyCountry);
}

// Convierte "25.000" / "25,000" / "$ 25.000" a 25000
export function parseCOP(input: string): number {
    const clean = String(input || "").replace(/[^\d.,-]/g, "");
    if (!clean) return 0;
    const lastDot = clean.lastIndexOf(".");
    const lastComma = clean.lastIndexOf(",");
    const separator = Math.max(lastDot, lastComma);
    if (separator >= 0 && clean.length - separator - 1 <= 2) {
        const normalized = clean.slice(0, separator).replace(/[^\d-]/g, "") + "." + clean.slice(separator + 1).replace(/\D/g, "");
        return Number(normalized) || 0;
    }
    return Number(clean.replace(/[^\d-]/g, "")) || 0;
}

export function cartStorageKey(slug: string) {
    return `cart:${slug}`;
}

export function calcTotal(cart: CartItem[]) {
    return cart.reduce((acc, it) => acc + it.unitPrice * it.qty, 0);
}

export function buildWaLink(phoneDigits: string, message: string) {
    const cleanPhone = phoneDigits.replace(/[^\d]/g, "");
    const text = encodeURIComponent(message);
    return `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${text}`;
}

export function getProductMainImage(p: Product): string | undefined {
    if (p.images?.length && p.images[0]?.url) return p.images[0].url;
    if (p.imageUrl) return p.imageUrl;
    return undefined;
}

export function getProductDisplayPrice(p: Product): { label: string; value: number } {
    const variants = p.variants || [];
    if (variants.length) {
        const min = Math.min(...variants.map((v) => Number(v.price || 0)).filter((x) => x > 0));
        return { label: `Desde ${formatCOP(min || 0)}`, value: min || 0 };
    }
    return { label: formatCOP(Number(p.price || 0)), value: Number(p.price || 0) };
}

export function formatDate(ts: any) {
    try {
        const d = ts?.toDate?.() ? ts.toDate() : null;
        if (!d) return "-";
        return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    } catch {
        return "-";
    }
}
export function waTo(phoneDigits: string, message?: string) {
    const clean = buildInternationalPhone(activeCurrencyCountry, phoneDigits);
    const text = encodeURIComponent(message || "");
    return `https://api.whatsapp.com/send?phone=${clean}${message ? `&text=${text}` : ""}`;
}

export const phoneForWhatsApp = (phone: string) =>
  buildInternationalPhone(activeCurrencyCountry, phone);

export function safeDate(ts: any) {
  try {
    const d = ts?.toDate?.() ? ts.toDate() : null;
    return d;
  } catch {
    return null;
  }
}

export function relativeTime(ts: any) {
  const d = safeDate(ts);
  if (!d) return "-";
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Ahora";
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `Hace ${days} d`;
}

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export const uid = () => Math.random().toString(36).slice(2, 10);
export const normalizePhone = (p: string) => (p || "").replace(/[^\d]/g, "");

export const norm = (s: any) =>
    String(s ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();

