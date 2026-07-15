import React, { useMemo, useRef, useState } from "react";
import { signInWithEmailAndPassword } from "@/lib/supabaseAuth";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { auth } from "@/lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { buildInternationalPhone, getLatamCountry, LATAM_COUNTRIES, onlyPhoneDigits } from "@/helpers/latamCountries";

function slugify(input: string) {
    return input
        .toLowerCase()
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "");
}

const TOKEN_PLANS: Record<string, "Basic" | "Pro" | "Premium"> = {
    "basic-ssdfg-123654-asadfsf-987878": "Basic",
    "pro-hjklo-456789-qwerty-123456": "Pro",
    "premium-zxcvb-987654-asdfgh-456789": "Premium",
};

const businessTypes = [
    "Ropa",
    "Calzado",
    "Alimentos",
    "Restaurante",
    "Comidas rapidas",
    "Panaderia",
    "Reposteria",
    "Cafeteria",
    "Bebidas",
    "Supermercado",
    "Minimercado",
    "Tienda de barrio",
    "Frutas y verduras",
    "Carniceria",
    "Pescaderia",
    "Lacteos",
    "Productos organicos",
    "Belleza y cuidado personal",
    "Peluqueria / Barberia",
    "Cosmeticos",
    "Perfumeria",
    "Accesorios",
    "Joyeria",
    "Relojeria",
    "Tecnologia",
    "Celulares y accesorios",
    "Computadores",
    "Electrodomesticos",
    "Muebles",
    "Decoracion",
    "Hogar",
    "Ferreteria",
    "Construccion",
    "Papeleria",
    "Libreria",
    "Jugueteria",
    "Mascotas",
    "Veterinaria",
    "Farmacia",
    "Salud",
    "Servicios medicos",
    "Gimnasio / Fitness",
    "Deportes",
    "Bicicletas",
    "Motos",
    "Repuestos",
    "Automotriz",
    "Lavadero de autos",
    "Floristeria",
    "Regalos",
    "Artesanias",
    "Eventos",
    "Fotografia",
    "Publicidad",
    "Diseno grafico",
    "Servicios profesionales",
    "Consultoria",
    "Educacion",
    "Cursos / Academia",
    "Turismo",
    "Hotel / Hospedaje",
    "Transporte",
    "Inmobiliaria",
    "Moda",
    "Ropa infantil",
    "Ropa deportiva",
    "Lenceria",
    "Uniformes",
    "Tienda virtual",
    "Otro",
];

