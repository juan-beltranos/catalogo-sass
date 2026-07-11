import { SidebarItemProps, SidebarProps } from '@/interfaces';
import React from 'react';
import { Link, useLocation } from 'react-router-dom';

type MenuItem = {
  to: string;
  icon: string;
  label: string;
  exact?: boolean;
  disabled?: boolean;
};

type SidebarCustomProps = SidebarProps & {
  hasActiveSubscription?: boolean;
  hideSubscription?: boolean;
};

const SidebarItem: React.FC<SidebarItemProps & { disabled?: boolean }> = ({
  to,
  icon,
  label,
  active,
  onNavigate,
  disabled = false,
}) => {
  if (disabled) {
    return (
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-lg font-medium text-gray-400 bg-gray-50 cursor-not-allowed opacity-70"
        title="Disponible solo con una suscripción activa"
      >
        <i className={`fa-solid ${icon} w-5 text-center`} />
        <span>{label}</span>
        <i className="fa-solid fa-lock ml-auto text-xs" />
      </div>
    );
  }

  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors font-medium ${active
          ? 'bg-indigo-50 text-indigo-700'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
        }`}
    >
      <i className={`fa-solid ${icon} w-5 text-center`} />
      <span>{label}</span>
    </Link>
  );
};

const Sidebar: React.FC<SidebarCustomProps> = ({
  onNavigate,
  hasActiveSubscription = false,
  hideSubscription = false,
}) => {
  const location = useLocation();

  const canUseAdmin = hasActiveSubscription === true;

  const menuItems: MenuItem[] = [
    {
      to: '/admin',
      icon: 'fa-chart-pie',
      label: 'Dashboard',
      exact: true,
      disabled: !canUseAdmin,
    },
    {
      to: '/admin/products',
      icon: 'fa-box',
      label: 'Productos',
      disabled: !canUseAdmin,
    },
    {
      to: '/admin/categories',
      icon: 'fa-tags',
      label: 'Categorías',
      disabled: !canUseAdmin,
    },
    {
      to: '/admin/orders',
      icon: 'fa-cart-shopping',
      label: 'Pedidos',
      disabled: !canUseAdmin,
    },
    {
      to: '/admin/customers',
      icon: 'fa-users',
      label: 'Clientes',
      disabled: !canUseAdmin,
    },
    {
      to: '/admin/settings',
      icon: 'fa-sliders',
      label: 'Configuración',
      disabled: !canUseAdmin,
    },
  ];

  // if (!hideSubscription) {
  //   menuItems.splice(5, 0, {
  //     to: '/admin/subscription',
  //     icon: 'fa-credit-card',
  //     label: 'Suscripción',
  //     disabled: false,
  //   });
  // }

  const isLinkActive = (item: MenuItem) => {
    if (item.exact) return location.pathname === item.to;
    return location.pathname.startsWith(item.to);
  };

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col h-full overflow-y-auto">
      {!canUseAdmin && !hideSubscription && (
        <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <div className="flex items-start gap-2">
            <i className="fa-solid fa-triangle-exclamation mt-0.5" />
            <div>
              <p className="font-bold">Acceso limitado</p>
              <p className="mt-1">Activa tu suscripción para usar el panel.</p>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 space-y-1">
        <div className="px-4 mb-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
            Gestión
          </p>
        </div>

        {menuItems.map((item) => (
          <SidebarItem
            key={item.to}
            to={item.to}
            icon={item.icon}
            label={item.label}
            active={!item.disabled && isLinkActive(item)}
            onNavigate={onNavigate}
            disabled={item.disabled}
          />
        ))}
      </div>
    </aside>
  );
};

export default Sidebar;