import React, { useEffect, useMemo, useState } from 'react';
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
import { db } from '@/lib/supabase';
import { getStoreForOwner, invalidateStoreForOwner } from "@/lib/storeLookup";
import { useAuth } from '../../context/AuthContext';
import { useSubscriptionAccess } from '@/hooks/useSubscriptionAccess';

type FirestoreTimestampLike = {
    seconds?: number;
    nanoseconds?: number;
    toDate?: () => Date;
};

type StoreInfo = {
    id: string;
    name: string;
    slug: string;
    hasActiveSubscription: boolean;
    subscriptionStatus?: string | null;
    subscriptionEndAt?: string | number | Date | FirestoreTimestampLike | null;

    source?: string | null;

    hasFreeTrial?: boolean;
    freeTrialDays?: number;
    freeTrialStatus?: string | null;
    trialStartedAt?: string | number | Date | FirestoreTimestampLike | null;
    trialEndsAt?: string | number | Date | FirestoreTimestampLike | null;
    trialEndsAtMs?: number | null;
};

const LOCAL_GO_PAYMENT_URL = import.meta.env.VITE_LOCAL_GO_PAYMENT_URL || '';

const parseDate = (
    value?: string | number | Date | FirestoreTimestampLike | null
): Date | null => {
    if (!value) return null;

    if (value instanceof Date) {
        return isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        return isNaN(parsed.getTime()) ? null : parsed;
    }

    if (typeof value === 'object') {
        if (typeof value.toDate === 'function') {
            const parsed = value.toDate();
            return isNaN(parsed.getTime()) ? null : parsed;
        }

        if (typeof value.seconds === 'number') {
            const parsed = new Date(value.seconds * 1000);
            return isNaN(parsed.getTime()) ? null : parsed;
        }
    }

    return null;
};

const formatDate = (
    value?: string | number | Date | FirestoreTimestampLike | null
) => {
    const parsed = parseDate(value);
    if (!parsed) return 'No disponible';

    return new Intl.DateTimeFormat('es-CO', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
    }).format(parsed);
};

const getDaysRemaining = (
    value?: string | number | Date | FirestoreTimestampLike | null
) => {
    const parsed = parseDate(value);
    if (!parsed) return null;

    const now = new Date();
    const diffMs = parsed.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
};

const isTrialExpired = (store?: StoreInfo | null) => {
    if (!store?.hasFreeTrial) return false;

    if (typeof store.trialEndsAtMs === 'number') {
        return Date.now() > store.trialEndsAtMs;
    }

    const parsedTrialEnd = parseDate(store.trialEndsAt);
    if (!parsedTrialEnd) return false;

    return Date.now() > parsedTrialEnd.getTime();
};

