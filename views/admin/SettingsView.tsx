import React, { useEffect, useMemo, useState } from "react";
import {
    collection,
    doc,
    getDocs,
    limit,
    query,
    updateDoc,
    where,
} from "@/lib/supabaseFirestore";
import { db, supabase } from "@/lib/supabase";
import { getStoreForOwner, invalidateStoreForOwner } from "@/lib/storeLookup";
import { useAuth } from "../../context/AuthContext";
import { Store } from "@/interfaces";
import { slugify } from "@/helpers";
import { compressImageFile } from "@/helpers/imageCompression";
import { getCatalogShareUrl } from "@/helpers/catalogLinks";
import { ref, uploadBytes, getDownloadURL, deleteObject, storage } from "@/lib/r2Storage";
import { buildInternationalPhone, getLatamCountry, LATAM_COUNTRIES, resolveStoreCountryCode } from "@/helpers/latamCountries";

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

const checkoutFieldTypes: { value: CheckoutFieldType; label: string }[] = [
    { value: "text", label: "Texto corto" },
    { value: "number", label: "Numero" },
    { value: "tel", label: "Telefono" },
    { value: "email", label: "Correo" },
    { value: "textarea", label: "Texto largo" },
    { value: "select", label: "Lista de opciones" },
    { value: "date", label: "Fecha" },
];

const createCheckoutField = (): CheckoutFieldConfig => ({
    id: `field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    label: "",
    type: "text",
    required: false,
    enabled: true,
    placeholder: "",
    options: [],
});

const normalizeCheckoutFields = (fields: any[]): CheckoutFieldConfig[] => {
    return (Array.isArray(fields) ? fields : [])
        .map((field) => ({
            id: String(field.id || `field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
            label: String(field.label || "").trim(),
            type: checkoutFieldTypes.some((item) => item.value === field.type) ? field.type : "text",
            required: field.required === true,
            enabled: field.enabled !== false,
            placeholder: String(field.placeholder || "").trim(),
            options: Array.isArray(field.options)
                ? field.options.map((option: any) => String(option).trim()).filter(Boolean)
                : [],
        }))
        .filter((field) => field.label);
};

