# Auditoría funcional de Faltos — 28/09/2026

## Resultado y alcance

Se revisó el código Android de la versión 1.5, sus adaptadores web, los scripts SQL y el código de notificaciones del repositorio web en `5c5549d`. Se corrigieron fallos reproducibles y se añadieron regresiones. **No equivale a certificar producción ni a afirmar que la app ya está lista para Play Store.**

Los cambios Android están en este directorio. Las correcciones del servidor están preparadas y probadas localmente, **no desplegadas**. No se modificaron expedientes, cuentas, firmas, credenciales ni políticas de la base de datos real. No se enviaron avisos a usuarios reales. No se hizo push ni publicación del APK.

## Revisión punto por punto

| Punto | Hallazgo / comprobación | Resultado |
|---|---|---|
| 1. Acceso y consentimiento | Una sesión guardada no debe saltarse la aceptación ni activar el token. | Prueba funcional aprobada. Se mantiene la continuación explícita. |
| 2. Lectura y firma de políticas | Se retenía el access token del ingreso durante toda la lectura; podía caducar antes de firmar. | Corregido: renovación compartida antes de consultar o firmar, sin saltarse la lectura. |
| 3. Rotación de pantalla y sesión | Inicio/Web podían reinstalar una sesión vieja desde su Intent y sobrescribir un refresco rotado. | Corregido: restaurar no reemplaza la sesión actual. Regresión añadida. |
| 4. Concurrencia | Login y Token renovaban por vías separadas. | Corregido: renovación serializada; dos módulos simultáneos solo renuevan una vez. |
| 5. Cambio de cuenta | Algunas salidas no borraban la sesión en memoria, el perfil o los datos web. | Corregido: cierre local centralizado; cancelación de notificaciones visibles y limpieza de perfil, refresco, cookies y almacenamiento web. Se conserva únicamente el TOTP cifrado vinculado a su propietario. |
| 6. Mensajes tardíos de la web | Una respuesta antigua podía volver a guardar sesión después de salir. | Corregido: verificación de la época de sesión; se rechazan actualizaciones tardías de una cuenta cerrada. |
| 7. Cierre de otros dispositivos | El logout usaba el alcance global por defecto. | Corregido a `scope=local`; prueba de la petición exacta. |
| 8. Activación y validación TOTP | La activación podía usar el token de acceso vencido que trajo la pantalla. | Corregido: renovación antes de activar, desafiar, verificar o usar recuperación. Pruebas de activación explícita, timeout, dispositivo anterior y recuperación. |
| 9. Recuperación desde panel inferior | Se intentaba renovar sesión en el hilo de la interfaz. | Corregido: toda renovación/generación se hace en segundo plano. |
| 10. Códigos de respaldo y rotación | Girar la pantalla regeneraba la lista e invalidaba los códigos recién guardados. | Corregido con estado retenido en memoria; nunca se guardan códigos en Bundle/disco. Si muere el proceso, se explica la interrupción sin regenerar silenciosamente. |
| 11. Migración de teléfono | El fallo al retirar el factor del teléfono anterior se ocultaba. | Ahora se advierte expresamente. La migración satisfactoria sigue verificada por prueba. |
| 12. Registro y cuenta pendiente | Solicitud no enviaba el token a Pendiente; podía impedir solicitar la baja. Había respuestas tardías y mensajes crudos del servidor. | Corregido: propaga token, renueva sesión, impide doble envío y usa errores sanitizados/guardas de ciclo de vida. |
| 13. Eliminación de cuenta | El formulario retenía un token antiguo. | Corregido: renueva antes de consulta/envío y no actualiza pantallas destruidas. La prueba verifica el pedido, no la ejecución administrativa del borrado. |
| 14. Inicio por rol | Usuario y administrador requieren opciones distintas, sin volver al inicio web. | Pruebas aprobadas para ambos; panel inferior de token conservado. |
| 15. Navegación | Cada módulo debe conservar su destino incluso al refrescar sesión. | Pruebas aprobadas. Además, se descartan resultados de cargas anteriores después de reintentar. |
| 16. Modo oscuro | Persistencia, panel, efectivos, seguimiento, formularios y gráficos. | Pruebas de tema/contraste aprobadas y capturas de muestra revisadas. No se realizó otro rediseño recargado. |
| 17. Seguimiento | Un error seguido de búsqueda podía anunciar falsamente que no había pendientes. | Corregido; ahora el estado vacío requiere una consulta correcta. Se eliminan duplicados por ID y datos de una carga anterior al refrescar. |
| 18. Documentos PDF | Validación, preparación y revisión antes de registrar. | Pruebas aprobadas con PDF ficticio y archivo inválido. Cámara/escáner físico y proveedores externos requieren teléfono real. |
| 19. Descargas | En Android antiguo se podía sobrescribir el mismo nombre; una descarga fallida podía dejar un registro parcial en Descargas. | Corregido: nombres disponibles, publicación con `IS_PENDING` y limpieza del archivo parcial recién creado. Revisión de código; falta prueba en Android 7–9 físico. |
| 20. Puente web | Las descargas comprobaban dominio pero no la ruta del proyecto. | Corregido: origen y ruta propios; enlaces externos restringidos a esquemas previstos; selector de archivos liberado al destruir la pantalla. |
| 21. Subida versus recepción física | Subir un PDF no equivale a recepcionar el físico. | Pruebas de interfaz y SQL aprobadas: administrador, conformidad explícita, fecha del servidor y confirmación idempotente. |
| 22. Apelación opcional | El campo de fecha cortaba la cadena UTC y podía mostrar el día siguiente a Lima. | Corregido y probado con `02:00Z`. Se conserva como opcional y separada de recepción. No se ha emitido validación jurídica del cómputo de plazos. |
| 23. Registro de notificaciones | El SDK podía dejar «Conectando» sin fin; el permiso denegado repetidamente no ofrecía ajustes. | Corregido: tiempo de espera acotado, recuperación del botón, comprobación de permisos/canal y acceso a ajustes. |
| 24. Avisos al cambiar de cuenta | Borrar un token FCM de forma tardía podía afectar a la cuenta siguiente. | Corregido: se serializa registro/retiro de asociación; no se borra el token de instalación al salir. El filtrado local de usuario y consentimiento sigue obligatorio. |
| 25. Aviso incorrecto de recepción | El servidor anunciaba «documento recibido» al registrar un descargo. | Corregido en fuente preparada: solo `recepciones_fisicas` con conformidad explícita lo autoriza. Pendiente de despliegue. |
| 26. Avisos con muchos registros | Consultas sin paginación podían ignorar filas más allá del límite de Supabase. | Corregido en fuente preparada; prueba con 1.205 filas. |
| 27. Fallos FCM | Un `INVALID_ARGUMENT` genérico retiraba dispositivos que podían ser válidos. | Corregido: solo `UNREGISTERED` estructurado retira el token. Los fallos temporales se contabilizan y permiten reintento. |
| 28. Duplicación y entrega parcial | El envío no reservaba eventos concurrentes y un dispositivo podía ocultar el fallo de otro. | Nueva reserva temporal por evento/usuario/dispositivo y marca de éxito individual. El móvil reconoce IDs opacos repetidos. No se promete entrega exactamente una vez ni entrega garantizada por Android. |
| 29. Pruebas sobre teléfonos | La función escogía automáticamente el último dispositivo de producción y simulaba un caso nuevo. | Corregido en fuente preparada: destinatario explícito y texto de prueba que no anuncia casos ficticios. |
| 30. Cifrado | Inicialización concurrente de la clave del almacén podía competir. | Corregido: creación/lectura de clave serializada. No se exportaron secretos. |
| 31. Documentación | README decía que solo se pedía Internet y que todos los SQL estaban aplicados. | Corregido: permiso opcional de notificaciones y distinción entre archivos locales y despliegue real. |

