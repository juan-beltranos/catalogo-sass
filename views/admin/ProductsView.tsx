import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  updateDoc,
  query,
  orderBy,
  limit,
  offset,
  onSnapshot,
  serverTimestamp,
  getDocs,
  QueryDocumentSnapshot,
  DocumentData,
  getCountFromServer,
  writeBatch,
} from "@/lib/supabaseFirestore";
import { db } from "@/lib/supabase";
import { getStoreForOwner } from "@/lib/storeLookup";
import { useAuth } from "../../context/AuthContext";
import { Product } from "@/interfaces";
import { ImageItem, ImportedJsonProduct, ProductOption, Variant, VideoItem } from "@/types";
import { formatCOP, parseCOP, getActiveCurrencyCode } from "@/helpers";
import VariantsEditor from "@/components/admin/VariantsEditor";
import { compressImageFile } from "@/helpers/imageCompression";
import { MAX_VIDEO_MB, validateVideoFile } from "@/helpers/videoValidation";
import Paginator from "@/components/catalog/Paginator";
import { cldImg, deleteFromR2, uploadImagesToR2, uploadToR2 } from "@/helpers/r2Upload";
import * as XLSX from "xlsx";
import { getPlanLimitMessage } from "@/helpers/planLimits";
import { useSubscriptionAccess } from "@/hooks/useSubscriptionAccess";

import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const PAGE_SIZE = 10;

const FREE_MAX_PRODUCTS = 300;
const FREE_MAX_IMAGES = 1;
const FREE_MAX_VIDEOS = 0;
const PRO_MAX_IMAGES = 5;
const PRO_MAX_VIDEOS = 1;

const getProductOrderValue = (product: Product) =>
  typeof product.order === "number" && Number.isFinite(product.order)
    ? product.order
    : Number.MAX_SAFE_INTEGER;

const getProductCreatedAtMillis = (product: Product) => {
  const createdAt = product.createdAt;
  if (createdAt && typeof createdAt.toMillis === "function") return createdAt.toMillis();
  if (createdAt instanceof Date) return createdAt.getTime();
  if (typeof createdAt === "number") return createdAt;
  return 0;
};

const sortProductsForAdmin = (items: Product[]) =>
  [...items].sort((a, b) => {
    const orderA = getProductOrderValue(a);
    const orderB = getProductOrderValue(b);
    if (orderA !== orderB) return orderA - orderB;

    const createdAtA = getProductCreatedAtMillis(a);
    const createdAtB = getProductCreatedAtMillis(b);
    if (createdAtA !== createdAtB) return createdAtB - createdAtA;

    return String(a.name || "").localeCompare(String(b.name || ""));
  });

type PageCache = {
  storeId: string;
  products: Product[];
  hasNext: boolean;
  page: number;
};
let pageCache: PageCache | null = null;

const allProductsCache = new Map<string, Product[]>();

type SortableProductRowProps = {
  prod: Product;
  index: number;
  displayPrice: string;
  hasVariants: boolean;
  openEdit: (p: Product) => void;
  handleDeleteProduct: (p: Product) => void;
};

const SortableProductRow: React.FC<SortableProductRowProps> = ({
  prod,
  displayPrice,
  hasVariants,
  openEdit,
  handleDeleteProduct,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: prod.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`text-sm transition-colors ${isDragging ? "bg-indigo-50 opacity-80 relative z-10" : ""
        }`}
    >
      <td className="px-3 py-4">
        <button
          type="button"
          {...attributes}
          {...listeners}
          style={{ touchAction: "none" }}
          className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 flex items-center justify-center w-10 h-10"
          title="Arrastrar para reordenar"
        >
          <i className="fa-solid fa-grip-vertical text-base" />
        </button>
      </td>

      <td className="px-4 sm:px-6 py-4 font-medium">
        <div className="flex items-center gap-3">
          {prod.images?.[0]?.url ? (
            <img
              src={cldImg(prod.images[0].url, {
                w: 80,
                h: 80,
                crop: "fill",
              })}
              alt={prod.name}
              className="w-10 h-10 rounded object-cover border shrink-0"
              loading="lazy"
            />
          ) : (
            <div className="w-10 h-10 rounded bg-gray-100 border shrink-0" />
          )}

          <div className="min-w-0 flex-1">
            <div className="font-semibold text-gray-900 truncate">
              {prod.name}
            </div>

            <div className="text-xs text-gray-400 line-clamp-2 sm:line-clamp-1">
              {prod.description || ""}
            </div>

            {(prod.videos?.length ?? 0) > 0 ? (
              <div className="mt-1 text-[10px] text-gray-400">
                <i className="fa-solid fa-video mr-1" />
                {prod.videos!.length} video(s)
              </div>
            ) : null}
          </div>
        </div>
      </td>

      <td className="px-4 sm:px-6 py-4 font-bold text-indigo-600 whitespace-nowrap">
        {displayPrice}
      </td>

      <td className="px-4 sm:px-6 py-4 text-gray-600 whitespace-nowrap">
        {hasVariants ? prod.variants?.length : "-"}
      </td>

      <td className="px-4 sm:px-6 py-4 text-right whitespace-nowrap">
        <button
          onClick={() => openEdit(prod)}
          className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200 text-gray-500 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50"
          title="Editar"
          type="button"
        >
          <i className="fa-solid fa-pen" />
        </button>

        <button
          onClick={() => handleDeleteProduct(prod)}
          className="ml-2 inline-flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200 text-gray-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50"
          title="Eliminar"
          type="button"
        >
          <i className="fa-solid fa-trash-can" />
        </button>
      </td>
    </tr>
  );
};