const SettingsView: React.FC = () => {
    const { user } = useAuth();

    const [store, setStore] = useState<Store | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [sharedCatalog, setSharedCatalog] = useState<"public" | "wholesale" | null>(null);

    // form — campos originales
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [description, setDescription] = useState("");
    const [whatsapp, setWhatsapp] = useState("");
    const [isActive, setIsActive] = useState(true);
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string>("");
    const [logoUploading, setLogoUploading] = useState(false);

    // form — campos nuevos
    const [brandColor, setBrandColor] = useState("#6366f1");
    const [bannerFile, setBannerFile] = useState<File | null>(null);
    const [bannerPreview, setBannerPreview] = useState<string>("");
    const [bannerUploading, setBannerUploading] = useState(false);
    const [instagram, setInstagram] = useState("");
    const [facebook, setFacebook] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [location, setLocation] = useState("");
    const [countryCode, setCountryCode] = useState("CO");

    // form — envíos
    const [shippingEnabled, setShippingEnabled] = useState(false);
    const [shippingMethods, setShippingMethods] = useState<string[]>(["cod"]); // cod = contra entrega, carrier = transportadora
    const [shippingCostCOD, setShippingCostCOD] = useState("0");
    const [shippingCostCarrier, setShippingCostCarrier] = useState("0");
    const [shippingNote, setShippingNote] = useState("");
    const [shippingHidePrices, setShippingHidePrices] = useState(false);
    const [checkoutFields, setCheckoutFields] = useState<CheckoutFieldConfig[]>([]);

    // cargar tienda
    useEffect(() => {
        if (!user) return;

        const load = async () => {
            setLoading(true);
            const storeResult = await getStoreForOwner(user.uid);
            if (!storeResult) {
                setLoading(false);
                return;
            }

            const data = storeResult.data;

            const s: Store = {
                id: storeResult.id,
                name: data.name,
                slug: data.slug,
                address: data.description ?? "",
                whatsapp: data.whatsapp ?? "",
                isActive: data.isActive ?? true,
                createdAt: data.createdAt,
                logoUrl: data.logoUrl ?? "",
                logoPath: data.logoPath ?? "",
            };

            setLogoPreview(s.logoUrl || "");
            setStore(s);
            setName(s.name);
            setSlug(s.slug);
            setDescription(s.address ?? "");
            setWhatsapp(s.whatsapp ?? "");
            setIsActive(s.isActive ?? true);

            // cargar campos nuevos si existen en Firestore
            setBrandColor(data.brandColor ?? "#6366f1");
            setBannerPreview(data.bannerUrl ?? "");
            setInstagram(data.instagram ?? "");
            setFacebook(data.facebook ?? "");
            setEmail(data.email ?? "");
            setPhone(data.phone ?? "");
            setLocation(data.location ?? "");
            setCountryCode(resolveStoreCountryCode(data.countryCode, data.whatsapp));

            // cargar configuración de envíos
            setShippingEnabled(data.shippingEnabled ?? false);
            setShippingMethods(data.shippingMethods ?? ["cod"]);
            setShippingCostCOD(String(data.shippingCostCOD ?? 0));
            setShippingCostCarrier(String(data.shippingCostCarrier ?? 0));
            setShippingNote(data.shippingNote ?? "");
            setShippingHidePrices(data.shippingHidePrices ?? false);
            setCheckoutFields(normalizeCheckoutFields(data.checkoutFields ?? []));

            setLoading(false);
        };

        load();
    }, [user]);

    // --- Upload helpers ---

    const uploadStoreLogo = async (): Promise<{ logoUrl: string; logoPath: string } | null> => {
        if (!store || !logoFile) return null;

        setLogoUploading(true);
        try {
            const optimized = await compressImageFile(logoFile, { maxSizeMB: 0.35, maxWidthOrHeight: 800 });
            const path = `stores/${store.id}/logo/${Date.now()}_${optimized.name}`;
            const storageRef = ref(storage, path);
            const uploaded = await uploadBytes(storageRef, optimized);
            const url = await getDownloadURL(storageRef, uploaded.url);

            if (store.logoPath) {
                try {
                    await deleteObject(ref(storage, store.logoPath));
                } catch (e) {
                    console.warn("No se pudo borrar logo anterior:", e);
                }
            }

            return { logoUrl: url, logoPath: path };
        } finally {
            setLogoUploading(false);
        }
    };

    const uploadStoreBanner = async (): Promise<{ bannerUrl: string; bannerPath: string } | null> => {
        if (!store || !bannerFile) return null;

        setBannerUploading(true);
        try {
            const optimized = await compressImageFile(bannerFile, { maxSizeMB: 0.7, maxWidthOrHeight: 1600 });
            const path = `stores/${store.id}/banner/${Date.now()}_${optimized.name}`;
            const storageRef = ref(storage, path);
            const uploaded = await uploadBytes(storageRef, optimized);
            const url = await getDownloadURL(storageRef, uploaded.url);

            // borrar banner anterior si existe
            const currentBannerPath = (store as any).bannerPath;
            if (currentBannerPath) {
                try {
                    await deleteObject(ref(storage, currentBannerPath));
                } catch (e) {
                    console.warn("No se pudo borrar banner anterior:", e);
                }
            }

            return { bannerUrl: url, bannerPath: path };
        } finally {
            setBannerUploading(false);
        }
    };

    // --- URL catálogo ---

    const catalogUrl = useMemo(() => {
        if (!store?.slug) return "";
        return getCatalogShareUrl(store.slug);
    }, [store?.slug]);
    const wholesaleCatalogUrl = useMemo(
        () => store?.slug ? getCatalogShareUrl(store.slug, { tipo: "mayorista" }) : "",
        [store?.slug]
    );

    const shareCatalogLink = async (type: "public" | "wholesale") => {
        const url = type === "wholesale" ? wholesaleCatalogUrl : catalogUrl;
        const title = type === "wholesale" ? "Catálogo mayorista" : "Catálogo público";
        if (!url) return;

        try {
            if (navigator.share) {
                await navigator.share({ title, text: `Te comparto el ${title.toLowerCase()}.`, url });
            } else {
                await navigator.clipboard.writeText(url);
                setSharedCatalog(type);
                window.setTimeout(() => setSharedCatalog(null), 2500);
            }
        } catch (err: any) {
            if (err?.name !== "AbortError") {
                await navigator.clipboard.writeText(url);
                setSharedCatalog(type);
                window.setTimeout(() => setSharedCatalog(null), 2500);
            }
        }
    };

    // --- Toggle método de envío ---
    const toggleShippingMethod = (method: string) => {
        setShippingMethods((prev) => {
            if (prev.includes(method)) {
                // No permitir dejar vacío
                if (prev.length === 1) return prev;
                return prev.filter((m) => m !== method);
            }
            return [...prev, method];
        });
    };

    const updateCheckoutField = (id: string, patch: Partial<CheckoutFieldConfig>) => {
        setCheckoutFields((prev) =>
            prev.map((field) => {
                if (field.id !== id) return field;
                const next = { ...field, ...patch };
                if (patch.type && patch.type !== "select") next.options = [];
                return next;
            }),
        );
    };

    const moveCheckoutField = (index: number, direction: -1 | 1) => {
        setCheckoutFields((prev) => {
            const target = index + direction;
            if (target < 0 || target >= prev.length) return prev;
            const next = [...prev];
            const [item] = next.splice(index, 1);
            next.splice(target, 0, item);
            return next;
        });
    };

    // --- Guardar ---

    const handleSave = async () => {
        if (!store) return;

        if (!name.trim()) {
            setError("El nombre de la tienda es obligatorio.");
            return;
        }

        const cleanSlug = slugify(slug);
        if (!cleanSlug) {
            setError("El slug no es válido.");
            return;
        }

        if (checkoutFields.some((field) => !field.label.trim())) {
            setError("Todos los campos personalizados deben tener nombre.");
            return;
        }

        if (checkoutFields.some((field) => field.type === "select" && (field.options || []).filter(Boolean).length === 0)) {
            setError("Los campos de lista deben tener al menos una opcion.");
            return;
        }

        setSaving(true);
        setError("");

        try {
            let logoPayload: any = {};
            let bannerPayload: any = {};

            if (logoFile) {
                const uploaded = await uploadStoreLogo();
                if (uploaded) logoPayload = uploaded;
            }

            if (bannerFile) {
                const uploaded = await uploadStoreBanner();
                if (uploaded) bannerPayload = uploaded;
            }

            const storeChanges = {
                name: name.trim(),
                slug: cleanSlug,
                description: description.trim(),
                whatsapp: buildInternationalPhone(countryCode, whatsapp),
                isActive,
                // nuevos campos
                brandColor,
                instagram: instagram.trim(),
                facebook: facebook.trim(),
                email: email.trim(),
                phone: phone.trim(),
                location: location.trim(),
                // envíos
                shippingEnabled,
                shippingMethods,
                shippingCostCOD: Number(shippingCostCOD) || 0,
                shippingCostCarrier: Number(shippingCostCarrier) || 0,
                shippingNote: shippingNote.trim(),
                shippingHidePrices,
                countryCode,
                checkoutFields: normalizeCheckoutFields(checkoutFields),
                ...logoPayload,
                ...bannerPayload,
                updatedAt: new Date(),
            };

            try {
                await updateDoc(doc(db, "stores", store.id), storeChanges);
            } catch (directError: any) {
                if (!String(directError?.message || directError?.details || "").includes("Failed to fetch")) {
                    throw directError;
                }

                const { data: sessionData } = await supabase.auth.getSession();
                const token = sessionData.session?.access_token;
                const dbChanges = {
                    name: storeChanges.name,
                    slug: storeChanges.slug,
                    description: storeChanges.description,
                    whatsapp: storeChanges.whatsapp,
                    status: storeChanges.isActive ? "active" : "inactive",
                    brand_color: storeChanges.brandColor,
                    logo_url: logoPayload.logoUrl,
                    banner_url: bannerPayload.bannerUrl,
                    instagram: storeChanges.instagram,
                    facebook: storeChanges.facebook,
                    contact_email: storeChanges.email,
                    phone: storeChanges.phone,
                    location: storeChanges.location,
                    shipping_settings: {
                        enabled: storeChanges.shippingEnabled,
                        methods: storeChanges.shippingMethods,
                        costCOD: storeChanges.shippingCostCOD,
                        costCarrier: storeChanges.shippingCostCarrier,
                        note: storeChanges.shippingNote,
                        hidePrices: storeChanges.shippingHidePrices,
                        countryCode,
                    },
                    checkout_fields: storeChanges.checkoutFields,
                    updated_at: new Date().toISOString(),
                };
                const response = await fetch("/api/store-settings", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token || ""}`,
                    },
                    body: JSON.stringify({ storeId: store.id, changes: dbChanges }),
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(result.error || "No se pudo guardar la tienda.");
            }
            invalidateStoreForOwner(user?.uid);

            alert("Configuración guardada ✅");
            setStore({
                ...store,
                name,
                slug: cleanSlug,
                description,
                whatsapp: buildInternationalPhone(countryCode, whatsapp),
                isActive,
                countryCode,
                checkoutFields: normalizeCheckoutFields(checkoutFields),
                ...logoPayload,
                ...bannerPayload,
            } as any);
            if (logoPayload.logoUrl) setLogoPreview(logoPayload.logoUrl);
            if (bannerPayload.bannerUrl) setBannerPreview(bannerPayload.bannerUrl);
            setLogoFile(null);
            setBannerFile(null);

        } catch (e: any) {
            console.error(e);
            const detail = String(e?.message || e?.details || "").trim();
            setError(
                detail
                    ? `No se pudo guardar la configuración: ${detail}`
                    : "No se pudo guardar la configuración.",
            );
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="p-8 text-center text-gray-500">Cargando configuración...</div>;
    }

    if (!store) {
        return <div className="p-8 text-center text-gray-500">No se encontró la tienda.</div>;
    }

    return (
        <div className="space-y-8 max-w-3xl">

            <div>
                <h1 className="text-2xl font-bold text-gray-900">Configuración de la tienda</h1>
                <p className="text-gray-500 mt-1">
                    Administra la información y el estado de tu negocio.
                </p>
            </div>

            {/* ── Logo ── */}
            <div className="bg-white border rounded-xl p-6 space-y-4">
                <h2 className="font-bold text-gray-900">Logo del negocio</h2>

                <div className="flex items-center gap-4">
                    <div className="h-16 w-16 rounded-2xl bg-gray-100 border overflow-hidden flex items-center justify-center">
                        {logoPreview ? (
                            <img src={logoPreview} alt="Logo" className="h-full w-full object-cover" />
                        ) : (
                            <i className="fa-regular fa-image text-gray-400 text-xl" />
                        )}
                    </div>

                    <div className="flex-1">
                        <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border font-semibold cursor-pointer hover:bg-gray-50">
                            <i className="fa-solid fa-upload" />
                            Subir logo
                            <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                    const f = e.target.files?.[0] || null;
                                    setLogoFile(f);
                                    if (f) setLogoPreview(URL.createObjectURL(f));
                                }}
                            />
                        </label>

                        <p className="text-xs text-gray-500 mt-2">
                            Recomendado: cuadrado (1:1). Se optimiza automáticamente antes de subir.
                        </p>

                        {logoFile && (
                            <p className="text-xs text-indigo-600 mt-1 font-semibold">
                                Listo para guardar: {logoFile.name}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Banner principal ── */}
            <div className="bg-white border rounded-xl p-6 space-y-4">
                <h2 className="font-bold text-gray-900">Banner principal</h2>

                {bannerPreview && (
                    <div className="w-full h-36 rounded-xl overflow-hidden border bg-gray-100">
                        <img
                            src={bannerPreview}
                            alt="Banner"
                            className="w-full h-full object-cover"
                        />
                    </div>
                )}

                <div className="flex items-center gap-4">
                    <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border font-semibold cursor-pointer hover:bg-gray-50">
                        <i className="fa-solid fa-image" />
                        {bannerPreview ? "Cambiar banner" : "Subir banner"}
                        <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                                const f = e.target.files?.[0] || null;
                                setBannerFile(f);
                                if (f) setBannerPreview(URL.createObjectURL(f));
                            }}
                        />
                    </label>

                    {bannerPreview && (
                        <button
                            type="button"
                            onClick={() => {
                                setBannerFile(null);
                                setBannerPreview("");
                            }}
                            className="text-sm text-red-500 hover:underline"
                        >
                            Quitar banner
                        </button>
                    )}
                </div>

                <p className="text-xs text-gray-500">
                    Recomendado: 1200 × 400 px (proporción 3:1). Se optimiza antes de subir.
                </p>

                {bannerFile && (
                    <p className="text-xs text-indigo-600 font-semibold">
                        Listo para guardar: {bannerFile.name}
                    </p>
                )}
            </div>

            {/* ── Color de marca ── */}
            <div className="bg-white border rounded-xl p-6 space-y-4">
                <h2 className="font-bold text-gray-900">Color de marca</h2>

                <div className="flex items-center gap-4">
                    <input
                        type="color"
                        value={brandColor}
                        onChange={(e) => setBrandColor(e.target.value)}
                        className="h-12 w-12 rounded-lg border cursor-pointer p-1"
                    />
                    <div>
                        <p className="text-sm font-medium text-gray-700">Color principal</p>
                        <p className="text-xs text-gray-500 font-mono">{brandColor}</p>
                    </div>
                </div>

                <p className="text-xs text-gray-500">
                    Se usará en botones y elementos destacados de tu catálogo público.
                </p>
            </div>

            {/* ── Información general ── */}
            <div className="bg-white border rounded-xl p-6 space-y-4">
                <h2 className="font-bold text-gray-900">Información general</h2>

                <div>
                    <label className="text-sm font-medium text-gray-700">Nombre</label>
                    <input
                        className="w-full mt-1 p-3 border rounded-lg"
                        value={name}
                        onChange={(e) => {
                            setName(e.target.value);
                            setSlug(slugify(e.target.value));
                        }}
                    />
                </div>

                <div>
                    <label className="text-sm font-medium text-gray-700">Slug (URL pública)</label>
                    <input
                        className="w-full mt-1 p-3 border rounded-lg font-mono"
                        value={slug}
                        onChange={(e) => setSlug(slugify(e.target.value))}
                    />
                </div>

                <div>
                    <label className="text-sm font-medium text-gray-700">Descripción</label>
                    <textarea
                        className="w-full mt-1 p-3 border rounded-lg"
                        rows={3}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />
                </div>
            </div>

            {/* ── Catálogo público ── */}
            <div className="bg-white border rounded-xl p-6 space-y-4">
                <div>
                    <h2 className="font-bold text-gray-900">Comparte tus catálogos</h2>
                    <p className="mt-1 text-sm text-gray-500">Envía el enlace público o el enlace con precios mayoristas según tu cliente.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                        type="button"
                        onClick={() => shareCatalogLink("public")}
                        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-left font-semibold text-gray-800 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300"
                    >
                        <span className="flex items-center gap-3">
                            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-600"><i className="fa-solid fa-store" /></span>
                            <span><span className="block">Compartir catálogo público</span><span className="mt-0.5 block text-xs font-normal text-gray-500">Precios para consumidor final</span></span>
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={() => shareCatalogLink("wholesale")}
                        className="w-full rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-left font-semibold text-indigo-900 shadow-sm transition hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    >
                        <span className="flex items-center gap-3">
                            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600"><i className="fa-solid fa-tags" /></span>
                            <span><span className="block">Compartir catálogo mayorista</span><span className="mt-0.5 block text-xs font-normal text-indigo-700">Precios configurados para mayoristas</span></span>
                        </span>
                    </button>
                </div>

                {sharedCatalog ? (
                    <div className="rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
                        Link {sharedCatalog === "public" ? "público" : "mayorista"} copiado al portapapeles.
                    </div>
                ) : null}

                <div className="text-sm text-gray-600 break-all">{catalogUrl}</div>

                <div className="flex gap-2">
                    <button
                        onClick={() => window.open(catalogUrl, "_blank")}
                        className="px-4 py-2 border rounded-lg font-semibold"
                    >
                        Abrir catálogo
                    </button>
                    <button
                        onClick={() => navigator.clipboard.writeText(catalogUrl)}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold"
                    >
                        Copiar link
                    </button>
                </div>

                <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
                    <div className="flex items-center gap-2 font-bold text-indigo-900">
                        <i className="fa-solid fa-tags text-indigo-600" /> Catálogo mayorista
                    </div>
                    <p className="mt-1 text-xs text-indigo-700">Muestra el precio mayorista de los productos que lo tengan configurado.</p>
                    <div className="mt-2 text-xs text-indigo-700 break-all">{wholesaleCatalogUrl}</div>
                    <div className="mt-3 flex gap-2">
                        <button onClick={() => window.open(wholesaleCatalogUrl, "_blank")} className="px-3 py-2 border border-indigo-200 bg-white rounded-lg text-sm font-semibold text-indigo-700">Abrir mayorista</button>
                        <button onClick={() => navigator.clipboard.writeText(wholesaleCatalogUrl)} className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold">Copiar link mayorista</button>
                    </div>
                </div>

                <label className="flex items-center gap-3 mt-2">
                    <input
                        type="checkbox"
                        checked={isActive}
                        onChange={(e) => setIsActive(e.target.checked)}
                    />
                    <span className="text-sm text-gray-700">
                        Tienda activa (visible al público)
                    </span>
                </label>
            </div>

            {/* ── Opciones de envío (NUEVO) ── */}
            <div className="bg-white border rounded-xl p-6 space-y-5">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="font-bold text-gray-900">Opciones de envío</h2>
                        <p className="text-xs text-gray-500 mt-0.5">
                            El cliente verá estas opciones al finalizar su pedido.
                        </p>
                    </div>
                    {/* Toggle principal */}
                    <button
                        type="button"
                        onClick={() => setShippingEnabled((v) => !v)}
                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${
                            shippingEnabled ? "bg-indigo-600" : "bg-gray-200"
                        }`}
                        aria-label="Activar envíos"
                    >
                        <span
                            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                                shippingEnabled ? "translate-x-6" : "translate-x-1"
                            }`}
                        />
                    </button>
                </div>

                {shippingEnabled && (
                    <div className="space-y-5 pt-1">

                        {/* Métodos disponibles */}
                        <div>
                            <p className="text-sm font-semibold text-gray-700 mb-3">
                                Métodos disponibles para tus clientes
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

                                {/* Contra entrega */}
                                <div
                                    onClick={() => toggleShippingMethod("cod")}
                                    className={`rounded-xl border-2 p-4 cursor-pointer transition select-none ${
                                        shippingMethods.includes("cod")
                                            ? "border-indigo-500 bg-indigo-50"
                                            : "border-gray-200 hover:border-gray-300"
                                    }`}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <div className="h-9 w-9 rounded-lg bg-green-100 flex items-center justify-center">
                                                <i className="fa-solid fa-money-bill-wave text-green-600" />
                                            </div>
                                            <span className="font-bold text-gray-900 text-sm">Contra entrega</span>
                                        </div>
                                        <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                                            shippingMethods.includes("cod")
                                                ? "border-indigo-500 bg-indigo-500"
                                                : "border-gray-300"
                                        }`}>
                                            {shippingMethods.includes("cod") && (
                                                <i className="fa-solid fa-check text-white text-[10px]" />
                                            )}
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-500">
                                        El cliente paga al recibir el pedido.
                                    </p>
                                </div>

                                {/* Transportadora */}
                                <div
                                    onClick={() => toggleShippingMethod("carrier")}
                                    className={`rounded-xl border-2 p-4 cursor-pointer transition select-none ${
                                        shippingMethods.includes("carrier")
                                            ? "border-indigo-500 bg-indigo-50"
                                            : "border-gray-200 hover:border-gray-300"
                                    }`}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <div className="h-9 w-9 rounded-lg bg-blue-100 flex items-center justify-center">
                                                <i className="fa-solid fa-truck text-blue-600" />
                                            </div>
                                            <span className="font-bold text-gray-900 text-sm">Envío con transportadora</span>
                                        </div>
                                        <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                                            shippingMethods.includes("carrier")
                                                ? "border-indigo-500 bg-indigo-500"
                                                : "border-gray-300"
                                        }`}>
                                            {shippingMethods.includes("carrier") && (
                                                <i className="fa-solid fa-check text-white text-[10px]" />
                                            )}
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-500">
                                        El pedido se envía por empresa de transporte.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Costos por método */}
                        <div className="space-y-3">
                            {/* Checkbox ocultar precios */}
                            <label className="flex items-center gap-3 cursor-pointer select-none group">
                                <div className="relative">
                                    <input
                                        type="checkbox"
                                        className="sr-only"
                                        checked={shippingHidePrices}
                                        onChange={(e) => setShippingHidePrices(e.target.checked)}
                                    />
                                    <div className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
                                        shippingHidePrices
                                            ? "bg-indigo-600 border-indigo-600"
                                            : "bg-white border-gray-300 group-hover:border-indigo-400"
                                    }`}>
                                        {shippingHidePrices && (
                                            <i className="fa-solid fa-check text-white text-[10px]" />
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <span className="text-sm font-semibold text-gray-700">
                                        No mostrar precios de envío al cliente
                                    </span>
                                    <p className="text-xs text-gray-400 mt-0.5">
                                        El cliente solo verá las opciones de envío, sin costo asociado.
                                    </p>
                                </div>
                            </label>

                            {/* Campos de costo — solo si no están ocultos */}
                            {!shippingHidePrices && (
                                <div className="space-y-3 pt-1">
                                    <p className="text-sm font-semibold text-gray-700">Costo de envío por método</p>
                                    <p className="text-xs text-gray-400 -mt-1">
                                        Escribe 0 si el envío es gratis para ese método.
                                    </p>

                                    {shippingMethods.includes("cod") && (
                                        <div className="flex items-center gap-3">
                                            <div className="h-8 w-8 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                                                <i className="fa-solid fa-money-bill-wave text-green-600 text-xs" />
                                            </div>
                                            <label className="text-sm text-gray-700 w-36 shrink-0">Contra entrega</label>
                                            <div className="flex items-center border rounded-lg overflow-hidden flex-1">
                                                <span className="px-3 py-2 bg-gray-50 text-gray-500 text-sm border-r">$</span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    className="flex-1 p-2 text-sm focus:outline-none"
                                                    value={shippingCostCOD}
                                                    onChange={(e) => setShippingCostCOD(e.target.value)}
                                                    placeholder="0"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {shippingMethods.includes("carrier") && (
                                        <div className="flex items-center gap-3">
                                            <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                                                <i className="fa-solid fa-truck text-blue-600 text-xs" />
                                            </div>
                                            <label className="text-sm text-gray-700 w-36 shrink-0">Transportadora</label>
                                            <div className="flex items-center border rounded-lg overflow-hidden flex-1">
                                                <span className="px-3 py-2 bg-gray-50 text-gray-500 text-sm border-r">$</span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    className="flex-1 p-2 text-sm focus:outline-none"
                                                    value={shippingCostCarrier}
                                                    onChange={(e) => setShippingCostCarrier(e.target.value)}
                                                    placeholder="0"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Nota de envío */}
                        <div>
                            <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                                <i className="fa-regular fa-note-sticky text-gray-400" />
                                Nota de envío (opcional)
                            </label>
                            <input
                                className="w-full mt-2 p-3 border rounded-lg text-sm"
                                placeholder="Ej: Envíos los martes y viernes. Tiempos estimados: 2-3 días hábiles."
                                value={shippingNote}
                                onChange={(e) => setShippingNote(e.target.value)}
                            />
                            <p className="text-xs text-gray-400 mt-1">
                                Se mostrará al cliente en el formulario del pedido.
                            </p>
                        </div>
                    </div>
                )}

                {!shippingEnabled && (
                    <div className="rounded-xl bg-gray-50 border border-dashed border-gray-200 p-4 text-center text-sm text-gray-400">
                        <i className="fa-solid fa-truck-fast text-2xl mb-2 block text-gray-300" />
                        Activa esta opción para que tus clientes puedan elegir cómo recibir su pedido.
                    </div>
                )}
            </div>

            <div className="bg-white border rounded-xl p-6 space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h2 className="font-bold text-gray-900">Formulario de compra</h2>
                        <p className="text-xs text-gray-500 mt-0.5">
                            Personaliza los datos que el cliente debe completar antes de enviar el pedido.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setCheckoutFields((prev) => [...prev, createCheckoutField()])}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700"
                    >
                        <i className="fa-solid fa-plus text-xs" />
                        Agregar campo
                    </button>
                </div>

                {checkoutFields.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-5 text-center">
                        <i className="fa-regular fa-rectangle-list mb-2 block text-2xl text-gray-300" />
                        <p className="text-sm font-semibold text-gray-500">No hay campos personalizados.</p>
                        <p className="mt-1 text-xs text-gray-400">
                            Nombre, telefono y direccion seguiran apareciendo por defecto.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {checkoutFields.map((field, index) => (
                            <div key={field.id} className="rounded-xl border border-gray-200 p-4 space-y-4">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-xs font-black text-gray-500">
                                            {index + 1}
                                        </span>
                                        <div>
                                            <p className="text-sm font-bold text-gray-900">
                                                {field.label || "Campo sin nombre"}
                                            </p>
                                            <p className="text-xs text-gray-400">
                                                {field.required ? "Obligatorio" : "Opcional"} · {field.enabled ? "Visible" : "Oculto"}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => moveCheckoutField(index, -1)}
                                            disabled={index === 0}
                                            className="h-9 w-9 rounded-lg border text-gray-500 hover:bg-gray-50 disabled:opacity-40"
                                            aria-label="Subir campo"
                                        >
                                            <i className="fa-solid fa-arrow-up text-xs" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => moveCheckoutField(index, 1)}
                                            disabled={index === checkoutFields.length - 1}
                                            className="h-9 w-9 rounded-lg border text-gray-500 hover:bg-gray-50 disabled:opacity-40"
                                            aria-label="Bajar campo"
                                        >
                                            <i className="fa-solid fa-arrow-down text-xs" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setCheckoutFields((prev) => prev.filter((item) => item.id !== field.id))}
                                            className="h-9 w-9 rounded-lg border border-red-100 text-red-500 hover:bg-red-50"
                                            aria-label="Eliminar campo"
                                        >
                                            <i className="fa-solid fa-trash text-xs" />
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-semibold text-gray-600">Nombre del campo</label>
                                        <input
                                            className="mt-1 w-full rounded-lg border p-3 text-sm"
                                            placeholder="Ej: Cedula, NIT, Barrio"
                                            value={field.label}
                                            onChange={(e) => updateCheckoutField(field.id, { label: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-semibold text-gray-600">Tipo</label>
                                        <select
                                            className="mt-1 w-full rounded-lg border p-3 text-sm"
                                            value={field.type}
                                            onChange={(e) => updateCheckoutField(field.id, { type: e.target.value as CheckoutFieldType })}
                                        >
                                            {checkoutFieldTypes.map((type) => (
                                                <option key={type.value} value={type.value}>
                                                    {type.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {field.type === "select" ? (
                                    <div>
                                        <label className="text-xs font-semibold text-gray-600">Opciones</label>
                                        <textarea
                                            className="mt-1 w-full rounded-lg border p-3 text-sm"
                                            rows={3}
                                            placeholder={"Una opcion por linea\nEj: Persona natural\nEmpresa"}
                                            value={(field.options || []).join("\n")}
                                            onChange={(e) =>
                                                updateCheckoutField(field.id, {
                                                    options: e.target.value
                                                        .split("\n")
                                                        .map((option) => option.trim())
                                                        .filter(Boolean),
                                                })
                                            }
                                        />
                                    </div>
                                ) : (
                                    <div>
                                        <label className="text-xs font-semibold text-gray-600">Texto de ayuda</label>
                                        <input
                                            className="mt-1 w-full rounded-lg border p-3 text-sm"
                                            placeholder="Ej: Escribe tu numero de cedula"
                                            value={field.placeholder || ""}
                                            onChange={(e) => updateCheckoutField(field.id, { placeholder: e.target.value })}
                                        />
                                    </div>
                                )}

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <label className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
                                        <input
                                            type="checkbox"
                                            checked={field.required}
                                            onChange={(e) => updateCheckoutField(field.id, { required: e.target.checked })}
                                        />
                                        <span className="text-sm font-semibold text-gray-700">Campo obligatorio</span>
                                    </label>
                                    <label className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
                                        <input
                                            type="checkbox"
                                            checked={field.enabled}
                                            onChange={(e) => updateCheckoutField(field.id, { enabled: e.target.checked })}
                                        />
                                        <span className="text-sm font-semibold text-gray-700">Mostrar en el checkout</span>
                                    </label>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Redes sociales y contacto ── */}
            <div className="bg-white border rounded-xl p-6 space-y-4">
                <h2 className="font-bold text-gray-900">Redes sociales y contacto</h2>

                <div>
                    <label className="text-sm font-medium text-gray-700">País, prefijo y moneda</label>
                    <select
                        className="w-full mt-1 p-3 border rounded-lg bg-white"
                        value={countryCode}
                        onChange={(e) => setCountryCode(e.target.value)}
                    >
                        {LATAM_COUNTRIES.map((country) => (
                            <option key={country.code} value={country.code}>
                                {country.name} (+{country.dialCode}) · {country.currency}
                            </option>
                        ))}
                    </select>
                </div>

                {/* WhatsApp principal */}
                <div>
                    <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                        <i className="fa-brands fa-whatsapp text-green-500" />
                        WhatsApp principal (+{getLatamCountry(countryCode).dialCode})
                    </label>
                    <input
                        className="w-full mt-1 p-3 border rounded-lg"
                        placeholder={getLatamCountry(countryCode).example}
                        value={whatsapp}
                        onChange={(e) => setWhatsapp(e.target.value.replace(/[^\d]/g, ""))}
                    />
                </div>

                {/* Instagram */}
                <div>
                    <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                        <i className="fa-brands fa-instagram text-pink-500" />
                        Instagram
                    </label>
                    <div className="flex mt-1">
                        <span className="inline-flex items-center px-3 border border-r-0 rounded-l-lg bg-gray-50 text-gray-500 text-sm">
                            @
                        </span>
                        <input
                            className="flex-1 p-3 border rounded-r-lg"
                            placeholder="tu_usuario"
                            value={instagram}
                            onChange={(e) => setInstagram(e.target.value.replace(/\s/g, ""))}
                        />
                    </div>
                </div>

                {/* Facebook */}
                <div>
                    <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                        <i className="fa-brands fa-facebook text-blue-600" />
                        Facebook
                    </label>
                    <div className="flex mt-1">
                        <span className="inline-flex items-center px-3 border border-r-0 rounded-l-lg bg-gray-50 text-gray-500 text-sm">
                            facebook.com/
                        </span>
                        <input
                            className="flex-1 p-3 border rounded-r-lg"
                            placeholder="tu.pagina"
                            value={facebook}
                            onChange={(e) => setFacebook(e.target.value.replace(/\s/g, ""))}
                        />
                    </div>
                </div>

                {/* Correo */}
                <div>
                    <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                        <i className="fa-regular fa-envelope text-gray-500" />
                        Correo electrónico
                    </label>
                    <input
                        type="email"
                        className="w-full mt-1 p-3 border rounded-lg"
                        placeholder="contacto@tunegocio.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                </div>

                {/* Teléfono */}
                <div>
                    <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                        <i className="fa-solid fa-phone text-gray-500" />
                        Teléfono
                    </label>
                    <input
                        className="w-full mt-1 p-3 border rounded-lg"
                        placeholder="3001234567"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s()-]/g, ""))}
                    />
                </div>

                {/* Ubicación */}
                <div>
                    <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                        <i className="fa-solid fa-location-dot text-red-500" />
                        Ubicación / Dirección
                    </label>
                    <input
                        className="w-full mt-1 p-3 border rounded-lg"
                        placeholder="Calle 10 # 5-20, Ibagué, Tolima"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                    />
                </div>
            </div>

            {/* ── Guardar ── */}
            {error && <div className="text-sm text-red-600">{error}</div>}

            <div className="flex justify-end">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-bold disabled:opacity-60"
                >
                    {saving ? "Guardando..." : "Guardar cambios"}
                </button>
            </div>
        </div>
    );
};

export default SettingsView;
