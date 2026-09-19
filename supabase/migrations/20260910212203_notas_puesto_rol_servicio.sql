-- Puesto/servicio que el investigado tenía asignado según el rol de servicio
-- del día de la falta. La IA lo extrae del rol que sube el admin; se usa en la
-- redacción de la Imputación y la Orden de Sanción ("...nombrado según el rol
-- de servicio ... en el servicio de <puesto>...").
alter table public.notas_informativas
  add column if not exists puesto_rol text;
