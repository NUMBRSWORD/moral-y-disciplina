-- Cada persona ve solo su propia firma de políticas; el administrador ve todas.
-- La app Android ya consulta solo las propias (firmante_id=eq.<uid>), así que no cambia.
-- Es la misma regla que trae seguridad-mfa-aal2.sql, sin exigir todavía el token.
-- Reversión: using (public.esta_aprobado())
alter policy "firmas_documentos_select_authenticated"
  on public.firmas_documentos
  using ((firmante_id = (select auth.uid()) and public.esta_aprobado()) or public.es_admin());
