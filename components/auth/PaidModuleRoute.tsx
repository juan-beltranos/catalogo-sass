import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useSubscriptionAccess } from "@/hooks/useSubscriptionAccess";

const PaidModuleRoute: React.FC = () => {
  const access = useSubscriptionAccess();
  if (access.loading) return <div className="min-h-[50vh] grid place-items-center text-gray-500">Verificando plan...</div>;
  return access.paidModulesAllowed ? <Outlet /> : <Navigate to="/admin/subscription" replace />;
};

export default PaidModuleRoute;
