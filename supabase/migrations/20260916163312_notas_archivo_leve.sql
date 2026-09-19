-- "Archivo del Procedimiento Administrativo Disciplinario por Infracción Leve"
-- (Anexo IV, Resolución IGPNP N° 29-2026-IGPNP/SEC-UNIPLA): cierra un caso
-- leve SIN sanción cuando, tras evaluar el descargo, la conducta no se
-- adecúa a ningún código del Anexo I. Contraparte de orden_sancion_generada_at.
alter table public.notas_informativas
  add column archivo_leve_generada_at timestamptz,
  add column archivo_leve_motivo text,
  add column archivo_leve_resolucion_numero text;

create or replace function public.registrar_archivo_leve(
  p_nota_id uuid,
  p_motivo text,
  p_resolucion_numero text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not (
    es_admin()
    or exists (
      select 1 from public.notas_informativas
      where id = p_nota_id and oficial_constato_cip = public.cip_actual()
    )
  ) then
    raise exception 'No autorizado para modificar esta nota.';
  end if;

  update public.notas_informativas
  set archivo_leve_motivo = p_motivo,
      archivo_leve_resolucion_numero = p_resolucion_numero,
      archivo_leve_generada_at = now()
  where id = p_nota_id;
end;
$function$;

revoke execute on function public.registrar_archivo_leve(uuid, text, text) from anon;
