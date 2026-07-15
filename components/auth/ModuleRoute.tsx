import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useSubscriptionAccess } from "@/hooks/useSubscriptionAccess";

const ModuleRoute: React.FC = () => {
  const access = useSubscriptionAccess();
  if (access.loading) return <div className="min-h-[50vh] grid place-items-center text-gray-500">Verificando plan...</div>;
  return access.restrictedModules ? <Navigate to="/admin/products" replace /> : <Outlet />;
};

export default ModuleRoute;
