-- Ejecutar después de publicar la app. Incluye la excepción de lectura/firma previa.
-- Las políticas se leen y firman antes del token; los datos operativos exigen MFA.
-- Convierte el segundo factor en una regla de servidor:
-- una interfaz modificada o una llamada REST directa con una sesión AAL1 ya no basta.

begin;

-- Compatibilidad con la auditoría web del 21/09/2026: aplicar MFA no debe
-- eliminar el bloqueo del servidor para una cuenta con clave pendiente.
create or replace function public.clave_actualizada_para_operar()
returns boolean language plpgsql stable security definer set search_path to 'public'
as $$
declare pendiente boolean;
begin
  if to_regprocedure('public.necesita_cambiar_clave()') is null then return true; end if;
  execute 'select public.necesita_cambiar_clave()' into pendiente;
  return pendiente is false;
end;
$$;
revoke execute on function public.clave_actualizada_para_operar() from public, anon;
grant execute on function public.clave_actualizada_para_operar() to authenticated;

create or replace function public.tiene_mfa_verificada()
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

revoke execute on function public.tiene_mfa_verificada() from public, anon;
grant execute on function public.tiene_mfa_verificada() to authenticated;

create or replace function public.esta_aprobado()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.tiene_mfa_verificada()
     and public.clave_actualizada_para_operar()
     and exists (
       select 1 from public.profiles
       where id = auth.uid() and estado = 'aprobado'
     );
$$;

revoke execute on function public.esta_aprobado() from public, anon;
grant execute on function public.esta_aprobado() to authenticated;

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.tiene_mfa_verificada()
     and public.clave_actualizada_para_operar()
     and exists (
       select 1 from public.profiles
       where id = auth.uid() and role = 'admin' and estado = 'aprobado'
     );
$$;

revoke execute on function public.es_admin() from public, anon;
grant execute on function public.es_admin() to authenticated;

create or replace function public.cip_actual()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when not public.tiene_mfa_verificada() then null
    when not public.clave_actualizada_para_operar() then null
    when p.estado <> 'aprobado' then null
    when p.cip is not null then p.cip
    when u.email_confirmed_at is not null
     and lower(split_part(u.email, '@', 2)) = 'moralydisciplina.local'
      then split_part(u.email, '@', 1)
    else null
  end
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.id = auth.uid();
$$;

revoke execute on function public.cip_actual() from public, anon;
grant execute on function public.cip_actual() to authenticated;

-- Incorporación previa al token: solo políticas publicadas y firmas propias.
create or replace function public.cuenta_aprobada_para_politicas()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and estado = 'aprobado'
  );
$$;
revoke execute on function public.cuenta_aprobada_para_politicas() from public, anon;
grant execute on function public.cuenta_aprobada_para_politicas() to authenticated;

alter policy "documentos_institucionales_select_authenticated"
  on public.documentos_institucionales
  using (public.cuenta_aprobada_para_politicas());
alter policy "firmas_documentos_select_authenticated"
  on public.firmas_documentos
  using ((firmante_id = (select auth.uid()) and public.cuenta_aprobada_para_politicas())
    or public.es_admin());
alter policy "cada quien firma solo por si mismo"
  on public.firmas_documentos
  with check (firmante_id = (select auth.uid()) and public.cuenta_aprobada_para_politicas());

commit;

-- Las Edge Functions también deben rechazar explícitamente sesiones cuyo JWT no tenga
-- aal=aal2 y cuentas para las que public.esta_aprobado() sea false. RLS no protege por sí
-- sola llamadas que usan service_role dentro de una función.