const ProductsView: React.FC = () => {
  const { user } = useAuth();
  const planAccess = useSubscriptionAccess();

  const [storeId, setStoreId] = useState<string | null>(null);
  const [hasActiveSubscription, setHasActiveSubscription] = useState<boolean>(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [productCount, setProductCount] = useState(0);
  const [categories, setCategories] = useState<{ id: string; name: string; order?: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);

  // ── Drag & drop state ────────────────────────────────────────────────────
  const [savingOrder, setSavingOrder] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [deletingAllProducts, setDeletingAllProducts] = useState(false);

  const importExcelRef = useRef<HTMLInputElement | null>(null);
  const [importingExcel, setImportingExcel] = useState(false);

  // Create form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [wholesalePriceInput, setWholesalePriceInput] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sku, setSku] = useState("");
  const [hasDiscount, setHasDiscount] = useState(false);
  const [discountType, setDiscountType] = useState<"percent" | "amount">("percent");
  const [discountValueInput, setDiscountValueInput] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [allowsCashOnDelivery, setAllowsCashOnDelivery] = useState(true);

  const [createVariants, setCreateVariants] = useState<Variant[]>([]);
  const [useVariants, setUseVariants] = useState(false);
  const [editUseVariants, setEditUseVariants] = useState(false);

  // Edit modal
  const [editSku, setEditSku] = useState("");
  const [editHasDiscount, setEditHasDiscount] = useState(false);
  const [editDiscountType, setEditDiscountType] = useState<"percent" | "amount">("percent");
  const [editDiscountValueInput, setEditDiscountValueInput] = useState("");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editPriceInput, setEditPriceInput] = useState("");
  const [editWholesalePriceInput, setEditWholesalePriceInput] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ total: 0, done: 0, currentName: "" });

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [allLoaded, setAllLoaded] = useState(false);

  const importJsonRef = useRef<HTMLInputElement | null>(null);
  const prodsRefRef = useRef<ReturnType<typeof collection> | null>(null);
  const catsRefRef = useRef<ReturnType<typeof collection> | null>(null);

  const maxImages = hasActiveSubscription ? PRO_MAX_IMAGES : FREE_MAX_IMAGES;
  const maxVideos = hasActiveSubscription ? PRO_MAX_VIDEOS : FREE_MAX_VIDEOS;

  useEffect(() => {
    if (!user) return;
    const fetchStore = async () => {
      const store = await getStoreForOwner(user.uid);
      if (store) {
        setStoreId(store.id);
        setHasActiveSubscription(store.data.hasActiveSubscription === true);
      } else {
        console.error("No se encontró tienda para este usuario");
      }
    };
    fetchStore();
  }, [user]);

  const catsRef = useMemo(() => {
    if (!storeId) return null;
    const r = collection(db, "stores", storeId, "categories");
    catsRefRef.current = r;
    return r;
  }, [storeId]);

  const prodsRef = useMemo(() => {
    if (!storeId) return null;
    const r = collection(db, "stores", storeId, "products");
    prodsRefRef.current = r;
    return r;
  }, [storeId]);

  useEffect(() => {
    if (!prodsRef) return;
    let active = true;
    getCountFromServer(prodsRef)
      .then((snapshot) => { if (active) setProductCount(snapshot.data().count); })
      .catch((error) => console.error("Error contando productos:", error));
    return () => { active = false; };
  }, [prodsRef, products]);

  const mapDocToProduct = useCallback(
    (d: QueryDocumentSnapshot<DocumentData>): Product => {
      const data = d.data() as any;
      return {
        id: d.id,
        name: data.name ?? "",
        sku: data.sku ?? null,
        discount: data.discount ?? null,
        description: data.description ?? "",
        price: Number(data.price ?? 0),
        wholesalePrice: data.wholesalePrice ?? null,
        categoryId: data.categoryId ?? "",
        images: (data.images ?? []) as ImageItem[],
        videos: (data.videos ?? []) as VideoItem[],
        options: (data.options ?? []) as ProductOption[],
        variants: (data.variants ?? []) as Variant[],
        isActive: data.isActive ?? true,
        allowsCashOnDelivery: data.allowsCashOnDelivery ?? true,
        order: data.order ?? null,
        createdAt: data.createdAt ?? null,
      };
    },
    []
  );

  useEffect(() => {
    if (!storeId || !catsRef || !prodsRef) return;

    const qCats = query(catsRef, orderBy("name", "asc"));
    const unsubCats = onSnapshot(qCats, (snap) => {
      setCategories(snap.docs.map((d) => ({ id: d.id, name: d.data().name, order: d.data().order ?? 0 })));
    });

    if (pageCache && pageCache.storeId === storeId) {
      setProducts(pageCache.products);
      setHasNext(pageCache.hasNext);
      setPage(pageCache.page);
      setLoading(false);
    } else {
      setLoading(true);
      loadFirstPage();
    }

    const cached = allProductsCache.get(storeId);
    if (cached) { setAllProducts(cached); setAllLoaded(true); }

    return () => { unsubCats(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const loadAllProductsOnce = useCallback(async () => {
    if (!prodsRef || !storeId) return;
    if (allProductsCache.has(storeId)) {
      setAllProducts(allProductsCache.get(storeId)!);
      setAllLoaded(true);
      return;
    }
    setSearching(true);
    try {
      const snap = await getDocs(prodsRef);
      const all = sortProductsForAdmin(snap.docs.map(mapDocToProduct));
      allProductsCache.set(storeId, all);
      setAllProducts(all);
      setAllLoaded(true);
    } catch (e) {
      console.error(e);
      alert("Error cargando todos los productos para búsqueda.");
    } finally {
      setSearching(false);
    }
  }, [prodsRef, storeId, mapDocToProduct]);

  const reloadAllProducts = useCallback(async () => {
    if (!prodsRef || !storeId) return;
    try {
      const snap = await getDocs(prodsRef);
      const all = sortProductsForAdmin(snap.docs.map(mapDocToProduct));
      allProductsCache.set(storeId, all);
      setAllProducts(all);
      setAllLoaded(true);
    } catch (e) {
      console.error(e);
    }
  }, [prodsRef, storeId, mapDocToProduct]);

  const getFinalPriceForExport = (product: Product) => {
    const price = Number(product.price ?? 0);
    const discount = product.discount;

    if (!discount || !discount.value) return price;

    if (discount.type === "percent") {
      return Math.max(
        0,
        Math.round(price * (1 - Math.min(100, Math.max(0, discount.value)) / 100))
      );
    }

    return Math.max(0, price - Math.max(0, discount.value));
  };

  const exportProductsToExcel = async () => {
    if (!prodsRef || !storeId) {
      alert("La tienda aún no está lista.");
      return;
    }

    setExportingExcel(true);

    try {
      const snap = await getDocs(prodsRef);
      const exportedProducts = sortProductsForAdmin(snap.docs.map(mapDocToProduct));

      const categoryMap = new Map(categories.map((cat) => [cat.id, cat.name]));

      const rows = exportedProducts.map((product, index) => {
        const images = product.images ?? [];
        const videos = product.videos ?? [];
        const variants = product.variants ?? [];
        const options = product.options ?? [];
        const discount = product.discount;

        return {
          Orden: product.order ?? index,
          ID: product.id,
          Nombre: product.name ?? "",
          SKU: product.sku ?? "",
          Descripción: product.description ?? "",
          Categoría: categoryMap.get(product.categoryId ?? "") ?? "",
          "ID Categoría": product.categoryId ?? "",
          Precio: Number(product.price ?? 0),
          "Precio formateado": formatCOP(Number(product.price ?? 0)),
          "Precio mayorista": product.wholesalePrice ?? "",
          "Tiene descuento": discount ? "Sí" : "No",
          "Tipo descuento": discount?.type ?? "",
          "Valor descuento": discount?.value ?? "",
          "Precio final": getFinalPriceForExport(product),
          "Precio final formateado": formatCOP(getFinalPriceForExport(product)),
          "Visible en catálogo": product.isActive ? "Sí" : "No",
          "Envío contra entrega": (product.allowsCashOnDelivery ?? true) ? "Sí" : "No",
          "Cantidad imágenes": images.length,
          "Imágenes URLs": images.map((img) => img.url).join(" | "),
          "Imágenes publicId/path": images
            .map((img: any) => img.publicId || img.path || "")
            .filter(Boolean)
            .join(" | "),
          "Cantidad videos": videos.length,
          "Videos URLs": videos.map((video) => video.url).join(" | "),
          "Videos path": videos
            .map((video: any) => video.path || "")
            .filter(Boolean)
            .join(" | "),
          "Tiene variantes": variants.length > 0 ? "Sí" : "No",
          "Cantidad variantes": variants.length,
          Variantes: variants.length ? JSON.stringify(variants) : "",
          Opciones: options.length ? JSON.stringify(options) : "",
        };
      });

      if (!rows.length) {
        alert("No hay productos para exportar.");
        return;
      }

      const worksheet = XLSX.utils.json_to_sheet(rows);

      worksheet["!cols"] = [
        { wch: 8 },
        { wch: 24 },
        { wch: 32 },
        { wch: 18 },
        { wch: 45 },
        { wch: 24 },
        { wch: 24 },
        { wch: 14 },
        { wch: 18 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
        { wch: 14 },
        { wch: 22 },
        { wch: 18 },
        { wch: 18 },
        { wch: 60 },
        { wch: 45 },
        { wch: 16 },
        { wch: 60 },
        { wch: 45 },
        { wch: 16 },
        { wch: 18 },
        { wch: 60 },
        { wch: 60 },
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Productos");

      const date = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(workbook, `productos-${date}.xlsx`);
    } catch (error) {
      console.error("Error exportando productos:", error);
      alert("No se pudieron exportar los productos.");
    } finally {
      setExportingExcel(false);
    }
  };

  const downloadImportTemplate = () => {
    const productsSheet = XLSX.utils.json_to_sheet([
      {
        ID: "",
        Nombre: "Producto de ejemplo",
        SKU: "EJ-001",
        Descripción: "Descripción opcional",
        Categoría: "General",
        Precio: 100000,
        "Precio mayorista": 80000,
        "Tiene descuento": "No",
        "Tipo descuento": "",
        "Valor descuento": "",
        "Visible en catálogo": "Sí",
        "Envío contra entrega": "Sí",
        Orden: "",
        Variantes: "",
        Opciones: "",
      },
    ]);

    productsSheet["!cols"] = [
      { wch: 24 }, { wch: 30 }, { wch: 18 }, { wch: 42 }, { wch: 22 },
      { wch: 16 }, { wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 20 },
      { wch: 22 }, { wch: 24 }, { wch: 10 }, { wch: 45 }, { wch: 45 },
    ];

    const instructionsSheet = XLSX.utils.aoa_to_sheet([
      ["Campo", "Cómo usarlo"],
      ["ID", "Opcional. Úsalo para actualizar exactamente un producto exportado."],
      ["SKU", "Opcional. Si coincide con un producto existente, se actualiza."],
      ["Nombre", "Obligatorio. También se usa para encontrar productos existentes si no hay ID o SKU."],
      ["Categoría", "Se crea automáticamente si no existe."],
      ["Precio", "Obligatorio. Usa solo números, por ejemplo 100000."],
      ["Precio mayorista", "Opcional. Se muestra únicamente en el enlace mayorista. Déjalo vacío para usar el precio normal."],
      ["Envío contra entrega", "Escribe Sí o No. Si queda vacío, los productos nuevos lo tendrán habilitado y las actualizaciones no cambiarán el valor actual."],
      ["Visible en catálogo", "Escribe Sí o No. Si queda vacío, el producto se importará como activo."],
      ["Descuento", "Usa Tiene descuento, Tipo descuento (percent o amount) y Valor descuento."],
      ["Orden", "Opcional. Al importar, se respeta el orden visual de las filas del Excel."],
      ["Variantes y Opciones", "Opcional. Si las usas, conserva el formato JSON de un archivo exportado."],
    ]);
    instructionsSheet["!cols"] = [{ wch: 25 }, { wch: 105 }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, productsSheet, "Productos");
    XLSX.utils.book_append_sheet(workbook, instructionsSheet, "Instrucciones");
    XLSX.writeFile(workbook, "plantilla-importacion-productos.xlsx");
  };

  const parseBooleanFromExcel = (value: any) => {
    const normalized = String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    return normalized === "si" || normalized === "sí" || normalized === "true" || normalized === "1";
  };

  const parseJsonSafe = <T,>(value: any, fallback: T): T => {
    if (!value) return fallback;

    try {
      const parsed = JSON.parse(String(value));
      return parsed;
    } catch {
      return fallback;
    }
  };

  const importProductsFromExcel = async (file: File) => {
    if (!storeId || !prodsRef || !catsRef) {
      alert("La tienda aún no está lista.");
      return;
    }

    setImportingExcel(true);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      const rows = XLSX.utils.sheet_to_json<any>(worksheet, {
        defval: "",
      });

      if (!rows.length) {
        alert("El Excel no tiene productos para importar.");
        return;
      }

      // ─────────────────────────────────────────────
      // Productos existentes para relacionar/actualizar
      // ─────────────────────────────────────────────
      const productsSnap = await getDocs(prodsRef);

      const existingProducts = productsSnap.docs.map((d) => ({
        id: d.id,
        data: d.data() as any,
      }));

      const existingById = new Map(existingProducts.map((p) => [p.id, p]));

      const existingBySku = new Map(
        existingProducts
          .filter((p) => String(p.data.sku ?? "").trim())
          .map((p) => [normalizeText(p.data.sku), p])
      );

      const existingByName = new Map(
        existingProducts
          .filter((p) => String(p.data.name ?? "").trim())
          .map((p) => [normalizeText(p.data.name), p])
      );

      // ─────────────────────────────────────────────
      // Categorías existentes desde Firestore
      // No confiamos solo en el estado `categories`
      // ─────────────────────────────────────────────
      const categoriesSnap = await getDocs(catsRef);

      const dbCategories = categoriesSnap.docs.map((d) => ({
        id: d.id,
        name: String(d.data().name ?? ""),
        order: Number(d.data().order ?? 0) || 0,
      }));

      const categoryMap = new Map<string, string>();
      const categoryIds = new Set<string>();

      dbCategories.forEach((cat) => {
        categoryIds.add(cat.id);
        categoryMap.set(normalizeText(cat.name), cat.id);
      });

      let categoryOrderCounter = dbCategories.length
        ? Math.max(...dbCategories.map((cat) => cat.order)) + 1
        : 1;

      let created = 0;
      let updated = 0;
      let skipped = 0;
      let createdCategories = 0;

      const importedProductIds = new Set<string>();
      let importOrderCounter = 0;

      for (const row of rows) {
        const excelId = String(row["ID"] ?? "").trim();
        const name = String(row["Nombre"] ?? "").trim();
        const skuValue = String(row["SKU"] ?? "").trim();
        const nameKey = normalizeText(name);
        const skuKey = normalizeText(skuValue);

        // Prioridad para relacionar:
        // 1. ID exacto del producto
        // 2. SKU
        // 3. Nombre normalizado
        const existingByExcelId = excelId ? existingById.get(excelId) : null;
        const existingBySkuValue = skuKey ? existingBySku.get(skuKey) : null;
        const existingByNameValue = nameKey ? existingByName.get(nameKey) : null;

        const existingProduct =
          existingByExcelId || existingBySkuValue || existingByNameValue;
        const isUpdatingExistingProduct = Boolean(existingProduct);

        const priceRaw = row["Precio"];
        const priceFormattedRaw = row["Precio formateado"];
        const hasPriceValue =
          String(priceRaw ?? "").trim() !== "" ||
          String(priceFormattedRaw ?? "").trim() !== "";
        const price = parseNumberSafe(priceRaw || priceFormattedRaw);
        const wholesalePriceRaw = row["Precio mayorista"];
        const hasWholesalePrice = String(wholesalePriceRaw ?? "").trim() !== "";
        const wholesalePrice = hasWholesalePrice
          ? (parseNumberSafe(wholesalePriceRaw) || null)
          : null;
        const cashOnDeliveryRaw = row["Envío contra entrega"] ?? row["Envio contra entrega"];
        const hasCashOnDeliveryValue = String(cashOnDeliveryRaw ?? "").trim() !== "";

        const categoryName = String(row["Categoría"] ?? "").trim();
        const categoryIdFromExcel = String(row["ID Categoría"] ?? "").trim();

        let finalCategoryId = "";

        // Importante:
        // Solo usamos el ID de categoría del Excel si existe en ESTA tienda.
        // Si no existe, buscamos/creamos por nombre de categoría.
        if (categoryIdFromExcel && categoryIds.has(categoryIdFromExcel)) {
          finalCategoryId = categoryIdFromExcel;
        } else if (categoryName) {
          const normalizedCategoryName = normalizeText(categoryName);
          const cachedCategoryId = categoryMap.get(normalizedCategoryName);

          if (cachedCategoryId) {
            finalCategoryId = cachedCategoryId;
          } else {
            const newCategoryRef = await addDoc(catsRef, {
              name: categoryName,
              order: categoryOrderCounter++,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });

            finalCategoryId = newCategoryRef.id;
            categoryMap.set(normalizedCategoryName, newCategoryRef.id);
            categoryIds.add(newCategoryRef.id);
            createdCategories++;
          }
        }

        if (
          !isUpdatingExistingProduct &&
          (!name || !finalCategoryId || !hasPriceValue || price <= 0)
        ) {
          skipped++;
          continue;
        }

        if (isUpdatingExistingProduct && hasPriceValue && price <= 0) {
          skipped++;
          continue;
        }

        const discountTypeRaw = String(row["Tipo descuento"] ?? "").trim();
        const discountValueRaw = row["Valor descuento"];
        const discountValue = parseNumberSafe(row["Valor descuento"]);
        const hasDiscountValue =
          discountTypeRaw !== "" || String(discountValueRaw ?? "").trim() !== "";

        const discount =
          discountTypeRaw && discountValue > 0
            ? {
              type: discountTypeRaw === "percent" ? "percent" : "amount",
              value:
                discountTypeRaw === "percent"
                  ? Math.min(100, Math.max(0, discountValue))
                  : Math.max(0, discountValue),
            }
            : null;

        const imagesUrls = String(row["Imágenes URLs"] ?? "")
          .split("|")
          .map((url) => url.trim())
          .filter(Boolean);

        const imagesMeta = String(row["Imágenes publicId/path"] ?? "")
          .split("|")
          .map((item) => item.trim());

        const images: ImageItem[] = imagesUrls.map((url, index) => {
          const meta = imagesMeta[index] || "";

          return {
            url,
            ...(meta ? { publicId: meta } : {}),
          } as ImageItem;
        });

        const videosUrls = String(row["Videos URLs"] ?? "")
          .split("|")
          .map((url) => url.trim())
          .filter(Boolean);

        const videosPaths = String(row["Videos path"] ?? "")
          .split("|")
          .map((item) => item.trim());

        const videos: VideoItem[] = videosUrls.map((url, index) => ({
          url,
          path: videosPaths[index] || "",
        }));

        const variants = parseJsonSafe<Variant[]>(row["Variantes"], []);
        const options = parseJsonSafe<ProductOption[]>(row["Opciones"], []);

        const rowOrder = importOrderCounter++;
        const isActiveRaw = row["Visible en catálogo"];
        const hasIsActiveValue = String(isActiveRaw ?? "").trim() !== "";
        const isActiveValue = hasIsActiveValue
          ? parseBooleanFromExcel(isActiveRaw)
          : true;
        const optionalImportFields: Record<string, any> = {};
        if (hasWholesalePrice) optionalImportFields.wholesalePrice = wholesalePrice;
        if (hasCashOnDeliveryValue) {
          optionalImportFields.allowsCashOnDelivery = parseBooleanFromExcel(cashOnDeliveryRaw);
        }

        const hasDescriptionValue = String(row["Descripción"] ?? "").trim() !== "";
        const hasImagesValue = imagesUrls.length > 0 || imagesMeta.some(Boolean);
        const hasVideosValue = videosUrls.length > 0 || videosPaths.some(Boolean);
        const hasVariantsValue = String(row["Variantes"] ?? "").trim() !== "";
        const hasOptionsValue = String(row["Opciones"] ?? "").trim() !== "";

        const payload: Record<string, any> = {
          ...optionalImportFields,
          updatedAt: serverTimestamp(),
        };

        if (name || !isUpdatingExistingProduct) payload.name = name;
        if (skuValue || !isUpdatingExistingProduct) payload.sku = skuValue || null;
        if (hasDescriptionValue || !isUpdatingExistingProduct) {
          payload.description = htmlToPlainText(row["Descripción"]);
        }
        if (hasPriceValue || !isUpdatingExistingProduct) payload.price = price;
        if (hasDiscountValue || !isUpdatingExistingProduct) payload.discount = discount;
        if (finalCategoryId || !isUpdatingExistingProduct) payload.categoryId = finalCategoryId;
        if (hasImagesValue || !isUpdatingExistingProduct) payload.images = images;
        if (hasVideosValue || !isUpdatingExistingProduct) payload.videos = videos;
        if (hasOptionsValue || !isUpdatingExistingProduct) payload.options = options;
        if (hasVariantsValue || !isUpdatingExistingProduct) payload.variants = variants;
        if (hasIsActiveValue || !isUpdatingExistingProduct) payload.isActive = isActiveValue;
        if (row["Orden"] !== undefined && String(row["Orden"] ?? "").trim() !== "") {
          payload.order = parseNumberSafe(row["Orden"]);
        } else if (!isUpdatingExistingProduct) {
          payload.order = rowOrder;
        }

        if (existingProduct) {
          await updateDoc(
            doc(db, "stores", storeId, "products", existingProduct.id),
            payload
          );
          importedProductIds.add(existingProduct.id);
          updated++;
        } else {
          const newProductRef = await addDoc(prodsRef, {
            ...payload,
            wholesalePrice: hasWholesalePrice ? wholesalePrice : null,
            allowsCashOnDelivery: hasCashOnDeliveryValue
              ? parseBooleanFromExcel(cashOnDeliveryRaw)
              : true,
            createdAt: serverTimestamp(),
          });
          importedProductIds.add(newProductRef.id);
          created++;
        }
      }

      const shouldReorderMissingProducts =
        rows.length >= existingProducts.length &&
        rows.some((row) => String(row["Orden"] ?? "").trim() !== "");

      if (shouldReorderMissingProducts) {
        const productsNotInExcel = existingProducts.filter((p) => !importedProductIds.has(p.id));
        for (let start = 0; start < productsNotInExcel.length; start += 450) {
          const batch = writeBatch(db);
          productsNotInExcel.slice(start, start + 450).forEach((product, index) => {
            batch.update(doc(db, "stores", storeId, "products", product.id), {
              order: rows.length + start + index,
              updatedAt: serverTimestamp(),
            });
          });
          await batch.commit();
        }
      }

      await loadFirstPage();

      if (allLoaded) {
        await reloadAllProducts();
      }

      if (importExcelRef.current) {
        importExcelRef.current.value = "";
      }

      alert(
        `Importación completada.\nActualizados: ${updated}\nCreados: ${created}\nCategorías creadas: ${createdCategories}\nOmitidos: ${skipped}`
      );
    } catch (error) {
      console.error("Error importando Excel:", error);
      alert(getPlanLimitMessage(error) || "No se pudo importar el Excel. Revisa que tenga el mismo formato exportado.");
    } finally {
      setImportingExcel(false);
    }
  };

  const normalize = (s: string) =>
    (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  const filterLocal = useCallback(
    (termRaw: string) => {
      const term = normalize(termRaw);
      if (!term) { setSearchResults([]); return; }
      const parts = term.split(/\s+/).filter(Boolean);
      const filtered = allProducts.filter((p) => {
        const hay = normalize(`${p.name ?? ""} ${p.sku ?? ""} ${p.description ?? ""}`);
        return parts.every((w) => hay.includes(w));
      });
      setSearchResults(filtered);
    },
    [allProducts]
  );

  useEffect(() => {
    if (!storeId || !prodsRef) return;
    const run = async () => {
      if (!debouncedSearch) { setSearchResults([]); return; }
      if (!allLoaded) await loadAllProductsOnce();
      filterLocal(debouncedSearch);
    };
    run();
  }, [debouncedSearch, storeId, prodsRef, allLoaded, loadAllProductsOnce, filterLocal]);

  const uploadImages = async (files: File[]): Promise<ImageItem[]> => {
    if (!storeId || !files.length) return [];
    if (uploading) return [];
    setUploading(true);
    setUploadProgress({ done: 0, total: files.length, currentName: "" });
    try {
      const optimizedFiles: File[] = [];
      for (const f of files) {
        optimizedFiles.push(await compressImageFile(f));
      }
      const uploaded = await uploadImagesToR2({
        files: optimizedFiles,
        folder: `stores/${storeId}/products`,
        onFileDone: ({ index, file }) => {
          setUploadProgress({ done: index + 1, total: optimizedFiles.length, currentName: file.name });
        },
      });
      setUploadProgress({ done: optimizedFiles.length, total: optimizedFiles.length, currentName: "" });
      return uploaded.map((img) => ({ url: img.url, publicId: img.path }));
    } finally {
      setUploading(false);
    }
  };

  const uploadVideos = async (files: File[]): Promise<VideoItem[]> => {
    if (!storeId || !files.length) return [];
    const uploaded: VideoItem[] = [];
    for (const f of files) {
      const err = validateVideoFile(f);
      if (err) { alert(err); continue; }
      const result = await uploadToR2({
        file: f,
        folder: `stores/${storeId}/products/videos`,
        resourceType: "video",
      });
      uploaded.push({ url: result.url, path: result.path });
    }
    return uploaded;
  };

  const deleteProductMediaFromR2 = async (productList: Product[]) => {
    const paths = new Set<string>();
    productList.forEach((product) => {
      (product.images || []).forEach((image: any) => {
        const path = image.publicId || image.path;
        if (path) paths.add(path);
      });
      (product.videos || []).forEach((video: any) => {
        const path = video.path || video.publicId;
        if (path) paths.add(path);
      });
    });

    for (const path of paths) {
      try {
        await deleteFromR2(path);
      } catch (error) {
        console.warn("No se pudo borrar archivo de R2:", path, error);
      }
    }
  };

  const resetCreateForm = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
    setName(""); setDescription(""); setPriceInput(""); setWholesalePriceInput(""); setCategoryId(""); setSku("");
    setHasDiscount(false); setDiscountType("percent"); setDiscountValueInput("");
    setImageFiles([]); setVideoFiles([]); setUseVariants(false); setCreateVariants([]); setIsActive(true); setAllowsCashOnDelivery(true);
  };

  // ── loadPage: usa el mismo orden que el catálogo público ──
  const loadPage = useCallback(
    async (
      mode: "first" | "next" | "prev"
    ) => {
      if (!prodsRef || !storeId) return;
      setLoadingPage(true);
      try {
        const targetPage =
          mode === "first" ? 1 : mode === "next" ? page + 1 : Math.max(1, page - 1);
        const start = (targetPage - 1) * PAGE_SIZE;
        const pageQuery = query(
          prodsRef,
          orderBy("order", "asc"),
          orderBy("createdAt", "desc"),
          limit(PAGE_SIZE + 1),
          offset(start),
        );
        const snap = await getDocs(pageQuery);
        const sortedProducts = sortProductsForAdmin(snap.docs.map(mapDocToProduct));
        const pageProducts = sortedProducts.slice(0, PAGE_SIZE);
        const nextExists = sortedProducts.length > PAGE_SIZE;

        setProducts(pageProducts);
        setHasNext(nextExists);
        setPage(targetPage);

        pageCache = { storeId, products: pageProducts, hasNext: nextExists, page: targetPage };
      } finally {
        setLoadingPage(false);
        setLoading(false);
      }
    },
    [prodsRef, storeId, mapDocToProduct, page]
  );

  const loadFirstPage = useCallback(async () => {
    await loadPage("first");
  }, [loadPage]);

  const goNext = useCallback(async () => {
    if (!hasNext || loadingPage) return;
    await loadPage("next");
  }, [hasNext, loadingPage, loadPage]);

  const goPrev = useCallback(async () => {
    if (page <= 1 || loadingPage) return;
    await loadPage("prev");
  }, [page, loadingPage, loadPage]);

  // ── Drag & drop handlers ─────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 180,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id || !storeId) return;

    const oldIndex = products.findIndex((p) => p.id === active.id);
    const newIndex = products.findIndex((p) => p.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(products, oldIndex, newIndex);

    const pageOffset = (page - 1) * PAGE_SIZE;
    const updated = reordered.map((p, i) => ({
      ...p,
      order: pageOffset + i,
    }));

    setProducts(updated);

    if (pageCache?.storeId === storeId) {
      pageCache.products = updated;
    }

    setSavingOrder(true);

    try {
      const batch = writeBatch(db);

      updated.forEach((p) => {
        batch.update(doc(db, "stores", storeId, "products", p.id), {
          order: p.order,
          updatedAt: serverTimestamp(),
        });
      });

      await batch.commit();

      if (allLoaded) {
        await reloadAllProducts();
      }
    } catch (err) {
      console.error("Error guardando orden:", err);
      alert("No se pudo guardar el orden. Intenta de nuevo.");
      await loadFirstPage();
    } finally {
      setSavingOrder(false);
    }
  };

  // ── CRUD (sin cambios) ───────────────────────────────────────────────────

  const discountValueNum = Number((discountValueInput || "").replace(/[^\d]/g, "")) || 0;
  const basePrice = parseCOP(priceInput);

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId || !prodsRef) return;
    if (isSubmitting) return;
    const cleanName = name.trim();
    const bp = parseCOP(priceInput);
    if (!cleanName || !categoryId || !bp) return;

    if (!hasActiveSubscription) {
      const countSnap = await getCountFromServer(prodsRef);
      const total = countSnap.data().count;
      if (total >= FREE_MAX_PRODUCTS) {
        alert(`Has alcanzado el límite de ${FREE_MAX_PRODUCTS} productos.\nActiva tu suscripción para crear productos ilimitados.`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const allowedImages = imageFiles.slice(0, maxImages);
      const allowedVideos = videoFiles.slice(0, maxVideos);
      if (imageFiles.length > maxImages) alert(`Solo se subirán las primeras ${maxImages} imagen(es).`);
      if (videoFiles.length > 0 && maxVideos === 0) alert("Tu plan no permite subir videos.");

      const images = await uploadImages(allowedImages);
      const videos = await uploadVideos(allowedVideos);
      const variants = useVariants ? (createVariants || []) : [];
      const cleanSku = sku.trim() || null;
      const wholesalePrice = parseCOP(wholesalePriceInput) || null;
      const discount = hasDiscount && discountValueNum > 0
        ? { type: discountType, value: discountType === "percent" ? Math.min(100, Math.max(0, discountValueNum)) : Math.max(0, discountValueNum) }
        : null;

      // El nuevo producto va al final del orden
      const countSnap = await getCountFromServer(prodsRef);
      const newOrder = countSnap.data().count;

      await addDoc(prodsRef, {
        name: cleanName, sku: cleanSku, description: description.trim(), price: bp, wholesalePrice, discount,
        categoryId, images, videos, options: [], variants, isActive, allowsCashOnDelivery,
        order: newOrder,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });

      pageCache = null;
      allProductsCache.delete(storeId);
      setAllLoaded(false);
      await loadFirstPage();
      resetCreateForm();
      setCreateVariants([]);
    } catch (err) {
      console.error(err);
      const limitMessage = getPlanLimitMessage(err);
      if (limitMessage) {
        alert(limitMessage);
        return;
      }
      const message = err instanceof Error ? err.message : "Error al guardar producto";
      alert(`Error al guardar producto: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteProduct = async (prod: Product) => {
    if (!storeId) return;
    if (!window.confirm("¿Eliminar producto?")) return;
    try {
      await deleteProductMediaFromR2([prod]);
      await deleteDoc(doc(db, "stores", storeId, "products", prod.id));
      await loadFirstPage();
      if (allLoaded) await reloadAllProducts();
    } catch (err) {
      console.error(err);
      alert("Error al eliminar producto");
    }
  };

  const handleDeleteAllProducts = async () => {
    if (!storeId || !prodsRef || deletingAllProducts) return;
    if (!window.confirm("¿Eliminar todos los productos de esta tienda? Esta acción no se puede deshacer.")) return;

    setDeletingAllProducts(true);
    try {
      const snapshot = await getDocs(prodsRef);
      if (snapshot.empty) {
        alert("Esta tienda no tiene productos para eliminar.");
        return;
      }
      const productsToDelete = snapshot.docs.map((productDoc) => ({
        id: productDoc.id,
        ...(productDoc.data() as Product),
      }));

      await deleteProductMediaFromR2(productsToDelete);

      const batchSize = 450;
      for (let start = 0; start < snapshot.docs.length; start += batchSize) {
        const batch = writeBatch(db);
        snapshot.docs
          .slice(start, start + batchSize)
          .forEach((productDoc) => batch.delete(productDoc.ref));
        await batch.commit();
      }

      pageCache = null;
      allProductsCache.delete(storeId);
      setProducts([]);
      setAllProducts([]);
      setAllLoaded(false);
      setSearchResults([]);
      setHasNext(false);
      setPage(1);
      alert(`Se eliminaron ${snapshot.docs.length} producto(s).`);
    } catch (err) {
      console.error(err);
      alert("No se pudieron eliminar todos los productos. Intenta nuevamente.");
    } finally {
      setDeletingAllProducts(false);
    }
  };

  const openEdit = (p: Product) => {
    setEditingProduct(p);
    setEditPriceInput(String(p.price));
    setEditWholesalePriceInput(p.wholesalePrice ? String(p.wholesalePrice) : "");
    setEditUseVariants((p.variants?.length ?? 0) > 0);
    setEditSku(p.sku ?? "");
    if (p.discount) {
      setEditHasDiscount(true);
      setEditDiscountType(p.discount.type);
      setEditDiscountValueInput(String(p.discount.value));
    } else {
      setEditHasDiscount(false);
      setEditDiscountType("percent");
      setEditDiscountValueInput("");
    }
  };

  const handleUpdateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId || !editingProduct) return;
    setIsSubmitting(true);
    try {
      const bp = parseCOP(editPriceInput);
      const prodRef = doc(db, "stores", storeId, "products", editingProduct.id);
      const cleanSku = editSku.trim() || null;
      const wholesalePrice = parseCOP(editWholesalePriceInput) || null;
      const discount = editHasDiscount && editDiscountValueNum > 0
        ? { type: editDiscountType, value: editDiscountType === "percent" ? Math.min(100, Math.max(0, editDiscountValueNum)) : Math.max(0, editDiscountValueNum) }
        : null;

      await updateDoc(prodRef, {
        name: editingProduct.name.trim(), sku: cleanSku,
        description: (editingProduct.description ?? "").trim(),
        price: bp, wholesalePrice, discount, categoryId: editingProduct.categoryId, options: [],
        variants: editUseVariants ? (editingProduct.variants ?? []) : [],
        images: editingProduct.images ?? [], videos: editingProduct.videos ?? [],
        isActive: editingProduct.isActive ?? true,
        allowsCashOnDelivery: editingProduct.allowsCashOnDelivery ?? true,
        updatedAt: serverTimestamp(),
      });

      pageCache = null;
      allProductsCache.delete(storeId);
      setAllLoaded(false);
      await loadFirstPage();
      setEditingProduct(null);
    } catch (err) {
      console.error(err);
      const limitMessage = getPlanLimitMessage(err);
      const message = limitMessage || (err instanceof Error ? err.message : "Error desconocido");
      alert(`Error al actualizar producto: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddMoreImagesToEdit = async (files: FileList | null) => {
    if (!files || !editingProduct || !storeId) return;
    const currentCount = (editingProduct.images || []).length;
    const remaining = maxImages - currentCount;
    if (remaining <= 0) { alert(`Ya tienes el máximo de ${maxImages} imagen(es) permitida(s).`); return; }
    const filesToUpload = Array.from(files).slice(0, remaining);
    if (Array.from(files).length > remaining) alert(`Solo se subirán ${remaining} imagen(es).`);
    const uploaded = await uploadImages(filesToUpload);
    const nextImages = [...(editingProduct.images || []), ...uploaded];
    await updateDoc(doc(db, "stores", storeId, "products", editingProduct.id), { images: nextImages, updatedAt: serverTimestamp() });
    setEditingProduct({ ...editingProduct, images: nextImages });
  };

  const removeImageFromEdit = async (index: number) => {
    if (!editingProduct || !storeId) return;
    if (!window.confirm("¿Eliminar esta imagen?")) return;
    const next = [...(editingProduct.images || [])];
    const removed = next[index];
    next.splice(index, 1);
    try { await deleteFromR2((removed as any)?.publicId || (removed as any)?.path); } catch (e) { console.warn(e); }
    await updateDoc(doc(db, "stores", storeId, "products", editingProduct.id), { images: next, updatedAt: serverTimestamp() });
    setEditingProduct({ ...editingProduct, images: next });
  };

  const handleAddMoreVideosToEdit = async (files: FileList | null) => {
    if (!files || !editingProduct) return;
    if (maxVideos === 0) { alert("Tu plan no permite subir videos."); return; }
    const currentVideoCount = ((editingProduct as any).videos || []).length;
    if (currentVideoCount >= maxVideos) { alert(`Ya tienes el máximo de ${maxVideos} video(s).`); return; }
    const filesToUpload = Array.from(files).slice(0, maxVideos - currentVideoCount);
    const uploaded = await uploadVideos(filesToUpload);
    setEditingProduct({ ...editingProduct, videos: [...((editingProduct as any).videos || []), ...uploaded] } as any);
  };

  const removeVideoFromEdit = async (index: number) => {
    if (!editingProduct) return;
    const vids = (((editingProduct as any).videos || []) as VideoItem[]);
    const vid = vids[index];
    if (!vid) return;
    if (!window.confirm("¿Eliminar este video?")) return;
    try { if (vid.path) await deleteFromR2(vid.path); } catch (e) { console.warn(e); }
    const next = [...vids];
    next.splice(index, 1);
    setEditingProduct({ ...(editingProduct as any), videos: next });
  };

  const toggleProductStatus = async (prod: Product) => {
    if (!storeId) return;
    const newStatus = !prod.isActive;
    setProducts((prev) => prev.map((p) => p.id === prod.id ? { ...p, isActive: newStatus } : p));
    if (allLoaded) {
      const updated = allProductsCache.get(storeId)?.map((p) => p.id === prod.id ? { ...p, isActive: newStatus } : p) ?? [];
      allProductsCache.set(storeId, updated);
      setAllProducts(updated);
    }
    if (pageCache?.storeId === storeId) {
      pageCache.products = pageCache.products.map((p) => p.id === prod.id ? { ...p, isActive: newStatus } : p);
    }
    try {
      await updateDoc(doc(db, "stores", storeId, "products", prod.id), { isActive: newStatus, updatedAt: serverTimestamp() });
    } catch (err) {
      console.error(err);
      alert("Error cambiando estado del producto");
      setProducts((prev) => prev.map((p) => p.id === prod.id ? { ...p, isActive: prod.isActive } : p));
    }
  };

  const finalPrice = useMemo(() => {
    if (!hasDiscount) return basePrice;
    if (!basePrice) return 0;
    if (discountType === "percent") return Math.max(0, Math.round(basePrice * (1 - Math.min(100, Math.max(0, discountValueNum)) / 100)));
    return Math.max(0, basePrice - Math.max(0, discountValueNum));
  }, [hasDiscount, discountType, discountValueNum, basePrice]);

  const savings = useMemo(() => { if (!hasDiscount) return 0; return Math.max(0, basePrice - finalPrice); }, [hasDiscount, basePrice, finalPrice]);

  const editBasePrice = parseCOP(editPriceInput);
  const editDiscountValueNum = Number((editDiscountValueInput || "").replace(/[^\d]/g, "")) || 0;

  const editFinalPrice = useMemo(() => {
    if (!editHasDiscount) return editBasePrice;
    if (!editBasePrice) return 0;
    if (editDiscountType === "percent") return Math.max(0, Math.round(editBasePrice * (1 - Math.min(100, Math.max(0, editDiscountValueNum)) / 100)));
    return Math.max(0, editBasePrice - Math.max(0, editDiscountValueNum));
  }, [editHasDiscount, editDiscountType, editDiscountValueNum, editBasePrice]);

  const editSavings = useMemo(() => { if (!editHasDiscount) return 0; return Math.max(0, editBasePrice - editFinalPrice); }, [editHasDiscount, editBasePrice, editFinalPrice]);

  const normalizeText = (value: any) => String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const parseNumberSafe = (value: any) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const cleaned = raw.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : 0;
  };
  const htmlToPlainText = (value: any) => {
    const str = String(value ?? "").trim();
    if (!str) return "";
    const temp = document.createElement("div");
    temp.innerHTML = str;
    return (temp.textContent || temp.innerText || "").replace(/\n\s*\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  };
  const buildDiscount = (price: number, originalRaw: any) => {
    const originalPrice = parseNumberSafe(originalRaw);
    if (!originalPrice || originalPrice <= price) return null;
    return { type: "amount" as const, value: originalPrice - price };
  };

  const getOrCreateCategoryId = async (categoryNameRaw: string, categoryMap: Map<string, string>) => {
    if (!storeId || !catsRef) return "";
    const categoryName = String(categoryNameRaw || "").trim();
    if (!categoryName) return "";
    const normalizedName = normalizeText(categoryName);
    const cachedId = categoryMap.get(normalizedName);
    if (cachedId) return cachedId;
    const existing = categories.find((cat) => normalizeText(cat.name) === normalizedName);
    if (existing) { categoryMap.set(normalizedName, existing.id); return existing.id; }
    const snap = await getDocs(query(catsRef, orderBy("name", "asc")));
    const dbCategories = snap.docs.map((d) => ({ id: d.id, name: d.data().name, order: d.data().order ?? 0 }));
    const existingInDb = dbCategories.find((cat) => normalizeText(cat.name) === normalizedName);
    if (existingInDb) { categoryMap.set(normalizedName, existingInDb.id); return existingInDb.id; }
    const maxOrder = dbCategories.length ? Math.max(...dbCategories.map((c) => Number(c.order ?? 0) || 0)) : 0;
    const newRef = await addDoc(catsRef, { name: categoryName, order: maxOrder + 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    categoryMap.set(normalizedName, newRef.id);
    return newRef.id;
  };

  const handleImportJsonFile = async (file: File) => {
    if (!storeId || !prodsRef || !catsRef) { alert("La tienda aún no está lista."); return; }
    setIsSubmitting(true);
    try {
      const text = await file.text();
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { alert("El archivo no es un JSON válido."); return; }
      const items: ImportedJsonProduct[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.products) ? parsed.products : [];
      if (!items.length) { alert("No encontré productos."); return; }

      if (!hasActiveSubscription) {
        const countSnap = await getCountFromServer(prodsRef);
        const currentTotal = countSnap.data().count;
        const available = FREE_MAX_PRODUCTS - currentTotal;
        if (available <= 0) { alert(`Has alcanzado el límite de ${FREE_MAX_PRODUCTS} productos.`); return; }
        if (items.length > available) {
          const ok = window.confirm(`Solo puedes importar ${available} más. ¿Continuar?`);
          if (!ok) return;
          items.splice(available);
        }
      }

      let imported = 0, skipped = 0;
      const categoryMap = new Map<string, string>();
      const countSnap = await getCountFromServer(prodsRef);
      let orderCounter = countSnap.data().count;

      for (const item of items) {
        const itemName = String(item.name ?? "").trim();
        const price = parseNumberSafe(item.price);
        if (!itemName || price <= 0) { skipped++; continue; }
        const catId = await getOrCreateCategoryId(item.category ?? "", categoryMap);
        const discount = buildDiscount(price, item.originalPrice ?? item.oldPrice ?? item.compareAtPrice);
        await addDoc(prodsRef, {
          name: itemName, sku: null, description: htmlToPlainText(item.description),
          price, discount, categoryId: catId, images: [], videos: [], options: [], variants: [],
          isActive, order: orderCounter++,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        imported++;
      }

      await loadFirstPage();
      if (allLoaded) await reloadAllProducts();
      if (importJsonRef.current) importJsonRef.current.value = "";
      alert(`Importación completada. Importados: ${imported}. Omitidos: ${skipped}.`);
    } catch (error) {
      console.error(error);
      alert(getPlanLimitMessage(error) || "Error importando el JSON.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!storeId) return <div className="p-8 text-center">Buscando configuración de tienda...</div>;

  const listToRender = search ? searchResults : products;

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Productos</h1>
          <p className="mt-1 text-sm text-gray-500">
            {planAccess.productLimit === null
              ? `${productCount} creados · Disponibles: ilimitados`
              : `${productCount} de ${planAccess.productLimit} creados · ${Math.max(0, planAccess.productLimit - productCount)} disponibles`}
          </p>
        </div>
        {!hasActiveSubscription && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-1.5 rounded-lg">
            <i className="fa-solid fa-lock text-amber-500" />
            <span>Plan pago único · máx. {FREE_MAX_PRODUCTS} · {FREE_MAX_IMAGES} img/prod · sin videos</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input ref={importJsonRef} type="file" accept="application/json,.json" className="hidden"
          onChange={(e) => { const file = e.target.files?.[0]; if (file) handleImportJsonFile(file); }} />
        <input
          ref={importExcelRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importProductsFromExcel(file);
          }}
        />
      </div>

      <div className="grid grid-cols-1 gap-8">
        {/* CREATE */}
        <div className="bg-white p-6 rounded-xl border">
          <h2 className="font-bold mb-4">Añadir Producto</h2>
          <form onSubmit={handleAddProduct} className="space-y-4">
            <input type="text" placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} className="w-full p-2 border rounded" required />
            <textarea placeholder="Descripción (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full p-2 border rounded" rows={3} />
            <input type="text" placeholder={`Precio (${getActiveCurrencyCode()})`} value={priceInput} onChange={(e) => setPriceInput(e.target.value)} className="w-full p-2 border rounded" required />
            <div>
              <label className="text-xs text-gray-500">Precio mayorista ({getActiveCurrencyCode()})</label>
              <input type="text" placeholder="Opcional. Ej: 200000 o 200.000" value={wholesalePriceInput} onChange={(e) => setWholesalePriceInput(e.target.value)} className="w-full mt-1 p-2 border rounded" />
              <div className="mt-1 text-xs text-gray-400">Solo se muestra en el enlace del catálogo mayorista.</div>
            </div>

            <div className="border rounded-lg p-3">
              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-700 font-medium">Descuento</label>
                <div className="flex items-center gap-2">
                  <input id="hasDiscount" type="checkbox" checked={hasDiscount} onChange={(e) => { setHasDiscount(e.target.checked); if (!e.target.checked) { setDiscountValueInput(""); setDiscountType("percent"); } }} />
                  <label htmlFor="hasDiscount" className="text-sm text-gray-600">Activar</label>
                </div>
              </div>
              {hasDiscount ? (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <select value={discountType} onChange={(e) => setDiscountType(e.target.value as any)} className="w-full p-2 border rounded">
                    <option value="percent">% Porcentaje</option>
                    <option value="amount">Valor ({getActiveCurrencyCode()})</option>
                  </select>
                  <input type="text" placeholder={discountType === "percent" ? "Ej: 10" : "Ej: 20000"} value={discountValueInput} onChange={(e) => setDiscountValueInput(e.target.value)} className="w-full p-2 border rounded sm:col-span-2" />
                  <div className="sm:col-span-3 text-xs text-gray-500">
                    {basePrice ? (<><div>Precio original: <b>{formatCOP(basePrice)}</b></div><div>Precio final: <b className="text-indigo-700">{formatCOP(finalPrice)}</b>{savings > 0 ? <> — Ahorro: <b>{formatCOP(savings)}</b></> : null}</div></>) : (<div>Escribe el precio para ver el cálculo.</div>)}
                  </div>
                </div>
              ) : (<div className="mt-2 text-xs text-gray-400">Si no activas descuento, se mostrará el precio normal.</div>)}
            </div>

            <input type="text" placeholder="Código / SKU (opcional)" value={sku} onChange={(e) => setSku(e.target.value)} className="w-full p-2 border rounded" />

            <div className="border rounded-lg p-3">
              <div className="flex items-center justify-between">
                <label htmlFor="isActive" className="text-sm font-medium text-gray-700">Visible en catálogo</label>
                <div className="flex items-center gap-2">
                  <input id="isActive" type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                  <span className="text-sm text-gray-600">{isActive ? "Mostrar" : "Ocultar"}</span>
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-400">{isActive ? "Este producto se mostrará en el catálogo." : "Este producto quedará oculto en el catálogo."}</div>
            </div>

            <div className="border rounded-lg p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label htmlFor="allowsCashOnDelivery" className="text-sm font-medium text-gray-700">Envío contra entrega</label>
                  <div className="mt-1 text-xs text-gray-400">Permite enviar y pagar este producto contra entrega.</div>
                </div>
                <input id="allowsCashOnDelivery" type="checkbox" checked={allowsCashOnDelivery} onChange={(e) => setAllowsCashOnDelivery(e.target.checked)} />
              </div>
            </div>

            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full p-2 border rounded" required>
              <option value="">Categoría</option>
              {categories.map((cat) => (<option key={cat.id} value={cat.id}>{cat.name}</option>))}
            </select>

            <div>
              <p className="text-[11px] text-gray-400">+ Agregar imágenes <span className="font-medium text-gray-500">(máx. {maxImages} por producto)</span></p>
              <input ref={fileInputRef} type="file" multiple={maxImages > 1}
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : [];
                  if (files.length > maxImages) { alert(`Solo puedes subir hasta ${maxImages} imagen(es).`); setImageFiles(files.slice(0, maxImages)); } else { setImageFiles(files); }
                }} className="w-full text-xs" />
            </div>

            {maxVideos > 0 ? (
              <div>
                <p className="text-[11px] text-gray-400">Máx {MAX_VIDEO_MB}MB · máx. {maxVideos} video(s)/producto.</p>
                <input type="file" multiple={maxVideos > 1} accept="video/*"
                  onChange={(e) => {
                    const files = e.target.files ? Array.from(e.target.files) : [];
                    if (files.length > maxVideos) { alert(`Solo puedes subir hasta ${maxVideos} video(s).`); setVideoFiles(files.slice(0, maxVideos)); } else { setVideoFiles(files); }
                  }} className="w-full text-xs" />
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg p-2 text-xs text-gray-400">
                <i className="fa-solid fa-lock text-gray-300" /> Videos disponibles con suscripción activa.
              </div>
            )}

            <div className="flex items-center gap-2">
              <input id="useVariants" type="checkbox" checked={useVariants} onChange={(e) => { setUseVariants(e.target.checked); if (!e.target.checked) setCreateVariants([]); }} />
              <label htmlFor="useVariants" className="text-sm text-gray-700">Este producto tiene variantes</label>
            </div>
            {useVariants ? (<VariantsEditor variants={createVariants} onChange={setCreateVariants} />) : null}

            <button type="submit" disabled={isSubmitting} className="w-full bg-indigo-600 text-white py-2 rounded font-bold disabled:opacity-50">Guardar</button>
          </form>
        </div>

        {/* LIST */}
        <div className="lg:col-span-2 bg-white rounded-xl border overflow-hidden">
          <div className="p-4 border-b bg-white">
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, SKU o descripción..."
                className="w-full p-2 border rounded"
              />

              <div className="flex flex-wrap gap-2">
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="px-3 py-2 border rounded text-sm"
                  >
                    Limpiar
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={exportProductsToExcel}
                  disabled={exportingExcel}
                  className="px-3 py-2 rounded text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                >
                  {exportingExcel ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin mr-2" />
                      Exportando
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-file-excel mr-2" />
                      Exportar Excel
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={downloadImportTemplate}
                  disabled={importingExcel || exportingExcel}
                  className="px-3 py-2 rounded text-sm font-semibold bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                  title="Descargar plantilla para importar productos"
                >
                  <i className="fa-solid fa-download mr-2" />
                  Plantilla Excel
                </button>
                <button
                  type="button"
                  onClick={() => importExcelRef.current?.click()}
                  disabled={importingExcel || exportingExcel || deletingAllProducts}
                  className="px-3 py-2 rounded text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                >
                  {importingExcel ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin mr-2" />
                      Importando
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-file-import mr-2" />
                      Importar Excel
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAllProducts}
                  disabled={deletingAllProducts}
                  className="px-3 py-2 rounded text-sm font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 whitespace-nowrap"
                  title="Eliminar todos los productos de esta tienda"
                >
                  {deletingAllProducts ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin mr-2" />
                      Eliminando
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-trash-can mr-2" />
                      Eliminar todos
                    </>
                  )}
                </button>
              </div>
            </div>
            {search ? (
              <div className="mt-2 text-xs text-gray-500">
                {searching ? "Cargando productos para búsqueda..." : `Resultados: ${searchResults.length}`}
                {!allLoaded && !searching ? " (cargando cache...)" : ""}
              </div>
            ) : null}

            {/* Indicador de guardado de orden */}
            {savingOrder && (
              <div className="mt-2 flex items-center gap-2 text-xs text-indigo-600">
                <div className="w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                Guardando orden...
              </div>
            )}

            {/* Hint de drag & drop (solo cuando no se busca) */}
            {!search && !loading && products.length > 1 && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
                <i className="fa-solid fa-grip-lines" />
                Arrastra las filas para cambiar el orden en el catálogo
              </div>
            )}
          </div>

          {loading ? (
            <div className="p-10 text-center text-gray-500">Cargando...</div>
          ) : (
            <div className="w-full overflow-x-auto">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={products.map((p) => p.id)}
                  strategy={verticalListSortingStrategy}
                >
              <table className="min-w-[720px] w-full text-left">
                <thead className="bg-gray-50 text-[10px] uppercase font-bold text-gray-500">
                  <tr>
                    {/* Columna handle drag */}
                    {!search && <th className="px-3 py-4 w-8" />}
                    <th className="px-4 sm:px-6 py-4">Producto</th>
                    <th className="px-4 sm:px-6 py-4">Precio</th>
                    <th className="px-4 sm:px-6 py-4">Variantes</th>
                    <th className="px-4 sm:px-6 py-4 text-right">Acciones</th>
                  </tr>
                </thead>

                <tbody className="divide-y">
                  {!search ? (
                    products.map((prod, index) => {
                          const hasVariants = (prod.variants?.length ?? 0) > 0;

                          const displayPrice = hasVariants
                            ? `Desde ${formatCOP(
                              Math.min(...prod.variants!.map((v) => v.price || 0))
                            )}`
                            : formatCOP(prod.price);

                          return (
                            <SortableProductRow
                              key={prod.id}
                              prod={prod}
                              index={index}
                              displayPrice={displayPrice}
                              hasVariants={hasVariants}
                              openEdit={openEdit}
                              handleDeleteProduct={handleDeleteProduct}
                            />
                          );
                        })
                  ) : (
                    searchResults.map((prod) => {
                      const hasVariants = (prod.variants?.length ?? 0) > 0;

                      const displayPrice = hasVariants
                        ? `Desde ${formatCOP(
                          Math.min(...prod.variants!.map((v) => v.price || 0))
                        )}`
                        : formatCOP(prod.price);

                      return (
                        <tr key={prod.id} className="text-sm transition-colors">
                          <td className="px-4 sm:px-6 py-4 font-medium">
                            <div className="flex items-center gap-3">
                              {prod.images?.[0]?.url ? (
                                <img
                                  src={cldImg(prod.images[0].url, {
                                    w: 80,
                                    h: 80,
                                    crop: "fill",
                                  })}
                                  alt={prod.name}
                                  className="w-10 h-10 rounded object-cover border shrink-0"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded bg-gray-100 border shrink-0" />
                              )}

                              <div className="min-w-0 flex-1">
                                <div className="font-semibold text-gray-900 truncate">
                                  {prod.name}
                                </div>
                                <div className="text-xs text-gray-400 line-clamp-2 sm:line-clamp-1">
                                  {prod.description || ""}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="px-4 sm:px-6 py-4 font-bold text-indigo-600 whitespace-nowrap">
                            {displayPrice}
                          </td>

                          <td className="px-4 sm:px-6 py-4 text-gray-600 whitespace-nowrap">
                            {hasVariants ? prod.variants?.length : "-"}
                          </td>

                          <td className="px-4 sm:px-6 py-4 text-right whitespace-nowrap">
                            <button
                              onClick={() => openEdit(prod)}
                              className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200 text-gray-500 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50"
                              title="Editar"
                              type="button"
                            >
                              <i className="fa-solid fa-pen" />
                            </button>

                            <button
                              onClick={() => handleDeleteProduct(prod)}
                              className="ml-2 inline-flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200 text-gray-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50"
                              title="Eliminar"
                              type="button"
                            >
                              <i className="fa-solid fa-trash-can" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}

                  {!listToRender.length ? (
                    <tr>
                      <td className="px-6 py-8 text-gray-400" colSpan={search ? 4 : 5}>
                        Aún no hay productos.
                      </td>
                    </tr>
                  ) : null}
                </tbody>

              </table>
                </SortableContext>
              </DndContext>

              {!search ? (
                <Paginator page={page} hasNext={hasNext} hasPrev={page > 1} loading={loadingPage} onNext={goNext} onPrev={goPrev} />
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* EDIT MODAL */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white p-6 rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">Editar Producto</h3>
              <button onClick={() => setEditingProduct(null)} className="text-gray-500">✕</button>
            </div>
            <form onSubmit={handleUpdateProduct} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-500">Nombre</label>
                  <input type="text" value={editingProduct.name} onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })} className="w-full p-2 border rounded" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Precio base ({getActiveCurrencyCode()})</label>
                  <input type="text" value={editPriceInput} onChange={(e) => setEditPriceInput(e.target.value)} className="w-full p-2 border rounded" />
                  <div className="text-xs text-gray-400 mt-1">Preview: {formatCOP(parseCOP(editPriceInput))}</div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Precio mayorista ({getActiveCurrencyCode()})</label>
                  <input type="text" value={editWholesalePriceInput} onChange={(e) => setEditWholesalePriceInput(e.target.value)} className="w-full p-2 border rounded" placeholder="Opcional" />
                  <div className="text-xs text-gray-400 mt-1">Se usa únicamente en el enlace mayorista.</div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Código / SKU</label>
                  <input type="text" value={editSku} onChange={(e) => setEditSku(e.target.value)} className="w-full p-2 border rounded" placeholder="Opcional" />
                </div>
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700">Descuento</label>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={editHasDiscount} onChange={(e) => { setEditHasDiscount(e.target.checked); if (!e.target.checked) { setEditDiscountValueInput(""); setEditDiscountType("percent"); } }} />
                      <span className="text-sm text-gray-600">Activar</span>
                    </div>
                  </div>
                  {editHasDiscount ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <select value={editDiscountType} onChange={(e) => setEditDiscountType(e.target.value as any)} className="p-2 border rounded">
                        <option value="percent">% Porcentaje</option>
                        <option value="amount">Valor ({getActiveCurrencyCode()})</option>
                      </select>
                      <input type="text" value={editDiscountValueInput} onChange={(e) => setEditDiscountValueInput(e.target.value)} placeholder={editDiscountType === "percent" ? "Ej: 10" : "Ej: 20000"} className="p-2 border rounded sm:col-span-2" />
                      <div className="sm:col-span-3 text-xs text-gray-500">
                        {editBasePrice ? (<><div>Precio original: <b>{formatCOP(editBasePrice)}</b></div><div>Precio final: <b className="text-indigo-700">{formatCOP(editFinalPrice)}</b>{editSavings > 0 && <> — Ahorro: <b>{formatCOP(editSavings)}</b></>}</div></>) : (<div>Escribe el precio para calcular.</div>)}
                      </div>
                    </div>
                  ) : (<div className="text-xs text-gray-400">Sin descuento.</div>)}
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-gray-500">Descripción</label>
                  <textarea rows={3} value={editingProduct.description || ""} onChange={(e) => setEditingProduct({ ...editingProduct, description: e.target.value })} className="w-full p-2 border rounded" />
                </div>
                <div className="border rounded-lg p-4 space-y-2 md:col-span-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700">Visible en catálogo</label>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={editingProduct.isActive ?? true} onChange={(e) => setEditingProduct({ ...editingProduct, isActive: e.target.checked })} />
                      <span className="text-sm text-gray-600">{(editingProduct.isActive ?? true) ? "Mostrar" : "Ocultar"}</span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-400">{(editingProduct.isActive ?? true) ? "Este producto se mostrará en el catálogo." : "Este producto quedará oculto."}</div>
                </div>
                <div className="md:col-span-2">
                  <div className="border rounded-lg p-4 space-y-2 mb-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <label htmlFor="editAllowsCashOnDelivery" className="text-sm font-medium text-gray-700">Envío contra entrega</label>
                        <div className="mt-1 text-xs text-gray-400">Permite enviar y pagar este producto contra entrega.</div>
                      </div>
                      <input id="editAllowsCashOnDelivery" type="checkbox" checked={editingProduct.allowsCashOnDelivery ?? true} onChange={(e) => setEditingProduct({ ...editingProduct, allowsCashOnDelivery: e.target.checked })} />
                    </div>
                  </div>
                  <label className="text-xs text-gray-500">Categoría</label>
                  <select value={editingProduct.categoryId} onChange={(e) => setEditingProduct({ ...editingProduct, categoryId: e.target.value })} className="w-full p-2 border rounded">
                    <option value="">Categoría</option>
                    {categories.map((cat) => (<option key={cat.id} value={cat.id}>{cat.name}</option>))}
                  </select>
                </div>
              </div>

              <div className="border rounded p-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold">Imágenes <span className="text-xs font-normal text-gray-400">({(editingProduct.images || []).length}/{maxImages})</span></h4>
                  {(editingProduct.images || []).length < maxImages ? (
                    <label className="text-sm text-indigo-600 cursor-pointer">+ Agregar imágenes<input type="file" multiple={maxImages > 1} className="hidden" onChange={(e) => handleAddMoreImagesToEdit(e.target.files)} /></label>
                  ) : (<span className="text-xs text-amber-600">Límite alcanzado ({maxImages}/{maxImages})</span>)}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                  {(editingProduct.images || []).map((img, idx) => (
                    <div key={img.path || img.url} className="relative">
                      <img src={cldImg(img.url, { w: 240, h: 240, crop: "fill" })} alt="img" className="w-full h-auto object-cover rounded border" loading="lazy" decoding="async" />
                      <button type="button" onClick={() => removeImageFromEdit(idx)} className="absolute top-1 right-1 bg-white/90 border rounded px-2 py-1 text-xs" title="Eliminar">✕</button>
                    </div>
                  ))}
                  {!editingProduct.images?.length ? (<div className="text-sm text-gray-400">Sin imágenes</div>) : null}
                </div>
              </div>

              <div className="border rounded p-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold">Videos <span className="text-xs font-normal text-gray-400">({((editingProduct as any).videos || []).length}/{maxVideos})</span></h4>
                  {maxVideos > 0 && ((editingProduct as any).videos || []).length < maxVideos ? (
                    <label className="text-sm text-indigo-600 cursor-pointer">+ Agregar videos<input type="file" multiple={maxVideos > 1} accept="video/*" className="hidden" onChange={(e) => handleAddMoreVideosToEdit(e.target.files)} /></label>
                  ) : maxVideos === 0 ? (
                    <span className="text-xs text-gray-400 flex items-center gap-1"><i className="fa-solid fa-lock" /> Requiere suscripción</span>
                  ) : (
                    <span className="text-xs text-amber-600">Límite alcanzado</span>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                  {((editingProduct as any).videos || []).map((v: VideoItem, idx: number) => (
                    <div key={v.path || v.url} className="relative border rounded-xl overflow-hidden bg-black">
                      <video src={v.url} controls className="w-full h-44 object-contain" />
                      <button type="button" onClick={() => removeVideoFromEdit(idx)} className="absolute top-2 right-2 bg-white/90 border rounded px-2 py-1 text-xs" title="Eliminar">✕</button>
                    </div>
                  ))}
                  {!((editingProduct as any).videos || []).length ? (<div className="text-sm text-gray-400">{maxVideos === 0 ? "Videos no disponibles en el plan pago único." : "Sin videos"}</div>) : null}
                </div>
              </div>

              <div className="border rounded p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <input id="editUseVariants" type="checkbox" checked={editUseVariants} onChange={(e) => { setEditUseVariants(e.target.checked); if (!e.target.checked) setEditingProduct({ ...editingProduct, variants: [] }); }} />
                  <label htmlFor="editUseVariants" className="text-sm text-gray-700">Este producto tiene variantes</label>
                </div>
                {editUseVariants ? (<VariantsEditor variants={editingProduct.variants || []} onChange={(vars) => setEditingProduct({ ...editingProduct, variants: vars })} />) : null}
              </div>

              <div className="flex gap-2">
                <button type="button" onClick={() => setEditingProduct(null)} className="flex-1 bg-gray-100 py-2 rounded">Cancelar</button>
                <button type="submit" disabled={isSubmitting} className="flex-1 bg-indigo-600 text-white py-2 rounded font-bold disabled:opacity-50">Guardar cambios</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {uploading && (
        <div className="fixed inset-0 z-[999] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl p-5 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-indigo-600" />
              <div>
                <div className="font-bold">Subiendo archivos...</div>
                <div className="text-xs text-gray-500">{uploadProgress.currentName}</div>
              </div>
            </div>
            <div className="mt-4 text-xs text-gray-600">{uploadProgress.done}/{uploadProgress.total}</div>
            <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-600" style={{ width: uploadProgress.total > 0 ? `${Math.round((uploadProgress.done / uploadProgress.total) * 100)}%` : "0%" }} />
            </div>
            <div className="mt-3 text-[11px] text-gray-400">No cierres esta ventana mientras se suben los archivos.</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductsView;
