-- Envuelve auth.uid()/cip_actual() en subconsulta para que se evalúen una vez
-- por consulta y no por fila (advisor "auth_rls_initplan").
alter policy "usuario ve su propio perfil" on public.profiles
  using ((select auth.uid()) = id);

alter policy "usuario ve sus alertas moviles" on public.suscripciones_movil
  using (user_id = (select auth.uid()));
alter policy "usuario actualiza sus alertas moviles" on public.suscripciones_movil
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
alter policy "usuario elimina sus alertas moviles" on public.suscripciones_movil
  using (user_id = (select auth.uid()));
alter policy "usuario registra sus alertas moviles" on public.suscripciones_movil
  with check ((user_id = (select auth.uid())) and (cip = (select public.cip_actual())));
