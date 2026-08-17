import { adminStoresAction } from "../server/adminStores.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const result = await adminStoresAction(req.body || {}, req.headers.authorization);
    return res.status(result.status).json(result);
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error?.message || "No se pudieron cargar las tiendas." });
  }
}
