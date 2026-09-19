# Migraciones de Supabase

Historial del esquema, exportado de `supabase_migrations.schema_migrations` del
proyecto. Antes de esto **nada del backend estaba en git**: las políticas RLS,
los RPC y las tablas solo existían dentro de Supabase.

> Esta carpeta es un **respaldo legible y revisable**, no una fuente verificada
> byte a byte. Antes de reconstruir una base desde aquí, compárala con la real.

## Qué NO está aquí (a propósito)

Este repositorio es público, así que se dejaron fuera o se recortaron migraciones
con datos sensibles:

| Migración original | Qué se hizo |
|---|---|
| `20260813190332_crea_cuentas_oficiales` | **Omitida.** Creaba las cuentas de acceso de cada oficial. |
| `20260813191328_cambia_login_admin_a_cip` | **Omitida.** Ajustaba la cuenta administradora. |
| `20260815161316_rls_notas_por_cip_del_oficial` | **Recortada.** Se quitó el *backfill* "id de nota → CIP de un oficial". |
| `20260908205538_cron_alertas_automaticas_0800` | **Con marcadores.** Traía el secreto del cron en texto claro; ver el comentario del archivo. |
| `20260914144800_firmas_documentos_institucionales` | **Recortada.** `updated_by` va en `null` (era el UUID de la cuenta administradora). |
| `20260814210742_crear_esquema_imputacion_pnp`, `20260814211109_bucket_casos_imputacion_pnp`, `20260814214740_copiar_efectivos_a_imputacion_pnp`, `20260814221658_agregar_columnas_acta_y_sancion`, `20260815005333_agregar_columnas_notificacion_orden` | **Omitidas.** Pertenecen a la otra app que comparte el proyecto (`notificaciones-pnp`, esquema `imputacion_pnp`). |

Nunca subas aquí contraseñas, secretos, claves de servicio ni listas de personal.
