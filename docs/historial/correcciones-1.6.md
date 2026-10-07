# Faltos 1.6 — integración y verificación del 30/09/2026

## Cambios

- Fuente unificada: Android y la web actual, preservando carga en lote, remisiones y el aviso `documentos_por_recibir` de la rama combinado.
- Oficio: nombre y OA del firmante obligatorios, validación también dentro del generador, confirmación de vigencia antes de generar. Conserva los firmantes recordados por ambas versiones previas.
- Las listas se actualizan al volver a la aplicación y en vistas de consulta visibles; no se recargan formularios en edición. Carga paginada de notas, efectivos y remisiones.
- Reintento de lote sin duplicar expedientes ya guardados y bloqueo de doble envío.
- Corrección del siguiente paso: una orden o un expediente subido no vuelven a evaluación por ausencia de un campo anterior. La subida digital no se presenta como recepción física.
- Modos claro/oscuro y contención de contenido en pantallas estrechas, incluido Roles y el token inferior.
- APK release 1.6, código 7, firmado con el mismo certificado que el APK 1.5. No es una firma de depuración.
- Publicación por lista explícita de archivos: Android, SQL, pruebas y claves quedan fuera del sitio público.

## Comprobaciones

- `npm ci --ignore-scripts && npm test` ejecuta lógica web, avisos, base de datos PostgreSQL aislada, integración de lote y contrato web/Android. No requiere clonar otro repositorio ni una base de datos real.
- `npm run sync:web -- app/build/upstream-github --check` exige igualdad de los archivos compartidos. La publicación sigue en `NUMBRSWORD/moral-y-disciplina`; no cambia el enlace que abre la APK.
- Compilación release/QA, 8 pruebas unitarias y lint correctos.
- Instalación 1.5 → 1.6 en emulador mediante actualización, misma firma y mismo `firstInstallTime`, sin desinstalar.
- 36 comprobaciones de ancho: Panel, Efectivos, Seguimiento, Recepción, Roles y Expedientes en 320/768/1280 px, ambos temas, sin desbordamiento horizontal de página.
- Oficio comprobado en navegador: sin confirmación no permite generar; datos completos y confirmados habilitan el botón; borrar al firmante vuelve a bloquearlo.
- Instrumentación QA: 57 pruebas ejecutadas correctas; una comprobación de versión pública se omite antes del despliegue y se habilita después con `-e verificarPublicacion true` (58 casos en el ejecutor).
- Suite Node: 405 pruebas correctas en la fuente unificada. Se ejecuta también sobre el checkout web sincronizado.

APK: `descargas/faltos-1.6.apk`. Su hash está en `descargas/version.json` y se verifica con pruebas automáticas.
Certificado SHA-256: `8a3f0900d2598b3b6f0be61d6f3dde8ad1503751eb03bf1b2b3cd43e9b221d78`.

## Producción: avisos y datos reales

La publicación web/APK no despliega SQL ni Edge Functions. La revisión previa de `combinado` indica que ya se aplicaron las tablas de entregas y recepción y la función versión 9; debe confirmarse administrativamente antes de cambiar nada.

1. Conectar Supabase y verificar el proyecto `tndjulaitywtoocqeeiy`: tablas `dispositivos_android`, `entregas_android`, `recepciones_fisicas`, las funciones y políticas AAL2 correspondientes.
2. Verificar el código de `avisos-android`, incluido `documentos_por_recibir`, sus secretos y el estado real de dispositivos. No imprimir tokens ni credenciales.
3. Preparar en Vault `faltos_avisos_cron_secret` con el mismo valor del secreto de la función `AVISOS_CRON_SECRET`, sin incluirlo en archivos de Git.
4. Aplicar administrativamente `supabase/activar-avisos-programados.sql`. Programa una ejecución cada 15 minutos y reutiliza el mismo nombre para evitar duplicados. Se detiene si faltan tablas o el secreto. No cambia la programación anterior de Web Push. Basado en la [documentación oficial de Supabase](https://supabase.com/docs/guides/functions/schedule-functions).
5. Comprobar una entrega con una cuenta de prueba explícita y su teléfono. La aceptación de FCM no equivale a ver el aviso en el dispositivo.
6. Verificar web → APK, subida de PDF ficticio autorizado → web, recepción física → consulta y separación de expedientes entre cuentas. No realizar estas pruebas con expedientes personales sin autorización específica.

No afirmar que el servidor o las notificaciones reales están listos hasta completar estas comprobaciones. No desinstalar la app real para cambiar de firma; conservar el token y sus medios de recuperación.
