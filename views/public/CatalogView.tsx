import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  getDocs,
  getDoc,
  where,
  limit,
  offset,
  QueryConstraint,
  doc,
  runTransaction,
  increment,
} from "@/lib/supabaseFirestore";
import { db, supabase } from "@/lib/supabase";
import { Product, Store } from "@/interfaces";
import { CartItem, Category, Variant } from "@/types";
import {
  buildWaLink,
  calcTotal,
  cartStorageKey,
  getProductDisplayPrice,
  getProductMainImage,
  norm,
} from "@/helpers";
import { buildInternationalPhone, formatStoreCurrency, resolveStoreCountryCode } from "@/helpers/latamCountries";
import { ImageCarousel } from "@/components/catalog/ImageCarousel";
import { cldImg } from "@/helpers/r2Upload";
import {
  discountBadgeText,
  getBaseUnitPrice,
  getFinalUnitPrice,
  getProductCardPrice,
} from "@/helpers/pricing";

const PAGE_SIZE = 20;

type PageCache = {
  products: Product[];
  hasMore: boolean;
};
const catalogCache = new Map<string, Map<string, PageCache>>();

const getCategoryCache = (
  storeId: string,
  categoryId: string,
): PageCache | null => {
  return catalogCache.get(storeId)?.get(categoryId) ?? null;
};
const setCategoryCache = (
  storeId: string,
  categoryId: string,
  data: PageCache,
) => {
  if (!catalogCache.has(storeId)) catalogCache.set(storeId, new Map());
  catalogCache.get(storeId)!.set(categoryId, data);
};
const clearStoreCache = (storeId: string) => {
  catalogCache.delete(storeId);
};
const searchProductsCache = new Map<string, Product[]>();

// ── Helpers de envío ──────────────────────────────────────────────────────────

type ShippingMethod = "cod" | "carrier";
type CheckoutFieldType = "text" | "number" | "tel" | "email" | "textarea" | "select" | "date";

type CheckoutFieldConfig = {
  id: string;
  label: string;
  type: CheckoutFieldType;
  required: boolean;
  enabled: boolean;
  placeholder?: string;
  options?: string[];
};

type CheckoutFieldAnswer = {
  id: string;
  label: string;
  type: CheckoutFieldType;
  value: string;
};

interface ShippingConfig {
  enabled: boolean;
  methods: ShippingMethod[];
  costCOD: number;
  costCarrier: number;
  note: string;
  hidePrices: boolean;
}

const getShippingConfig = (store: any): ShippingConfig => ({
  enabled: store?.shippingEnabled ?? false,
  methods: store?.shippingMethods ?? ["cod"],
  costCOD: Number(store?.shippingCostCOD ?? 0),
  costCarrier: Number(store?.shippingCostCarrier ?? 0),
  note: store?.shippingNote ?? "",
  hidePrices: store?.shippingHidePrices ?? false,
});

const getCheckoutFields = (store: any): CheckoutFieldConfig[] => {
  const fields = Array.isArray(store?.checkoutFields) ? store.checkoutFields : [];
  return fields
    .map((field: any) => ({
      id: String(field.id || ""),
      label: String(field.label || "").trim(),
      type: field.type || "text",
      required: field.required === true,
      enabled: field.enabled !== false,
      placeholder: String(field.placeholder || "").trim(),
      options: Array.isArray(field.options)
        ? field.options.map((option: any) => String(option).trim()).filter(Boolean)
        : [],
    }))
    .filter((field: CheckoutFieldConfig) => field.id && field.label && field.enabled);
};

const SHIPPING_LABELS: Record<ShippingMethod, { label: string; icon: string; color: string; bg: string }> = {
  cod: {
    label: "Contra entrega",
    icon: "fa-solid fa-money-bill-wave",
    color: "text-green-600",
    bg: "bg-green-100",
  },
  carrier: {
    label: "Envío con transportadora",
    icon: "fa-solid fa-truck",
    color: "text-blue-600",
    bg: "bg-blue-100",
  },
};

// ─────────────────────────────────────────────────────────────────────────────


type CatalogUnavailableReason =
  | "not_found"
  | "inactive"
  | "subscription_inactive"
  | "subscription_expired"
  | "trial_expired";

const getDateMs = (value: unknown): number | null => {
  if (!value) return null;

  if (typeof value === "number") return value;

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds: number }).seconds === "number"
  ) {
    return (value as { seconds: number }).seconds * 1000;
  }

  return null;
};

const getCatalogUnavailableReason = (
  store: any,
): CatalogUnavailableReason | null => {
  if (!store) return "not_found";

  if (store.isActive === false) {
    return "inactive";
  }

  /**
   * Compatibilidad para clientes antiguos de pago único.
   * Así no se bloquean tiendas viejas que no tienen los campos nuevos
   * de suscripción/prueba gratis.
   */
  const isLegacyOneTimeClient =
    store.subscriptionType === "one_time" &&
    !store.source &&
    !store.subscriptionStatus &&
    store.hasFreeTrial !== true &&
    !store.trialEndsAtMs;

  if (isLegacyOneTimeClient) {
    return null;
  }

  const trialExpired =
    store.hasFreeTrial === true &&
    typeof store.trialEndsAtMs === "number" &&
    Date.now() > store.trialEndsAtMs;

  if (
    trialExpired ||
    store.freeTrialStatus === "expired" ||
    store.subscriptionStatus === "trial_expired"
  ) {
    return "trial_expired";
  }

  const subscriptionEndMs =
    getDateMs(store.subscriptionEndAt) ?? getDateMs(store.subscriptionEndsAt);

  const subscriptionExpired =
    store.hasActiveSubscription === true &&
    subscriptionEndMs !== null &&
    Date.now() > subscriptionEndMs;

  if (subscriptionExpired || store.subscriptionStatus === "expired") {
    return "subscription_expired";
  }

  if (store.hasActiveSubscription !== true) {
    return "subscription_inactive";
  }

  return null;
};

const CatalogUnavailableScreen: React.FC<{
  store?: Store | null;
  reason?: CatalogUnavailableReason | null;
}> = ({ store, reason }) => {
  const brandColor = (store as any)?.brandColor || "#111111";
  const storeName = store?.name || "Catálogo";

  const messageByReason: Record<
    CatalogUnavailableReason,
    { title: string; description: string; icon: string }
  > = {
    not_found: {
      title: "Tienda no encontrada",
      description:
        "No pudimos encontrar este catálogo.",
      icon: "fa-regular fa-circle-question",
    },
    inactive: {
      title: "Catálogo no disponible",
      description:
        "Esta tienda está desactivada temporalmente. Intenta nuevamente más tarde.",
      icon: "fa-solid fa-store-slash",
    },
    subscription_inactive: {
      title: "Catálogo no disponible",
      description:
        "Este catálogo no está disponible.",
      icon: "fa-solid fa-lock",
    },
    subscription_expired: {
      title: "Catálogo no disponible",
      description:
        "Cuando el administrador la renueve, el catálogo volverá a estar disponible.",
      icon: "fa-solid fa-calendar-xmark",
    },
    trial_expired: {
      title: "Catálogo no disponible",
      description:
        "El periodo de prueba de esta tienda finalizó.",
      icon: "fa-solid fa-hourglass-end",
    },
  };

  const content = messageByReason[reason || "not_found"];

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-3xl border border-gray-100 shadow-sm p-8 text-center">
        <div
          className="mx-auto h-16 w-16 rounded-2xl flex items-center justify-center text-white shadow-sm"
          style={{ background: brandColor }}
        >
          <i className={`${content.icon} text-2xl`} />
        </div>

        <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-gray-400">
          {storeName}
        </p>

        <h1 className="mt-2 text-2xl font-black text-gray-900">
          {content.title}
        </h1>

        <p className="mt-3 text-sm leading-6 text-gray-500">
          {content.description}
        </p>

        <div className="mt-6 rounded-2xl bg-gray-50 border border-gray-100 p-4 text-xs text-gray-500">
          <i className="fa-solid fa-circle-info mr-1" />
          Si eres el administrador de esta tienda, ingresa al panel para revisar tu suscripción.
        </div>
      </div>
    </div>
  );
};

