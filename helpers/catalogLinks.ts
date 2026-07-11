const cleanSlug = (slug: string) => slug.replace(/^\/+|\/+$/g, "");

const buildQuery = (params?: Record<string, string | undefined>) => {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const text = query.toString();
  return text ? `?${text}` : "";
};

export const getCatalogAppPath = (slug: string, params?: Record<string, string | undefined>) =>
  `/#/${cleanSlug(slug)}${buildQuery(params)}`;

export const getCatalogSharePath = (slug: string, params?: Record<string, string | undefined>) =>
  `/c/${cleanSlug(slug)}${buildQuery(params)}`;

export const getCatalogShareUrl = (
  slug: string,
  params?: Record<string, string | undefined>,
  origin = window.location.origin,
) => `${origin}${getCatalogSharePath(slug, params)}`;
