-- Respaldo institucional en Google Drive (OAuth del administrador).
-- Los tokens NO se pueden leer desde el navegador: solo las Edge Functions
-- con SUPABASE_SERVICE_ROLE_KEY los usan (tablas sin ninguna politica RLS).
create table if not exists public.google_drive_conexion (
  id boolean primary key default true check (id),
  cuenta_google text,
  refresh_token text not null,
  access_token text,
  access_token_expira_at timestamptz,
  carpeta_raiz_id text,
  conectado_por uuid references auth.users(id),
  conectado_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.google_drive_conexion enable row level security;

create table if not exists public.google_drive_oauth_estados (
  estado text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  creado_at timestamptz not null default now(),
  expira_at timestamptz not null
);
alter table public.google_drive_oauth_estados enable row level security;

create or replace function public.estado_respaldo_drive()
returns table (conectado boolean, cuenta_google text, conectado_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select
    public.es_admin() and exists (select 1 from public.google_drive_conexion where id = true),
    case when public.es_admin() then (select cuenta_google from public.google_drive_conexion where id = true) end,
    case when public.es_admin() then (select conectado_at from public.google_drive_conexion where id = true) end;
$$;
grant execute on function public.estado_respaldo_drive() to authenticated;

alter table public.expedientes_remitidos
  add column if not exists drive_expediente_file_id text,
  add column if not exists drive_expediente_url text,
  add column if not exists drive_ht_file_id text,
  add column if not exists drive_ht_url text,
  add column if not exists drive_oficio_file_id text,
  add column if not exists drive_oficio_url text,
  add column if not exists drive_sync_at timestamptz,
  add column if not exists drive_error text;
