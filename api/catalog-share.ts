import { buildCatalogShareHtml } from "../server/catalogShare.js";

export default async function handler(req: any, res: any) {
  try {
    const rawSlug = Array.isArray(req.query?.slug) ? req.query.slug[0] : req.query?.slug;
    const slug = String(rawSlug || "").trim();
    const query = new URLSearchParams(req.query || {});
    query.delete("slug");
    const queryString = query.toString() ? `?${query.toString()}` : "";
    const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0];
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0];
    const origin = `${proto}://${host}`;

    const result = await buildCatalogShareHtml({
      slug,
      origin,
      query: queryString,
      env: process.env,
    });

    res.status(result.status);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600");
    res.send(result.html);
  } catch (error: any) {
    console.error(error);
    res.status(500).send("No se pudo generar el preview del catalogo.");
  }
}
