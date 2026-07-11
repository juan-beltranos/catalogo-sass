export type ImageItem = {
    url: string;        // secure_url
    publicId: string;   // public_id (lo usas para borrar)
    path?: string;      // clave del objeto en R2 (compatibilidad con imágenes persistidas)
    width?: number;
    height?: number;
    format?: string;
    bytes?: number;
};


export type ProductOption = {
    name: string;      // e.g. "Color"
    values: string[];  // e.g. ["Rojo", "Azul"]
};

export type Variant = {
    id: string;              // simple id
    title: string;           // "Rojo / M"
    optionValues: string[];  // ["Rojo", "M"]
    price: number;           // int COP
    stock?: number;
    sku?: string;
    imageIndex?: number;     // index en images[]
    video?: VideoItem | null;
};

export type Product = {
    id: string;
    name: string;
    sku?: string;
    description?: string;
    price: number;
    wholesalePrice?: number | null;
    categoryId: string;
    imageUrl?: string;
    images?: ImageItem[];
    variants?: Variant[];
    allowsCashOnDelivery?: boolean;
};

export type Category = { id: string; name: string; order: number };

export type CartItem = {
    productId: string;
    productName: string;
    variantId?: string;
    variantTitle?: string;
    unitPrice: number; // COP int
    priceType?: "retail" | "wholesale";
    qty: number;
    imageUrl?: string;
    allowsCashOnDelivery?: boolean;
    originalUnitPrice?: number; // BASE sin descuento (opcional)
    hasDiscount?: boolean;
    sku?: string;
};

export type CheckoutFieldType = "text" | "number" | "tel" | "email" | "textarea" | "select" | "date";

export type CheckoutFieldConfig = {
    id: string;
    label: string;
    type: CheckoutFieldType;
    required: boolean;
    enabled: boolean;
    placeholder?: string;
    options?: string[];
};

export type CheckoutFieldAnswer = {
    id: string;
    label: string;
    type: CheckoutFieldType;
    value: string;
};


export type OrderStatus = "new" | "confirmed" | "preparing" | "delivered" | "cancelled";

export type OrderItem = {
    productId: string;
    productName: string;
    sku?: string | null;
    variantId?: string | null;
    variantTitle?: string | null;
    unitPrice: number; // COP int
    qty: number;
    subtotal: number; // unitPrice * qty
};

export type Order = {
    id: string;
    status: OrderStatus;
    channel?: "whatsapp" | "manual";
    customer: {
        name: string;
        phone: string;
        address: string;
        customFields?: CheckoutFieldAnswer[];
    };
    notes?: string;
    items: OrderItem[];
    customFields?: CheckoutFieldAnswer[];
    total: number; // COP int
    createdAt?: any;
    updatedAt?: any;
};

export type Client = {
    id: string; // phone como id
    name: string;
    phone: string;
    address: string;

    totalOrders: number;
    totalSpent: number; // COP int
    lastOrderAt?: any;

    createdAt?: any;
    updatedAt?: any;
};

export type VideoItem = {
    url: string;
    path: string;
    thumbUrl?: string;
    durationSec?: number;
    optimizedUrl?: string;
    originalUrl?: string;
};


export type UploadResult = {
    secure_url: string;
    public_id: string;
    width?: number;
    height?: number;
    format?: string;
    bytes?: number;
};

export type SignedPayload = {
    cloudName: string;
    apiKey: string;
    timestamp: number;
    signature: string;
    folder: string;
    overwrite: boolean;
};

export type CloudImageItem = {
    url: string;
    publicId: string;
    width?: number;
    height?: number;
    bytes?: number;
};

export type ImportedJsonProduct = {
    id?: string;
    name?: string;
    price?: number | string;
    originalPrice?: number | string;
    oldPrice?: number | string;
    compareAtPrice?: number | string;
    description?: string;
    category?: string;
    featured?: boolean;
    hidden?: boolean;
    quantity?: number | string;
};
