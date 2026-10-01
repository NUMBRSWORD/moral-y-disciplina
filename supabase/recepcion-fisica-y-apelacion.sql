-- Aplicar UNA VEZ en el SQL Editor del mismo Supabase usado por la web.
-- Requiere las migraciones anteriores de notas y seguridad-mfa-aal2.sql.
-- Aditiva: no modifica notas, archivos, recepciones antiguas ni firmas existentes.
-- No convierte recepciones históricas en verificaciones físicas retrospectivas.
begin;

do $$ begin
  if to_regprocedure('public.esta_aprobado()') is null
     or to_regprocedure('public.tiene_mfa_verificada()') is null then
    raise exception 'Aplicar primero las migraciones de aprobación y seguridad MFA.';
  end if;
end $$;

create table if not exists public.recepciones_fisicas (
  nota_id uuid primary key references public.notas_informativas(id) on delete cascade,
  recibido_at timestamptz not null default now(),
  recibido_por uuid not null references auth.users(id),
  conformidad_verificada boolean not null check (conformidad_verificada)
);
create index if not exists recepciones_fisicas_recibido_por_idx on public.recepciones_fisicas(recibido_por);
alter table public.recepciones_fisicas enable row level security;
revoke all on public.recepciones_fisicas from public, anon, authenticated;
grant select on public.recepciones_fisicas to authenticated;
drop policy if exists "consulta recepcion de nota autorizada" on public.recepciones_fisicas;
create policy "consulta recepcion de nota autorizada" on public.recepciones_fisicas
for select to authenticated using (
  (select public.esta_aprobado()) and (select public.tiene_mfa_verificada())
  and exists (select 1 from public.notas_informativas n where n.id = recepciones_fisicas.nota_id)
);

-- El estado digital anterior no basta: hace falta este acto explícito del admin.
-- La PK conserva la primera fecha ante doble toque, reintento o concurrencia.
create or replace function public.confirmar_recepcion_fisica(p_nota_id uuid, p_conforme boolean)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare n public.notas_informativas%rowtype; resultado jsonb;
begin
  if auth.uid() is null or not coalesce(public.esta_aprobado(), false)
     or not coalesce(public.tiene_mfa_verificada(), false)
     or not coalesce(public.es_admin(), false) then
    raise exception 'Solo Mesa de Partes puede confirmar la recepción física.' using errcode = '42501';
  end if;
  if p_conforme is distinct from true then
    raise exception 'Confirme la recepción del físico y la conformidad de la documentación.' using errcode = '22023';
  end if;
  select * into n from public.notas_informativas where id = p_nota_id for update;
  if not found or n.orden_sancion_generada_at is null or n.orden_notificada_at is null
     or nullif(btrim(n.archivo_orden_notificacion_path), '') is null then
    raise exception 'Primero debe subirse el expediente firmado.' using errcode = '22023';
  end if;
  insert into public.recepciones_fisicas(nota_id, recibido_por, conformidad_verificada)
    values(p_nota_id, auth.uid(), true) on conflict(nota_id) do nothing;
  select to_jsonb(r) into resultado from public.recepciones_fisicas r where nota_id = p_nota_id;
  return resultado;
end $$;
revoke all on function public.confirmar_recepcion_fisica(uuid,boolean) from public, anon;
grant execute on function public.confirmar_recepcion_fisica(uuid,boolean) to authenticated;

