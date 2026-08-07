-- Conserva en el cliente todas las respuestas del formulario administrable.
alter table public.clients
  add column if not exists custom_fields jsonb not null default '[]'::jsonb;
