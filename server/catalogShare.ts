import { createClient } from "@supabase/supabase-js";
import ws from "ws";

type Env = Record<string, string | undefined>;

const envValue = (env: Env, ...names: string[]) => {
  for (const name of names) {
    const value = env[name];
    if (value) return value;
  }
  return "";
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const absoluteUrl = (url: string | null | undefined, origin: string) => {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${origin}${url.startsWith("/") ? url : `/${url}`}`;
};

const getSupabase = (env: Env) => {
  const url = envValue(env, "SUPABASE_URL", "VITE_SUPABASE_URL", "VITE_PUBLIC_SUPABASE_URL");
  const key = envValue(
    env,
    "SUPABASE_SERVICE_ROLE_KEY",
    "VITE_SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "VITE_SUPABASE_ANON_KEY",
    "VITE_PUBLIC_SUPABASE_ANON_KEY",
  );
  if (!url || !key) throw new Error("Faltan variables de Supabase para generar el preview.");
  return createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: ws as any },
  });
};

export async function buildCatalogShareHtml(params: {
  slug: string;
  origin: string;
  query?: string;
  env: Env;
}) {
  const slug = params.slug.trim().replace(/^\/+|\/+$/g, "");
  const appPath = `/#/${encodeURIComponent(slug)}${params.query || ""}`;
  const shareUrl = `${params.origin}/c/${encodeURIComponent(slug)}${params.query || ""}`;
  const fallbackTitle = "Catalogo seguro";
  const fallbackDescription = "Abre el catalogo oficial de esta tienda.";

  if (!slug) {
    return {
      status: 404,
      html: renderShareHtml({
        title: fallbackTitle,
        description: fallbackDescription,
        imageUrl: "",
        shareUrl,
        redirectUrl: appPath,
      }),
    };
  }

  const supabase = getSupabase(params.env);
  const { data: store, error } = await supabase
    .from("stores")
    .select("name, slug, logo_url, banner_url, business_type, city, status")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;

  if (!store || store.status === "inactive") {
    return {
      status: 404,
      html: renderShareHtml({
        title: "Catalogo no disponible",
        description: "Este catalogo no esta disponible en este momento.",
        imageUrl: "",
        shareUrl,
        redirectUrl: appPath,
      }),
    };
  }

  const business = [store.business_type, store.city].filter(Boolean).join(" en ");
  const title = `Catalogo oficial de ${store.name}`;
  const description = business
    ? `Compra con confianza en el catalogo seguro de ${store.name}, ${business}.`
    : `Compra con confianza en el catalogo seguro de ${store.name}.`;
  const imageUrl = absoluteUrl(store.logo_url || store.banner_url, params.origin);

  return {
    status: 200,
    html: renderShareHtml({
      title,
      description,
      imageUrl,
      shareUrl,
      redirectUrl: appPath,
    }),
  };
}

function renderShareHtml(params: {
  title: string;
  description: string;
  imageUrl: string;
  shareUrl: string;
  redirectUrl: string;
}) {
  const title = escapeHtml(params.title);
  const description = escapeHtml(params.description);
  const imageUrl = escapeHtml(params.imageUrl);
  const shareUrl = escapeHtml(params.shareUrl);
  const redirectUrl = escapeHtml(params.redirectUrl);
  const imageMeta = imageUrl
    ? `
    <meta property="og:image" content="${imageUrl}">
    <meta property="og:image:secure_url" content="${imageUrl}">
    <meta name="twitter:image" content="${imageUrl}">`
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="CatalogoSaaS">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${shareUrl}">
  ${imageMeta}
  <meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <link rel="canonical" href="${shareUrl}">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="shortcut icon" href="/favicon.svg">
  <meta name="theme-color" content="#4f46e5">
  <meta http-equiv="refresh" content="0;url=${redirectUrl}">
</head>
<body>
  <script>window.location.replace(${JSON.stringify(params.redirectUrl)});</script>
  <p>Abriendo catalogo seguro...</p>
</body>
</html>`;
}
