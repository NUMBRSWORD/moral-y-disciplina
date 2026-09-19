-- Registro de cada "sigue faltando" reportado mientras una nota sigue abierta
-- (sin reincorporar): guarda fecha/N.º de nota/oficial de cada confirmación,
-- sin crear una nota nueva por cada día. Usado por el Informe Administrativo
-- para citar el N.º de nota real de cada día intermedio de ausencia, en vez
-- de solo el rol de servicio.
alter table public.notas_informativas
  add column seguimiento_faltas jsonb not null default '[]'::jsonb;
