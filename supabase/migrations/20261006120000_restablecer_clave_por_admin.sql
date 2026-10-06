-- Restablecer la clave de un usuario que la olvidó.
--
-- Las cuentas internas son "{cip}@moralydisciplina.local": no hay un correo real al
-- que mandar un enlace, así que "olvidé mi clave" no puede ser autoservicio. Lo hace
-- un administrador desde la web:
--   1. Se genera una clave temporal al azar (la devuelve la función para que el
--      administrador se la entregue en persona).
--   2. La cuenta queda en cambios_clave_pendientes con el hash de esa clave: no
--      tiene acceso a nada hasta que la cambie (ver cambio_clave_pendiente_en_servidor).
--   3. Se cierran sus sesiones abiertas.
--   4. Queda constancia en audit_log (sin la clave).
--
-- Límites a propósito:
--   - Solo un administrador con el token verificado en esta sesión (aal2).
--   - Solo cuentas aprobadas y con rol viewer: la de otro administrador se
--     restablece desde Supabase, para que un administrador no pueda tomar la
--     cuenta de otro. Las cuentas dadas de baja no se reviven.
--   - La propia cuenta se cambia con «Cambiar clave».
--   - El token (MFA) no se toca: quien lo tenga lo seguirá necesitando.

create or replace function public.restablecer_clave_usuario(p_cip text)
returns text
language plpgsql
security definer
set search_path to 'public', 'auth', 'extensions'
as $$
declare
  v_cip    text := btrim(coalesce(p_cip, ''));
  v_user   uuid;
  v_rol    text;
  v_estado text;
  v_letras constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- sin 0/O, 1/I/L
  v_bytes  bytea := extensions.gen_random_bytes(8);
  v_clave  text := '';
  v_hash   text;
  v_email  text;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede restablecer claves' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Ingrese el código de su token antes de restablecer claves' using errcode = '42501';
  end if;
  if v_cip !~ '^\d{4,10}$' then
    raise exception 'Escriba un CIP válido (solo números)' using errcode = '22023';
  end if;

  select u.id, p.role, p.estado into v_user, v_rol, v_estado
    from auth.users u
    join public.profiles p on p.id = u.id
   where lower(u.email) = v_cip || '@moralydisciplina.local';

  if v_user is null then
    raise exception 'No hay una cuenta con el CIP %', v_cip using errcode = 'P0002';
  end if;
  if v_user = auth.uid() then
    raise exception 'Para su propia cuenta use «Cambiar clave»' using errcode = '22023';
  end if;
  if v_rol = 'admin' then
    raise exception 'La clave de un administrador solo se restablece desde Supabase' using errcode = '42501';
  end if;
  if v_estado is distinct from 'aprobado' then
    raise exception 'La cuenta del CIP % no está aprobada', v_cip using errcode = '22023';
  end if;

  for i in 0..7 loop
    v_clave := v_clave || substr(v_letras, (get_byte(v_bytes, i) % length(v_letras)) + 1, 1);
    if i = 3 then v_clave := v_clave || '-'; end if;
  end loop;
  v_hash := extensions.crypt(v_clave, extensions.gen_salt('bf', 10));

  update auth.users set encrypted_password = v_hash, updated_at = now() where id = v_user;

  insert into public.cambios_clave_pendientes (user_id, hash_al_marcar)
  values (v_user, v_hash)
  on conflict (user_id) do update set hash_al_marcar = excluded.hash_al_marcar, marcado_at = now();

  delete from auth.sessions where user_id = v_user;  -- refresh_tokens caen en cascada

  select email into v_email from auth.users where id = auth.uid();
  insert into public.audit_log (table_name, record_id, action, changed_by, changed_by_email, new_data)
  values ('auth.users', v_user, 'UPDATE', auth.uid(), v_email,
          jsonb_build_object('evento', 'clave_restablecida', 'cip', v_cip));

  return v_clave;
end;
$$;

revoke all on function public.restablecer_clave_usuario(text) from public, anon;
grant execute on function public.restablecer_clave_usuario(text) to authenticated;
