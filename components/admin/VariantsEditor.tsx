import React from "react";
import { parseCOP, formatCOP } from "@/helpers";
import { Variant } from "@/types";

const uid = () => Math.random().toString(36).slice(2, 10);

type Props = {
    variants: Variant[];
    onChange: (variants: Variant[]) => void;
};

const VariantsEditor: React.FC<Props> = ({ variants, onChange }) => {
    const addVariant = () => {
        onChange([
            ...(variants || []),
            {
                id: uid(),
                title: "",
                optionValues: [],
                price: 0,
                stock: 0,
            },
        ]);
    };

    const removeVariant = (id: string) => {
        onChange((variants || []).filter((v) => v.id !== id));
    };

    const updateVariant = (idx: number, patch: Partial<Variant>) => {
        const next = [...(variants || [])];
        next[idx] = { ...next[idx], ...patch };
        onChange(next);
    };

    return (
        <div className="border rounded-xl p-4 space-y-4 bg-gray-50">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h4 className="font-bold text-gray-900">Variantes</h4>
                    <p className="text-xs text-gray-500 mt-1">
                        Agrega variantes con <b>precio</b> y <b>stock</b> independiente.
                    </p>
                </div>

                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => onChange([])}
                        className="px-3 py-2 border rounded-lg text-sm bg-white hover:bg-gray-50"
                    >
                        Quitar
                    </button>

                    <button
                        type="button"
                        onClick={addVariant}
                        className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700"
                    >
                        + Agregar
                    </button>
                </div>
            </div>

            {/* List */}
            {(variants || []).length ? (
                <div className="space-y-3">
                    {variants.map((v, idx) => (
                        <div key={v.id} className="bg-white border rounded-xl p-4">
                            {/* Row header */}
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-semibold text-gray-500">
                                        Variante #{idx + 1}
                                    </span>
                                    {v.title?.trim() ? (
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                                            {v.title}
                                        </span>
                                    ) : null}
                                </div>

                                <button
                                    type="button"
                                    onClick={() => removeVariant(v.id)}
                                    className="text-sm text-red-600 hover:underline"
                                >
                                    Eliminar
                                </button>
                            </div>

                            {/* Inputs - SIEMPRE 1 COLUMNA */}
                            <div className="space-y-3">
                                {/* Nombre */}
                                <div>
                                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                                        Nombre de la variante
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                                            <i className="fa-solid fa-tag text-xs" />
                                        </span>
                                        <input
                                            className="w-full pl-9 pr-3 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                            placeholder='Ej: "Rojo / M" o "Negro"'
                                            value={v.title}
                                            onChange={(e) => updateVariant(idx, { title: e.target.value })}
                                        />
                                    </div>
                                    <p className="text-[11px] text-gray-400 mt-1">
                                        Se mostrará al cliente al elegir la variante.
                                    </p>
                                </div>

                                {/* Precio */}
                                <div>
                                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                                        Precio (COP)
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">
                                            $
                                        </span>
                                        <input
                                            inputMode="numeric"
                                            className="w-full pl-7 pr-3 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                            placeholder="Ej: 250000"
                                            value={String(v.price ?? 0)}
                                            onChange={(e) => updateVariant(idx, { price: parseCOP(e.target.value) })}
                                        />
                                    </div>
                                    <p className="text-[11px] text-gray-400 mt-1">
                                        Preview: {formatCOP(Number(v.price || 0))}
                                    </p>
                                </div>

                                {/* Stock */}
                                <div>
                                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                                        Stock
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                                            <i className="fa-solid fa-boxes-stacked text-xs" />
                                        </span>
                                        <input
                                            inputMode="numeric"
                                            className="w-full pl-9 pr-3 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                            placeholder="0"
                                            value={String(v.stock ?? 0)}
                                            onChange={(e) =>
                                                updateVariant(idx, { stock: parseInt(e.target.value || "0", 10) })
                                            }
                                        />
                                    </div>
                                    <p className="text-[11px] text-gray-400 mt-1">
                                        Unidades disponibles.
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-sm text-gray-500 bg-white border rounded-xl p-4">
                    No hay variantes. Presiona <b>+ Agregar</b> para crear una.
                </div>
            )}
        </div>
    );
};

export default VariantsEditor;
