-- Aplicar después de aprobacion-de-cuentas.sql (con o sin seguridad-mfa-aal2.sql).
-- Esta excepción de incorporación solo permite a usuarios aprobados leer las políticas
-- y leer/registrar sus propias firmas antes de MFA. Los expedientes siguen exigiendo AAL2.
begin;

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
  using (
    (firmante_id = (select auth.uid()) and public.cuenta_aprobada_para_politicas())
    or public.es_admin()
  );

alter policy "cada quien firma solo por si mismo"
  on public.firmas_documentos
  with check (
    firmante_id = (select auth.uid()) and public.cuenta_aprobada_para_politicas()
  );

commit;