## Evidencia

- Compilación de `debug`, `qa` y APK de instrumentación: correcta. También se comprobó compilación optimizada `release`; sin credencial de publicación configurada produce APK sin firmar.
- Android Lint final: `No issues found`.
- JUnit local: 8 pruebas correctas (TOTP, fechas y tipos permitidos de aviso).
- Instrumentación: **53 pruebas correctas**, cero fallos en la última ejecución (`OK (53 tests)`, 235,134 segundos). Incluye la regresión adicional de fecha de apelación. La pasada previa de Gradle registró 52 pruebas correctas.
- PostgreSQL aislado (PGlite): 6 pruebas de seguridad MFA/aprobación y 10 de recepción/apelación correctas.
- Nueva reserva de entregas: 6 comprobaciones correctas (idempotencia, permisos, exclusión, reintento, propietario de intento y éxito definitivo).
- Lógica de avisos: 7 pruebas correctas; sin red ni usuarios reales.
- `deno check` de la función desplegable: correcto, con dependencias fijadas a la versión comprobada.
- Contrato estático del adaptador con el checkout web: correcto.
- Firebase emitió un token de instalación real para el emulador QA. **Esto no prueba el cron, el envío desde Supabase ni la recepción en un teléfono físico.**
- Verificación de firma del APK debug con `apksigner`: correcta (esquema v2). No es una firma de publicación Play.

