import { CheckoutFieldConfig, ImageItem, ProductOption, Variant, VideoItem } from "@/types";

export interface Product {
  id: string;
  name: string;
  sku?: string;
  description?: string;
    price: number;
    wholesalePrice?: number | null;
    categoryId: string;
  images: ImageItem[];
  options: ProductOption[];
  variants: Variant[];
  videos?: VideoItem[];
  isActive?: boolean;
  /** Si es false, este producto no puede pedirse con pago contra entrega. */
  allowsCashOnDelivery?: boolean;
  order?: number | null;
  createdAt?: any;
  discount?: {
    type: "percent" | "amount";
    value: number;
  } | null;
}

export interface Store {
  id: string;
  name: string;
  whatsapp: string;
  slug: string;
  address?: string;
  isActive?: boolean;
  createdAt?: string;
  logoUrl?: string;
  logoPath?: string;
  checkoutFields?: CheckoutFieldConfig[];
}

export interface SidebarProps {
  onNavigate?: () => void;
}

export interface SidebarItemProps {
  to: string;
  icon: string;
  label: string;
  active: boolean;
  onNavigate?: () => void;
  disabled?: boolean;
}

export interface Category {
  id: string;
  name: string;
  order: number;
}

export interface PaginatorProps {
  page: number;
  hasNext: boolean;
  hasPrev: boolean;
  loading?: boolean;
  onNext: () => void;
  onPrev: () => void;
  className?: string;
}

export interface DeleteSignedPayload {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  publicIds: string[];
  resourceType: "image" | "video";
}
