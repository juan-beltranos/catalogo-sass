-- Permite que el catálogo decida si debe renderizar las funciones mensuales.
-- La función solo devuelve un booleano y no expone datos de la suscripción.
grant execute on function public.has_paid_monthly_access(uuid) to anon, authenticated;
