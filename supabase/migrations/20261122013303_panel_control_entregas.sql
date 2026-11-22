-- Control interno de entregas. La fecha es administrativa y la recepción la acredita Mesa de Partes.
begin;
create table public.control_entregas (
  nota_id uuid primary key references public.notas_informativas(id) on delete cascade,
  fecha_limite date,
  programada_por uuid references auth.users(id),
  reportada_at timestamptz,
  reportada_por uuid references auth.users(id),
  check ((reportada_at is null) = (reportada_por is null))
);
alter table public.control_entregas enable row level security;
revoke all on public.control_entregas from public, anon, authenticated;
grant select on public.control_entregas to authenticated;
create policy "consulta de entregas por responsable" on public.control_entregas for select to authenticated using (
  (select public.esta_aprobado()) and (select public.tiene_mfa_verificada()) and
  exists (select 1 from public.notas_informativas n where n.id=nota_id and
    ((select public.es_admin()) or n.oficial_constato_cip=(select public.cip_actual())))
);

create function public.programar_entrega_panel(p_nota uuid, p_fecha date) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(public.es_admin() and public.esta_aprobado() and public.tiene_mfa_verificada(), false) then
    raise exception 'Se requiere un administrador verificado.' using errcode='42501';
  end if;
  perform 1 from public.notas_informativas where id=p_nota and orden_sancion_generada_at is not null
    and archivo_leve_generada_at is null for update;
  if not found or p_fecha is null or exists(select 1 from public.recepciones_fisicas where nota_id=p_nota)
     or exists(select 1 from public.control_entregas where nota_id=p_nota and reportada_at is not null) then
    raise exception 'La entrega no admite programación.' using errcode='22023';
  end if;
  insert into public.control_entregas(nota_id,fecha_limite,programada_por) values(p_nota,p_fecha,auth.uid())
  on conflict(nota_id) do update set fecha_limite=excluded.fecha_limite,programada_por=excluded.programada_por;
end $$;

create function public.reportar_entrega_panel(p_nota uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(public.esta_aprobado() and public.tiene_mfa_verificada(), false) then
    raise exception 'Acceso no autorizado.' using errcode='42501';
  end if;
  perform 1 from public.notas_informativas where id=p_nota and oficial_constato_cip=public.cip_actual()
    and orden_sancion_generada_at is not null and archivo_leve_generada_at is null and orden_notificada_at is not null
    and nullif(btrim(archivo_orden_notificacion_path),'') is not null for update;
  if not found then raise exception 'Se requiere un expediente firmado a su cargo.' using errcode='42501'; end if;
  if exists(select 1 from public.recepciones_fisicas where nota_id=p_nota) then return; end if;
  insert into public.control_entregas(nota_id,reportada_at,reportada_por) values(p_nota,now(),auth.uid())
  on conflict(nota_id) do update set reportada_at=excluded.reportada_at,reportada_por=excluded.reportada_por
    where control_entregas.reportada_at is null;
end $$;
revoke all on function public.programar_entrega_panel(uuid,date),public.reportar_entrega_panel(uuid) from public,anon;
grant execute on function public.programar_entrega_panel(uuid,date),public.reportar_entrega_panel(uuid) to authenticated;
commit;
