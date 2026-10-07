# Auditoría 2026-10-01 (solo lectura sobre Supabase; no se modificó nada en producción)

## Verificado y correcto
- Migraciones `avisos_android_entregas` y `recepcion_fisica_y_apelacion` aplicadas; función `avisos-android` desplegada (v9) con cron diario 08:05 Lima activo.
- RLS activo en las 25 tablas de `public`; políticas por rol/CIP coherentes. Tablas de recepción/apelación y su almacenamiento sí exigen aprobado + MFA.
- Secretos de FCM/servicio solo en variables de entorno; `avisos-android` exige cabecera secreta. No hay claves privadas en el repositorio (la clave `anon` es pública por diseño).
- App: WebView limita la navegación a `numbrsword.github.io/moral-y-disciplina/`, sin acceso a archivos ni contenido mixto; token y recuperación con `FLAG_SECURE`; sin `Log`; `allowBackup=false`; actividades internas no exportadas.
- Pruebas locales: avisos 7/7, entregas 6, MFA 6, recepción 10 (tras corregir la prueba de fecha UTC vs Lima).

## Hallazgos
1. **ALTO – MFA no se exige en el servidor.** En producción `es_admin()` y `esta_aprobado()` no comprueban `aal2` (`seguridad-mfa-aal2.sql` no está aplicada). Solo 1 de 13 cuentas (2 admin, 11 viewer) tiene token verificado: aplicarla hoy bloquearía a las demás. Plan: que cada cuenta active su token y luego aplicar el script.
2. **MEDIO – Permisos excesivos en tablas.** `anon` y `authenticated` tienen todos los privilegios (incl. TRUNCATE) sobre ~16 tablas; solo RLS protege. Recomendado `revoke` de lo que no se usa, empezando por `anon`.
3. **MEDIO – Protección de contraseñas filtradas desactivada** en Supabase Auth.
4. **BAJO** – `pg_net` en esquema `public`; `imputacion_pnp.set_updated_at` sin `search_path`; `imputacion_pnp.es_admin()`/`handle_new_user()` ejecutables por `anon`; comparación del secreto cron con `!==` (no constante); 9 tablas con RLS sin políticas (intencional, solo funciones SECURITY DEFINER).
5. **INFO** – `dispositivos_android` y `entregas_android` tienen 0 filas: ningún teléfono ha registrado avisos aún. Falta `app/google-services.json` en builds locales.

## No verificado
- Compilación/lint/pruebas Android (sin SDK; descarga bloqueada). Cámara, escáner, avisos en teléfono real. Cumplimiento legal de retención de datos.

## Actualización (misma fecha, sobre `main` con Faltos 1.6)
- `npm test`: **405/405** pruebas correctas (web, lógica, PostgreSQL aislado, avisos, contrato).
- Primer teléfono registrado en `dispositivos_android` (1). Tokens verificados: 2 de 13 cuentas.
- Cron `avisos-android-0805` activo; la clave del cron fue rotada (commit `b9b10fb`).
- Web: los datos dinámicos que se insertan con `innerHTML` pasan por `escapeHtml`; no se encontró inyección. No hay Content-Security-Policy.
- Rendimiento: sin problemas al volumen actual (175 notas); solo avisos informativos de índices.
- Sigue pendiente el hallazgo ALTO (MFA en servidor): aplicarlo cuando las 13 cuentas tengan token.

## Correcciones aplicadas en producción (01/10/2026)
Migración `20261001120000_endurece_permisos_auditoria` (reversión: `supabase/endurece-permisos-REVERTIR.sql`):
- `anon` sin ningún permiso sobre tablas de `public` (antes: todos, incluido TRUNCATE en 16 tablas).
- `authenticated` sin TRUNCATE/REFERENCES/TRIGGER (no los usa la API; TRUNCATE no respeta RLS).
- `imputacion_pnp.es_admin()` y `handle_new_user()` ya no ejecutables sin sesión; `set_updated_at` con `search_path` fijo.
- Índices en 3 llaves foráneas de `public`.

Verificación antes/después como administrador real: 175 notas, 153 efectivos, 13 perfiles, 115 documentos, 4 firmas — idéntico. Usuario viewer: sigue viendo solo su perfil y sus 42 notas. `npm test`: 405/405.

## Lo que no se puede corregir desde aquí
- Protección de contraseñas filtradas: interruptor en el panel de Supabase (Auth).
- `pg_net` en `public`: la extensión no admite cambiar de esquema; solo reinstalándola, con riesgo para los cron.
- MFA obligatoria en servidor: esperar a que las 13 cuentas tengan token (hoy 2) y aplicar `seguridad-mfa-aal2.sql`. Comprobado: una cuenta viewer con sesión AAL1 aún lee sus notas.

## Cambios de la web para iPhone y celulares (01/10/2026)
- Pestaña **Cumplimiento** solo para administradores.
- **Políticas al entrar** en la web: igual que Android, no se continúa sin firmar todas en su versión vigente; un fallo de carga no cuenta como conformidad.
- **Inicio sencillo** para usuarios en celular (pantalla ≤ 700 px): «Pasos pendientes» y «Subir expediente», como la app Android.
- **Activar token desde la web** con QR (Google/Microsoft Authenticator o Contraseñas de iPhone) y 8 códigos de recuperación; en la pantalla del token, opción «Perdí mi celular» con código de recuperación.
- Dentro de la app Android (`window.__faltosConfig`) nada de lo anterior se muestra: Android mantiene sus pantallas nativas.
- Servidor (migración `20261001130000_firmas_solo_propias`): cada usuario ve solo su propia firma; el administrador ve todas. Verificado: admin 4 firmas, usuario 0 ajenas, firma propia visible tras firmar.
- Cuentas dadas de baja: CIP 363060 y 375949 (rechazadas y con inicio de sesión bloqueado; sus notas se conservan).
- Pruebas: `npm test` 405/405 y prueba en navegador (Chromium, 390 px) con Supabase simulado: 27/27.
- Pendiente: sincronizar estos archivos al repositorio publicado `moral-y-disciplina` (`npm run sync:web`).