const RegisterView: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user, loading: authLoading } = useAuth();

    // HashRouter entrega aqui la query ubicada despues de #/admin/register.
    const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
    const source = (params.get("source") || "").trim().toLowerCase();
    const token = (params.get("token") || "").trim();
    const tokenPlan = TOKEN_PLANS[token] || null;
    const hasTokenParameter = params.has("token") && token.length > 0;

    const [adminName, setAdminName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);

    const [storeName, setStoreName] = useState("");
    const [storeSlug, setStoreSlug] = useState("");
    const [businessType, setBusinessType] = useState("");
    const [city, setCity] = useState("");
    const [countryCode, setCountryCode] = useState("CO");
    const [whatsapp, setWhatsapp] = useState("");
    const [address, setAddress] = useState("");
    const countryMenuRef = useRef<HTMLDetailsElement>(null);

    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const suggestedSlug = useMemo(() => slugify(storeName), [storeName]);

    if (authLoading) return null;
    if (user) return <Navigate to="/admin" replace />;

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        const cleanAdminName = adminName.trim();
        const cleanEmail = email.trim().toLowerCase();
        const cleanStoreName = storeName.trim();
        const cleanSlug = (storeSlug.trim() || suggestedSlug).trim();
        const cleanBusinessType = businessType.trim();
        const cleanCity = city.trim();
        const selectedCountry = getLatamCountry(countryCode);
        const cleanWhatsapp = buildInternationalPhone(countryCode, whatsapp);

        if (!cleanAdminName) return setError("Escribe tu nombre.");
        if (!cleanEmail) return setError("Escribe tu email.");
        if (password.length < 6) return setError("La contrasena debe tener minimo 6 caracteres.");
        if (!cleanStoreName) return setError("Escribe el nombre del negocio.");
        if (!cleanSlug) return setError("El slug del negocio es obligatorio.");
        if (!cleanBusinessType) return setError("Selecciona el tipo de negocio.");
        if (!cleanCity) return setError("Escribe la ciudad del negocio.");
        if (!onlyPhoneDigits(whatsapp)) return setError("Escribe el WhatsApp del negocio.");

        if (!/^\d{8,15}$/.test(cleanWhatsapp)) {
            return setError(`El número no parece válido para ${selectedCountry.name}. Revisa el número sin el prefijo internacional.`);
        }

        setLoading(true);

        try {
            const response = await fetch("/api/register-store", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    adminName: cleanAdminName,
                    email: cleanEmail,
                    password,
                    storeName: cleanStoreName,
                    storeSlug: cleanSlug,
                    businessType: cleanBusinessType,
                    city: cleanCity,
                    countryCode,
                    whatsapp: cleanWhatsapp,
                    address: address.trim() || "",
                    source: source || "direct",
                    token,
                }),
            });

            const responseText = await response.text();
            let result: any = null;
            try {
                result = responseText ? JSON.parse(responseText) : null;
            } catch {
                const apiError = new Error(`La API de registro no respondio correctamente (${response.status}).`);
                (apiError as any).status = response.status;
                throw apiError;
            }
            if (!response.ok || !result?.ok) {
                const apiError = new Error(result?.message || "No se pudo crear la cuenta/tienda.");
                (apiError as any).code = result?.code;
                (apiError as any).status = response.status;
                throw apiError;
            }

            await signInWithEmailAndPassword(auth, cleanEmail, password);
            localStorage.setItem("activeStoreId", result.storeId);
            navigate("/admin", { replace: true });
        } catch (err: any) {
            console.error(err);
            const code = err?.code as string | undefined;
            const rawMessage = String(err?.message || "");
            const message = rawMessage.toLowerCase();
            const status = Number(err?.status || 0);

            if (
                status === 429 ||
                code === "over_email_send_rate_limit" ||
                code === "email_rate_limit_exceeded" ||
                message.includes("rate limit")
            ) {
                setError("Supabase limito temporalmente los correos de registro. Espera unos minutos e intenta de nuevo.");
            } else if (
                code === "user_already_exists" ||
                code === "auth/email-already-in-use" ||
                message.includes("already registered") ||
                message.includes("already exists") ||
                message.includes("ya esta registrado")
            ) {
                setError("Ese correo ya esta registrado. Inicia sesion o usa la recuperacion de contrasena.");
            } else if (
                code === "duplicate_store" ||
                message.includes("slug") ||
                message.includes("duplicate key")
            ) {
                setError("Ese slug ya esta en uso. Prueba con otro para tu URL publica.");
            } else if (
                code === "validation_failed" ||
                code === "auth/invalid-email" ||
                code === "invalid_email"
            ) {
                setError("El correo no es valido.");
            } else if (code === "weak_password" || code === "auth/weak-password") {
                setError("Contrasena muy debil (minimo 6).");
            } else {
                setError(rawMessage || "No se pudo crear la cuenta/tienda. Revisa los datos e intenta de nuevo.");
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
            <div className="w-full max-w-xl bg-white rounded-xl shadow p-6">
                <h1 className="text-2xl font-bold">Crear cuenta</h1>
                <p className="text-gray-500 mt-1">Admin + datos del negocio</p>

                {tokenPlan ? (
                    <div className="mt-4 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg p-3 text-sm">
                        Registro con plan {tokenPlan}.
                    </div>
                ) : hasTokenParameter ? (
                    <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
                        El enlace o token de registro no es valido.
                    </div>
                ) : (
                    <div className="mt-4 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg p-3 text-sm">
                        Tu registro incluye 7 dias gratis.
                    </div>
                )}

                <form onSubmit={handleRegister} className="mt-6 space-y-6">
                    <section className="space-y-4">
                        <h2 className="text-lg font-semibold">Datos del administrador</h2>

                        <div>
                            <label className="block text-sm font-medium text-gray-700">Nombre</label>
                            <input
                                className="mt-1 w-full border rounded-lg p-2"
                                value={adminName}
                                onChange={(e) => setAdminName(e.target.value)}
                                placeholder="Tu nombre"
                                autoComplete="name"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700">Email</label>
                            <input
                                className="mt-1 w-full border rounded-lg p-2"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="correo@dominio.com"
                                type="email"
                                autoComplete="email"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700">Contrasena</label>

                            <div className="relative mt-1">
                                <input
                                    className="w-full border rounded-lg p-2 pr-12"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Minimo 6 caracteres"
                                    type={showPassword ? "text" : "password"}
                                    autoComplete="new-password"
                                />

                                <button
                                    type="button"
                                    onClick={() => setShowPassword((prev) => !prev)}
                                    className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-500 hover:text-gray-700"
                                    aria-label={showPassword ? "Ocultar contrasena" : "Mostrar contrasena"}
                                    title={showPassword ? "Ocultar contrasena" : "Mostrar contrasena"}
                                >
                                    {showPassword ? "Ocultar" : "Ver"}
                                </button>
                            </div>
                        </div>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-lg font-semibold">Datos del negocio</h2>

                        <div>
                            <label className="block text-sm font-medium text-gray-700">Nombre del negocio</label>
                            <input
                                className="mt-1 w-full border rounded-lg p-2"
                                value={storeName}
                                onChange={(e) => setStoreName(e.target.value)}
                                placeholder="Mi Tienda"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700">Tipo de negocio</label>
                            <select
                                className="mt-1 w-full border rounded-lg p-2 bg-white"
                                value={businessType}
                                onChange={(e) => setBusinessType(e.target.value)}
                            >
                                <option value="">Selecciona una opcion</option>
                                {businessTypes.map((type) => (
                                    <option key={type} value={type}>
                                        {type}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700">País</label>
                            <details ref={countryMenuRef} className="relative mt-1 group">
                                <summary className="flex w-full cursor-pointer list-none items-center justify-between rounded-lg border bg-white p-2 marker:content-none focus:outline-none focus:ring-2 focus:ring-indigo-200">
                                    <span className="flex items-center gap-2">
                                        <img
                                            src={`https://flagcdn.com/w40/${countryCode.toLowerCase()}.png`}
                                            srcSet={`https://flagcdn.com/w80/${countryCode.toLowerCase()}.png 2x`}
                                            width="28"
                                            height="19"
                                            alt=""
                                            className="h-[19px] w-7 rounded-sm object-cover shadow-sm"
                                        />
                                        <span>{getLatamCountry(countryCode).name} (+{getLatamCountry(countryCode).dialCode})</span>
                                    </span>
                                    <i className="fa-solid fa-chevron-down text-xs text-gray-400 transition group-open:rotate-180" />
                                </summary>
                                <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-white py-1 shadow-xl">
                                    {LATAM_COUNTRIES.map((country) => (
                                        <button
                                            key={country.code}
                                            type="button"
                                            className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-indigo-50 ${country.code === countryCode ? "bg-indigo-50 font-semibold text-indigo-700" : "text-gray-700"}`}
                                            onClick={() => {
                                                setCountryCode(country.code);
                                                countryMenuRef.current?.removeAttribute("open");
                                            }}
                                        >
                                            <img
                                                src={`https://flagcdn.com/w40/${country.code.toLowerCase()}.png`}
                                                srcSet={`https://flagcdn.com/w80/${country.code.toLowerCase()}.png 2x`}
                                                width="28"
                                                height="19"
                                                alt={`Bandera de ${country.name}`}
                                                loading="lazy"
                                                className="h-[19px] w-7 rounded-sm object-cover shadow-sm"
                                            />
                                            <span className="flex-1">{country.name}</span>
                                            <span className="text-gray-500">+{country.dialCode}</span>
                                        </button>
                                    ))}
                                </div>
                            </details>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700">Ciudad</label>
                            <input
                                className="mt-1 w-full border rounded-lg p-2"
                                value={city}
                                onChange={(e) => setCity(e.target.value)}
                                placeholder="Ej: Bogota, Medellin, Cali..."
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700">Slug (URL publica)</label>
                            <input
                                className="mt-1 w-full border rounded-lg p-2"
                                value={storeSlug}
                                onChange={(e) => setStoreSlug(slugify(e.target.value))}
                                placeholder={suggestedSlug || "mi-tienda"}
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                Tu catalogo publico sera:{" "}
                                <span className="font-mono">
                                    /c/{storeSlug || suggestedSlug || "mi-tienda"}
                                </span>
                            </p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700">
                                WhatsApp
                            </label>
                            <div className="mt-1 flex overflow-hidden rounded-lg border focus-within:ring-2 focus-within:ring-indigo-200">
                                <span className="flex items-center border-r bg-gray-50 px-3 text-sm font-semibold text-gray-700">
                                    <img
                                        src={`https://flagcdn.com/w40/${countryCode.toLowerCase()}.png`}
                                        width="24"
                                        height="16"
                                        alt=""
                                        className="mr-2 h-4 w-6 rounded-sm object-cover"
                                    />
                                    +{getLatamCountry(countryCode).dialCode}
                                </span>
                                <input
                                    className="min-w-0 flex-1 p-2 outline-none"
                                    value={whatsapp}
                                    onChange={(e) => setWhatsapp(onlyPhoneDigits(e.target.value))}
                                    placeholder={getLatamCountry(countryCode).example}
                                    inputMode="numeric"
                                    autoComplete="tel-national"
                                />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                                Escribe solo el número local. Guardaremos +{getLatamCountry(countryCode).dialCode}{onlyPhoneDigits(whatsapp) || getLatamCountry(countryCode).example}.
                            </p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700">Direccion (opcional)</label>
                            <input
                                className="mt-1 w-full border rounded-lg p-2"
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                placeholder="Calle 123 #45-67"
                            />
                        </div>
                    </section>

                    {error ? (
                        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
                            {error}
                        </div>
                    ) : null}

                    <div className="space-y-3">
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-indigo-600 text-white rounded-lg p-2 font-semibold disabled:opacity-60"
                        >
                            {loading ? "Creando..." : "Crear cuenta y tienda"}
                        </button>

                        <button
                            type="button"
                            onClick={() => navigate("/admin/login")}
                            className="w-full border rounded-lg p-2 font-semibold"
                        >
                            Ya tengo cuenta
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default RegisterView;