El emulador de auditoría usa Android 16, variante `.qa` y respuestas ficticias para cuentas/expedientes. No se autenticó una cuenta administrativa de producción. Los tiempos de algunas ejecuciones incluyen suspensiones/reanudaciones del equipo y no son mediciones de rendimiento.

## Entregables

- APK de prueba: `app/build/audit/Faltos-1.5-auditoria-debug.apk` (paquete normal, firma debug).
- SHA-256: `716f0c4eff4716d9a94c06356168d5b69fad63c84cf810d9f04fe2199d73fca8`.
- La versión sigue siendo 1.5: esta es una compilación de auditoría local, no una nueva versión publicada. No se modificó `descargas/version.json` del sitio.
- Fuente del servidor: `supabase/functions/avisos-android/`.
- Migración aditiva: `supabase/avisos-android-entregas.sql`.
- Parche para el repositorio web: `upstream-patches/avisos-android-auditoria-2026-09-28.patch`, contra `5c5549d`.
- Plan seguro de integración: `docs/despliegue-auditoria-2026-09-28.md`.
- Capturas generadas con datos ficticios: `app/build/audit/capturas/`. Se excluyen pantallas con códigos de token o recuperación.

Si Android rechaza actualizar por diferencia de firma, **no desinstalar la app de uso real**: podría perderse el token local. Usar la variante QA o compilar con la firma original.

## Pendientes que impiden declarar todo terminado en producción

1. Aplicar la migración nueva y desplegar la función en el Supabase correcto; no hay en esta auditoría una sesión administrativa confirmada para hacerlo. La APK por sí sola no modifica el servidor.
2. Verificar las políticas RLS realmente instaladas con cuentas de prueba aprobada, pendiente, ajena, administrador y AAL1/AAL2. La documentación anterior indica que **no se aplicó toda la migración MFA**. Las pruebas locales no demuestran el estado remoto ni autorizan cerrar ese riesgo como resuelto.
3. Probar en un teléfono designado los avisos con app abierta/cerrada, cambio de cuenta, permiso rechazado, sin red, recepción física y reintentos. No enviar una prueba al «último dispositivo» arbitrario.
4. Probar cámara/escáner, selector de archivos, descargas y accesibilidad en más versiones de Android y en dispositivo físico. La prueba automatizada usa archivos ficticios y adaptadores web de prueba; no es una prueba contra todos los módulos web reales y sus dependencias.
5. Confirmar operación administrativa de eliminación de cuentas y retención de documentos acorde con el aviso de privacidad. No se ejecutaron borrados ni se certificó cumplimiento jurídico.
6. Para distribuir una nueva versión pública: incrementar versión, compilar con la firma del publicador, probar actualización sobre la versión instalada y actualizar la descarga pública de manera coordinada. No se cambiaron publicación, ficha Play ni secretos.

## Referencias técnicas consultadas

- Alcance local/global de cierre: [Supabase — Signing out](https://supabase.com/docs/guides/auth/signout).
- Diferencia entre error del mensaje y dispositivo no registrado: [Firebase — FCM error codes](https://firebase.google.com/docs/cloud-messaging/error-codes).
