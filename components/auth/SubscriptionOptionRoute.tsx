import React from "react";
import { Navigate } from "react-router-dom";
import { useSubscriptionAccess } from "@/hooks/useSubscriptionAccess";
import SubscriptionView from "@/views/admin/SubscriptionView";

const SubscriptionOptionRoute: React.FC = () => {
  const access = useSubscriptionAccess();
  if (access.loading) return <div className="min-h-[50vh] grid place-items-center text-gray-500">Verificando acceso...</div>;
  if (access.tokenIntroActive) return <Navigate to="/admin/products" replace />;
  return <SubscriptionView />;
};

export default SubscriptionOptionRoute;
