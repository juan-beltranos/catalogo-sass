import React, { useEffect, useMemo, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from '@/lib/supabaseAuth';
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@/lib/supabaseFirestore';

import { auth, db } from '@/lib/supabase';
import { getStoreForOwner, invalidateStoreForOwner } from "@/lib/storeLookup";
import { useAuth } from '../../context/AuthContext';
import Sidebar from '../admin/Sidebar';
import { getCatalogSharePath } from '@/helpers/catalogLinks';
import { useSubscriptionAccess } from '@/hooks/useSubscriptionAccess';

type StoreInfo = {
  id: string;
  slug: string;
  name: string;
  hasActiveSubscription: boolean;

  subscriptionType?: string | null;
  source?: string | null;
  subscriptionStatus?: string | null;

  hasFreeTrial?: boolean;
  freeTrialStatus?: string | null;
  trialEndsAtMs?: number | null;

  subscriptionEndAt?: unknown;
  subscriptionEndsAt?: unknown;
};

const getDateMs = (value: unknown): number | null => {
  if (!value) return null;

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'seconds' in value &&
    typeof (value as { seconds: number }).seconds === 'number'
  ) {
    return (value as { seconds: number }).seconds * 1000;
  }

  return null;
};

const AdminLayout: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const subscriptionAccess = useSubscriptionAccess();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [storeInfo, setStoreInfo] = useState<StoreInfo | null>(null);
  const [loadingStore, setLoadingStore] = useState(true);

  // El módulo de pago permanece visible para todos, incluidos usuarios legacy.
  const hideSubscriptionModule = false;

  useEffect(() => {
    let isMounted = true;

    const loadStore = async () => {
      try {
        if (!user?.uid) {
          if (isMounted) {
            setStoreInfo(null);
            setLoadingStore(false);
          }
          return;
        }

        setLoadingStore(true);

        const storeResult = await getStoreForOwner(user.uid);

        if (!isMounted) return;

        if (!storeResult) {
          setStoreInfo(null);
          setLoadingStore(false);
          return;
        }

        const data = storeResult.data;

        const loadedStore: StoreInfo = {
          id: storeResult.id,
          slug: typeof data.slug === 'string' ? data.slug : '',
          name: typeof data.name === 'string' ? data.name : '',
          hasActiveSubscription: data.hasActiveSubscription === true,

          subscriptionType:
            typeof data.subscriptionType === 'string'
              ? data.subscriptionType
              : null,

          source: typeof data.source === 'string' ? data.source : null,

          subscriptionStatus:
            typeof data.subscriptionStatus === 'string'
              ? data.subscriptionStatus
              : null,

          hasFreeTrial: data.hasFreeTrial === true,

          freeTrialStatus:
            typeof data.freeTrialStatus === 'string'
              ? data.freeTrialStatus
              : null,

          trialEndsAtMs:
            typeof data.trialEndsAtMs === 'number'
              ? data.trialEndsAtMs
              : null,

          subscriptionEndAt: data.subscriptionEndAt ?? null,
          subscriptionEndsAt: data.subscriptionEndsAt ?? null,
        };

        const trialExpired =
          loadedStore.hasFreeTrial === true &&
          typeof loadedStore.trialEndsAtMs === 'number' &&
          Date.now() > loadedStore.trialEndsAtMs;

        const subscriptionEndMs =
          getDateMs(loadedStore.subscriptionEndAt) ??
          getDateMs(loadedStore.subscriptionEndsAt);

        const subscriptionExpired =
          loadedStore.hasActiveSubscription === true &&
          subscriptionEndMs !== null &&
          Date.now() > subscriptionEndMs;

        if (
          trialExpired &&
          loadedStore.freeTrialStatus !== 'expired' &&
          loadedStore.subscriptionStatus !== 'trial_expired'
        ) {
          await updateDoc(doc(db, 'stores', storeResult.id), {
            hasActiveSubscription: false,
            subscriptionStatus: 'trial_expired',
            freeTrialStatus: 'expired',
            updatedAt: serverTimestamp(),
          });
          invalidateStoreForOwner(user.uid);

          loadedStore.hasActiveSubscription = false;
          loadedStore.subscriptionStatus = 'trial_expired';
          loadedStore.freeTrialStatus = 'expired';
        }

        if (
          subscriptionExpired &&
          loadedStore.subscriptionStatus !== 'expired'
        ) {
          await updateDoc(doc(db, 'stores', storeResult.id), {
            hasActiveSubscription: false,
            subscriptionStatus: 'expired',
            updatedAt: serverTimestamp(),
          });
          invalidateStoreForOwner(user.uid);

          loadedStore.hasActiveSubscription = false;
          loadedStore.subscriptionStatus = 'expired';
        }

        setStoreInfo(loadedStore);
      } catch (error) {
        console.error('Error cargando la tienda:', error);

        if (isMounted) {
          setStoreInfo(null);
        }
      } finally {
        if (isMounted) {
          setLoadingStore(false);
        }
      }
    };

    loadStore();

    return () => {
      isMounted = false;
    };
  }, [user?.uid]);

  // La tabla subscriptions es la fuente canonica que actualiza el webhook de pago.
  const hasAdminAccess = subscriptionAccess.allowed;

  useEffect(() => {
    if (loadingStore || subscriptionAccess.loading) return;

    const isSubscriptionPage = location.pathname === '/admin/subscription';

    if (!hasAdminAccess && !isSubscriptionPage) {
      navigate('/admin/subscription', { replace: true });
    }
  }, [loadingStore, subscriptionAccess.loading, hasAdminAccess, location.pathname, navigate]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/admin/login');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const initials = useMemo(() => {
    return user?.email?.substring(0, 2).toUpperCase() || 'AD';
  }, [user?.email]);

  const openMyCatalog = () => {
    try {
      if (loadingStore) return;

      if (!storeInfo) {
        alert('No se encontró una tienda para este usuario.');
        return;
      }

      if (!storeInfo.slug) {
        alert('Tu tienda no tiene slug configurado.');
        return;
      }

      window.open(getCatalogSharePath(storeInfo.slug), '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error(err);
      alert('No se pudo abrir el catálogo.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden p-2 rounded-lg hover:bg-gray-100 text-gray-700"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir menú"
            >
              <i className="fa-solid fa-bars"></i>
            </button>

            <Link
              to={hasAdminAccess ? '/admin' : '/admin/subscription'}
              className="flex items-center gap-2"
            >
              <div className="bg-indigo-600 p-1.5 rounded-lg">
                <i className="fa-solid fa-layer-group text-white text-lg"></i>
              </div>
              <span className="text-xl font-bold text-gray-900 tracking-tight">
                Catalog<span className="text-indigo-600">SaaS</span>
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-6">
            <button
              onClick={openMyCatalog}
              disabled={loadingStore}
              className="hidden sm:flex items-center gap-2 text-sm text-gray-500 hover:text-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <i className="fa-solid fa-arrow-up-right-from-square text-xs"></i>
              Ver Catálogo
            </button>

            <div className="h-6 w-px bg-gray-200 hidden sm:block"></div>

            <div className="flex items-center gap-4">
              <div className="flex-col items-end hidden lg:flex">
                <p className="text-sm font-semibold text-gray-900 leading-none">
                  Administrador
                </p>
                <p className="text-xs text-gray-500 mt-1">{user?.email}</p>
              </div>

              <div className="group relative">
                <div className="h-9 w-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold border border-indigo-200 shadow-sm cursor-pointer">
                  {initials}
                </div>
              </div>

              <button
                onClick={handleLogout}
                className="text-gray-400 hover:text-red-600 p-2 rounded-lg hover:bg-red-50 transition-all"
                title="Cerrar sesión"
              >
                <i className="fa-solid fa-power-off"></i>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="hidden md:flex sticky top-16 h-[calc(100vh-64px)]">
          <Sidebar
            onNavigate={() => setMobileMenuOpen(false)}
            hasActiveSubscription={hasAdminAccess}
            hideSubscription={hideSubscriptionModule}
            restrictedModules={subscriptionAccess.restrictedModules}
            tokenIntroActive={subscriptionAccess.tokenIntroActive}
          />
        </aside>

        <main className="flex-1 overflow-x-hidden">
          <div className="p-6 md:p-8">
            <div className="max-w-6xl mx-auto">
              {loadingStore ? (
                <div className="bg-white rounded-2xl border p-8 text-center text-gray-500">
                  Cargando información de la tienda...
                </div>
              ) : (
                <Outlet />
              )}
            </div>
          </div>
        </main>
      </div>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Cerrar menú"
          />

          <div className="absolute left-0 top-0 h-full w-72 bg-white shadow-xl">
            <div className="h-16 flex items-center justify-between px-4 border-b border-gray-200">
              <span className="font-bold text-gray-900">Menú</span>
              <button
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-700"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Cerrar"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <Sidebar
              onNavigate={() => setMobileMenuOpen(false)}
              hasActiveSubscription={hasAdminAccess}
              hideSubscription={hideSubscriptionModule}
              restrictedModules={subscriptionAccess.restrictedModules}
              tokenIntroActive={subscriptionAccess.tokenIntroActive}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminLayout;
