create table public.efectivos (
  id uuid primary key default gen_random_uuid(),
  cip text not null unique,
  dni text not null unique,
  grado text,
  apellidos_nombres text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.efectivos enable row level security;

create policy "autenticados ven efectivos"
  on public.efectivos for select
  to authenticated
  using (true);

create policy "solo admin crea efectivos"
  on public.efectivos for insert
  to authenticated
  with check (es_admin());

create policy "solo admin edita efectivos"
  on public.efectivos for update
  to authenticated
  using (es_admin())
  with check (es_admin());

create policy "solo admin elimina efectivos"
  on public.efectivos for delete
  to authenticated
  using (es_admin());
