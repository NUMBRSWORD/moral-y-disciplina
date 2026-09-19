-- Protección de datos personales (Ley N° 29733): el padrón completo de
-- efectivos (con DNI/CIP de todo el personal) solo lo ve el administrador.
-- Un oficial no-admin solo ve SU propia ficha, que es la única que necesita
-- para generar los documentos de sus casos (el sello del oficial que constató;
-- los datos del investigado salen de la propia nota, no del padrón).
drop policy if exists "autenticados ven efectivos" on public.efectivos;

create policy "admin ve el padron, el oficial solo su ficha" on public.efectivos
for select to authenticated
using ( public.es_admin() or cip = public.cip_actual() );
