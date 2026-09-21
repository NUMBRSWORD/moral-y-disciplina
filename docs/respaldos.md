# Respaldos y recuperación

## Situación (auditoría del 21-sep-2026)
- La base de datos vive en Supabase. Según `docs/auditoria-y-cumplimiento.md`, la organización está en el
  **plan Free**: no incluye copias automáticas ni restauración a un punto en el tiempo, y pausa el proyecto
  tras una semana sin actividad.
- Hoy existe: copia de **archivos** de expedientes cerrados en Google Drive, y una copia manual en JSON desde
  Ajustes. **No hay una copia programada de las tablas** (notas, sanciones, historial).
- La titularidad de Supabase, GitHub y Google es de cuentas personales: si esa persona no está, el sistema
  no tiene dueño que recupere el acceso (ver `docs/recuperacion-de-acceso.md`).

## Opciones (de menor a mayor esfuerzo)
1. **Subir a plan Pro:** copias diarias durante 7 días, sin pausa por inactividad y con la protección de
   "leaked password protection". Es la opción más simple.
2. **Copia programada de la base** desde una PC institucional con `pg_dump` (PostgreSQL), guardada en un
   disco o carpeta institucional y otra copia fuera de la unidad:
   ```
   pg_dump "postgresql://postgres:[CLAVE]@db.tndjulaitywtoocqeeiy.supabase.co:5432/postgres" --schema=public --no-owner -Fc -f respaldo-AAAA-MM-DD.dump
   ```
   La cadena de conexión y la clave de la base están en Supabase → Project Settings → Database. **No guardar
   la clave en el repositorio ni en archivos compartidos.** Programarlo con el Programador de tareas de
   Windows (semanal como mínimo) y guardar al menos 8 copias.
3. **Copia manual** desde Ajustes → respaldo JSON, cada semana, hasta implementar la 1 o la 2.

## Prueba de restauración (cada 3 meses)
Restaurar la última copia en un proyecto de prueba (`pg_restore`), comprobar cuántas notas, efectivos y filas de
historial trae y dejar el resultado anotado. Una copia que nunca se probó no es una copia.

## Qué NO cubre ninguna copia
Las claves de los usuarios (viven en Auth) y los secretos de las funciones (Anthropic, Google). Tenga a mano,
guardados de forma segura, cómo volver a generarlos.