const SubscriptionView: React.FC = () => {
    const { user } = useAuth();
    const subscriptionAccess = useSubscriptionAccess();

    const [storeInfo, setStoreInfo] = useState<StoreInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        let isMounted = true;

        const loadStore = async () => {
            try {
                if (!user?.uid) {
                    if (isMounted) {
                        setStoreInfo(null);
                        setLoading(false);
                    }
                    return;
                }

                const storeResult = await getStoreForOwner(user.uid);

                if (!isMounted) return;

                if (!storeResult) {
                    setStoreInfo(null);
                    setLoading(false);
                    return;
                }

                const data = storeResult.data;

                const loadedStore: StoreInfo = {
                    id: storeResult.id,
                    name: typeof data.name === 'string' ? data.name : '',
                    slug: typeof data.slug === 'string' ? data.slug : '',
                    hasActiveSubscription: data.hasActiveSubscription === true,
                    subscriptionStatus:
                        typeof data.subscriptionStatus === 'string'
                            ? data.subscriptionStatus
                            : null,
                    subscriptionEndAt: data.subscriptionEndAt ?? null,

                    source: typeof data.source === 'string' ? data.source : null,

                    hasFreeTrial: data.hasFreeTrial === true,
                    freeTrialDays:
                        typeof data.freeTrialDays === 'number'
                            ? data.freeTrialDays
                            : 0,
                    freeTrialStatus:
                        typeof data.freeTrialStatus === 'string'
                            ? data.freeTrialStatus
                            : null,
                    trialStartedAt: data.trialStartedAt ?? null,
                    trialEndsAt: data.trialEndsAt ?? null,
                    trialEndsAtMs:
                        typeof data.trialEndsAtMs === 'number'
                            ? data.trialEndsAtMs
                            : null,
                };

                loadedStore.hasActiveSubscription = subscriptionAccess.allowed;
                loadedStore.subscriptionStatus = subscriptionAccess.status;
                loadedStore.subscriptionEndAt = subscriptionAccess.endAt;
                loadedStore.hasFreeTrial = subscriptionAccess.status === 'trial';
                loadedStore.trialEndsAt = subscriptionAccess.status === 'trial' ? subscriptionAccess.endAt : null;
                loadedStore.trialEndsAtMs = loadedStore.trialEndsAt ? Date.parse(String(loadedStore.trialEndsAt)) : null;
                loadedStore.freeTrialStatus = subscriptionAccess.status === 'trial' && subscriptionAccess.allowed ? 'active' : null;

                const trialExpired = isTrialExpired(loadedStore);

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

                setStoreInfo(loadedStore);
            } catch (error) {
                console.error('Error cargando la suscripción:', error);
                if (isMounted) setStoreInfo(null);
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        loadStore();

        return () => {
            isMounted = false;
        };
    }, [user?.uid, subscriptionAccess.allowed, subscriptionAccess.status, subscriptionAccess.endAt]);

    const registeredEmail = user?.email || '';

    const isFreeTrialActive = useMemo(() => {
        if (!storeInfo?.hasFreeTrial) return false;
        if (storeInfo.freeTrialStatus !== 'active') return false;
        return !isTrialExpired(storeInfo);
    }, [storeInfo]);

    const trialDaysRemaining = useMemo(
        () => getDaysRemaining(storeInfo?.trialEndsAt),
        [storeInfo?.trialEndsAt]
    );

    const subscriptionDaysRemaining = useMemo(
        () => getDaysRemaining(storeInfo?.subscriptionEndAt),
        [storeInfo?.subscriptionEndAt]
    );

    const currentExpirationDate = useMemo(() => {
        if (isFreeTrialActive) return storeInfo?.trialEndsAt;
        return storeInfo?.subscriptionEndAt;
    }, [isFreeTrialActive, storeInfo?.trialEndsAt, storeInfo?.subscriptionEndAt]);

    const currentDaysRemaining = useMemo(() => {
        if (isFreeTrialActive) return trialDaysRemaining;
        return subscriptionDaysRemaining;
    }, [isFreeTrialActive, trialDaysRemaining, subscriptionDaysRemaining]);

    const statusConfig = useMemo(() => {
        if (!storeInfo) {
            return {
                badge: 'Sin datos',
                badgeClass: 'bg-gray-100 text-gray-700 border-gray-200',
                alertClass: 'bg-gray-50 border-gray-200 text-gray-700',
                title: 'No se encontró información de la tienda',
                message: 'Verifica que tu usuario tenga una tienda asociada.',
                icon: 'fa-circle-info',
            };
        }

        if (isFreeTrialActive) {
            if (trialDaysRemaining !== null && trialDaysRemaining <= 2) {
                return {
                    badge: 'Prueba por vencer',
                    badgeClass: 'bg-amber-100 text-amber-700 border-amber-200',
                    alertClass: 'bg-amber-50 border-amber-200 text-amber-700',
                    title: 'Tu prueba gratis está por vencer',
                    message: `Tu prueba gratis vence en ${trialDaysRemaining} día${trialDaysRemaining === 1 ? '' : 's'}. Puedes pagar ahora para evitar interrupciones.`,
                    icon: 'fa-clock',
                };
            }

            return {
                badge: 'Prueba gratis',
                badgeClass: 'bg-indigo-100 text-indigo-700 border-indigo-200',
                alertClass: 'bg-indigo-50 border-indigo-200 text-indigo-700',
                title: 'Prueba gratis activa',
                message:
                    trialDaysRemaining === null
                        ? 'Tu prueba gratis de 7 días está activa.'
                        : `Tu prueba gratis está activa. Te quedan ${trialDaysRemaining} día${trialDaysRemaining === 1 ? '' : 's'}.`,
                icon: 'fa-gift',
            };
        }

        if (
            storeInfo.hasFreeTrial &&
            (storeInfo.freeTrialStatus === 'expired' ||
                storeInfo.subscriptionStatus === 'trial_expired')
        ) {
            return {
                badge: 'Prueba vencida',
                badgeClass: 'bg-red-100 text-red-700 border-red-200',
                alertClass: 'bg-red-50 border-red-200 text-red-700',
                title: 'Tu prueba gratis terminó',
                message:
                    'Ya pasaron los 7 días gratis. Realiza el pago para activar tu suscripción y seguir usando el catálogo.',
                icon: 'fa-triangle-exclamation',
            };
        }

        if (!storeInfo.hasActiveSubscription) {
            return {
                badge: 'Inactiva',
                badgeClass: 'bg-gray-100 text-gray-700 border-gray-200',
                alertClass: 'bg-gray-50 border-gray-200 text-gray-700',
                title: 'Suscripción inactiva',
                message: 'No tienes una suscripción activa. Realiza el pago para activarla.',
                icon: 'fa-circle-info',
            };
        }

        if (!storeInfo.subscriptionEndAt) {
            return {
                badge: 'Activa',
                badgeClass: 'bg-green-100 text-green-700 border-green-200',
                alertClass: 'bg-green-50 border-green-200 text-green-700',
                title: 'Suscripción activa',
                message: 'Tu suscripción está activa.',
                icon: 'fa-circle-check',
            };
        }

        if (subscriptionDaysRemaining === null) {
            return {
                badge: 'Activa',
                badgeClass: 'bg-green-100 text-green-700 border-green-200',
                alertClass: 'bg-green-50 border-green-200 text-green-700',
                title: 'Suscripción activa',
                message: 'No se pudo calcular la fecha de vencimiento.',
                icon: 'fa-circle-check',
            };
        }

        if (subscriptionDaysRemaining < 0) {
            return {
                badge: 'Vencida',
                badgeClass: 'bg-red-100 text-red-700 border-red-200',
                alertClass: 'bg-red-50 border-red-200 text-red-700',
                title: 'Suscripción vencida',
                message: 'Tu suscripción ya expiró.',
                icon: 'fa-triangle-exclamation',
            };
        }

        if (subscriptionDaysRemaining <= 5) {
            return {
                badge: 'Por vencer',
                badgeClass: 'bg-amber-100 text-amber-700 border-amber-200',
                alertClass: 'bg-amber-50 border-amber-200 text-amber-700',
                title: 'Próxima a vencer',
                message: `Tu suscripción vence en ${subscriptionDaysRemaining} día${subscriptionDaysRemaining === 1 ? '' : 's'}.`,
                icon: 'fa-clock',
            };
        }

        return {
            badge: 'Activa',
            badgeClass: 'bg-green-100 text-green-700 border-green-200',
            alertClass: 'bg-green-50 border-green-200 text-green-700',
            title: 'Suscripción activa',
            message: `Te quedan ${subscriptionDaysRemaining} días de suscripción.`,
            icon: 'fa-circle-check',
        };
    }, [storeInfo, isFreeTrialActive, trialDaysRemaining, subscriptionDaysRemaining]);

    const handleCopyEmail = async () => {
        if (!registeredEmail) {
            alert('No se encontró el correo del usuario autenticado.');
            return;
        }

        try {
            await navigator.clipboard.writeText(registeredEmail);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            console.error(error);
            alert(`Correo registrado: ${registeredEmail}`);
        }
    };

    const handleOpenLocalGo = () => {
        if (!registeredEmail) {
            alert('No se encontró el correo del usuario autenticado.');
            return;
        }

        if (!LOCAL_GO_PAYMENT_URL) {
            alert('Falta configurar el enlace de pago de Local Go.');
            return;
        }
        window.open(LOCAL_GO_PAYMENT_URL, '_blank', 'noopener,noreferrer');
    };

    if (loading || subscriptionAccess.loading) {
        return (
            <div className="bg-white rounded-2xl border p-8 text-center text-gray-500">
                Cargando suscripción...
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-gray-900">Suscripción</h1>
                <p className="text-sm text-gray-500 mt-1">
                    Gestiona el pago mensual de tu plan y revisa el estado actual de tu suscripción.
                </p>
            </div>

            <div className="bg-white rounded-2xl border p-6">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Estado de tu suscripción</h2>
                        <p className="text-sm text-gray-500 mt-1">
                            Aquí puedes ver si tu plan está activo, en prueba gratis, por vencer o vencido.
                        </p>
                    </div>

                    <span
                        className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${statusConfig.badgeClass}`}
                    >
                        {statusConfig.badge}
                    </span>
                </div>

                <div className={`mt-6 rounded-xl border p-4 ${statusConfig.alertClass}`}>
                    <div className="flex items-start gap-3">
                        <i className={`fa-solid ${statusConfig.icon} mt-1`} />
                        <div>
                            <p className="font-bold">{statusConfig.title}</p>
                            <p className="text-sm mt-1">{statusConfig.message}</p>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                    <div className="rounded-xl border p-4">
                        <p className="text-xs uppercase tracking-wide text-gray-400">Tienda</p>
                        <p className="text-sm font-semibold text-gray-900 mt-2 break-words">
                            {storeInfo?.name || 'No disponible'}
                        </p>
                    </div>

                    <div className="rounded-xl border p-4">
                        <p className="text-xs uppercase tracking-wide text-gray-400">
                            {isFreeTrialActive ? 'Prueba gratis vence el' : 'Suscripción vence el'}
                        </p>
                        <p className="text-sm font-semibold text-gray-900 mt-2">
                            {formatDate(currentExpirationDate)}
                        </p>
                    </div>

                    <div className="rounded-xl border p-4">
                        <p className="text-xs uppercase tracking-wide text-gray-400">
                            Días restantes
                        </p>
                        <p className="text-sm font-semibold text-gray-900 mt-2">
                            {currentDaysRemaining === null
                                ? 'No disponible'
                                : currentDaysRemaining < 0
                                    ? '0'
                                    : currentDaysRemaining}
                        </p>
                    </div>
                </div>

                {storeInfo?.source ? (
                    <div className="mt-4 rounded-xl border p-4">
                        <p className="text-xs uppercase tracking-wide text-gray-400">Origen del registro</p>
                        <p className="text-sm font-semibold text-gray-900 mt-2">
                            {storeInfo.source === 'client' ? 'Cliente desde landing' : storeInfo.source}
                        </p>
                    </div>
                ) : null}
            </div>

            <div className="bg-white rounded-2xl border p-6">
                <h2 className="text-xl font-bold text-gray-900">Pago de suscripción</h2>
                <p className="text-sm text-gray-500 mt-1">
                    Antes de ir a pagar, copia el correo con el que registraste tu tienda y pégalo en la
                    pasarela externa de Local Go.
                </p>

                <div className="mt-5 rounded-xl border bg-gray-50 p-4">
                    <p className="text-xs uppercase tracking-wide text-gray-400">
                        Correo registrado en la tienda
                    </p>
                    <p className="text-lg font-bold text-gray-900 mt-2 break-all">
                        {registeredEmail || 'No disponible'}
                    </p>
                </div>

                <div className="mt-4 flex flex-col sm:flex-row gap-3">
                    <button
                        type="button"
                        onClick={handleCopyEmail}
                        className="px-4 py-3 rounded-xl border font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                        <i className="fa-regular fa-copy mr-2" />
                        {copied ? 'Correo copiado' : 'Copiar correo'}
                    </button>

                    <button
                        type="button"
                        onClick={handleOpenLocalGo}
                        className="px-4 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors"
                    >
                        <i className="fa-solid fa-arrow-up-right-from-square mr-2" />
                        Ir a pagar con Local Go
                    </button>
                </div>

                <div className="mt-6 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-800">
                    Al hacer clic en <b>Ir a pagar con Local Go</b> se abrirá una pasarela de pago externa.
                    Vas a salir temporalmente de nuestro sistema para completar el pago.
                </div>
            </div>
        </div>
    );
};

export default SubscriptionView;
