-- Anotación libre para la reincorporación: casos como un descanso médico
-- expedido por Sanidad PNP (donde el efectivo no vuelve físicamente, pero
-- la ausencia queda justificada desde la fecha/hora de esta nota) necesitan
-- dejar constancia de esa circunstancia, no solo la fecha/hora/N.° de nota.
alter table public.notas_informativas
  add column if not exists reincorporacion_observacion text;
