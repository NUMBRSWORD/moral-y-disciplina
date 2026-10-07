# Preparación para Google Play — 22/09/2026

Estado: **no enviar aún**. Se conservan los flujos de expedientes disciplinarios
como herramienta independiente y se retiró la identidad institucional visible
del código Android. La web remota usada por la app aún muestra la versión
anterior hasta que se revise y publique el cambio propuesto. La declaración de
no afiliación no confiere permiso para tratar datos personales ni para operar
como canal oficial.

## Resultado técnico comprobado

- Actualizado el 23/09/2026 tras la auditoría (ver `AUDITORIA-2026-09-23.md`).
- `lintRelease`: **0 errores y 0 advertencias**. Pruebas: 37 instrumentadas en
  emulador y 7 unitarias, todas pasan.
- Android App Bundle: `app/build/outputs/bundle/release/app-release.aab`, **3,1 MB**
  con la optimización de R8 activada (antes 5,9 MB sin optimizar). Sigue **sin
  firmar** mientras no exista la clave de carga.
- `targetSdk = 37`: supera el mínimo 36 exigido para nuevas apps desde el
  31/08/2026. `versionCode = 4`, `versionName = 1.3`,
  `applicationId = com.hidalgoferrai.faltos`.
- La configuración de firma admite una clave de carga propia mediante cuatro
  variables de entorno: `FALTOS_UPLOAD_STORE_FILE`,
  `FALTOS_UPLOAD_STORE_PASSWORD`, `FALTOS_UPLOAD_KEY_ALIAS` y
  `FALTOS_UPLOAD_KEY_PASSWORD`. Si solo se configura una parte, la compilación
  falla. Ninguna clave ni contraseña debe guardarse en Git o compartirse por chat.

## Antes de generar el paquete para enviar

1. Revisar y fusionar la propuesta web
   `codex/independent-branding-play-readiness` de `NUMBRSWORD/moral-y-disciplina`
   solo cuando estén resueltos los puntos legales y de datos. La propuesta
   elimina marca institucional, localización fija de Ventanilla y atribución
   de responsabilidad a la comisaría; conserva el flujo de expedientes.
   `npm test`: 249/249. Las funciones Supabase requieren despliegue aparte y
   la carpeta de respaldo existente conserva su nombre hasta planificar su
   migración sin perder documentos.
2. ~~Fijar el identificador de paquete.~~ **Hecho el 23/09/2026:**
   `com.hidalgoferrai.faltos` (antes seguía siendo `com.hidalgoferrai.myapplication`,
   el de la plantilla de Android Studio). Tras publicar ya no se puede cambiar.
   Queda por fijar el nombre público de la ficha y quién publica la app.
3. Identificar al responsable real del tratamiento, un contacto verificable,
   la base jurídica/permiso para tratar expedientes sensibles, destinatarios,
   conservación efectiva y eliminación. Publicar una política de privacidad
   definitiva por URL y dentro de la app. Los textos actuales son **borradores
   expresos**; no pueden presentarse como política final ni respaldar la
   aceptación para producción.
4. ~~Ofrecer solicitud de eliminación desde la app y en un recurso web público.~~
   **Hecho el 23/09/2026:** pantalla «Eliminar mi cuenta» en el inicio y en la
   pantalla de cuenta pendiente, página pública
   `https://numbrsword.github.io/moral-y-disciplina/eliminar-cuenta.html`, y en el
   servidor la tabla `solicitudes_eliminacion` con las funciones
   `solicitar_eliminacion_cuenta()` y `tiene_eliminacion_pendiente()`.
   **Falta del responsable:** completar el correo de contacto y el plazo en esa
   página, y ejecutar de verdad el borrado cuando llegue un pedido; desactivar la
   cuenta por sí solo no satisface la política.
5. Preparar una cuenta de demostración estable y las instrucciones de revisión
   que permitan entrar a todas las funciones protegidas. El flujo actual exige
   Google, aprobación y un token temporal; el revisor necesitará acceso viable
   sin depender de una persona que envíe códigos cada vez.
6. Crear y custodiar la clave de **carga** de Play App Signing. Compilar el AAB
   firmado y verificarlo antes de subirlo. El APK `debug` compartido para pruebas
   no es el archivo que se envía a Play Store.
7. Revisar si Play clasifica la app como gubernamental o como facilitadora de
   un proceso gubernamental, aun sin logotipos; describir con precisión su
   independencia y fuente de información. Completar la ficha y declaraciones de Play Console según los datos del
   producto final: Seguridad de los datos, anuncios, acceso a la app, contenido,
   público objetivo, política de privacidad, ficha gráfica y contacto.
8. Si la cuenta de Play Console es personal y se creó después del 13/11/2023,
   hacer prueba cerrada con 12 participantes durante 14 días continuos y solicitar
   acceso a producción. Verificarlo en la cuenta concreta.

## Fuentes oficiales

- [AAB requerido para nuevas apps](https://developer.android.com/guide/app-bundle)
- [API de destino para Play](https://support.google.com/googleplay/android-developer/answer/11926878?hl=es)
- [Firma con Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756?hl=es)
- [Política de datos y privacidad](https://support.google.com/googleplay/android-developer/answer/10144311?hl=es)
- [Eliminación de cuentas](https://support.google.com/googleplay/android-developer/answer/13327111?hl=es)
- [Acceso para el equipo revisor](https://support.google.com/googleplay/android-developer/answer/15748846?hl=es)
- [Requisitos para cuentas personales nuevas](https://support.google.com/googleplay/android-developer/answer/14151465?hl=es)
- [Declaración de aplicaciones gubernamentales](https://support.google.com/googleplay/android-developer/answer/9514050?hl=es)
