import type { CommerceRules, PricingRule, RuleCondition, ShippingRule } from "../types/index";

export type CommerceRuleInput = {
  quantity: number;
  subtotal: number;
  shippingMethod?: "pickup" | "local" | "national" | null;
  baseShippingCost?: number;
};

export type AppliedRule = { id: string; name: string; amount: number; kind: "pricing" | "shipping" };

export type CommerceRuleResult = {
  originalSubtotal: number;
  subtotal: number;
  discount: number;
  baseShippingCost: number;
  shippingCost: number;
  total: number;
  appliedRules: AppliedRule[];
};

export const EMPTY_COMMERCE_RULES: CommerceRules = { pricing: [], shipping: [] };

const money = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));
const count = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));

const matches = (condition: RuleCondition | undefined, quantity: number, subtotal: number) => {
  const c = condition || {};
  if (c.minQuantity != null && quantity < count(c.minQuantity)) return false;
  if (c.maxQuantity != null && quantity > count(c.maxQuantity)) return false;
  if (c.minSubtotal != null && subtotal < money(c.minSubtotal)) return false;
  if (c.maxSubtotal != null && subtotal > money(c.maxSubtotal)) return false;
  return true;
};

const byPriority = <T extends { priority?: number }>(rules: T[]) =>
  [...rules].sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));

export const normalizeCommerceRules = (value: any): CommerceRules => ({
  pricing: (Array.isArray(value?.pricing) ? value.pricing : []).map((rule: any, index: number): PricingRule => ({
    id: String(rule.id || `pricing_${index}`), name: String(rule.name || "Regla de precio"),
    enabled: rule.enabled !== false, priority: Number(rule.priority || 0), condition: rule.condition || {},
    action: ["fixed_subtotal", "percent_discount", "amount_discount"].includes(rule.action) ? rule.action : "fixed_subtotal",
    value: money(rule.value), stopProcessing: rule.stopProcessing !== false,
  })),
  shipping: (Array.isArray(value?.shipping) ? value.shipping : []).map((rule: any, index: number): ShippingRule => ({
    id: String(rule.id || `shipping_${index}`), name: String(rule.name || "Regla de envio"),
    enabled: rule.enabled !== false, priority: Number(rule.priority || 0), condition: rule.condition || {},
    shippingMethod: rule.shippingMethod === "cod" ? "pickup"
      : rule.shippingMethod === "carrier" ? "local"
      : ["pickup", "local", "national"].includes(rule.shippingMethod) ? rule.shippingMethod : "all",
    action: ["fixed_cost", "free_shipping", "amount_discount"].includes(rule.action) ? rule.action : "fixed_cost",
    value: money(rule.value), stopProcessing: rule.stopProcessing !== false,
  })),
});

export function evaluateCommerceRules(input: CommerceRuleInput, rawRules?: CommerceRules | null): CommerceRuleResult {
  const quantity = count(input.quantity);
  const originalSubtotal = money(input.subtotal);
  const baseShippingCost = money(input.baseShippingCost);
  const rules = normalizeCommerceRules(rawRules);
  const appliedRules: AppliedRule[] = [];
  let subtotal = originalSubtotal;

  for (const rule of byPriority(rules.pricing).filter((item) => item.enabled)) {
    if (!matches(rule.condition, quantity, originalSubtotal)) continue;
    const before = subtotal;
    if (rule.action === "fixed_subtotal") subtotal = money(rule.value);
    if (rule.action === "percent_discount") subtotal = money(subtotal * (1 - Math.min(100, rule.value) / 100));
    if (rule.action === "amount_discount") subtotal = money(subtotal - rule.value);
    appliedRules.push({ id: rule.id, name: rule.name, amount: Math.max(0, before - subtotal), kind: "pricing" });
    if (rule.stopProcessing !== false) break;
  }

  let shippingCost = baseShippingCost;
  for (const rule of byPriority(rules.shipping).filter((item) => item.enabled)) {
    if (rule.shippingMethod !== "all" && rule.shippingMethod !== input.shippingMethod) continue;
    if (!matches(rule.condition, quantity, subtotal)) continue;
    const before = shippingCost;
    if (rule.action === "free_shipping") shippingCost = 0;
    if (rule.action === "fixed_cost") shippingCost = money(rule.value);
    if (rule.action === "amount_discount") shippingCost = money(shippingCost - rule.value);
    appliedRules.push({ id: rule.id, name: rule.name, amount: Math.max(0, before - shippingCost), kind: "shipping" });
    if (rule.stopProcessing !== false) break;
  }

  return { originalSubtotal, subtotal, discount: Math.max(0, originalSubtotal - subtotal), baseShippingCost,
    shippingCost, total: subtotal + shippingCost, appliedRules };
}
