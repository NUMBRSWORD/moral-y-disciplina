# Integración pendiente de los avisos auditados

Estos archivos **no se han desplegado**. No sustituir esta comprobación por «compila correctamente».

## Para quien tiene acceso al repositorio web y a Supabase

1. Trabajar sobre una rama del repositorio `NUMBRSWORD/moral-y-disciplina`, preservando cambios ajenos. Revisar primero `git apply --check` sobre `upstream-patches/avisos-android-auditoria-2026-09-28.patch`; está preparado contra `5c5549d`.
2. Aplicar el parche y ejecutar `node --test tests/avisos-servidor.test.mjs` y `deno check --no-lock supabase/functions/avisos-android/index.ts`. No se requieren credenciales para esas pruebas.
3. Revisar en Supabase qué migraciones ya existen. Esta versión depende de `dispositivos_android`, `recepciones_fisicas`, `profiles`, `notas_informativas` y la nueva tabla/función de reserva. No inventar recepciones históricas a partir de descargos o subidas.
4. Aplicar únicamente la migración aditiva `20260928000100_avisos_android_entregas.sql`. No reemplazar a ciegas políticas globales: antes de una migración MFA completa verificar recuperación del administrador, cambio de clave obligatorio y acceso de usuarios pendientes.
5. Desplegar `avisos-android` conservando la configuración de autorización del proyecto y cron existentes. Reutilizar los secretos `FCM_CUENTA_SERVICIO` y `AVISOS_CRON_SECRET` desde su almacén seguro; nunca imprimirlos, pegarlos en el chat, incorporarlos al APK o al parche.
6. Probar primero `comprobar:true`: autentica la credencial y consulta cantidad de dispositivos, sin enviar mensajes. Un fallo de tabla/permisos debe detener la puesta en marcha.
7. Instalar el APK corregido en un teléfono de prueba autorizado y registrar sus avisos. La prueba de envío requiere `probarEnvio:true` y `usuarioPrueba` con el UUID de esa cuenta aprobada. No acepta «el último usuario» como destinatario implícito. El texto recibido es de prueba, no de caso nuevo. Las versiones antiguas ignoran este tipo nuevo.
8. Revisar los avisos que se generarían antes de reactivar el cron. La tabla nueva empieza sin marcas históricas; las recepciones reales previas podrían producir avisos iniciales. Definir y verificar el corte inicial con el responsable, sin fabricar registros de recepción ni marcar mensajes como enviados si no lo fueron.
9. Confirmar recepción física, caso nuevo, revisión de plazo y pendientes con datos de prueba. Comprobar que un descargo **no** anuncia recepción física; una cuenta ajena/no aprobada no recibe; dos ejecuciones concurrentes no reservan la misma entrega; un error de FCM permite reintento sin borrar un token válido.
10. Documentar versión desplegada, migraciones efectivas y resultados. «Aceptado por FCM» no significa «visto en el teléfono». Si una verificación falla, detener el despliegue de avisos; no volver a la función antigua que confunde el descargo con la recepción física.

Los avisos de plazo solo invitan a revisar el expediente. El cálculo de fin de semana no contempla feriados ni sustituye plazos/notificaciones oficiales.
