# Recepción física y apelación opcional

## Activación pendiente en el servidor

Aplicar `supabase/recepcion-fisica-y-apelacion.sql` en el SQL Editor del proyecto Supabase de esta aplicación, después de las migraciones de aprobación y MFA. Esta entrega no ejecuta SQL en producción ni publica cambios en el repositorio web remoto. Sin esa activación, la app informa que no puede verificar los nuevos estados; no inventa un cargo de recepción.

La migración es aditiva. Conserva notas, PDF, fechas de notificación y recepciones anteriores. La recepción digital histórica no se interpreta retrospectivamente como una revisión física. El nuevo cargo se registra solo tras la confirmación expresa del administrador. El archivo administrativo anterior (`expedientes_remitidos`, HT, oficio y Drive) permanece intacto y no constituye este nuevo cargo físico.

## Flujo

1. En el detalle, **Subir expediente** reemplaza la etiqueta Notificación final. Se conserva la fecha real de notificación de la orden: no es una fecha de recepción física. El PDF continúa en el almacenamiento privado existente.
2. **Consulta de expediente** incluye pendientes, subidos y archivados accesibles según las reglas existentes. Una carga digital queda pendiente de recepción física.
3. **Recepción física**, solo para administradores, muestra los expedientes subidos. El administrador recibe el físico, comprueba su integridad, marca la conformidad y confirma. El servidor guarda la fecha, hora y usuario; los reintentos conservan el primer cargo.
4. Al consultar o actualizar, el remitente ve: **Su documento fue recibido el [fecha]**. La fecha se presenta en la zona horaria de Lima. No se añade una notificación push: el aviso se muestra al consultar, como se solicitó.
5. **Apelación (opcional)** aparece en el detalle de una sanción por infracción leve. Permite adjuntar el recurso firmado en PDF, registra la fecha del servidor y conserva su constancia. No se añade al conteo de pasos obligatorios y no condiciona la recepción. La fecha de notificación se toma de la orden; si aún no está cargada, se pide la fecha que consta en el cargo.

El acceso se conserva para el administrador y el oficial autorizado por las políticas existentes. No se amplía automáticamente a todos los sancionados ni a otros usuarios. El registro digital de una apelación no significa que se haya declarado admisible o resuelto el recurso.

## Plazo informado

Tres días hábiles desde el día siguiente de la notificación de la sanción: artículo 62 de la Ley 30714 modificado por el [Decreto Legislativo 1583](https://www.congreso.gob.pe/Docs/comisiones2023/Constitucion/files/dl-1583-2023-of.pdf). Revisar además el reglamento vigente y sus modificaciones, incluido el [D. S. 016-2025-IN](https://www.gob.pe/institucion/mininter/normas-legales/7469892-016-2025-in).

No se muestra un vencimiento calculado sin calendario institucional de feriados y días inhábiles. Tampoco se deniegan automáticamente recursos por una estimación del teléfono. La admisibilidad y el cómputo definitivo corresponden a la autoridad competente.

## Verificación después de activar Supabase

- Usuario autorizado: subir expediente no crea fila en `recepciones_fisicas`.
- Administrador sin conformidad: no puede confirmar. Con conformidad: se crea una única recepción con hora del servidor.
- Usuario no administrador: RPC de recepción rechaza con 42501; no puede insertar, editar ni borrar el cargo por REST.
- Consultar con el oficial autorizado: puede leer el cargo de su nota, pero no los de notas ajenas.
- Presentar apelación es opcional; confirmar recepción no consulta ni exige la tabla de apelaciones.
- No hay apelación para procedimientos archivados sin sanción o infracciones no leves.
- Dos confirmaciones concurrentes devuelven la misma fecha. Dos presentaciones conservan el primer recurso; no se sobrescribe.
- Si la carga del PDF termina pero el registro falla, actualizar para comprobar si se registró antes de reintentar. Los objetos huérfanos se conservan para revisión administrativa; no se borran automáticamente ante un resultado de red incierto.

Los cambios de interfaz se integran en el Android mediante el adaptador del módulo público. La web independiente conserva su interfaz hasta que su responsable integre y publique estos cambios allí.

## Resultado de pruebas locales — 20/09/2026

- Compilación Debug/QA e instrumentación: correcta. Lint: 0 errores, 14 advertencias preexistentes.
- 14 pruebas de pantallas aprobadas en el emulador: carga frente a recepción, conformidad explícita, aviso consultado en otro ingreso, fecha de Lima, apelación opcional, PDF inválido, doble toque, ausencia de migración, navegación y contraste.
- 10 pruebas de acceso y 3 pruebas unitarias de TOTP aprobadas; no se capturaron tokens.
- 10 pruebas PostgreSQL en memoria aprobadas, incluida una política heredada de almacenamiento ampliamente permisiva para comprobar que no elude la protección del nuevo bucket.
- Las capturas de demostración quedan en `app/build/reports/consulta-expediente-recibido.png`, `recepcion-fisica-confirmada.png` y `apelacion-opcional-registrada.png`.
- Estos resultados no sustituyen la prueba de aceptación contra Supabase después de aplicar la migración. No se consultaron ni modificaron expedientes reales durante las pruebas.
