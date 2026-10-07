# Auditoría de sincronización y diseño — 30 de septiembre de 2026

## Alcance y resultado

Revisión del Android actual y de la web `NUMBRSWORD/moral-y-disciplina`, base web `35d0367`.
Se conservaron las correcciones de avisos del 28/09 que estaban pendientes en el checkout web.
Durante el trabajo, otra sesión registró las primeras correcciones Android en `74f8214`; se conservó ese commit.

No se modificaron expedientes reales, cuentas, políticas de producción ni credenciales.
Las comprobaciones locales no equivalen a certificar «cero bugs» ni a confirmar el despliegue de Supabase.

## Hallazgos y correcciones

| Punto | Resultado |
|---|---|
| 1. Destino de Subir expediente (admin) | Verificado: abre escáner/selector, después revisión de expedientes firmados. Se actualizó la prueba que todavía esperaba Consulta. |
| 2. Casos antes del PDF | Corregido: `registro` y `expedientes-lote` esperan la carga de notas. Prueba con PDF ficticio y carga retardada. |
| 3. Contrato de carga entre web y APK | Corregido: el adaptador conserva el resultado booleano de `loadNotas`; distingue fallo de carga compartida. |
| 4. Fallo de refresco con formulario abierto | Corregido: un refresco fallido no tapa un módulo ya abierto ni elimina su PDF preparado. |
| 5. Listas de más de 1.000 registros | Corregido: paginación completa de casos, efectivos y remisiones, con orden estable y sin aceptar respuestas parciales. |
| 6. Consultas simultáneas | Corregido: carga compartida; libera la promesa tras éxito o error para permitir reintentos. |
| 7. Cambios de otra pantalla | Actualización de listas al volver a la web/APK y cada 60 s mientras están visibles; no recarga la página. |
| 8. Formularios en edición | No se refrescan automáticamente detalles, modales ni vistas mientras un campo tiene el foco. Recepción/consulta conservan sus controles de actualización explícitos. |
| 9. Estado de sincronización | Aviso en la vista correspondiente: actualizando, actualizado o datos posiblemente desactualizados. |
| 10. Fallo al consultar remisiones | Ya no se afirma que falta el oficio basándose en una consulta fallida. Se informa el error. |
| 11. Cambio de cuenta | Se limpian las listas al salir; las cargas modificadas descartan resultados de otra cuenta. |
| 12. Lote con datos antiguos | Antes del reconocimiento se actualizan casos y padrón. Un fallo detiene la lectura en vez de cruzar contra una lista incompleta. |
| 13. Doble clic / cambio de PDF durante carga | Controles bloqueados durante lectura/guardado; prueba del manejador real sin red. |
| 14. Reintento de lote parcialmente fallido | Solo se reintentan los pendientes; los expedientes ya guardados no se vuelven a subir. |
| 15. Revisión antes de archivar | Se mantiene la confirmación explícita de guardado; las pruebas del escáner no registran expedientes. |
| 16. Títulos largos, letra 200 % | Se reprodujo y corrigió el recorte de «Recepcionar documentos». |
| 17. Token inferior en pantalla baja | Se reprodujo y corrigió: panel desplazable y código ajustable en una línea. Sigue protegido contra capturas. |
| 18. Acceso y PDF en 320 dp | Pruebas de medición de texto, ambos temas y letra al 200 %, sin elipsis ni recortes verticales. |
| 19. Barra web estrecha | Se corrigió superposición de marca y acciones; navegación horizontal contenida y acciones en su propia fila. |
| 20. Formulario Roles | Se reprodujo desbordamiento de 409 px en una pantalla de 320 px. Corregido el mínimo de las columnas/campos. |
| 21. Nombres y botones largos | Ajuste de línea en tarjetas, botones y modales; campos PDF limitados al ancho disponible. |
| 22. Modo oscuro web/APK | Paleta verde coherente, texto de botones con contraste y conservación del tema nativo en módulos. |
| 23. Gráficos | Lienzos contenidos mientras carga Chart.js; revisión por generación evita dibujar dos veces al cambiar tema/refrescar concurrentemente. |
| 24. Service worker | No borra cachés ajenas, no devuelve HTML como si fuera JavaScript sin red, y título de aviso sin respaldo institucional. |
| 25. Backend compartido | Prueba estática confirma el mismo proyecto Supabase y los mismos campos/RPC canónicos de carga del expediente. Esto no prueba por sí solo la sincronización real. |
| 26. Recepción y apelación | Pruebas SQL aisladas preservan distinción entre subir digitalmente, recibir físicamente y apelar opcionalmente. |
| 27. Avisos del servidor | Se incluyen en la rama web las correcciones anteriores y su migración; no se desplegaron en Supabase. |

