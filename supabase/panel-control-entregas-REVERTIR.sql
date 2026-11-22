-- Revertir elimina las programaciones y reportes de esta función.
begin;
drop function if exists public.programar_entrega_panel(uuid,date);
drop function if exists public.reportar_entrega_panel(uuid);
drop table if exists public.control_entregas;
commit;
