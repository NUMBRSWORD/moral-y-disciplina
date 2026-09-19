-- Columna que fija, al crear la nota, el CIP del oficial que consta como
-- "oficial_constato" (resuelto con el mismo emparejamiento difuso que ya usa
-- la app en buscarOficialConstato). Es la base para que RLS pueda decidir,
-- en el servidor, quién puede ver cada nota -- hasta ahora esa decisión
-- solo la tomaba el navegador (loadNotas filtrando en JS), lo cual no
-- impedía leer todo directo desde la API.
alter table public.notas_informativas
  add column if not exists oficial_constato_cip text;

-- [Omitido en este archivo] La migración original incluía aquí un backfill de
-- las notas existentes: una lista fija "id de nota -> CIP del oficial" con
-- datos reales de personal. No se versiona porque este repositorio es público.
-- En una base nueva no hace falta: las notas se crean ya con
-- oficial_constato_cip.

-- CIP del usuario autenticado, derivado de su correo de login
-- ("{cip}@moralydisciplina.local"), para usar en las políticas de RLS.
create or replace function public.cip_actual()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select split_part(email, '@', 1) from auth.users where id = auth.uid();
$$;

drop policy if exists "autenticados ven notas" on public.notas_informativas;
create policy "ve notas propias o es admin"
  on public.notas_informativas for select
  to authenticated
  using (es_admin() or oficial_constato_cip = public.cip_actual());

drop policy if exists "autenticados ven expedientes" on public.expedientes;
create policy "ve expedientes de sus propias notas o es admin"
  on public.expedientes for select
  to authenticated
  using (
    es_admin()
    or exists (
      select 1 from public.notas_informativas n
      where n.id = expedientes.nota_id
        and n.oficial_constato_cip = public.cip_actual()
    )
  );
