-- Documentos institucionales firmables (políticas) y sus firmas electrónicas simples.
create table public.documentos_institucionales (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  titulo text not null,
  contenido text not null,
  version integer not null default 1,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.firmas_documentos (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.documentos_institucionales(id) on delete cascade,
  documento_version integer not null,
  firmante_id uuid not null references auth.users(id) on delete cascade,
  firmante_nombre text not null,
  firmante_grado text,
  firmante_cargo text not null,
  firmado_at timestamptz not null default now(),
  unique (documento_id, documento_version, firmante_id)
);

create index ix_firmas_documentos_documento on public.firmas_documentos(documento_id);
create index ix_firmas_documentos_firmante on public.firmas_documentos(firmante_id);

alter table public.documentos_institucionales enable row level security;
alter table public.firmas_documentos enable row level security;

create policy "documentos_institucionales_select_authenticated" on public.documentos_institucionales
  for select to authenticated using (true);
create policy "solo admin crea documentos institucionales" on public.documentos_institucionales
  for insert to authenticated with check (es_admin());
create policy "solo admin edita documentos institucionales" on public.documentos_institucionales
  for update to authenticated using (es_admin()) with check (es_admin());
create policy "solo admin elimina documentos institucionales" on public.documentos_institucionales
  for delete to authenticated using (es_admin());

create policy "firmas_documentos_select_authenticated" on public.firmas_documentos
  for select to authenticated using (true);
create policy "cada quien firma solo por si mismo" on public.firmas_documentos
  for insert to authenticated with check (firmante_id = (select auth.uid()));

create trigger audit_documentos_institucionales
  after insert or update or delete on public.documentos_institucionales
  for each row execute function public.fn_audit_log();

-- (El original fijaba updated_by al UUID de la cuenta administradora; aquí se
-- deja en null porque este repositorio es público.)
insert into public.documentos_institucionales (slug, titulo, contenido, updated_by) values
('politica-datos-personales', 'Política de datos personales y retención', 'CPNP Ventanilla — Módulo Moral y Disciplina (infracciones leves)

1. Datos tratados. Nombres, grado, CIP, DNI, unidad, y datos del procedimiento disciplinario (notas informativas, descargos, órdenes de sanción) del personal PNP de la comisaría.

2. Finalidad. Gestión del procedimiento disciplinario por infracciones leves conforme a la Ley N.° 30714 y su reglamento.

3. Base legal. Ejercicio de la función disciplinaria de la PNP.

4. Acceso.
- Administrador (jefe de la unidad o quien designe): acceso total.
- Oficial instructor: solo los expedientes donde figura como oficial que constató la falta.
- El padrón de personal (nombres, grado, CIP, DNI de todos) solo es accesible para los usuarios con rol administrador. Un oficial no-admin solo ve su propia ficha y sus propios expedientes.

5. Conservación. [Pendiente de definir por el administrador: plazo sugerido = prescripción del régimen disciplinario + 1 año. Editar este documento con el plazo definitivo antes de firmarlo.] Vencido el plazo, los expedientes se anonimizan o eliminan.

6. Respaldo. Supabase (base de datos y archivos) + copia en Google Drive de la cuenta institucional. Copia manual en JSON disponible desde Ajustes.', null),
('politica-ia', 'Política institucional de uso de Inteligencia Artificial', 'CPNP Ventanilla — Módulo Moral y Disciplina

1. Alcance. Esta política cubre toda función de Inteligencia Artificial usada en el módulo Moral y Disciplina: redacción de análisis, revisión de consistencia, extracción de datos de documentos (notas, roles de servicio), resúmenes ejecutivos y el asistente de consulta.

2. Principios. Se adoptan los del artículo 7 del Reglamento de la Ley N.° 31814: no discriminación, privacidad, protección de derechos fundamentales, seguridad y proporcionalidad, transparencia, rendición de cuentas, supervisión humana.

3. Regla de supervisión humana. Ninguna función de IA de este módulo produce un documento, guarda un dato o notifica a alguien sin que un funcionario autorizado lo revise y confirme explícitamente antes. Ningún resultado de IA se guarda ni se envía automáticamente.

4. Datos. Se aplica lo establecido en la Política de datos personales: el padrón completo del personal solo lo ve el administrador; a las funciones de IA no se les envía más dato del necesario para la tarea puntual.

5. Revisión periódica. Este documento y el inventario de funciones de IA se revisan al menos una vez cada 12 meses, o al agregar una función de IA nueva al sistema.', null);
