export type SubscriptionPlan = "trial" | "basic" | "pro" | "premium" | "subscription" | null;

export type SubscriptionPlanLimits = {
  products: number | null;
  categories: number | null;
  imagesPerProduct: number | null;
  videosPerProduct: number | null;
};

const UNLIMITED: SubscriptionPlanLimits = {
  products: null,
  categories: null,
  imagesPerProduct: null,
  videosPerProduct: null,
};

export const SUBSCRIPTION_PLAN_LIMITS: Record<Exclude<SubscriptionPlan, null>, SubscriptionPlanLimits> = {
  basic: { products: 50, categories: 5, imagesPerProduct: 3, videosPerProduct: 0 },
  pro: { products: 200, categories: 10, imagesPerProduct: 5, videosPerProduct: 1 },
  premium: UNLIMITED,
  trial: UNLIMITED,
  subscription: UNLIMITED,
};

export const getSubscriptionPlanLimits = (plan: SubscriptionPlan): SubscriptionPlanLimits =>
  plan ? SUBSCRIPTION_PLAN_LIMITS[plan] : UNLIMITED;
