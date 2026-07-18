import { supabase } from "./supabase";

export type DocumentData = Record<string, any>;
export type QueryConstraint = { type: string; [key: string]: any };

type CollectionRef = {
  kind: "collection";
  path: string[];
  table: string;
  storeId?: string;
};

type DocRef = {
  kind: "doc";
  path: string[];
  table: string;
  id?: string;
  storeId?: string;
};

type QueryRef = CollectionRef & { constraints: QueryConstraint[] };

const nowIso = () => new Date().toISOString();
const isUuid = (value: any) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value ?? ""),
  );

const randomId = () => crypto.randomUUID();

const chunkArray = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const findLastConstraint = (
  constraints: QueryConstraint[],
  predicate: (constraint: QueryConstraint) => boolean,
) => [...constraints].reverse().find(predicate);

const selectByForeignKey = async (
  table: string,
  foreignKey: string,
  ids: string[],
  orderField?: string,
) => {
  const rows: any[] = [];
  for (const chunk of chunkArray(ids, 100)) {
    let request = supabase.from(table).select("*").in(foreignKey, chunk);
    if (orderField) request = request.order(orderField);
    const { data, error } = await request;
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
};

const TABLE_ALIASES: Record<string, string> = {
  subscriptionPayments: "subscription_payments",
};

const tableForPath = (path: string[]) => {
  if (path.length === 1 && path[0] === "stores") return "stores";
  const leaf = path[path.length - 1];
  const allowed = new Set([
    "products",
    "categories",
    "orders",
    "clients",
    "subscriptionPayments",
  ]);
  const logical = allowed.has(leaf) ? leaf : path[0] === "stores" && allowed.has(path[2]) ? path[2] : leaf;
  return TABLE_ALIASES[logical] ?? logical;
};

const storeIdForPath = (path: string[]) =>
  path[0] === "stores" && path.length >= 3 ? path[1] : undefined;

const cleanData = (value: any): any => {
  if (Array.isArray(value)) return value.map(cleanData);
  if (value && typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    if (value.__op === "serverTimestamp") return nowIso();
    if (value.__op === "timestamp") return value.value;
    if (value.__op === "increment") return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanData(v)]));
  }
  return value;
};

const getShippingSettings = (row: any) => row.shipping_settings ?? {};

