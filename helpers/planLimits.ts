type LimitResource = "products" | "categories";

const labels: Record<LimitResource, string> = {
  products: "productos",
  categories: "categorias",
};

export function getPlanLimitMessage(error: unknown): string | null {
  const raw = String((error as any)?.message || error || "");
  const match = raw.match(/plan_limit_exceeded:(products|categories):(\d+)/i);
  if (!match) return null;

  const resource = match[1].toLowerCase() as LimitResource;
  const limit = Number(match[2]);
  const plan = resource === "products"
    ? (limit === 30 ? "Basic" : limit === 200 ? "Pro" : "actual")
    : (limit === 3 ? "Basic" : limit === 6 ? "Pro" : "actual");

  return `Has alcanzado el limite de ${limit} ${labels[resource]} permitido por el plan ${plan}.`;
}
