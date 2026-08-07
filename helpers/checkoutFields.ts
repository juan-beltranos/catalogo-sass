import type { CheckoutFieldConfig, CheckoutFieldType } from "../types/index";

export const SYSTEM_CHECKOUT_FIELDS: CheckoutFieldConfig[] = [
  { id: "customer_name", label: "Nombre", type: "text", required: true, enabled: true, placeholder: "Tu nombre", system: true },
  { id: "customer_phone", label: "Telefono", type: "tel", required: true, enabled: true, placeholder: "Solo numeros", system: true },
  { id: "customer_address", label: "Direccion", type: "text", required: true, enabled: true, placeholder: "Tu direccion", system: true },
  { id: "order_notes", label: "Notas", type: "textarea", required: false, enabled: true, placeholder: "Indicaciones para el pedido", system: true },
];

const validTypes: CheckoutFieldType[] = ["text", "number", "tel", "email", "textarea", "select", "date"];

export function normalizeCheckoutFormFields(raw: any): CheckoutFieldConfig[] {
  const supplied = (Array.isArray(raw) ? raw : []).map((field: any) => ({
    id: String(field.id || ""), label: String(field.label || "").trim(),
    type: validTypes.includes(field.type) ? field.type : "text",
    required: field.required === true, enabled: field.enabled !== false,
    placeholder: String(field.placeholder || "").trim(),
    options: Array.isArray(field.options) ? field.options.map((item: any) => String(item).trim()).filter(Boolean) : [],
    system: field.system === true || SYSTEM_CHECKOUT_FIELDS.some((item) => item.id === field.id),
  })).filter((field: CheckoutFieldConfig) => field.id && field.label);
  const hasSystemFields = supplied.some((field: CheckoutFieldConfig) => field.system);
  if (hasSystemFields) return supplied;
  return [...SYSTEM_CHECKOUT_FIELDS.map((field) => ({ ...field })), ...supplied];
}