create table if not exists public.apelaciones_expediente (
  nota_id uuid primary key references public.notas_informativas(id) on delete cascade,
  presentada_at timestamptz not null default now(),
  presentada_por uuid not null references auth.users(id),
  fecha_notificacion date not null,
  archivo_path text not null,
  archivo_nombre text not null,
  estado text not null default 'presentada' check (estado = 'presentada')
);
create index if not exists apelaciones_expediente_presentada_por_idx on public.apelaciones_expediente(presentada_por);
alter table public.apelaciones_expediente enable row level security;
revoke all on public.apelaciones_expediente from public, anon, authenticated;
grant select on public.apelaciones_expediente to authenticated;
drop policy if exists "consulta apelacion de nota autorizada" on public.apelaciones_expediente;
create policy "consulta apelacion de nota autorizada" on public.apelaciones_expediente
for select to authenticated using (
  (select public.esta_aprobado()) and (select public.tiene_mfa_verificada())
  and exists (select 1 from public.notas_informativas n where n.id = apelaciones_expediente.nota_id)
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('apelaciones-expediente','apelaciones-expediente',false,20971520,array['application/pdf'])
on conflict(id) do nothing;
drop policy if exists "sube apelacion de nota autorizada" on storage.objects;
create policy "sube apelacion de nota autorizada" on storage.objects for insert to authenticated
with check (
  bucket_id = 'apelaciones-expediente'
  and (select public.esta_aprobado()) and (select public.tiene_mfa_verificada())
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists(select 1 from public.notas_informativas n
    where n.id::text = (storage.foldername(name))[2]
    and n.orden_sancion_generada_at is not null and n.archivo_leve_generada_at is null
    and n.codigo_infraccion ~* '^\s*L')
);
drop policy if exists "lee apelacion registrada autorizada" on storage.objects;
create policy "lee apelacion registrada autorizada" on storage.objects for select to authenticated
using (
  bucket_id = 'apelaciones-expediente'
  and (select public.esta_aprobado()) and (select public.tiene_mfa_verificada())
  and exists(select 1 from public.apelaciones_expediente a where a.archivo_path = name)
);
-- Sin UPDATE/DELETE: no se puede reemplazar o borrar un recurso ya registrado.
-- Cierre restrictivo del bucket nuevo: las políticas antiguas de storage son
-- permisivas (se combinan con OR). Una política amplia no debe saltar estas reglas.
-- Los demás buckets conservan exactamente sus permisos actuales.
drop policy if exists "apelaciones limite insert" on storage.objects;
create policy "apelaciones limite insert" on storage.objects as restrictive for insert to authenticated
with check (bucket_id <> 'apelaciones-expediente' or (
  (select public.esta_aprobado()) and (select public.tiene_mfa_verificada())
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists(select 1 from public.notas_informativas n
    where n.id::text = (storage.foldername(name))[2]
    and n.orden_sancion_generada_at is not null and n.archivo_leve_generada_at is null
    and n.codigo_infraccion ~* '^\s*L')
));
drop policy if exists "apelaciones limite select" on storage.objects;
create policy "apelaciones limite select" on storage.objects as restrictive for select to authenticated
using (bucket_id <> 'apelaciones-expediente' or (
  (select public.esta_aprobado()) and (select public.tiene_mfa_verificada())
  and exists(select 1 from public.apelaciones_expediente a where a.archivo_path = name)
));
drop policy if exists "apelaciones no reemplazables" on storage.objects;
create policy "apelaciones no reemplazables" on storage.objects as restrictive for update to authenticated
using (bucket_id <> 'apelaciones-expediente') with check (bucket_id <> 'apelaciones-expediente');
drop policy if exists "apelaciones no borrables" on storage.objects;
create policy "apelaciones no borrables" on storage.objects as restrictive for delete to authenticated
using (bucket_id <> 'apelaciones-expediente');
drop policy if exists "apelaciones no anonimas" on storage.objects;
create policy "apelaciones no anonimas" on storage.objects as restrictive for all to anon
using (bucket_id <> 'apelaciones-expediente') with check (bucket_id <> 'apelaciones-expediente');

create or replace function public.presentar_apelacion_expediente(
  p_nota_id uuid, p_fecha_notificacion date, p_archivo_path text, p_archivo_nombre text
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare n public.notas_informativas%rowtype; resultado jsonb; fecha date;
begin
  if auth.uid() is null or not coalesce(public.esta_aprobado(), false)
     or not coalesce(public.tiene_mfa_verificada(), false) then
    raise exception 'Se requiere una cuenta aprobada y token verificado.' using errcode = '42501';
  end if;
  select * into n from public.notas_informativas where id = p_nota_id for update;
  if not found or not (coalesce(public.es_admin(),false)
       or coalesce(n.oficial_constato_cip = public.cip_actual(),false)) then
    raise exception 'No autorizado para este expediente.' using errcode = '42501';
  end if;
  select to_jsonb(a) into resultado from public.apelaciones_expediente a where nota_id = p_nota_id;
  if resultado is not null then return resultado; end if;
  if n.orden_sancion_generada_at is null or n.archivo_leve_generada_at is not null
     or not coalesce(n.codigo_infraccion ~* '^\s*L',false) then
    raise exception 'Esta opción corresponde a una sanción por infracción leve.' using errcode = '22023';
  end if;
  fecha := coalesce((n.orden_notificada_at at time zone 'America/Lima')::date, p_fecha_notificacion);
  if fecha is null or fecha > (now() at time zone 'America/Lima')::date then
    raise exception 'Verifique la fecha de notificación de la sanción.' using errcode = '22023';
  end if;
  if p_archivo_path is null or p_archivo_path not like auth.uid()::text || '/' || p_nota_id::text || '/%'
     or nullif(btrim(p_archivo_nombre),'') is null or length(p_archivo_nombre) > 255
     or not exists(select 1 from storage.objects where bucket_id = 'apelaciones-expediente' and name = p_archivo_path) then
    raise exception 'Adjunte primero el PDF de la apelación correspondiente.' using errcode = '22023';
  end if;
  -- No denegar automáticamente por plazo: feriados, días inhábiles y admisibilidad
  -- corresponden a la autoridad. Nunca modificar el progreso ni la recepción aquí.
  insert into public.apelaciones_expediente(nota_id,presentada_por,fecha_notificacion,archivo_path,archivo_nombre)
    values(p_nota_id,auth.uid(),fecha,p_archivo_path,p_archivo_nombre);
  select to_jsonb(a) into resultado from public.apelaciones_expediente a where nota_id = p_nota_id;
  return resultado;
end $$;
revoke all on function public.presentar_apelacion_expediente(uuid,date,text,text) from public, anon;
grant execute on function public.presentar_apelacion_expediente(uuid,date,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
