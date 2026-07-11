
import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import PublicLayout from './components/layouts/PublicLayout';
import AdminLayout from './components/layouts/AdminLayout';
import HomeView from './views/public/HomeView';
import CatalogView from './views/public/CatalogView';
import DashboardView from './views/admin/DashboardView';
import CategoriesView from './views/admin/CategoriesView';
import ProductsView from './views/admin/ProductsView';
import OrdersView from './views/admin/OrdersView';
import CustomersView from './views/admin/CustomersView';
import LoginView from './views/admin/LoginView';
import ProtectedRoute from './components/auth/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import RegisterView from './views/admin/RegisterView';
import SettingsView from './views/admin/SettingsView';
import SubscriptionView from './views/admin/SubscriptionView';
import StoresView from './views/superadmin/StoresView';
import SuperAdminRoute from './components/auth/SuperAdminRoute';

const App: React.FC = () => {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          {/* Public Landing */}
          <Route element={<PublicLayout />}>
            <Route path="/" element={<HomeView />} />
          </Route>

          {/* Admin Login */}
          <Route path="/admin/login" element={<LoginView />} />
          <Route path="/admin/register" element={<RegisterView />} />

          <Route path="/system/stores" element={<SuperAdminRoute><StoresView /></SuperAdminRoute>} />

          {/* Protected Admin Routes */}
          <Route path="/admin" element={<ProtectedRoute />}>
            <Route element={<AdminLayout />}>
              <Route index element={<DashboardView />} />
              <Route path="products" element={<ProductsView />} />
              <Route path="categories" element={<CategoriesView />} />
              <Route path="orders" element={<OrdersView />} />
              <Route path="customers" element={<CustomersView />} />
              <Route path="subscription" element={<SubscriptionView />} />
              <Route path="settings" element={<SettingsView />} />
            </Route>
          </Route>

          {/* Public Catalog Route (Dynamic Slug at root) */}
          <Route path="/:slug" element={<CatalogView />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
};

export default App;
