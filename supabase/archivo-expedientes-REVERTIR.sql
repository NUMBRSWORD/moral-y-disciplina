-- Deshace archivo-expedientes.sql. Borra el registro del archivo (no los PDF del
-- bucket ni los folders físicos): exportar antes si ya hay casos archivados.
begin;
drop table if exists public.archivo_expedientes;
commit;
