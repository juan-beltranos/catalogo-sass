import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useSubscriptionAccess } from "@/hooks/useSubscriptionAccess";

const SubscriptionRoute: React.FC = () => {
  const subscription = useSubscriptionAccess();
  const location = useLocation();
  if (subscription.loading) return <div className="min-h-[50vh] grid place-items-center text-gray-500">Verificando suscripción...</div>;
  if (!subscription.allowed) {
    return <Navigate to="/admin/subscription-required" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
};
export default SubscriptionRoute;
