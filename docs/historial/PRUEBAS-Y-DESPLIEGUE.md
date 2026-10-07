# Flujo de acceso corregido

Acceso → cambio de clave (solo si el servidor lo exige) → lectura y firma de políticas → Token Digital → panel de trabajo.

La sesión guardada no navega por sí sola: requiere aceptación y el botón Continuar.
La pantalla de políticas permanece abierta incluso si ya están firmadas. Un conjunto
vacío o un fallo de carga no se interpreta como conformidad. El token se consulta
mediante GET /auth/v1/user; POST /auth/v1/factors solo se usa al pulsar Activar.

## Backend

El archivo `supabase/politicas-antes-del-token.sql` permite leer las políticas y leer o
registrar las firmas propias a cuentas aprobadas antes de MFA. Debe aplicarse después
de `aprobacion-de-cuentas.sql`. La versión actual de `seguridad-mfa-aal2.sql` ya incluye
esta excepción en la misma transacción; si se aplicó una versión anterior, basta con
aplicar `politicas-antes-del-token.sql`. No abre expedientes, personal ni
otros datos operativos a sesiones AAL1. Estos archivos no se aplican automáticamente
a Supabase desde la aplicación.

## Pruebas

La variante `qa` usa el paquete `com.hidalgoferrai.faltos.qa`. Las pruebas
instrumentadas sustituyen el transporte HTTP por respuestas ficticias y verifican
el paquete antes de limpiar sus preferencias. No utilizan la cuenta de la app real.

```
gradlew assembleDebug testQaUnitTest connectedQaAndroidTest lintDebug
```

Las pruebas cubren consentimiento explícito, navegación hacia políticas, firma con
confirmación, lista de políticas vacía, timeout y reintento, activación pendiente
recuperable tras recreación, factor en otro dispositivo, no repetición del código
recién activado, mensajes sin datos sensibles y renderizado claro/oscuro.

Las capturas de diseño usan datos de demostración. No se capturan pantallas de token.
Para una comprobación real, abra la app, revise los términos, pulse Continuar, firme
solo los documentos con los que esté conforme y active o verifique su token.

## Módulos independientes

Para los accesos nuevos y la compatibilidad con las actualizaciones de GitHub de
la versión 1.2, consultar `ACTUALIZACION-GITHUB-2026-09-21.md`. Historial por efectivo
es distinto de Seguimiento de pendientes; el aviso de privacidad fue sincronizado.

- Subir expediente abre una pantalla nativa: escáner de varias páginas o selector de PDF (máximo 20 MB). El documento se prepara y puede previsualizarse antes de pulsar Revisar y registrar. El alta sigue requiriendo la confirmación en el formulario web existente y el permiso de administrador.
- Seguimiento consulta notas pendientes con ambos campos de cierre nulos (`orden_notificada_at`, `archivo_leve_generada_at`), bajo las políticas RLS existentes. Carga páginas de 100 y permite buscar entre las cargadas. Cada tarjeta muestra pasos numerados, comprobantes de avance (✓ y fecha), siguiente paso, pendientes y la acción para abrir su nota concreta. Las faltas leves muestran registro, reincorporación, imputación, descargo, orden y notificación final. Un paso posterior no marca automáticamente los anteriores. Si existe orden pero no fecha de descargo, se indica «Sin descargo registrado», sin inventar un descargo completado. Los informes administrativos y casos sin clasificación no se fuerzan a seguir la ruta de leves.
- Expedientes concluidos abre el archivo, separado de los pendientes. Cumplimiento, Personal y Recepción tienen destinos propios.
- Token Digital queda fijo abajo en Inicio y abre un panel inferior protegido contra capturas. No inscribe ni verifica factores al abrirlo.

La sesión vigente se instala al inicio del documento web, antes del módulo JavaScript. Ya no se inyecta después de cargar ni se recarga para entrar. Las renovaciones de la web se sincronizan con el almacenamiento cifrado nativo. Los errores tienen reintento y límite de espera; no se presentan como un ingreso nuevo o una lista vacía.

El adaptador local `mobile_adapter.js` se añade a la respuesta del `app.js` público (también a través del service worker). No modifica ni publica el sitio remoto. Depende de sus nombres actuales de vistas, funciones y formulario; si el sitio cambia su estructura, debe actualizarse y probarse este adaptador. Un fallo de compatibilidad muestra un error nativo. La entrega temporal del PDF usa un origen local distinto para que el service worker del sitio no lo cachee.

`ModulosTest` usa HTML/JavaScript ficticios y respuestas de API sustituidas exclusivamente en QA: comprueba destinos, sesión antes del arranque, renovación sin retorno al dashboard, nota específica, panel inferior, filtro de pendientes, errores, validación y entrega de PDF sin registro. No sustituye una prueba de aceptación con la cuenta real ni una prueba física de cámara. El escáner depende de Google Play Services y puede descargar componentes en su primer uso; si no está disponible se mantiene la selección de PDF.

## Claro y oscuro

Los módulos web usan una paleta completa consistente con el modo de Android (fondos, tarjetas, texto, campos, botones y estados). Se eliminó el fondo/texto claro fijo que se mezclaba con las tarjetas oscuras del sitio. La web independiente mantiene su selector de tema. En módulos, cambiar `uiMode` actualiza la paleta y la barra nativa sin recrear el WebView ni perder el borrador. La inversión automática de WebView se desactiva cuando está soportada para no aplicar dos transformaciones de color.

Las pruebas de regresión miden contraste mínimo 4.5:1 en texto principal/secundario, campos, botones y avisos de las dos paletas; alternan oscuro→claro→oscuro conservando la vista y el texto del formulario. También verifican los estados de avance con datos ausentes, orden sin descargo, caso grave y archivo, y generan capturas de demostración de Inicio, carga y Seguimiento en oscuro.

## Actualización: recepción física y apelación

El paso final ahora se llama **Subir expediente**. El acceso de archivo de Inicio pasa a **Consulta de expediente**, que permite consultar los registros autorizados y muestra el aviso fechado de recepción. El acceso de administración pasa a **Recepción física**, con revisión y confirmación explícitas. No se modifica el archivo administrativo previo ni sus documentos.

`mobile_casework.js` añade estos módulos y la apelación opcional al detalle, conservando la navegación y los puntos de avance originales. Los datos requieren activar la migración aditiva `supabase/recepcion-fisica-y-apelacion.sql`; consultar `RECEPCION-Y-APELACION.md` para permisos, alcance y activación. La migración no ha sido aplicada a producción por esta entrega.

La validación local de PostgreSQL se ejecuta con `node tests/recepcion-db.test.mjs` después de instalar PGlite en `app/build/sql-qa` según las instrucciones del archivo. Diez pruebas comprueban RLS, MFA, privilegios de escritura, fechas del servidor, idempotencia, archivos privados y la independencia de la apelación. No se conecta a Supabase real.
