-- La aplicación usa "amount" para los descuentos de valor fijo.
-- Algunas bases existentes crearon el enum antes de incluir este valor,
-- provocando: invalid input value for enum discount_type: "amount".
alter type public.discount_type add value if not exists 'amount';