const dbStoreToApp = async (row: any) => {
  const shipping = getShippingSettings(row);
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("store_id", row.id)
    .maybeSingle();

  const subscriptionEnd = subscription?.subscription_end_at ?? subscription?.current_period_ends_at ?? null;
  const trialEndsAt = subscription?.subscription_status === "trial"
    ? subscriptionEnd : subscription?.trial_ends_at ?? null;
  const hasActiveSubscription =
    (subscription?.subscription_status === "active" || subscription?.subscription_status === "trial") &&
    Boolean(subscriptionEnd) && Date.now() <= Date.parse(subscriptionEnd);

  return {
    ...row,
    ownerUid: row.owner_id,
    ownerEmail: row.owner_email ?? row.contact_email ?? "",
    businessType: row.business_type,
    isActive: row.status !== "inactive",
    brandColor: row.brand_color,
    logoUrl: row.logo_url,
    bannerUrl: row.banner_url,
    email: row.contact_email,
    shippingEnabled: shipping.enabled ?? false,
    shippingMethods: shipping.methods ?? ["cod"],
    shippingCostCOD: shipping.costCOD ?? 0,
    shippingCostCarrier: shipping.costCarrier ?? 0,
    shippingNote: shipping.note ?? "",
    shippingHidePrices: shipping.hidePrices ?? false,
    countryCode: shipping.countryCode ?? "CO",
    checkoutFields: row.checkout_fields ?? [],
    hasActiveSubscription,
    subscriptionStatus: subscription?.subscription_status ?? subscription?.status ?? "inactive",
    subscriptionType: subscription?.subscription_status === "trial" ? "free_trial" : "subscription",
    subscriptionEndAt: subscriptionEnd,
    subscriptionEndsAt: subscriptionEnd,
    trialEndsAt,
    trialEndsAtMs: trialEndsAt ? Date.parse(trialEndsAt) : null,
    hasFreeTrial: subscription?.subscription_status === "trial",
    freeTrialStatus: subscription?.subscription_status === "trial" ? "active" : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const appStoreToDb = (data: any) => {
  const payload: any = {};
  if ("ownerUid" in data) payload.owner_id = data.ownerUid;
  if ("ownerEmail" in data) payload.contact_email = data.ownerEmail;
  if ("name" in data) payload.name = data.name;
  if ("slug" in data) payload.slug = data.slug;
  if ("businessType" in data) payload.business_type = data.businessType;
  if ("city" in data) payload.city = data.city;
  if ("whatsapp" in data) payload.whatsapp = data.whatsapp;
  if ("address" in data) payload.address = data.address;
  if ("description" in data) payload.description = data.description;
  if ("isActive" in data) payload.status = data.isActive === false ? "inactive" : "active";
  if ("brandColor" in data) payload.brand_color = data.brandColor;
  if ("logoUrl" in data) payload.logo_url = data.logoUrl;
  if ("bannerUrl" in data) payload.banner_url = data.bannerUrl;
  if ("instagram" in data) payload.instagram = data.instagram;
  if ("facebook" in data) payload.facebook = data.facebook;
  if ("email" in data) payload.contact_email = data.email;
  if ("phone" in data) payload.phone = data.phone;
  if ("location" in data) payload.location = data.location;
  if ("checkoutFields" in data) payload.checkout_fields = data.checkoutFields ?? [];
  if ("createdAt" in data) payload.created_at = data.createdAt;
  if ("updatedAt" in data) payload.updated_at = data.updatedAt;

  if (!("status" in payload) && ("name" in data || "slug" in data)) {
    payload.status = data.isActive === false ? "inactive" : "active";
  }
  if (!("brand_color" in payload) && ("name" in data || "slug" in data)) {
    payload.brand_color = data.brandColor ?? "#6366f1";
  }
  if (!("shipping_settings" in payload) && ("name" in data || "slug" in data)) {
    payload.shipping_settings = {};
  }
  if (!("checkout_fields" in payload) && ("name" in data || "slug" in data)) {
    payload.checkout_fields = [];
  }

  const shippingKeys = [
    "shippingEnabled",
    "shippingMethods",
    "shippingCostCOD",
    "shippingCostCarrier",
    "shippingNote",
    "shippingHidePrices",
  ];
  if (shippingKeys.some((key) => key in data)) {
    payload.shipping_settings = {
      enabled: data.shippingEnabled ?? false,
      methods: data.shippingMethods ?? ["cod"],
      costCOD: Number(data.shippingCostCOD ?? 0),
      costCarrier: Number(data.shippingCostCarrier ?? 0),
      note: data.shippingNote ?? "",
      hidePrices: data.shippingHidePrices ?? false,
      countryCode: data.countryCode ?? getShippingSettings(data).countryCode ?? "CO",
    };
  }
  return payload;
};

const dbCategoryToApp = (row: any) => ({
  ...row,
  storeId: row.store_id,
  order: row.sort_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const appCategoryToDb = (data: any, storeId?: string) => ({
  ...(storeId ? { store_id: storeId } : {}),
  ...("name" in data ? { name: data.name } : {}),
  ...("order" in data ? { sort_order: data.order } : {}),
  ...("createdAt" in data ? { created_at: data.createdAt } : {}),
  ...("updatedAt" in data ? { updated_at: data.updatedAt } : {}),
});

const productBaseToApp = (row: any) => {
  const discount =
    row.discount_type && row.discount_value !== null
      ? { type: row.discount_type, value: Number(row.discount_value) }
      : null;
  return {
    ...row,
    storeId: row.store_id,
    categoryId: row.category_id ?? "",
    price: Number(row.base_price ?? 0),
    wholesalePrice: row.wholesale_price === null ? null : Number(row.wholesale_price),
    discount,
    isActive: row.is_active,
    allowsCashOnDelivery: row.allow_cash_on_delivery,
    order: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    images: [],
    videos: [],
    options: [],
    variants: [],
  };
};

const hydrateProducts = async (rows: any[]) => {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);

  const [imageRows, videoRows, optionRows, variantRows] = await Promise.all([
    selectByForeignKey("product_images", "product_id", ids, "sort_order"),
    selectByForeignKey("product_videos", "product_id", ids, "sort_order"),
    selectByForeignKey("product_options", "product_id", ids, "sort_order"),
    selectByForeignKey("product_variants", "product_id", ids, "created_at"),
  ]);

  const byProduct = <T extends { product_id: string }>(items: T[] = []) => {
    const map = new Map<string, T[]>();
    items.forEach((item) => map.set(item.product_id, [...(map.get(item.product_id) ?? []), item]));
    return map;
  };

  const images = byProduct(imageRows);
  const videos = byProduct(videoRows);
  const options = byProduct(optionRows);
  const variants = byProduct(variantRows);

  return rows.map((row) => ({
    ...productBaseToApp(row),
    images: (images.get(row.id) ?? []).map((img: any) => ({
      url: img.url,
      publicId: img.r2_key,
      path: img.r2_key,
    })),
    videos: (videos.get(row.id) ?? []).map((video: any) => ({
      url: video.url,
      path: video.r2_key,
    })),
    options: (options.get(row.id) ?? []).map((option: any) => ({
      id: option.id,
      name: option.name,
      values: option.values ?? [],
    })),
    variants: (variants.get(row.id) ?? []).map((variant: any) => ({
      id: variant.id,
      title: variant.title,
      sku: variant.sku,
      price: Number(variant.price ?? 0),
      stock: Number(variant.stock ?? 0),
      optionValues: variant.option_values ?? [],
    })),
  }));
};

const appProductToDb = (data: any, storeId?: string) => {
  const discount = data.discount ?? null;
  const payload: any = {};
  if (storeId) payload.store_id = storeId;
  if ("categoryId" in data) payload.category_id = data.categoryId || null;
  if ("name" in data) payload.name = data.name;
  if ("sku" in data) payload.sku = data.sku || null;
  if ("description" in data) payload.description = data.description || null;
  if ("price" in data) payload.base_price = Number(data.price ?? 0);
  if ("wholesalePrice" in data) payload.wholesale_price = data.wholesalePrice ?? null;
  if ("discount" in data) {
    payload.discount_type = discount?.type ?? null;
    payload.discount_value = discount?.value ?? null;
  }
  if ("isActive" in data) payload.is_active = data.isActive !== false;
  if ("allowsCashOnDelivery" in data) payload.allow_cash_on_delivery = data.allowsCashOnDelivery !== false;
  if ("stock" in data) payload.stock = Number(data.stock ?? 0);
  if ("order" in data) payload.sort_order = data.order ?? 0;
  if ("createdAt" in data) payload.created_at = data.createdAt;
  if ("updatedAt" in data) payload.updated_at = data.updatedAt;
  return payload;
};

const syncProductChildren = async (productId: string, storeId: string | undefined, data: any) => {
  if (!storeId) return;

  if ("images" in data) {
    await supabase.from("product_images").delete().eq("product_id", productId);
    const rows = (data.images ?? []).map((img: any, index: number) => ({
      product_id: productId,
      store_id: storeId,
      url: img.url,
      r2_key: img.publicId ?? img.path ?? null,
      sort_order: index,
      created_at: nowIso(),
    }));
    if (rows.length) {
      const { error } = await supabase.from("product_images").insert(rows);
      if (error) throw error;
    }
  }

  if ("videos" in data) {
    await supabase.from("product_videos").delete().eq("product_id", productId);
    const rows = (data.videos ?? []).map((video: any, index: number) => ({
      product_id: productId,
      store_id: storeId,
      url: video.url,
      r2_key: video.path ?? null,
      sort_order: index,
      created_at: nowIso(),
    }));
    if (rows.length) {
      const { error } = await supabase.from("product_videos").insert(rows);
      if (error) throw error;
    }
  }

  if ("options" in data) {
    await supabase.from("product_options").delete().eq("product_id", productId);
    const rows = (data.options ?? []).map((option: any, index: number) => ({
      ...(isUuid(option.id) ? { id: option.id } : {}),
      product_id: productId,
      store_id: storeId,
      name: option.name,
      values: option.values ?? [],
      sort_order: index,
    }));
    if (rows.length) {
      const { error } = await supabase.from("product_options").insert(rows);
      if (error) throw error;
    }
  }

  if ("variants" in data) {
    await supabase.from("product_variants").delete().eq("product_id", productId);
    const rows = (data.variants ?? []).map((variant: any) => ({
      ...(isUuid(variant.id) ? { id: variant.id } : {}),
      product_id: productId,
      store_id: storeId,
      title: variant.title || "",
      sku: variant.sku || null,
      price: Number(variant.price ?? 0),
      stock: Number(variant.stock ?? 0),
      option_values: variant.optionValues ?? [],
      created_at: nowIso(),
      updated_at: nowIso(),
    }));
    if (rows.length) {
      const { error } = await supabase.from("product_variants").insert(rows);
      if (error) throw error;
    }
  }
};

const dbClientToApp = (row: any) => ({
  ...row,
  id: row.phone || row.id,
  uuid: row.id,
  storeId: row.store_id,
  totalOrders: row.orders_count,
  totalSpent: Number(row.total_spent ?? 0),
  lastOrderAt: row.last_order_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const appClientToDb = (data: any, storeId?: string) => ({
  ...(storeId ? { store_id: storeId } : {}),
  ...("name" in data ? { name: data.name } : {}),
  ...("phone" in data ? { phone: data.phone } : {}),
  ...("address" in data ? { address: data.address } : {}),
  ...("totalOrders" in data ? { orders_count: data.totalOrders } : {}),
  ...("totalSpent" in data ? { total_spent: data.totalSpent } : {}),
  ...("lastOrderAt" in data ? { last_order_at: data.lastOrderAt } : {}),
  ...("createdAt" in data ? { created_at: data.createdAt } : {}),
  ...("updatedAt" in data ? { updated_at: data.updatedAt } : {}),
});

const resolveClientDbId = async (ref: DocRef) => {
  if (!ref.id || isUuid(ref.id)) return ref.id;
  const { data, error } = await supabase
    .from("clients")
    .select("id")
    .eq("store_id", ref.storeId)
    .eq("phone", ref.id)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
};

const hydrateOrders = async (rows: any[]) => {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [itemRows, fieldRows] = await Promise.all([
    selectByForeignKey("order_items", "order_id", ids),
    selectByForeignKey("order_custom_fields", "order_id", ids),
  ]);

  const group = <T extends { order_id: string }>(items: T[] = []) => {
    const map = new Map<string, T[]>();
    items.forEach((item) => map.set(item.order_id, [...(map.get(item.order_id) ?? []), item]));
    return map;
  };
  const itemsByOrder = group(itemRows);
  const fieldsByOrder = group(fieldRows);

  return rows.map((row) => {
    const customFields = (fieldsByOrder.get(row.id) ?? []).map((field: any) => ({
      id: field.field_key,
      label: field.label,
      value: field.value ?? "",
      type: "text",
    }));
    return {
      ...row,
      storeId: row.store_id,
      clientId: row.client_id,
      status: row.status,
      channel: row.source,
      customer: {
        name: row.customer_name,
        phone: row.customer_phone,
        address: row.address,
        customFields,
      },
      customFields,
      shippingMethod: row.delivery_method,
      shippingCost: Number(row.shipping_cost ?? 0),
      subtotal: Number(row.subtotal ?? 0),
      total: Number(row.total ?? 0),
      items: (itemsByOrder.get(row.id) ?? []).map((item: any) => ({
        productId: item.product_id,
        variantId: item.variant_id,
        productName: item.title,
        sku: item.sku,
        variantTitle: null,
        qty: item.quantity,
        unitPrice: Number(item.unit_price ?? 0),
        subtotal: Number(item.total ?? 0),
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
};

const appOrderToDb = (data: any, storeId?: string) => ({
  ...(storeId ? { store_id: storeId } : {}),
  ...("clientId" in data ? { client_id: isUuid(data.clientId) ? data.clientId : null } : {}),
  ...("status" in data ? { status: data.status } : {}),
  ...(data.customer || "customerName" in data || "customer_name" in data
    ? { customer_name: data.customer?.name ?? data.customerName ?? data.customer_name ?? "" }
    : {}),
  ...(data.customer || "customerPhone" in data || "customer_phone" in data
    ? { customer_phone: data.customer?.phone ?? data.customerPhone ?? data.customer_phone ?? "" }
    : {}),
  ...(data.customer || "customerAddress" in data || "address" in data
    ? { address: data.customer?.address ?? data.customerAddress ?? data.address ?? "" }
    : {}),
  ...("shippingMethod" in data ? { delivery_method: data.shippingMethod } : {}),
  ...("shippingCost" in data ? { shipping_cost: data.shippingCost } : {}),
  ...("subtotal" in data ? { subtotal: data.subtotal } : {}),
  ...("total" in data ? { total: data.total } : {}),
  ...("channel" in data ? { source: data.channel } : {}),
  ...("source" in data ? { source: data.source } : {}),
  ...("createdAt" in data ? { created_at: data.createdAt } : {}),
  ...("updatedAt" in data ? { updated_at: data.updatedAt } : {}),
});

const syncOrderChildren = async (orderId: string, storeId: string | undefined, data: any) => {
  if (!storeId) return;
  if ("items" in data) {
    await supabase.from("order_items").delete().eq("order_id", orderId);
    const rows = (data.items ?? []).map((item: any) => ({
      order_id: orderId,
      store_id: storeId,
      product_id: isUuid(item.productId) ? item.productId : null,
      variant_id: isUuid(item.variantId) ? item.variantId : null,
      title: item.productName ?? item.title ?? "",
      sku: item.sku ?? null,
      quantity: Number(item.qty ?? item.quantity ?? 1),
      unit_price: Number(item.unitPrice ?? item.unit_price ?? 0),
      total: Number(item.subtotal ?? item.total ?? 0),
    }));
    if (rows.length) {
      const { error } = await supabase.from("order_items").insert(rows);
      if (error) throw error;
    }
  }

  if ("customFields" in data || data.customer?.customFields) {
    await supabase.from("order_custom_fields").delete().eq("order_id", orderId);
    const rows = (data.customFields ?? data.customer?.customFields ?? []).map((field: any) => ({
      order_id: orderId,
      store_id: storeId,
      field_key: field.id ?? field.field_key ?? field.label,
      label: field.label ?? "",
      value: field.value ?? "",
    }));
    if (rows.length) {
      const { error } = await supabase.from("order_custom_fields").insert(rows);
      if (error) throw error;
    }
  }
};

const appPaymentToDb = async (data: any, storeId?: string) => {
  let subscriptionId = data.subscription_id;
  if (!subscriptionId && storeId) {
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("store_id", storeId)
      .maybeSingle();
    subscriptionId = subscription?.id;
  }
  return {
    subscription_id: subscriptionId,
    store_id: storeId ?? data.storeId,
    amount: Number(data.amount ?? 0),
    currency: data.currency ?? "COP",
    provider: data.provider ?? "manual",
    provider_reference: data.provider_reference ?? data.providerReference ?? null,
    status: data.status ?? "approved",
    raw_payload: data.raw_payload ?? data.rawPayload ?? data,
    created_at: data.createdAt ?? nowIso(),
  };
};

const syncStoreSubscription = async (storeId: string, data: any) => {
  const hasSubscriptionFields =
    "hasActiveSubscription" in data ||
    "subscriptionStatus" in data ||
    "trialEndsAt" in data ||
    "trialEndsAtMs" in data;
  if (!hasSubscriptionFields) return;

  const rawStatus =
    data.subscriptionStatus ??
    (data.hasActiveSubscription === true ? "active" : "inactive");
  const status =
    rawStatus === "trial_expired" || rawStatus === "subscription_expired"
      ? "expired"
      : rawStatus;
  const trialEndsAt =
    data.trialEndsAt ??
    (typeof data.trialEndsAtMs === "number" ? new Date(data.trialEndsAtMs).toISOString() : null);
  const currentPeriodEndsAt = data.subscriptionEndAt ?? data.subscriptionEndsAt ?? null;

  const { data: existing, error: lookupError } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("store_id", storeId)
    .maybeSingle();
  if (lookupError) throw lookupError;

  if (!existing && data.hasActiveSubscription !== true && status !== "trialing") {
    return;
  }

  const payload = {
    store_id: storeId,
    status,
    trial_ends_at: trialEndsAt,
    current_period_ends_at: currentPeriodEndsAt,
    updated_at: nowIso(),
    ...(existing ? {} : { created_at: nowIso() }),
  };

  const request = existing
    ? supabase.from("subscriptions").update(payload).eq("id", existing.id)
    : supabase.from("subscriptions").insert(payload);
  const { error } = await request;
  if (error) throw error;
};

const mapRowToApp = async (table: string, row: any) => {
  if (table === "stores") return dbStoreToApp(row);
  if (table === "categories") return dbCategoryToApp(row);
  if (table === "clients") return dbClientToApp(row);
  return row;
};

const mapRowsToApp = async (ref: CollectionRef | QueryRef, rows: any[]) => {
  if (ref.table === "products") return hydrateProducts(rows);
  if (ref.table === "orders") return hydrateOrders(rows);
  return Promise.all(rows.map((row) => mapRowToApp(ref.table, row)));
};

const mapField = (table: string, field: string) => {
  const common: Record<string, string> = {
    storeId: "store_id",
    createdAt: "created_at",
    updatedAt: "updated_at",
  };
  const maps: Record<string, Record<string, string>> = {
    stores: {
      ownerUid: "owner_id",
      businessType: "business_type",
      brandColor: "brand_color",
      logoUrl: "logo_url",
      bannerUrl: "banner_url",
      isActive: "status",
      checkoutFields: "checkout_fields",
      email: "contact_email",
    },
    categories: { order: "sort_order" },
    products: {
      categoryId: "category_id",
      price: "base_price",
      wholesalePrice: "wholesale_price",
      isActive: "is_active",
      allowsCashOnDelivery: "allow_cash_on_delivery",
      order: "sort_order",
    },
    clients: {
      totalOrders: "orders_count",
      totalSpent: "total_spent",
      lastOrderAt: "last_order_at",
    },
    orders: {
      clientId: "client_id",
      customerPhone: "customer_phone",
      "customer.phone": "customer_phone",
      shippingMethod: "delivery_method",
      shippingCost: "shipping_cost",
      channel: "source",
    },
  };
  return maps[table]?.[field] ?? common[field] ?? field;
};

const compareValue = (a: any, b: any) => {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return a > b ? 1 : -1;
};

const matchesWhere = (row: any, c: QueryConstraint) => {
  const value = cleanData(c.value);
  const actual = row[c.field];
  switch (c.op) {
    case "==":
      return actual === value;
    case "!=":
      return actual !== value;
    case ">":
      return actual > value;
    case ">=":
      return actual >= value;
    case "<":
      return actual < value;
    case "<=":
      return actual <= value;
    case "in":
      return Array.isArray(value) && value.includes(actual);
    default:
      return actual === value;
  }
};

const applyClientConstraints = (rows: any[], constraints: QueryConstraint[]) => {
  let result = rows.filter((row) =>
    constraints.filter((c) => c.type === "where").every((c) => matchesWhere(row, c)),
  );
  const orderConstraints = constraints.filter((item) => item.type === "orderBy");

  for (const constraint of constraints) {
    if (constraint.type === "startAt" && orderConstraints[0]) {
      result = result.filter((row) => compareValue(row[orderConstraints[0].field], constraint.value) >= 0);
    }
    if (constraint.type === "endAt" && orderConstraints[0]) {
      const endValue =
        typeof constraint.value === "string" && constraint.value.endsWith("\uf8ff")
          ? constraint.value.slice(0, -1)
          : constraint.value;
      result = result.filter((row) =>
        typeof constraint.value === "string" && constraint.value.endsWith("\uf8ff")
          ? String(row[orderConstraints[0].field] ?? "").startsWith(endValue)
          : compareValue(row[orderConstraints[0].field], endValue) <= 0,
      );
    }
    if (constraint.type === "startAfter" && constraint.cursor?.id) {
      const index = result.findIndex((row) => row.id === constraint.cursor.id);
      if (index >= 0) result = result.slice(index + 1);
    }
    if (constraint.type === "endBefore" && constraint.cursor?.id) {
      const index = result.findIndex((row) => row.id === constraint.cursor.id);
      if (index >= 0) result = result.slice(0, index);
    }
  }

  for (const orderItem of [...orderConstraints].reverse()) {
    result.sort((a, b) => {
      const value = compareValue(a[orderItem.field], b[orderItem.field]);
      return orderItem.direction === "desc" ? -value : value;
    });
  }

  const limitLast = findLastConstraint(constraints, (item) => item.type === "limitToLast");
  if (limitLast) return result.slice(-limitLast.count);

  const limitItem = findLastConstraint(constraints, (item) => item.type === "limit");
  if (limitItem) return result.slice(0, limitItem.count);

  return result;
};

export class SupabaseDocumentSnapshot<T = DocumentData> {
  ref: DocRef;
  id: string;
  private value: T | null;
  constructor(ref: DocRef, id: string, value: T | null) {
    this.ref = ref;
    this.id = id;
    this.value = value;
  }
  exists() {
    return this.value !== null;
  }
  data(): T {
    return (this.value ?? {}) as T;
  }
}

export type QueryDocumentSnapshot<T = DocumentData> = SupabaseDocumentSnapshot<T>;

class SupabaseQuerySnapshot<T = DocumentData> {
  docs: QueryDocumentSnapshot<T>[];
  constructor(docs: QueryDocumentSnapshot<T>[]) {
    this.docs = docs;
  }
  get empty() {
    return this.docs.length === 0;
  }
  get size() {
    return this.docs.length;
  }
  forEach(callback: (doc: QueryDocumentSnapshot<T>) => void) {
    this.docs.forEach(callback);
  }
}

const normalizeArgs = (args: any[]) =>
  args.flatMap((arg) => {
    if (!arg) return [];
    if (arg.kind === "collection" || arg.kind === "doc") return arg.path;
    return [String(arg)];
  });

export const collection = (_db: unknown, ...segments: any[]): CollectionRef => {
  const path = normalizeArgs(segments);
  return { kind: "collection", path, table: tableForPath(path), storeId: storeIdForPath(path) };
};

export const doc = (...args: any[]): DocRef => {
  const start = args[0]?.kind === "collection" ? 0 : 1;
  const path = normalizeArgs(args.slice(start));
  if (args.length === 1 && args[0]?.kind === "collection" && path.length % 2 === 1) {
    path.push(randomId());
  }
  const id = path.length % 2 === 0 ? path[path.length - 1] : undefined;
  const collectionPath = id ? path.slice(0, -1) : path;
  return { kind: "doc", path, id, table: tableForPath(collectionPath), storeId: storeIdForPath(collectionPath) };
};

export const query = (base: CollectionRef | QueryRef, ...constraints: QueryConstraint[]): QueryRef => ({
  ...base,
  constraints: [...((base as QueryRef).constraints ?? []), ...constraints],
});
export const where = (field: string, op: string, value: any): QueryConstraint => ({ type: "where", field, op, value });
export const orderBy = (field: string, direction: "asc" | "desc" = "asc"): QueryConstraint => ({ type: "orderBy", field, direction });
export const limit = (count: number): QueryConstraint => ({ type: "limit", count });
export const offset = (count: number): QueryConstraint => ({ type: "offset", count });
export const limitToLast = (count: number): QueryConstraint => ({ type: "limitToLast", count });
export const startAt = (value: any): QueryConstraint => ({ type: "startAt", value });
export const endAt = (value: any): QueryConstraint => ({ type: "endAt", value });
export const startAfter = (cursor: any): QueryConstraint => ({ type: "startAfter", cursor });
export const endBefore = (cursor: any): QueryConstraint => ({ type: "endBefore", cursor });
export const serverTimestamp = () => ({ __op: "serverTimestamp" });
export const increment = (amount: number) => ({ __op: "increment", amount });
export const Timestamp = { fromDate: (date: Date) => ({ __op: "timestamp", value: date.toISOString() }) };

const applyBaseFilters = (builder: any, ref: CollectionRef | QueryRef | DocRef) => {
  let next = builder;
  if (ref.storeId) next = next.eq("store_id", ref.storeId);
  return next;
};

const applyServerConstraints = (builder: any, table: string, constraints: QueryConstraint[]) => {
  let next = builder;
  for (const constraint of constraints) {
    if (constraint.type !== "where") continue;
    const field = mapField(table, constraint.field);
    const value = cleanData(constraint.value);
    switch (constraint.op) {
      case "==":
        next = next.eq(field, value);
        break;
      case "!=":
        next = next.neq(field, value);
        break;
      case ">":
        next = next.gt(field, value);
        break;
      case ">=":
        next = next.gte(field, value);
        break;
      case "<":
        next = next.lt(field, value);
        break;
      case "<=":
        next = next.lte(field, value);
        break;
      case "in":
        if (Array.isArray(value) && value.length) next = next.in(field, value);
        break;
    }
  }

  for (const constraint of constraints) {
    if (constraint.type === "orderBy") {
      next = next.order(mapField(table, constraint.field), {
        ascending: constraint.direction !== "desc",
      });
    }
  }

  const limitItem = findLastConstraint(constraints, (item) => item.type === "limit");
  const offsetItem = findLastConstraint(constraints, (item) => item.type === "offset");
  if (limitItem && offsetItem) {
    next = next.range(offsetItem.count, offsetItem.count + limitItem.count - 1);
  } else if (limitItem) {
    next = next.limit(limitItem.count);
  }

  return next;
};

export const getDocs = async (ref: CollectionRef | QueryRef) => {
  const constraints = (ref as QueryRef).constraints ?? [];
  const hasExplicitLimit = constraints.some((item) => item.type === "limit");
  let rawRows: any[] = [];

  if (hasExplicitLimit) {
    const request = applyServerConstraints(
      applyBaseFilters(supabase.from(ref.table).select("*"), ref),
      ref.table,
      constraints,
    );
    const { data, error } = await request;
    if (error) throw error;
    rawRows = data ?? [];
  } else {
    // Supabase/PostgREST suele limitar cada respuesta a 1.000 filas. Recorremos
    // todas las páginas para que catálogos grandes no queden truncados.
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const request = applyServerConstraints(
        applyBaseFilters(supabase.from(ref.table).select("*"), ref),
        ref.table,
        constraints,
      ).range(from, from + pageSize - 1);
      const { data, error } = await request;
      if (error) throw error;
      const page = data ?? [];
      rawRows.push(...page);
      if (page.length < pageSize) break;
    }
  }

  const appRows = await mapRowsToApp(ref, rawRows);
  const rows = applyClientConstraints(appRows, constraints);
  const docs = rows.map(
    (row: any) =>
      new SupabaseDocumentSnapshot(
        { kind: "doc", path: [...ref.path, row.id], table: ref.table, id: row.id, storeId: ref.storeId },
        row.id,
        row,
      ),
  );
  return new SupabaseQuerySnapshot(docs);
};

export const getDoc = async (ref: DocRef) => {
  if (!ref.id) return new SupabaseDocumentSnapshot(ref, "", null);
  if (ref.table === "clients" && !isUuid(ref.id)) {
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("store_id", ref.storeId)
      .eq("phone", ref.id)
      .maybeSingle();
    if (error) throw error;
    return new SupabaseDocumentSnapshot(ref, ref.id, data ? dbClientToApp(data) : null);
  }
  const { data, error } = await applyBaseFilters(supabase.from(ref.table).select("*"), ref)
    .eq("id", ref.id)
    .maybeSingle();
  if (error) throw error;
  const appRows = data ? await mapRowsToApp({ ...ref, kind: "collection" } as CollectionRef, [data]) : [];
  return new SupabaseDocumentSnapshot(ref, ref.id, appRows[0] ?? null);
};

const basePayloadFor = async (ref: CollectionRef | DocRef, data: any) => {
  if (ref.table === "stores") return appStoreToDb(data);
  if (ref.table === "categories") return appCategoryToDb(data, ref.storeId);
  if (ref.table === "products") return appProductToDb(data, ref.storeId);
  if (ref.table === "clients") return appClientToDb(data, ref.storeId);
  if (ref.table === "orders") return appOrderToDb(data, ref.storeId);
  if (ref.table === "subscription_payments") return appPaymentToDb(data, ref.storeId);
  return { ...data, ...(ref.storeId ? { store_id: ref.storeId } : {}) };
};

const afterWrite = async (ref: CollectionRef | DocRef, id: string, data: any) => {
  if (ref.table === "stores") await syncStoreSubscription(id, data);
  if (ref.table === "products") await syncProductChildren(id, ref.storeId, data);
  if (ref.table === "orders") await syncOrderChildren(id, ref.storeId, data);
};

export const addDoc = async (ref: CollectionRef, data: DocumentData) => {
  const id = randomId();
  const cleaned = cleanData({ ...data, id });
  const payload = await basePayloadFor(ref, cleaned);
  const { data: inserted, error } = await supabase
    .from(ref.table)
    .insert({ ...payload, id })
    .select("*")
    .single();
  if (error) throw error;
  await afterWrite(ref, id, cleaned);
  return { kind: "doc", path: [...ref.path, id], table: ref.table, id, storeId: ref.storeId, data: () => inserted };
};

export const setDoc = async (ref: DocRef, data: DocumentData, options?: { merge?: boolean }) => {
  const id = ref.id ?? randomId();
  if (ref.table === "clients" && ref.id && !isUuid(ref.id)) {
    const existingId = await resolveClientDbId(ref);
    const cleaned = cleanData({ ...(existingId && options?.merge ? (await getDoc({ ...ref, id: existingId })).data() : {}), ...data });
    const payload = await basePayloadFor(ref, { ...cleaned, phone: cleaned.phone ?? ref.id });
    if (existingId) {
      const { error } = await supabase.from("clients").update(payload).eq("id", existingId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("clients").insert({ ...payload, id: randomId() });
      if (error) throw error;
    }
    return;
  }
  const current = options?.merge ? (await getDoc({ ...ref, id })).data() : {};
  const cleaned = cleanData({ ...current, ...data, id });
  const payload = await basePayloadFor(ref, cleaned);
  const { error } = await supabase.from(ref.table).upsert({ ...payload, id });
  if (error) throw error;
  await afterWrite(ref, id, cleaned);
};

const resolveIncrementPayload = async (ref: DocRef, payload: DocumentData) => {
  const entries = Object.entries(payload);
  if (!entries.some(([, value]) => value?.__op === "increment")) return payload;
  const currentSnap = await getDoc(ref);
  const current = currentSnap.exists() ? currentSnap.data() : {};
  return Object.fromEntries(
    entries.map(([key, value]) => [
      key,
      value?.__op === "increment" ? Number(current?.[key] ?? 0) + Number(value.amount ?? 0) : value,
    ]),
  );
};

export const updateDoc = async (ref: DocRef, data: DocumentData) => {
  if (!ref.id) throw new Error("updateDoc requiere un id.");
  if (ref.table === "clients" && !isUuid(ref.id)) {
    const existingId = await resolveClientDbId(ref);
    if (!existingId) {
      await setDoc(ref, data, { merge: true });
      return;
    }
    const cleaned = await resolveIncrementPayload({ ...ref, id: existingId }, cleanData(data));
    const payload = await basePayloadFor(ref, cleaned);
    const { error } = await supabase.from("clients").update(payload).eq("id", existingId);
    if (error) throw error;
    return;
  }
  const cleaned = await resolveIncrementPayload(ref, cleanData(data));
  const payload = await basePayloadFor(ref, cleaned);
  const { error } = await applyBaseFilters(supabase.from(ref.table).update(payload), ref).eq("id", ref.id);
  if (error) throw error;
  await afterWrite(ref, ref.id, cleaned);
};

export const deleteDoc = async (ref: DocRef) => {
  if (!ref.id) throw new Error("deleteDoc requiere un id.");
  if (ref.table === "clients" && !isUuid(ref.id)) {
    const existingId = await resolveClientDbId(ref);
    if (!existingId) return;
    const { error } = await supabase.from("clients").delete().eq("id", existingId);
    if (error) throw error;
    return;
  }
  if (ref.table === "products") {
    for (const table of ["product_images", "product_videos", "product_options", "product_variants"]) {
      const { error } = await supabase.from(table).delete().eq("product_id", ref.id);
      if (error) throw error;
    }
  }
  const { error } = await applyBaseFilters(supabase.from(ref.table).delete(), ref).eq("id", ref.id);
  if (error) throw error;
};

export const getCountFromServer = async (ref: CollectionRef | QueryRef) => {
  const constraints = (ref as QueryRef).constraints ?? [];
  const request = applyServerConstraints(
    applyBaseFilters(
      supabase.from(ref.table).select("id", { count: "exact", head: true }),
      ref,
    ),
    ref.table,
    constraints,
  );
  const { count, error } = await request;
  if (error) throw error;
  return { data: () => ({ count: count ?? 0 }) };
};

export const onSnapshot = (
  ref: CollectionRef | QueryRef,
  next: (snapshot: SupabaseQuerySnapshot) => void,
  error?: (err: any) => void,
) => {
  let active = true;
  const load = () => getDocs(ref).then((snap) => active && next(snap)).catch((err) => active && error?.(err));
  load();
  const interval = window.setInterval(load, 30000);
  return () => {
    active = false;
    window.clearInterval(interval);
  };
};

export const writeBatch = (_db: unknown) => {
  const operations: Array<() => Promise<void>> = [];
  return {
    update: (ref: DocRef, data: DocumentData) => operations.push(() => updateDoc(ref, data)),
    set: (ref: DocRef, data: DocumentData, options?: { merge?: boolean }) => operations.push(() => setDoc(ref, data, options)),
    delete: (ref: DocRef) => operations.push(() => deleteDoc(ref)),
    commit: async () => {
      for (const operation of operations) await operation();
    },
  };
};

export const runTransaction = async (_db: unknown, callback: (tx: any) => Promise<void>) => {
  const operations: Array<() => Promise<void>> = [];
  const tx = {
    get: getDoc,
    update: (ref: DocRef, data: DocumentData) => operations.push(() => updateDoc(ref, data)),
    set: (ref: DocRef, data: DocumentData, options?: { merge?: boolean }) => operations.push(() => setDoc(ref, data, options)),
    delete: (ref: DocRef) => operations.push(() => deleteDoc(ref)),
  };
  await callback(tx);
  for (const operation of operations) await operation();
};
