import { createPublicOrder } from "../server/orderActions.js";
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const result = await createPublicOrder(req.body || {});
  return res.status(result.status).json(result);
}
