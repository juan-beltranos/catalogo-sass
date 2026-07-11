import { CartItem, Product } from "@/types";

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
    return new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
    }).format(value);
}

// Convierte "25.000" / "25,000" / "$ 25.000" a 25000
export function parseCOP(input: string): number {
    const onlyDigits = input.replace(/[^\d]/g, "");
    return onlyDigits ? parseInt(onlyDigits, 10) : 0;
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
    const clean = (phoneDigits || "").replace(/[^\d]/g, "");
    const text = encodeURIComponent(message || "");
    return `https://api.whatsapp.com/send?phone=${clean}${message ? `&text=${text}` : ""}`;
}

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