## Evidencia reproducible

- `npm test` en el checkout web: **386 pruebas correctas**, ninguna fallida.
- Android: compilación debug/QA y pruebas JUnit correctas; **8 pruebas unitarias**. Lint: **No issues found**.
- Instrumentación: pasada de **57 pruebas correcta**; pasada final con una regresión adicional en curso al redactar este documento.
- `node --test tests/*.test.mjs`: contrato, 7 pruebas de avisos, 2 de lote, 6 comprobaciones SQL de entregas, 6 de seguridad y 10 de recepción/apelación correctas.
- Web real servida localmente con `scripts/preview-audit.mjs`: HTML, CSS y lógica actuales, transporte ficticio de solo lectura. Ninguna llamada a Supabase real.
- Navegación inicial: 11 módulos en 320/768/1280 px. Se encontró el desbordamiento de Roles y se corrigió.
- Revisión posterior: Panel, Roles, Efectivos, Seguimiento, Recepción y Expedientes en los tres anchos, temas claro/oscuro: **36 comprobaciones sin desbordamiento horizontal de página**. Las tablas y pestañas conservan desplazamiento interno cuando hace falta.
- Consola de esa revisión web: sin errores registrados. No incluye OCR remoto ni documentos reales.
- La web pública se revisó sin autenticarse; las pantallas privadas se probaron con datos ficticios.

Los tiempos de ejecución incluyen suspensión/reanudación del equipo: no son mediciones de rendimiento.

## APK de prueba

- `app/build/audit-2026-09-30/Faltos-1.5-auditoria-30-09-debug.apk`.
- SHA-256: `1f06c846bc0176d2faebab42967f5f14d8e324c1c31295782a0329db1ba43b3d`.
- Paquete normal, firma **debug**, versión 1.5. Es una compilación de auditoría, no una publicación nueva de Play Store ni de `descargas/version.json`.
- Si Android rechaza actualizar por diferencia de firma, **no desinstalar la app de uso real**: podría perderse el token local. Usar QA o la firma original.

## Pendientes para certificar producción

1. Integrar los cambios web y desplegar la migración/función de avisos siguiendo `docs/despliegue-auditoria-2026-09-28.md`. Subir a GitHub no aplica SQL ni secretos en Supabase.
2. Verificar RLS/MFA realmente instalados. La auditoría anterior documenta una migración MFA incompleta; no hay evidencia administrativa nueva para cerrar ese riesgo.
3. Prueba de dos clientes autenticados con cuentas designadas: alta ficticia en web → pendiente en APK; subida PDF → consulta web; recepción física → fecha visible al usuario; restricción de expedientes ajenos.
4. Avisos reales en teléfono físico, app cerrada/abierta, red interrumpida y cambio de cuenta. Un token Firebase de instalación no demuestra entrega end-to-end.
5. Cámara/escáner en teléfono real y OCR de un documento de prueba autorizado. No se subieron documentos personales a servicios externos.
6. Para distribución pública: firma del publicador, nueva versión, prueba de actualización y cambio coordinado del APK/archivo de versión. No se sustituyó la descarga pública durante esta auditoría.

## GitHub

Los enlaces de las ramas/solicitudes de cambios se añadirán tras confirmar la subida. No se subirán claves, `google-services.json`, registros privados ni datos de expedientes.
