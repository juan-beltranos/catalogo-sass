import { registerStore } from "../server/registerStore";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Metodo no permitido" });
    return;
  }

  const result = await registerStore(req.body ?? {}, process.env);

  if (!result.ok) {
    res.status("status" in result ? result.status : 500).json(result);
    return;
  }

  res.status(200).json(result);
}
