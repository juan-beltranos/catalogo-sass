import { runCategoryAction } from "../server/categoryActions.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const result = await runCategoryAction(req.body || {}, req.headers.authorization);
    return res.status(result.status).json(result);
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ ok: false, error: error?.message || "No se pudo guardar la categoria." });
  }
}
