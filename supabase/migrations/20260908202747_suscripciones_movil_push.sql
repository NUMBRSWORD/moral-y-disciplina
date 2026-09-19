-- Suscripciones Web Push por dispositivo, ancladas al CIP del usuario.
-- Las alertas se envian al oficial que constato la falta (el que tramita el
-- expediente), no al investigado; ese oficial ya ve el caso por RLS.
create table if not exists public.suscripciones_movil (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cip text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists suscripciones_movil_cip_idx on public.suscripciones_movil (cip);

alter table public.suscripciones_movil enable row level security;

drop policy if exists "usuario ve sus alertas moviles" on public.suscripciones_movil;
drop policy if exists "usuario registra sus alertas moviles" on public.suscripciones_movil;
drop policy if exists "usuario actualiza sus alertas moviles" on public.suscripciones_movil;
drop policy if exists "usuario elimina sus alertas moviles" on public.suscripciones_movil;

create policy "usuario ve sus alertas moviles"
  on public.suscripciones_movil for select to authenticated
  using (user_id = auth.uid());
create policy "usuario registra sus alertas moviles"
  on public.suscripciones_movil for insert to authenticated
  with check (user_id = auth.uid() and cip = public.cip_actual());
create policy "usuario actualiza sus alertas moviles"
  on public.suscripciones_movil for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "usuario elimina sus alertas moviles"
  on public.suscripciones_movil for delete to authenticated
  using (user_id = auth.uid());

-- Registro anti-duplicados para las alertas automaticas (paso posterior).
create table if not exists public.alertas_movil_enviadas (
  id uuid primary key default gen_random_uuid(),
  nota_id uuid not null references public.notas_informativas(id) on delete cascade,
  tipo text not null,
  clave_estado text not null,
  enviado_at timestamptz not null default now(),
  unique (nota_id, tipo, clave_estado)
);
alter table public.alertas_movil_enviadas enable row level security;
drop policy if exists "admin lee historial de alertas moviles" on public.alertas_movil_enviadas;
create policy "admin lee historial de alertas moviles"
  on public.alertas_movil_enviadas for select to authenticated
  using (public.es_admin());
