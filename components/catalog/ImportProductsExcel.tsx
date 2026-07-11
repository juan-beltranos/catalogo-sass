import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
    collection,
    doc,
    getDocs,
    query,
    setDoc,
    addDoc,
    where,
    serverTimestamp,
    getCountFromServer,
} from "@/lib/supabaseFirestore";
import { db } from "@/lib/supabase";

type Row = {
    sku: string;
    name: string;
    categoryName: string;
    price: number;
};

function parseMoneyToNumber(v: any): number {
    // acepta: "$2.500", "2500", 2500, "2,500" etc.
    if (typeof v === "number") return Math.round(v);
    const s = String(v ?? "").trim();
    if (!s) return 0;
    // quita $, espacios, y deja dígitos
    const digits = s.replace(/[^\d]/g, "");
    return Number(digits || 0);
}

function pick(obj: any, keys: string[]) {
    for (const k of keys) {
        if (obj?.[k] !== undefined && obj?.[k] !== null && String(obj[k]).trim() !== "") {
            return obj[k];
        }
    }
    return undefined;
}

export default function ImportProductsExcel({ storeId }: { storeId: string }) {
    const [file, setFile] = useState<File | null>(null);
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<{ created: number; failed: number; errors: string[] } | null>(null);

    const canImport = useMemo(() => rows.length > 0 && !loading, [rows, loading]);

    const readExcel = async (f: File) => {
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });

        const mapped: Row[] = json
            .map((r) => {
                const sku = String(pick(r, ["CODIGO", "Código", "codigo", "SKU", "sku"]) ?? "").trim();
                const name = String(pick(r, ["NOMBRE", "Nombre", "nombre", "NAME", "name"]) ?? "").trim();
                const categoryName = String(pick(r, ["CATEGORIA", "Categoría", "categoria", "CATEGORY", "category"]) ?? "").trim();
                const priceRaw = pick(r, ["PRECIO", "Precio", "precio", "PRICE", "price", "PRECIO FINAL"]);
                const price = parseMoneyToNumber(priceRaw);

                return { sku, name, categoryName, price };
            })
            .filter((r) => r.name && r.categoryName && r.price > 0);

        setRows(mapped);
        setResult(null);
    };

    const importToFirestore = async () => {
        if (!storeId) return;
        setLoading(true);
        setResult(null);

        try {
            // 1) Traer categorías existentes
            const catsRef = collection(db, "stores", storeId, "categories");
            const catsSnap = await getDocs(catsRef);

            const catNameToId = new Map<string, string>();
            catsSnap.forEach((d) => {
                const data = d.data() as any;
                const name = String(data?.name ?? "").trim();
                if (name) catNameToId.set(name.toLowerCase(), d.id);
            });

            // 2) Crear categorías faltantes
            const uniqueCatNames = Array.from(new Set(rows.map((r) => r.categoryName.trim()).filter(Boolean)));

            for (const catName of uniqueCatNames) {
                //@ts-ignore
                const key = catName.toLowerCase();
                if (!catNameToId.has(key)) {
                    const newCatRef = await addDoc(catsRef, {
                        name: catName,
                        order: 9999,
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                    });
                    catNameToId.set(key, newCatRef.id);
                }
            }

            // 3) Insertar productos
            const prodsRef = collection(db, "stores", storeId, "products");
            const countSnap = await getCountFromServer(prodsRef);
            const importOrderBase = countSnap.data().count;

            let created = 0;
            let failed = 0;
            const errors: string[] = [];

            // (Opcional) evitar duplicados por SKU: consulta previa
            // Si tienes muchos, mejor crear un índice en Firestore y consultar por lotes.
            // Aquí haremos una consulta por SKU (sencilla, funciona bien para cientos).
            for (const [rowIndex, r] of rows.entries()) {
                try {
                    const catId = catNameToId.get(r.categoryName.toLowerCase());
                    if (!catId) throw new Error(`No se pudo resolver categoría: ${r.categoryName}`);

                    const cleanSku = r.sku?.trim() ? r.sku.trim() : null;
                    if (cleanSku) {
                        const qSku = query(prodsRef, where("sku", "==", cleanSku));
                        const skuSnap = await getDocs(qSku);
                        if (!skuSnap.empty) continue;
                    }

                    await addDoc(prodsRef, {
                        sku: r.sku,
                        name: r.name,
                        categoryId: catId,
                        price: r.price,
                        discount: null,
                        images: [],
                        videos: [],
                        options: [],
                        variants: [],
                        order: importOrderBase + rowIndex,
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                    });

                    created++;
                } catch (e: any) {
                    failed++;
                    errors.push(`${r.sku} - ${r.name}: ${e?.message || "error"}`);
                }
            }

            setResult({ created, failed, errors });
        } finally {
            setLoading(false);
            window.location.reload()
        }
    };

    return (
        <div className="bg-white border rounded-xl p-4 space-y-3">
            <div className="font-extrabold text-gray-900">Importar productos desde Excel</div>

            <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setFile(f);
                    setRows([]);
                    setResult(null);
                    if (f) readExcel(f);
                }}
            />

            {rows.length > 0 ? (
                <div className="text-sm text-gray-600">
                    Detectados <b>{rows.length}</b> productos válidos (nombre, categoría, precio).
                </div>
            ) : (
                <div className="text-xs text-gray-400">
                    {''}
                </div>
            )}

            <button
                disabled={!canImport}
                onClick={importToFirestore}
                className="w-full bg-indigo-600 text-white py-2 rounded font-extrabold disabled:opacity-60"
            >
                {loading ? "Importando..." : "Importar a la tienda"}
            </button>

            {result ? (
                <div className="border rounded-lg p-3 text-sm">
                    <div>✅ Creados: <b>{result.created}</b></div>
                    <div>⚠️ Fallidos: <b>{result.failed}</b></div>
                    {result.errors.length > 0 ? (
                        <details className="mt-2">
                            <summary className="cursor-pointer font-bold">Ver errores</summary>
                            <ul className="mt-2 list-disc pl-5 text-xs text-gray-600 space-y-1">
                                {result.errors.slice(0, 50).map((x, i) => <li key={i}>{x}</li>)}
                                {result.errors.length > 50 ? <li>...y más</li> : null}
                            </ul>
                        </details>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