const CatalogView: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [store, setStore] = useState<Store | null>(null);
  const countryCode = resolveStoreCountryCode((store as any)?.countryCode, store?.whatsapp);
  const formatCOP = (value: number) => formatStoreCurrency(value, countryCode);
  const [catalogUnavailableReason, setCatalogUnavailableReason] =
    useState<CatalogUnavailableReason | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [placingOrder, setPlacingOrder] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});

  // Envío
  const [selectedShipping, setSelectedShipping] = useState<ShippingMethod | null>(null);

  const [activeCategoryId, setActiveCategoryId] = useState<string>("all");
  const categoryFromUrl = searchParams.get("category");
  const isWholesaleCatalog = searchParams.get("tipo") === "mayorista";
  const cartStorageId = slug
    ? cartStorageKey(`${slug}:${isWholesaleCatalog ? "mayorista" : "publico"}`)
    : "";
  const pendingCartRestoreRef = useRef<string | null>(null);

  const [search, setSearch] = useState("");
  const [queryError, setQueryError] = useState<string | null>(null);

  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const [searchProducts, setSearchProducts] = useState<Product[]>([]);
  const [searchLoaded, setSearchLoaded] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [locationTooltipOpen, setLocationTooltipOpen] = useState(false);

  const isSearching = search.trim().length > 0;

  const [productModal, setProductModal] = useState<{
    open: boolean;
    product: Product | null;
    selectedVariantId?: string | null;
    quantity: number;
  }>({ open: false, product: null, selectedVariantId: null, quantity: 1 });

  const [shareToast, setShareToast] = useState(false);

  // ── Configuración de envío derivada del store ──
  const shippingConfig = useMemo(() => getShippingConfig(store), [store]);
  const checkoutFields = useMemo(() => getCheckoutFields(store), [store]);
  const cashOnDeliveryAvailable = useMemo(
    () => cart.every((item) => item.allowsCashOnDelivery !== false),
    [cart],
  );
  const availableShippingMethods = useMemo(
    () => shippingConfig.methods.filter((method) => method !== "cod" || cashOnDeliveryAvailable),
    [shippingConfig.methods, cashOnDeliveryAvailable],
  );

  useEffect(() => {
    setCustomFieldValues((current) => {
      const allowedIds = new Set(checkoutFields.map((field) => field.id));
      const next = Object.fromEntries(
        Object.entries(current).filter(([id]) => allowedIds.has(id)),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [checkoutFields]);

  // Auto-seleccionar primer método si solo hay uno
  useEffect(() => {
    if (!shippingConfig.enabled) {
      setSelectedShipping(null);
      return;
    }
    setSelectedShipping((current) => {
      if (current && availableShippingMethods.includes(current)) return current;
      return availableShippingMethods.length === 1
        ? availableShippingMethods[0] as ShippingMethod
        : null;
    });
  }, [shippingConfig.enabled, availableShippingMethods]);

  // Costo de envío según selección
  const shippingCost = useMemo(() => {
    if (!shippingConfig.enabled || !selectedShipping) return 0;
    if (selectedShipping === "cod") return shippingConfig.costCOD;
    if (selectedShipping === "carrier") return shippingConfig.costCarrier;
    return 0;
  }, [shippingConfig, selectedShipping]);

  const subtotal = useMemo(() => calcTotal(cart), [cart]);
  const total = useMemo(() => subtotal + shippingCost, [subtotal, shippingCost]);

  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [categories]);

  const sortProducts = (items: Product[]) => {
    return [...items].sort((a: any, b: any) => {
      const aHasOrder = typeof a.order === "number";
      const bHasOrder = typeof b.order === "number";

      if (aHasOrder && bHasOrder) return a.order - b.order;
      if (aHasOrder) return -1;
      if (bHasOrder) return 1;

      const aTime = a.createdAt?.seconds ?? 0;
      const bTime = b.createdAt?.seconds ?? 0;
      return bTime - aTime;
    });
  };

  const sortCategories = (items: Category[]) => {
    return [...items].sort((a: any, b: any) => {
      const aHasOrder = typeof a.order === "number";
      const bHasOrder = typeof b.order === "number";

      if (aHasOrder && bHasOrder) return a.order - b.order;
      if (aHasOrder) return -1;
      if (bHasOrder) return 1;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  };

  const filteredProducts = useMemo(() => {
    const q = norm(search);
    const source = q ? searchProducts : products;
    const visible = source.filter((p) => p.isActive !== false);
    if (!q) {
      return activeCategoryId === "all"
        ? visible
        : visible.filter((p) => p.categoryId === activeCategoryId);
    }
    return visible.filter((p) => {
      const catName = categoryNameById.get(p.categoryId) || "";
      const variantsText = (p.variants || [])
        .map((v: any) => `${v.title ?? ""} ${v.sku ?? ""}`)
        .join(" ");
      const priceText = `${p.price ?? ""} ${(p.variants || []).map((v: any) => v.price ?? "").join(" ")}`;
      const haystack = norm(
        `${p.name} ${p.sku ?? ""} ${p.description ?? ""} ${catName} ${variantsText} ${priceText}`,
      );
      return haystack.includes(q);
    });
  }, [search, searchProducts, products, activeCategoryId, categoryNameById]);

  useEffect(() => {
    if (!cartStorageId) return;
    pendingCartRestoreRef.current = cartStorageId;
    try {
      const raw = localStorage.getItem(cartStorageId);
      setCart(raw ? JSON.parse(raw) : []);
    } catch {
      setCart([]);
    }
  }, [cartStorageId]);

  useEffect(() => {
    if (!cartStorageId) return;
    if (pendingCartRestoreRef.current === cartStorageId) {
      pendingCartRestoreRef.current = null;
      return;
    }
    localStorage.setItem(cartStorageId, JSON.stringify(cart));
  }, [cart, cartStorageId]);

  useEffect(() => {
    const fetchStoreBySlug = async () => {
      if (!slug) {
        setStore(null);
        setCatalogUnavailableReason("not_found");
        setLoading(false);
        return;
      }

      setLoading(true);
      setCatalogUnavailableReason(null);
      setProducts([]);
      setCategories([]);
      setSearchProducts([]);
      setSearchLoaded(false);
      setQueryError(null);

      try {
        const { data, error } = await supabase.rpc("get_public_catalog_store", {
          p_slug: slug,
        });
        if (error) throw error;

        if (!data) {
          setStore(null);
          setCatalogUnavailableReason("not_found");
          setLoading(false);
          return;
        }

        const s = data as Store;
        const unavailableReason = getCatalogUnavailableReason(s);

        setStore(s);
        setCatalogUnavailableReason(unavailableReason);
        document.title = unavailableReason
          ? `${s.name} | Catálogo no disponible`
          : `${s.name} | Catálogo`;

        setLoading(false);
      } catch (error) {
        console.error("fetchStoreBySlug error:", error);
        setStore(null);
        setCatalogUnavailableReason("not_found");
        setLoading(false);
      }
    };

    fetchStoreBySlug();
  }, [slug]);

  useEffect(() => {
    if (!store || catalogUnavailableReason) return;
    const qCats = query(collection(db, "stores", store.id, "categories"));
    const unsubscribeCats = onSnapshot(qCats, (snap) => {
      setCategories(sortCategories(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))));
    });
    return () => unsubscribeCats();
  }, [store, catalogUnavailableReason]);

  useEffect(() => {
    if (!categories.length) return;
    if (!categoryFromUrl) {
      setActiveCategoryId("all");
      return;
    }
    const exists = categories.some((c) => c.id === categoryFromUrl);
    setActiveCategoryId(exists ? categoryFromUrl : "all");
  }, [categories, categoryFromUrl]);

  const fetchSearchProducts = useCallback(async (storeId: string) => {
    const term = search.trim();
    if (!term) {
      setSearchProducts([]);
      setSearchLoaded(false);
      return;
    }

    if (searchProductsCache.has(storeId)) {
      setSearchProducts(searchProductsCache.get(storeId)!);
      setSearchLoaded(true);
      return;
    }
    setSearchLoading(true);
    setSearchLoaded(false);
    setQueryError(null);
    try {
      const baseRef = collection(db, "stores", storeId, "products");
      const snap = await getDocs(baseRef);
      const allProducts = sortProducts(snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      })) as Product[]);
      searchProductsCache.set(storeId, allProducts);
      setSearchProducts(allProducts);
      setSearchLoaded(true);
    } catch (e: any) {
      console.error("fetchSearchProducts error:", e);
      setQueryError(
        "Error cargando productos para búsqueda. Revisa la consola.",
      );
      setSearchProducts([]);
      setSearchLoaded(true);
    } finally {
      setSearchLoading(false);
    }
  }, [search]);

  const storeIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!store || catalogUnavailableReason) return;
    storeIdRef.current = store.id;
    if (!isSearching) {
      setSearchProducts([]);
      setSearchLoaded(false);
      return;
    }
    fetchSearchProducts(store.id);
  }, [store?.id, catalogUnavailableReason, isSearching, fetchSearchProducts]);

  const fetchFirstPage = useCallback(
    async (storeId: string, categoryId: string) => {
      const cached = getCategoryCache(storeId, categoryId);
      if (cached) {
        setProducts(cached.products);
        setHasMore(cached.hasMore);
        setLoading(false);
        return;
      }
      setLoading(true);
      setQueryError(null);
      const baseRef = collection(db, "stores", storeId, "products");
      try {
        const constraints: QueryConstraint[] = [];
        constraints.push(where("isActive", "==", true));
        if (categoryId !== "all")
          constraints.push(where("categoryId", "==", categoryId));
        constraints.push(
          orderBy("order", "asc"),
          orderBy("createdAt", "desc"),
          limit(PAGE_SIZE + 1),
        );
        const qProds = query(baseRef, ...constraints);
        const snap = await getDocs(qProds);
        const allProducts = sortProducts(snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as any),
          })) as Product[]);
        const pageProducts = allProducts.slice(0, PAGE_SIZE);
        const more = allProducts.length > PAGE_SIZE;
        setCategoryCache(storeId, categoryId, {
          products: pageProducts,
          hasMore: more,
        });
        setProducts(pageProducts);
        setHasMore(more);
      } catch (e: any) {
        console.error("fetchFirstPage error:", e);
        const msg = String(e?.message || "")
          .toLowerCase()
          .includes("index")
          ? "Falta un índice en Firestore para filtrar por categoría. Revisa la consola."
          : "Error consultando productos. Revisa la consola.";
        setQueryError(msg);
        setProducts([]);
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const fetchMorePage = useCallback(async () => {
    if (!store || catalogUnavailableReason || !hasMore || loadingMore) return;
    setLoadingMore(true);
    setQueryError(null);
    try {
      const cached = getCategoryCache(store.id, activeCategoryId);
      if (!cached) {
        await fetchFirstPage(store.id, activeCategoryId);
        return;
      }
      const baseRef = collection(db, "stores", store.id, "products");
      const constraints: QueryConstraint[] = [];
      constraints.push(where("isActive", "==", true));
      if (activeCategoryId !== "all")
        constraints.push(where("categoryId", "==", activeCategoryId));
      constraints.push(
        orderBy("order", "asc"),
        orderBy("createdAt", "desc"),
        offset(cached.products.length),
        limit(PAGE_SIZE + 1),
      );
      const snap = await getDocs(query(baseRef, ...constraints));
      const loadedProducts = sortProducts(snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      })) as Product[]);
      const pageProducts = loadedProducts.slice(0, PAGE_SIZE);
      if (!pageProducts.length) {
        setHasMore(false);
        return;
      }
      const nextProducts = [...cached.products, ...pageProducts];
      const more = loadedProducts.length > PAGE_SIZE;
      setProducts((prev) => {
        const visibleProducts = prev.length === cached.products.length
          ? nextProducts
          : [...prev, ...pageProducts];
        setCategoryCache(store.id, activeCategoryId, {
          products: visibleProducts,
          hasMore: more,
        });
        return visibleProducts;
      });
      setHasMore(more);
    } catch (e: any) {
      console.error("fetchMorePage error:", e);
      const msg = String(e?.message || "")
        .toLowerCase()
        .includes("index")
        ? "Falta un índice en Firestore para paginar. Revisa la consola."
        : "Error cargando más productos. Revisa la consola.";
      setQueryError(msg);
    } finally {
      setLoadingMore(false);
    }
  }, [store, catalogUnavailableReason, hasMore, loadingMore, activeCategoryId, fetchFirstPage]);

  useEffect(() => {
    if (!store || catalogUnavailableReason) return;
    fetchFirstPage(store.id, activeCategoryId);
  }, [store?.id, catalogUnavailableReason, activeCategoryId, fetchFirstPage]);

  const getCartItemMaxStock = (item: CartItem) => {
    const prod = [...products, ...searchProducts].find((p) => p.id === item.productId);
    const v = prod?.variants?.find((vv) => vv.id === item.variantId);
    return v && typeof v.stock === "number" && v.stock > 0 ? v.stock : undefined;
  };

  const normalizeQuantity = (value: number, maxStock?: number) => {
    const qty = Number.isFinite(value) ? Math.floor(value) : 1;
    if (maxStock !== undefined) return Math.min(Math.max(qty, 1), maxStock);
    return Math.max(qty, 1);
  };

  const addToCart = (prod: Product, variant?: Variant, quantity = 1) => {
    const baseUnitPrice = getBaseUnitPrice(prod, variant, isWholesaleCatalog);
    const unitPrice = getFinalUnitPrice(prod, variant, isWholesaleCatalog);
    if (!unitPrice) return;
    const maxStock = variant && typeof variant.stock === "number" && variant.stock > 0 ? variant.stock : undefined;
    const qtyToAdd = normalizeQuantity(quantity, maxStock);
    const item: CartItem = {
      productId: prod.id,
      productName: prod.name,
      sku: variant?.sku || prod.sku || undefined,
      variantId: variant?.id,
      variantTitle: variant?.title,
      unitPrice,
      originalUnitPrice: baseUnitPrice,
      priceType: isWholesaleCatalog ? "wholesale" : "retail",
      hasDiscount: hasValidDiscount((prod as any).discount),
      qty: qtyToAdd,
      imageUrl: getProductMainImage(prod),
      allowsCashOnDelivery: prod.allowsCashOnDelivery ?? true,
    };
    setCart((prev) => {
      const idx = prev.findIndex(
        (x) =>
          x.productId === item.productId &&
          (x.variantId || "") === (item.variantId || ""),
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          qty: normalizeQuantity(next[idx].qty + qtyToAdd, maxStock),
        };
        return next;
      }
      return [...prev, item];
    });
  };

  const changeQty = (index: number, delta: number) => {
    setCart((prev) => {
      const next = [...prev];
      const it = next[index];
      if (!it) return prev;
      const q = it.qty + delta;
      const maxStock = getCartItemMaxStock(it);
      if (maxStock !== undefined && q > maxStock) return prev;
      if (q <= 0) next.splice(index, 1);
      else next[index] = { ...it, qty: q };
      return next;
    });
  };

  const setCartQty = (index: number, quantity: number) => {
    setCart((prev) => {
      const next = [...prev];
      const it = next[index];
      if (!it) return prev;
      next[index] = {
        ...it,
        qty: normalizeQuantity(quantity, getCartItemMaxStock(it)),
      };
      return next;
    });
  };

  const clearCart = () => setCart([]);

  const openAddFlow = (prod: Product) => {
    setProductModal({ open: true, product: prod, selectedVariantId: null, quantity: 1 });
  };

  const placeOrder = async () => {
    if (!store || catalogUnavailableReason) return;
    if (!cart.length) return;
    const cleanName = customerName.trim();
    const cleanPhone = buildInternationalPhone(countryCode, customerPhone);
    const cleanAddress = customerAddress.trim();
    const customFields: CheckoutFieldAnswer[] = checkoutFields.map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      value: (customFieldValues[field.id] || "").trim(),
    }));
    const missingCustomField = customFields.find(
      (field) => checkoutFields.find((config) => config.id === field.id)?.required && !field.value,
    );
    if (!cleanName) return alert("Escribe tu nombre.");
    if (!cleanPhone) return alert("Escribe tu teléfono.");
    if (!cleanAddress) return alert("Escribe tu dirección.");
    if (missingCustomField) return alert(`Completa el campo: ${missingCustomField.label}.`);
    const invalidEmailField = customFields.find(
      (field) => field.type === "email" && field.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value),
    );
    if (invalidEmailField) return alert(`El correo de ${invalidEmailField.label} no es valido.`);
    if (!/^\d{7,15}$/.test(cleanPhone))
      return alert("Teléfono inválido. Usa solo números.");
    if (!store.whatsapp)
      return alert("Esta tienda no tiene WhatsApp configurado.");

    // Validar método de envío si está habilitado
    if (shippingConfig.enabled && availableShippingMethods.length > 1 && !selectedShipping) {
      return alert("Selecciona un método de envío.");
    }
    if (selectedShipping === "cod" && !cashOnDeliveryAvailable) {
      return alert("Uno o más productos no permiten pago contra entrega.");
    }

    const whatsappWindow = window.open("about:blank", "_blank");

    setPlacingOrder(true);
    try {
      const resolveCartProduct = async (item: CartItem) => {
        const productRef = doc(db, "stores", store.id, "products", item.productId);
        const snap = await getDoc(productRef);
        if (snap.exists()) return { item, ref: productRef, data: snap.data() };

        const productsRef = collection(db, "stores", store.id, "products");
        const candidates: QueryConstraint[][] = [];
        if (item.sku) candidates.push([where("sku", "==", item.sku), limit(1)]);
        candidates.push([where("name", "==", item.productName), limit(1)]);

        for (const constraints of candidates) {
          const fallbackSnap = await getDocs(query(productsRef, ...constraints));
          const fallbackDoc = fallbackSnap.docs[0];
          if (fallbackDoc?.exists()) {
            const fallbackData = fallbackDoc.data() as Product;
            const fallbackRef = doc(db, "stores", store.id, "products", fallbackDoc.id);
            return {
              item: { ...item, productId: fallbackDoc.id },
              ref: fallbackRef,
              data: fallbackData,
            };
          }
        }

        return null;
      };

      const resolvedProducts = await Promise.all(cart.map(resolveCartProduct));
      const missingItems = cart.filter((_, index) => !resolvedProducts[index]);
      if (missingItems.length) {
        const missingIds = new Set(missingItems.map((item) => `${item.productId}:${item.variantId || ""}`));
        setCart((current) => current.filter((item) => !missingIds.has(`${item.productId}:${item.variantId || ""}`)));
        throw new Error(`Estos productos ya no estan disponibles: ${missingItems.map((item) => item.productName).join(", ")}`);
      }

      const resolvedCartItems = resolvedProducts.map((entry) => entry!.item);
      const items = resolvedCartItems.map((it) => ({
        productId: it.productId,
        productName: it.productName,
        sku: it.sku ?? null,
        variantId: it.variantId ?? null,
        variantTitle: it.variantTitle ?? null,
        unitPrice: it.unitPrice,
        priceType: it.priceType ?? (isWholesaleCatalog ? "wholesale" : "retail"),
        qty: it.qty,
        subtotal: it.unitPrice * it.qty,
      }));

      const orderTotal = total; // ya incluye envío
      const clientRef = doc(db, "stores", store.id, "clients", cleanPhone);
      const orderRef = doc(collection(db, "stores", store.id, "orders"));

      // Las escrituras públicas pasan por el backend del mismo dominio.
      // Se conserva la transacción anterior como referencia, pero no se ejecuta.
      if (false) await runTransaction(db, async (tx) => {
        const productSnaps = resolvedProducts.map((entry) => entry!);

        const clientSnap = await tx.get(clientRef);

        const updates: { ref: any; data: any }[] = [];

        for (const { item, ref, data } of productSnaps) {
          if (selectedShipping === "cod" && data.allowsCashOnDelivery === false) {
            throw new Error(`El producto ${item.productName} no permite pago contra entrega`);
          }
          if (item.variantId) {
            const variants = data.variants || [];
            const i = variants.findIndex((v: any) => v.id === item.variantId);
            if (i === -1) throw new Error(`Variante no encontrada`);
            const variant = variants[i];
            if (typeof variant.stock === "number" && variant.stock >= item.qty) {
              variants[i].stock = variant.stock - item.qty;
              updates.push({ ref, data: { variants } });
            }
          } else {
            if (typeof data.stock === "number" && data.stock >= item.qty) {
              updates.push({
                ref,
                data: { stock: data.stock - item.qty },
              });
            }
          }
        }

        updates.forEach((u) => {
          tx.update(u.ref, u.data);
        });

        if (!clientSnap.exists()) {
          tx.set(clientRef, {
            name: cleanName,
            phone: cleanPhone,
            address: cleanAddress,
            customFields,
            notes: "",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            lastOrderAt: serverTimestamp(),
            totalOrders: 1,
            totalSpent: orderTotal,
          });
        } else {
          tx.update(clientRef, {
            name: cleanName,
            address: cleanAddress,
            customFields,
            updatedAt: serverTimestamp(),
            lastOrderAt: serverTimestamp(),
            totalOrders: increment(1),
            totalSpent: increment(orderTotal),
          });
        }

        tx.set(orderRef, {
          status: "new",
          channel: "whatsapp",
          clientId: cleanPhone,
          customer: {
            name: cleanName,
            phone: cleanPhone,
            address: cleanAddress,
            customFields,
          },
          customFields,
          notes: customerNotes.trim() || "",
          customerType: isWholesaleCatalog ? "wholesale" : "retail",
          items,
        subtotal,
        shippingMethod: selectedShipping ?? null,
        shippingCost,
        cashOnDeliveryEligible: cashOnDeliveryAvailable,
        total: orderTotal,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      const orderPayload = {
        id: orderRef.id,
        customer: { name: cleanName, phone: cleanPhone, address: cleanAddress },
        customFields,
        notes: customerNotes.trim() || "",
        customerType: isWholesaleCatalog ? "wholesale" : "retail",
        items,
        subtotal,
        shippingMethod: selectedShipping ?? null,
        shippingCost,
        total: orderTotal,
      };
      const orderResponse = await fetch("/api/public-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: store.id, order: orderPayload }),
      });
      const orderResult = await orderResponse.json().catch(() => ({}));
      if (!orderResponse.ok) {
        throw new Error(orderResult.error || "No se pudo registrar el pedido.");
      }

      // Mensaje de WhatsApp
      const lines: string[] = [];
      lines.push("🛒 *Nuevo pedido*");
      lines.push(`Tienda: *${store.name}*`);
      lines.push(`Tipo de cliente: *${isWholesaleCatalog ? "Mayorista" : "Público general"}*`);
      lines.push(`Pedido ID: ${orderRef.id}`);
      lines.push("");
      lines.push(`👤 Cliente: *${cleanName}*`);
      lines.push(`📞 Tel: ${cleanPhone}`);
      lines.push(`📍 Dirección: ${cleanAddress}`);
      customFields
        .filter((field) => field.value)
        .forEach((field) => {
          lines.push(`${field.label}: ${field.value}`);
        });
      if (customerNotes.trim()) lines.push(`📝 Notas: ${customerNotes.trim()}`);
      lines.push("");
      lines.push("📦 *Productos*:");
      resolvedCartItems.forEach((it) => {
        const v = it.variantTitle ? ` (${it.variantTitle})` : "";
        lines.push(
          `- ${it.qty} x ${it.productName}${v}${it.sku ? ` | SKU: ${it.sku}` : ""} — ${formatCOP(it.unitPrice * it.qty)}`
        );
      });
      lines.push("");
      lines.push(`🧾 Subtotal: ${formatCOP(subtotal)}`);
      if (shippingConfig.enabled && selectedShipping) {
        const label = SHIPPING_LABELS[selectedShipping].label;
        lines.push(`🚚 Envío (${label}): ${shippingCost === 0 ? "Gratis" : formatCOP(shippingCost)}`);
      } else if (shippingConfig.enabled && !cashOnDeliveryAvailable && shippingConfig.methods.includes("cod")) {
        lines.push("⚠️ Pago contra entrega: no disponible para todos los productos. Coordinar pago y envío.");
      }
      lines.push(`💰 *Total:* ${formatCOP(orderTotal)}`);

      const waUrl = buildWaLink(store.whatsapp, lines.join("\n"));
      clearCart();
      setCustomFieldValues({});
      setCheckoutOpen(false);
      if (whatsappWindow && !whatsappWindow.closed) {
        whatsappWindow.location.href = waUrl;
      } else {
        window.location.href = waUrl;
      }
    } catch (e) {
      console.error(e);
      if (whatsappWindow && !whatsappWindow.closed) {
        whatsappWindow.close();
      }
      const message = e instanceof Error ? e.message : "No se pudo crear el pedido. Intenta de nuevo.";
      alert(message);
    } finally {
      setPlacingOrder(false);
    }
  };

  const hasValidDiscount = (p?: Product | null) => {
    const d = p?.discount;
    if (!d || !d.value) return false;
    return (Number(d.value) || 0) > 0;
  };

  const handleCategoryChange = (categoryId: string) => {
    setActiveCategoryId(categoryId);
    const next = new URLSearchParams(searchParams);
    if (categoryId === "all") next.delete("category");
    else next.set("category", categoryId);
    setSearchParams(next, { replace: true });
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: store?.name, url });
      } catch { }
    } else {
      await navigator.clipboard.writeText(url);
      setShareToast(true);
      setTimeout(() => setShareToast(false), 2200);
    }
  };

  const brandColor = (store as any)?.brandColor || "#111111";
  const bannerUrl = (store as any)?.bannerUrl || "";
  const instagram = (store as any)?.instagram || "";
  const facebook = (store as any)?.facebook || "";
  const email = (store as any)?.email || "";
  const phone = (store as any)?.phone || "";
  const location = (store as any)?.location || "";
  const description = (store as any)?.description || store?.address || "";

  if (loading)
    return (
      <div className="h-screen flex items-center justify-center text-gray-500">
        Cargando catálogo...
      </div>
    );
  if (!store)
    return <CatalogUnavailableScreen reason="not_found" />;

  if (catalogUnavailableReason)
    return (
      <CatalogUnavailableScreen
        store={store}
        reason={catalogUnavailableReason}
      />
    );

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      {/* ── Toast compartir ── */}
      {shareToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] bg-gray-900 text-white text-sm font-semibold px-5 py-2.5 rounded-full shadow-lg">
          ¡Link copiado!
        </div>
      )}

      {/* ── Hero ── */}
      <div className="relative">
        {bannerUrl ? (
          <div className="w-full h-40 sm:h-52 overflow-hidden bg-gray-200">
            <img
              src={bannerUrl}
              alt={`Banner ${store.name}`}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 h-40 sm:h-52 bg-gradient-to-t from-black/50 to-transparent" />
          </div>
        ) : (
          <div
            className="w-full h-24 sm:h-32"
            style={{ background: brandColor, opacity: 0.15 }}
          />
        )}

        <div
          className={`relative max-w-6xl mx-auto px-4 ${bannerUrl ? "-mt-10" : "-mt-4"}`}
        >
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
            <div className="flex items-start gap-4">
              <div className="shrink-0 -mt-10 sm:-mt-12">
                {store.logoUrl ? (
                  <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-2xl bg-white border-2 border-white shadow-md overflow-hidden">
                    <img
                      src={store.logoUrl}
                      alt={`Logo ${store.name}`}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div
                    className="h-16 w-16 sm:h-20 sm:w-20 rounded-2xl border-2 border-white shadow-md flex items-center justify-center font-black text-2xl text-white"
                    style={{ background: brandColor }}
                  >
                    {(store.name || "T").trim().slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-extrabold text-lg sm:text-2xl text-gray-900 leading-tight truncate">
                    {store.name}
                  </h1>
                  {store.isActive ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                      Abierto
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-full px-2.5 py-0.5">
                      <i className="fa-solid fa-circle-xmark text-[10px]" />
                      Cerrado en este momento
                    </span>
                  )}
                  {isWholesaleCatalog ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2.5 py-0.5">
                      <i className="fa-solid fa-tags text-[10px]" />
                      Catálogo mayorista
                    </span>
                  ) : null}
                </div>

                {description ? (
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                    {description}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-3 mt-2">
                  {instagram ? (
                    <a
                      href={`https://instagram.com/${instagram}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-pink-600 transition"
                    >
                      <i className="fa-brands fa-instagram text-sm" />
                      <span className="hidden sm:inline">@{instagram}</span>
                    </a>
                  ) : null}

                  {facebook ? (
                    <a
                      href={`https://facebook.com/${facebook}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 transition"
                    >
                      <i className="fa-brands fa-facebook text-sm" />
                      <span className="hidden sm:inline">{facebook}</span>
                    </a>
                  ) : null}

                  {store.whatsapp ? (
                    <a
                      href={`https://wa.me/${store.whatsapp}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-green-600 transition"
                    >
                      <i className="fa-brands fa-whatsapp text-sm" />
                      <span className="hidden sm:inline">
                        +{store.whatsapp}
                      </span>
                    </a>
                  ) : null}

                  {email ? (
                    <a
                      href={`mailto:${email}`}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 transition"
                    >
                      <i className="fa-regular fa-envelope text-sm" />
                      <span className="hidden sm:inline">{email}</span>
                    </a>
                  ) : null}

                  {phone ? (
                    <a
                      href={`tel:${phone}`}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition"
                    >
                      <i className="fa-solid fa-phone text-sm" />
                      <span className="hidden sm:inline">{phone}</span>
                    </a>
                  ) : null}

                  {location ? (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setLocationTooltipOpen((prev) => !prev)}
                        onBlur={() =>
                          setTimeout(() => setLocationTooltipOpen(false), 150)
                        }
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-500 transition"
                        aria-label="Ver ubicación"
                        title={location}
                      >
                        <i className="fa-solid fa-location-dot text-sm text-red-400" />
                        <span className="hidden sm:inline">{location}</span>
                      </button>

                      {locationTooltipOpen ? (
                        <div className="sm:hidden absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-56 rounded-xl bg-gray-900 px-3 py-2 text-xs font-semibold text-white shadow-lg">
                          {location}
                          <span className="absolute -top-1 left-1/2 -translate-x-1/2 h-2 w-2 rotate-45 bg-gray-900" />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-end gap-2 shrink-0">
                <button
                  onClick={handleShare}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition"
                >
                  <i className="fa-solid fa-share-nodes" />
                  <span className="hidden sm:inline">Compartir</span>
                </button>

                <button
                  onClick={() => setCheckoutOpen(true)}
                  className="relative inline-flex items-center gap-2 rounded-xl px-4 py-2 font-extrabold shadow-sm text-sm text-white transition hover:opacity-90 active:scale-[0.99]"
                  style={{ background: brandColor }}
                >
                  <i className="fa-solid fa-cart-shopping" />
                  <span className="hidden sm:inline">Carrito</span>
                  {cart.length > 0 ? (
                    <span
                      className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-white text-[10px] font-black"
                      style={{ color: brandColor }}
                    >
                      {cart.reduce((a, b) => a + b.qty, 0)}
                    </span>
                  ) : null}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Categories bar ── */}
      <div className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b mt-3">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => handleCategoryChange("all")}
              className="shrink-0 px-4 py-2 rounded-full text-sm font-extrabold border transition"
              style={
                activeCategoryId === "all"
                  ? { background: brandColor, color: "#fff", borderColor: brandColor }
                  : { background: "#fff", color: "#374151", borderColor: "#e5e7eb" }
              }
            >
              Todo
            </button>

            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => handleCategoryChange(cat.id)}
                className="shrink-0 px-4 py-2 rounded-full text-sm font-extrabold border transition"
                style={
                  activeCategoryId === cat.id
                    ? { background: brandColor, color: "#fff", borderColor: brandColor }
                    : { background: "#fff", color: "#374151", borderColor: "#e5e7eb" }
                }
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        <div className="relative">
          <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, descripción, categoría, variante..."
            className="w-full pl-9 pr-10 py-2.5 rounded-2xl border border-gray-200 bg-white focus:outline-none focus:ring-2"
            style={{ "--tw-ring-color": brandColor + "55" } as any}
          />
          {search.trim() ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
              aria-label="Limpiar"
            >
              <i className="fa-solid fa-xmark" />
            </button>
          ) : null}
        </div>

        {isSearching && !searchLoaded ? (
          <div className="text-sm text-gray-500">
            {searchLoading ? "Buscando productos..." : "Preparando búsqueda..."}
          </div>
        ) : null}

        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500">
            {activeCategoryId === "all"
              ? "Todos los productos"
              : `Categoría: ${categories.find((c) => c.id === activeCategoryId)?.name || ""}`}
          </div>
          {activeCategoryId !== "all" ? (
            <button
              type="button"
              onClick={() => handleCategoryChange("all")}
              className="text-sm font-extrabold hover:opacity-70"
              style={{ color: brandColor }}
            >
              Ver todo
            </button>
          ) : null}
        </div>

        {queryError ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
            {queryError}
          </div>
        ) : null}

        {filteredProducts.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-2xl p-6 text-gray-500 shadow-sm">
            No hay productos en esta categoría.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {filteredProducts.map((prod) => {
              const img = getProductMainImage(prod);
              const imgOptim = img
                ? cldImg(img, { w: 600, h: 600, crop: "fill" })
                : "";
              const hasVariants = (prod.variants?.length ?? 0) > 0;
              const badge = discountBadgeText((prod as any).discount);
              const discOk = !isWholesaleCatalog && hasValidDiscount(prod);
              const cardPrice = getProductCardPrice(prod, isWholesaleCatalog);

              return (
                <div
                  key={prod.id}
                  className="group bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition overflow-hidden flex flex-col"
                >
                  <button
                    type="button"
                    onClick={() => openAddFlow(prod)}
                    className="relative aspect-square bg-gray-100 overflow-hidden text-left"
                    aria-label={`Ver ${prod.name}`}
                  >
                    {img ? (
                      <img
                        src={imgOptim}
                        alt={prod.name}
                        className="relative z-10 h-full w-full object-contain"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-gray-400">
                        <i className="fa-regular fa-image text-2xl" />
                      </div>
                    )}
                    {!isWholesaleCatalog && badge ? (
                      <div className="absolute top-3 left-3 z-20 pointer-events-none">
                        <span className="inline-flex items-center rounded-full bg-yellow-400 text-white px-3 py-1 text-xs font-extrabold shadow-sm">
                          {badge}
                        </span>
                      </div>
                    ) : null}
                  </button>

                  <div className="p-3 sm:p-4 flex-1 flex flex-col">
                    <div className="flex flex-col gap-1">
                      <div className="min-w-0">
                        <h3 className="text-sm sm:text-[15px] font-extrabold text-gray-900 break-words">
                          {prod.name}
                        </h3>
                      </div>
                      {prod.sku ? (
                        <div className="min-w-0 max-w-full">
                          <span className="inline-block max-w-full text-[10px] leading-4 font-bold text-gray-500 bg-gray-100 border border-gray-200 rounded-lg px-2 py-1 break-all whitespace-normal">
                            SKU: {prod.sku}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    {prod.description ? (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                        {prod.description}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                        &nbsp;
                      </p>
                    )}

                    <div className="mt-2">
                      {discOk ? (
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs text-gray-400 line-through font-bold">
                            {cardPrice.hasVariants
                              ? `Desde ${formatCOP(cardPrice.base)}`
                              : formatCOP(cardPrice.base)}
                          </span>
                          <span className="text-sm font-extrabold">
                            {cardPrice.hasVariants
                              ? `Desde ${formatCOP(cardPrice.final)}`
                              : formatCOP(cardPrice.final)}
                          </span>
                        </div>
                      ) : (
                        <div className="text-sm font-extrabold">
                          {cardPrice.hasVariants
                            ? `Desde ${formatCOP(cardPrice.base)}`
                            : formatCOP(cardPrice.base)}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => openAddFlow(prod)}
                      className="mt-3 w-full rounded-xl py-2.5 text-xs sm:text-sm font-extrabold text-white hover:opacity-90 active:scale-[0.99] transition"
                      style={{ background: brandColor }}
                    >
                      {hasVariants ? "Elegir variante" : "Añadir al carrito"}
                    </button>

                    {hasVariants ? (
                      <div className="mt-2 text-[11px] text-gray-500">
                        Variantes disponibles: <b>{prod.variants?.length}</b>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!isSearching && hasMore ? (
          <div className="flex justify-center">
            <button
              onClick={fetchMorePage}
              disabled={loadingMore}
              className="px-5 py-3 rounded-2xl font-extrabold border bg-white hover:bg-gray-50 disabled:opacity-60"
            >
              {loadingMore ? "Cargando..." : "Cargar más"}
            </button>
          </div>
        ) : null}
      </main>

      {/* ── Bottom CTA ── */}
      {cart.length > 0 && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[92%] max-w-md text-white p-4 rounded-2xl shadow-2xl flex justify-between items-center z-50"
          style={{ background: brandColor }}
        >
          <div>
            <div className="font-extrabold">
              {cart.reduce((a, b) => a + b.qty, 0)} items
            </div>
            <div className="text-xs opacity-80">{formatCOP(subtotal)}</div>
          </div>
          <button
            onClick={() => setCheckoutOpen(true)}
            className="bg-white px-4 py-2 rounded-xl font-extrabold text-sm hover:opacity-90"
            style={{ color: brandColor }}
          >
            Finalizar
          </button>
        </div>
      )}

      {/* ── Variant Modal ── */}
      {productModal.open && productModal.product && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4">
          <div className="flex h-[100dvh] w-full min-h-0 flex-col overflow-hidden bg-white shadow-xl sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-xl sm:rounded-3xl">
            <div className="shrink-0 border-b p-3 sm:p-4 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-lg sm:text-xl font-extrabold text-gray-900 break-words">
                  {productModal.product.name}
                </div>
              </div>
              <button
                onClick={() =>
                  setProductModal({ open: false, product: null, selectedVariantId: null, quantity: 1 })
                }
                className="h-10 w-10 rounded-full border flex items-center justify-center hover:bg-gray-50 shrink-0"
                aria-label="Cerrar"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto p-3 sm:p-5 space-y-4">
              <ImageCarousel
                images={(productModal.product.images || [])
                  .map((x: any) => x.url)
                  .filter(Boolean)}
                alt={productModal.product.name}
              />

              {productModal.product.description ? (
                <div className="space-y-2">
                  <div className="text-sm font-extrabold text-gray-900">Descripción</div>
                  <div className="max-h-40 overflow-y-auto rounded-2xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 whitespace-pre-line break-words">
                    {productModal.product.description}
                  </div>
                </div>
              ) : null}

              {(productModal.product.videos?.length ?? 0) > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm font-extrabold text-gray-900">Videos</div>
                  <div className="grid grid-cols-1 gap-3">
                    {productModal.product.videos!.map((v: any) => (
                      <div
                        key={v.path || v.url}
                        className="rounded-2xl overflow-hidden border bg-black"
                      >
                        <video src={v.url} controls className="h-[min(16rem,42dvh)] w-full object-contain" />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-500">Precio</div>
                {(() => {
                  const modalPrice = getProductCardPrice(productModal.product, isWholesaleCatalog);
                  return (
                    <div className="font-extrabold">
                      {!isWholesaleCatalog && hasValidDiscount(productModal.product) ? (
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs text-gray-400 line-through font-bold">
                            {modalPrice.hasVariants
                              ? `Desde ${formatCOP(modalPrice.base)}`
                              : formatCOP(modalPrice.base)}
                          </span>
                          <span>
                            {modalPrice.hasVariants
                              ? `Desde ${formatCOP(modalPrice.final)}`
                              : formatCOP(modalPrice.final)}
                          </span>
                        </div>
                      ) : modalPrice.hasVariants ? (
                        `Desde ${formatCOP(modalPrice.base)}`
                      ) : (
                        formatCOP(modalPrice.base)
                      )}
                    </div>
                  );
                })()}
              </div>

              {(productModal.product.variants?.length ?? 0) > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm font-extrabold text-gray-900">Variantes</div>
                  <div className="grid grid-cols-1 gap-2">
                    {(productModal.product.variants || []).map((v) => {
                      const outOfStock = false;
                      const selected = productModal.selectedVariantId === v.id;
                      const base = getBaseUnitPrice(productModal.product, v, isWholesaleCatalog);
                      const final = getFinalUnitPrice(productModal.product, v, isWholesaleCatalog);
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() =>
                            setProductModal((pm) => ({
                              ...pm,
                              selectedVariantId: v.id,
                              quantity: normalizeQuantity(pm.quantity, typeof v.stock === "number" && v.stock > 0 ? v.stock : undefined),
                            }))
                          }
                          className={`w-full rounded-2xl p-4 border flex items-center justify-between text-left transition
                          ${outOfStock ? "opacity-50 cursor-not-allowed bg-gray-50" : "bg-white hover:bg-gray-50"}`}
                          style={
                            selected
                              ? { borderColor: brandColor, boxShadow: `0 0 0 2px ${brandColor}22` }
                              : {}
                          }
                        >
                          <div>
                            <div className="font-extrabold text-gray-900">{v.title}</div>
                          </div>
                          <div className="font-extrabold">
                            {!isWholesaleCatalog && hasValidDiscount(productModal.product) ? (
                              <div className="flex items-baseline gap-2">
                                <span className="text-xs text-gray-400 line-through font-bold">
                                  {formatCOP(base)}
                                </span>
                                <span>{formatCOP(final)}</span>
                              </div>
                            ) : (
                              formatCOP(base)
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {(() => {
                const selectedVariant = (productModal.product?.variants || []).find(
                  (v) => v.id === productModal.selectedVariantId,
                );
                const maxStock =
                  selectedVariant && typeof selectedVariant.stock === "number" && selectedVariant.stock > 0
                    ? selectedVariant.stock
                    : undefined;

                return (
                  <div className="space-y-2">
                    <label
                      htmlFor="product-quantity"
                      className="text-sm font-extrabold text-gray-900"
                    >
                      Cantidad
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="h-11 w-11 rounded-xl border hover:bg-gray-50 shrink-0"
                        onClick={() =>
                          setProductModal((pm) => ({
                            ...pm,
                            quantity: normalizeQuantity(pm.quantity - 1, maxStock),
                          }))
                        }
                        aria-label="Restar cantidad"
                      >
                        <i className="fa-solid fa-minus text-xs" />
                      </button>
                      <input
                        id="product-quantity"
                        type="number"
                        min={1}
                        max={maxStock}
                        inputMode="numeric"
                        value={productModal.quantity}
                        onChange={(e) =>
                          setProductModal((pm) => ({
                            ...pm,
                            quantity: normalizeQuantity(Number(e.target.value), maxStock),
                          }))
                        }
                        className="h-11 w-full rounded-xl border border-gray-200 px-3 text-center font-extrabold outline-none focus:border-gray-400"
                      />
                      <button
                        type="button"
                        className="h-11 w-11 rounded-xl border hover:bg-gray-50 shrink-0"
                        onClick={() =>
                          setProductModal((pm) => ({
                            ...pm,
                            quantity: normalizeQuantity(pm.quantity + 1, maxStock),
                          }))
                        }
                        aria-label="Sumar cantidad"
                      >
                        <i className="fa-solid fa-plus text-xs" />
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="grid shrink-0 grid-cols-2 gap-2 border-t bg-white p-3 sm:p-4">
              <button
                type="button"
                onClick={() =>
                  setProductModal({ open: false, product: null, selectedVariantId: null, quantity: 1 })
                }
                className="w-full rounded-2xl border px-3 py-3 font-extrabold hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const p = productModal.product!;
                  const variants = p.variants || [];
                  if (variants.length > 0) {
                    const chosen = variants.find((v) => v.id === productModal.selectedVariantId);
                    if (!chosen) return alert("Selecciona una variante.");
                    addToCart(p, chosen, productModal.quantity);
                  } else {
                    addToCart(p, undefined, productModal.quantity);
                  }
                  setProductModal({ open: false, product: null, selectedVariantId: null, quantity: 1 });
                }}
                className="w-full rounded-2xl px-3 py-3 font-extrabold text-white hover:opacity-90"
                style={{ background: brandColor }}
              >
                Añadir al carrito
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Checkout Drawer ── */}
      {checkoutOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
          <div className="w-full sm:max-w-xl bg-white rounded-t-3xl sm:rounded-3xl h-full overflow-hidden shadow-2xl">
            <div className="p-4 sm:p-6 border-b flex items-start justify-between gap-3">
              <div>
                <div className="text-xl font-extrabold text-gray-900">Tu pedido</div>
                <div className="text-sm text-gray-500">
                  Completa tus datos y envía por WhatsApp
                </div>
              </div>
              <button
                onClick={() => setCheckoutOpen(false)}
                className="h-10 w-10 rounded-full border flex items-center justify-center hover:bg-gray-50"
                aria-label="Cerrar"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-auto max-h-[70vh] space-y-5">

              {/* Items del carrito */}
              <div className="space-y-3">
                {cart.length === 0 ? (
                  <div className="text-gray-400">Tu carrito está vacío.</div>
                ) : (
                  cart.map((it, idx) => (
                    <div
                      key={`${it.productId}:${it.variantId || "base"}`}
                      className="flex gap-3 border border-gray-100 rounded-2xl p-3 shadow-sm"
                    >
                      <div className="w-16 h-16 rounded-2xl bg-gray-100 overflow-hidden border relative">
                        {it.imageUrl ? (
                          <img
                            src={cldImg(it.imageUrl, { w: 160, h: 160, crop: "fill" })}
                            alt={it.productName}
                            className="relative z-10 w-full h-full object-contain"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400">
                            <i className="fa-regular fa-image text-sm" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-extrabold text-gray-900 truncate">
                          {it.productName}
                        </div>
                        {it.variantTitle ? (
                          <div className="text-xs text-gray-500">{it.variantTitle}</div>
                        ) : null}
                        <div className="text-sm font-extrabold mt-1">
                          {typeof it.originalUnitPrice === "number" &&
                            it.originalUnitPrice > it.unitPrice ? (
                            <div className="flex items-baseline gap-2">
                              <span className="text-xs text-gray-400 line-through font-bold">
                                {formatCOP(it.originalUnitPrice)}
                              </span>
                              <span>{formatCOP(it.unitPrice)}</span>
                            </div>
                          ) : (
                            formatCOP(it.unitPrice)
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          Subtotal: <b>{formatCOP(it.unitPrice * it.qty)}</b>
                        </div>
                      </div>
                      <div className="flex flex-col items-end justify-between">
                        <div className="flex items-center gap-2">
                          <button
                            className="w-9 h-9 rounded-xl border hover:bg-gray-50"
                            onClick={() => changeQty(idx, -1)}
                            type="button"
                          >
                            <i className="fa-solid fa-minus text-xs" />
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={getCartItemMaxStock(it)}
                            inputMode="numeric"
                            value={it.qty}
                            onChange={(e) => setCartQty(idx, Number(e.target.value))}
                            className="h-9 w-20 rounded-xl border border-gray-200 px-2 text-center font-extrabold outline-none focus:border-gray-400"
                            aria-label={`Cantidad de ${it.productName}`}
                          />
                          <button
                            className="w-9 h-9 rounded-xl border hover:bg-gray-50"
                            onClick={() => changeQty(idx, +1)}
                            type="button"
                          >
                            <i className="fa-solid fa-plus text-xs" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* ── Método de envío (NUEVO) ── */}
              {shippingConfig.enabled && availableShippingMethods.length > 0 && (
                <div className="space-y-3">
                  <div className="text-sm font-extrabold text-gray-900 flex items-center gap-2">
                    <i className="fa-solid fa-truck text-gray-400" />
                    Método de envío
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    {availableShippingMethods.map((method) => {
                      const meta = SHIPPING_LABELS[method as ShippingMethod];
                      const cost = method === "cod" ? shippingConfig.costCOD : shippingConfig.costCarrier;
                      const isSelected = selectedShipping === method;

                      return (
                        <button
                          key={method}
                          type="button"
                          onClick={() => setSelectedShipping(method as ShippingMethod)}
                          className="w-full rounded-2xl border-2 p-3.5 flex items-center justify-between text-left transition"
                          style={
                            isSelected
                              ? { borderColor: brandColor, background: brandColor + "08" }
                              : { borderColor: "#e5e7eb", background: "#fff" }
                          }
                        >
                          <div className="flex items-center gap-3">
                            <div className={`h-9 w-9 rounded-xl ${meta.bg} flex items-center justify-center shrink-0`}>
                              <i className={`${meta.icon} ${meta.color} text-sm`} />
                            </div>
                            <div>
                              <div className="font-extrabold text-gray-900 text-sm">
                                {meta.label}
                              </div>
                              {!shippingConfig.hidePrices && (
                                <div className="text-xs text-gray-500 mt-0.5">
                                  {cost === 0 ? "Gratis" : `+${formatCOP(cost)}`}
                                </div>
                              )}
                            </div>
                          </div>
                          {/* Radio visual */}
                          <div
                            className="h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors"
                            style={
                              isSelected
                                ? { borderColor: brandColor, background: brandColor }
                                : { borderColor: "#d1d5db", background: "#fff" }
                            }
                          >
                            {isSelected && (
                              <div className="h-2 w-2 rounded-full bg-white" />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Nota de envío */}
                  {!cashOnDeliveryAvailable && shippingConfig.methods.includes("cod") ? (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                      <i className="fa-solid fa-circle-info text-amber-500 text-sm mt-0.5 shrink-0" />
                      <p className="text-xs text-amber-800">El pago contra entrega no está disponible para uno o más productos del carrito.</p>
                    </div>
                  ) : null}

                  {shippingConfig.note ? (
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                      <i className="fa-solid fa-circle-info text-amber-500 text-sm mt-0.5 shrink-0" />
                      <p className="text-xs text-amber-800">{shippingConfig.note}</p>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Resumen de totales */}
              {shippingConfig.enabled && availableShippingMethods.length === 0 ? (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <i className="fa-solid fa-circle-info text-amber-500 text-sm mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-800">Algunos productos no permiten pago contra entrega. Puedes enviar el pedido y la tienda coordinará contigo el pago y el envío por WhatsApp.</p>
                </div>
              ) : null}

              {cart.length > 0 && (
                <div className="border-t pt-4 space-y-2">
                  <div className="flex items-center justify-between text-sm text-gray-500">
                    <span>Subtotal</span>
                    <span className="font-bold">{formatCOP(subtotal)}</span>
                  </div>
                  {shippingConfig.enabled && selectedShipping && !shippingConfig.hidePrices ? (
                    <div className="flex items-center justify-between text-sm text-gray-500">
                      <span>Envío ({SHIPPING_LABELS[selectedShipping].label})</span>
                      <span className="font-bold">
                        {shippingCost === 0 ? (
                          <span className="text-green-600">Gratis</span>
                        ) : (
                          formatCOP(shippingCost)
                        )}
                      </span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between font-black text-gray-900 text-base border-t pt-2 mt-1">
                    <span>Total</span>
                    <span>{formatCOP(total)}</span>
                  </div>
                </div>
              )}

              {/* Datos del cliente */}
              <div className="space-y-3">
                <div className="text-sm font-extrabold text-gray-900">Tus datos</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-600">Nombre</label>
                    <input
                      className="w-full mt-1 p-3 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      placeholder="Tu nombre"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600">Teléfono</label>
                    <input
                      className="w-full mt-1 p-3 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      placeholder="Solo números"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      inputMode="numeric"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">Dirección</label>
                  <input
                    className="w-full mt-1 p-3 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    placeholder="Tu dirección"
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                  />
                </div>
                {checkoutFields.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {checkoutFields.map((field) => {
                      const value = customFieldValues[field.id] || "";
                      const setValue = (nextValue: string) =>
                        setCustomFieldValues((current) => ({
                          ...current,
                          [field.id]: nextValue,
                        }));
                      const label = `${field.label}${field.required ? " *" : ""}`;

                      if (field.type === "textarea") {
                        return (
                          <div key={field.id} className="sm:col-span-2">
                            <label className="text-xs font-semibold text-gray-600">{label}</label>
                            <textarea
                              className="w-full mt-1 p-3 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-200"
                              placeholder={field.placeholder || field.label}
                              value={value}
                              onChange={(e) => setValue(e.target.value)}
                              rows={3}
                            />
                          </div>
                        );
                      }

                      if (field.type === "select") {
                        return (
                          <div key={field.id}>
                            <label className="text-xs font-semibold text-gray-600">{label}</label>
                            <select
                              className="w-full mt-1 p-3 border rounded-2xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
                              value={value}
                              onChange={(e) => setValue(e.target.value)}
                            >
                              <option value="">Selecciona una opcion</option>
                              {(field.options || []).map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      }

                      return (
                        <div key={field.id}>
                          <label className="text-xs font-semibold text-gray-600">{label}</label>
                          <input
                            type={field.type === "tel" ? "tel" : field.type}
                            inputMode={
                              field.type === "number"
                                ? "numeric"
                                : field.type === "tel"
                                  ? "tel"
                                  : undefined
                            }
                            className="w-full mt-1 p-3 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-200"
                            placeholder={field.placeholder || field.label}
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                <div>
                  <label className="text-xs font-semibold text-gray-600">
                    Notas (opcional)
                  </label>
                  <textarea
                    className="w-full mt-1 p-3 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    placeholder="Indicaciones para el pedido"
                    value={customerNotes}
                    onChange={(e) => setCustomerNotes(e.target.value)}
                    rows={3}
                  />
                </div>
              </div>
            </div>

            <div className="p-4 sm:p-6 border-t bg-white">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { clearCart(); setCheckoutOpen(false); }}
                  className="flex-1 rounded-2xl p-3 font-extrabold border hover:bg-gray-50"
                  disabled={placingOrder}
                >
                  Vaciar
                </button>
                <button
                  type="button"
                  onClick={placeOrder}
                  className="flex-1 rounded-2xl p-3 font-extrabold text-white hover:opacity-90 disabled:opacity-60"
                  style={{ background: brandColor }}
                  disabled={placingOrder || cart.length === 0}
                >
                  {placingOrder ? "Enviando..." : "Enviar a WhatsApp"}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-3">
                Se creará el pedido y se abrirá WhatsApp para confirmarlo con la tienda.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CatalogView;
