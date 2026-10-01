# Avisos Android: estado y puesta en marcha

El proyecto Firebase `faltos-notificaciones` tiene registradas las variantes
`com.hidalgoferrai.faltos` y `com.hidalgoferrai.faltos.qa`. El cliente Android
compila sin Firebase configurado, pero en ese caso **no registra ni recibe avisos**.

1. Descargar `google-services.json` de Configuración del proyecto > General en
   Firebase y guardarlo como `app/google-services.json`. Comprobar que el arreglo
   `client` contiene las dos variantes. Este archivo está ignorado por Git.
2. Revisar y ejecutar `supabase/notificaciones-android.sql` en el proyecto
   Supabase que usa la web. La migración crea el registro privado de dispositivos;
   todavía no envía mensajes.
3. Crear una cuenta de servicio de Google Cloud dedicada exclusivamente a FCM,
   con el rol mínimo `Firebase Cloud Messaging API Admin`. Guardar su clave JSON
   en secretos de Edge Functions de Supabase; jamás en el APK, en Git o en un
   archivo público. Confirmar que la API FCM HTTP v1 está habilitada.
### Nota de auditoría del 28/09/2026

La sección siguiente es un registro histórico, no una verificación actual de producción. Firebase ya está configurado en esta copia y la prueba QA obtuvo un token real. La auditoría encontró fallos en la fuente del servidor; las correcciones y la migración de reserva de entregas están preparadas, **sin desplegar**. Ver `AUDITORIA-2026-09-28.md` y `docs/despliegue-auditoria-2026-09-28.md`. El payload auditado añade `aviso_id` opaco para deduplicación y el tipo explícito `prueba`.

### Estado histórico al 27/09/2026

- **Paso 2 hecho.** Aplicado en el proyecto `tndjulaitywtoocqeeiy` como migración
  `registro_de_dispositivos_android`. Comprobado: la tabla tiene RLS activa, cero
  políticas y ningún permiso directo para `anon` ni `authenticated`; las dos
  funciones solo las puede ejecutar `authenticated`.
  El archivo exigía `tiene_mfa_verificada()`, que vive en `seguridad-mfa-aal2.sql`.
  Ese archivo **no se aplicó entero a propósito**: redefine `esta_aprobado()` para
  exigir token y dejaría fuera a las cuentas que aún no lo activaron. Se creó solo
  la función auxiliar, que lee una marca del token de sesión y no cambia ninguna
  política existente.
- **Paso 4 hecho, sin poder enviar todavía.** Función `avisos-android` desplegada
  (fuente en el repositorio de la web, `supabase/functions/avisos-android/`).
  Comprobado en vivo: sin sesión responde 401 y con la clave pública pero sin los
  secretos responde 503 con el mensaje esperado. **No enviará nada hasta que
  existan los secretos.**
- **Pasos 1, 3 y 5 pendientes**: requieren la consola de Firebase, que no es
  accesible desde aquí.

### Secretos que faltan (Supabase → Edge Functions → Secrets)

| Secreto | Contenido |
|---|---|
| `FCM_CUENTA_SERVICIO` | El JSON completo de la cuenta de servicio dedicada a FCM |
| `AVISOS_CRON_SECRET` | Una frase larga cualquiera, la misma que usará el cron |

Con los secretos puestos, el cron diario se crea igual que el de
`alertas-automaticas`, llamando a `avisos-android` con la cabecera
`x-avisos-cron-secret`.

4. Implementar y desplegar una función del servidor que resuelva el destinatario
   autorizado de cada expediente, envíe mensajes FCM **data-only** y controle
   reintentos/deduplicación. El payload admitido por Android contiene únicamente
   `user_id` y `tipo`. Los tipos son `caso_nuevo`, `plazo_descargo`,
   `pasos_pendientes` y `documento_recibido`. No incluir nombres, CIP, sanciones,
   fechas precisas ni texto libre en la notificación. Al perder vigencia un token,
   borrarlo de `dispositivos_android`.
5. Probar en un teléfono real: permiso Android 13+, recepción con la app abierta,
   cerrada y sesión cambiada, cierre de sesión, rotación de token y recepción solo
   del expediente autorizado. La app no debe anunciar que el plazo legal venció
   por un cálculo basado solo en fines de semana: los feriados y reglas aplicables
   deben verificarse antes de enviar ese tipo de alerta.

La opción de activar avisos se muestra solo cuando existe una configuración
Firebase válida; el permiso del sistema se solicita al tocar «Activar». Un error
de registro no se presenta como éxito.

## Probado de extremo a extremo el 30/09/2026

La cadena completa quedó comprobada en un teléfono real, con la variante QA
(«Faltos QA», `com.hidalgoferrai.faltos.qa`), que usa el mismo proyecto Supabase:

| Eslabón | Cómo se comprobó |
|---|---|
| Credencial FCM en el servidor | la función obtuvo su token de acceso y FCM aceptó el mensaje (200) |
| Registro del teléfono | una fila en `dispositivos_android`, a los segundos de activar |
| Envío dirigido | solo al teléfono de esa cuenta, exigiendo `usuarioPrueba` explícito |
| Entrega con la app abierta | confirmada por el responsable |
| **Entrega con la app cerrada** | confirmada: cerrada del todo y pantalla bloqueada |

Tres envíos a las 21:41, 21:42 y 21:43 (hora de Lima); los tres llegaron.

Detalle para no equivocarse después: el cron está en `5 13 * * *`, que es **UTC**
y equivale a las **8:05 de la mañana en Lima**. Si alguna vez se cambia desde el
panel, hay que seguir escribiéndolo en UTC o los avisos saldrán de madrugada.

## La clave del cron, rotada el 30/09/2026

Estaba escrita en claro dentro de `cron.job.command` y era adivinable: llevaba
el nombre del proyecto y una fecha. Es lo unico que protege la funcion de envio,
asi que quien la leyera podia mandar avisos a los telefonos registrados.

Lo que se hizo:

| | Antes | Ahora |
|---|---|---|
| Donde vive | en claro en el comando del cron | cifrada en **Vault** (`avisos_cron_secret`) |
| Como es | frase adivinable | 64 caracteres aleatorios (48 bytes) |
| En el historial | aparecia en 3 ejecuciones | tachada; las 25 filas de historial se conservaron |

El cron ya no la lleva dentro: la lee de Vault al ejecutarse. Comprobado que la
nueva funciona (200) y que la anterior ya no (403).

Para volver a rotarla: crear el secreto nuevo en Vault, leerlo UNA vez desde el
SQL Editor y pegarlo en **Edge Functions -> Secrets** como `AVISOS_CRON_SECRET`.
El valor nunca debe pasar por un chat ni quedar escrito en el cron.
