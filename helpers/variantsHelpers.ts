import { uid } from ".";

export function cartesianN(arrays: string[][]): string[][] {
    // arrays = [[Rojo,Azul],[S,M],[...]]
    if (!arrays.length) return [];
    return arrays.reduce<string[][]>(
        (acc, curr) => acc.flatMap((a) => curr.map((c) => [...a, c])),
        [[]]
    );
}

export function variantKey(optionValues: string[]) {
    return optionValues.map((v) => v.trim()).join("||").toLowerCase();
}

export function generateVariantsFromOptions(
    basePrice: number,
    options: { name: string; values: string[] }[],
    prev: { id: string; optionValues: string[]; price?: number; stock?: number }[] = []
) {
    const cleanOptions = options
        .map((o) => ({
            name: (o.name || "").trim(),
            values: (o.values || []).map((v) => v.trim()).filter(Boolean),
        }))
        .filter((o) => o.name && o.values.length);

    if (!cleanOptions.length) return { options: [], variants: [] as any[] };

    const combos = cartesianN(cleanOptions.map((o) => o.values));

    const prevMap = new Map(prev.map((v) => [variantKey(v.optionValues), v]));

    const variants = combos.map((optionValues) => {
        const key = variantKey(optionValues);
        const existing = prevMap.get(key);

        return {
            id: existing?.id ?? uid(),
            optionValues,
            title: optionValues.join(" / "),
            price: existing?.price ?? basePrice,
            stock: existing?.stock ?? 0,
        };
    });

    return { options: cleanOptions, variants };
}
