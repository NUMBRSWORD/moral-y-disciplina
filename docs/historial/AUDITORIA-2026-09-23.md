# Auditoría de la aplicación Faltos — 23/09/2026

Revisión de calidad y de cumplimiento de las políticas de Google Play sobre la
versión de trabajo del 22/09/2026, y corrección de lo encontrado. Todo lo que
aquí se afirma se comprobó ejecutando la aplicación, no solo leyendo el código.

## Resultado final

| | Antes | Después |
|---|---|---|
| Análisis `lintRelease` | 0 errores, 58 avisos | **0 errores, 0 avisos** |
| Pruebas automáticas | 35 en el emulador + 7 unitarias | **37 + 7**, todas pasan |
| Paquete de publicación (AAB) | 5,9 MB, sin optimizar | **3,1 MB** |
| APK de publicación | — | **2,5 MB** |
| Imagen de la mascota | 1254×1254, 1,5 MB | 576×576, 523 KB |

## Cómo se comprobó

- Compilación completa, análisis `lintRelease`, pruebas unitarias y pruebas
  instrumentadas sobre un emulador Pixel 7 con Android 16.
- Capturas reales del arranque, del acceso y del inicio, en tema claro y oscuro.
- Medición del contraste (WCAG) de los 18 pares de color que de verdad se dibujan
  juntos, en los dos temas.
- Medición geométrica del icono adaptativo (lienzo 108dp, ventana visible 72dp,
  zona segura 66dp) sobre el archivo real de la mascota.

## Defectos de funcionamiento corregidos

1. **La variante de pruebas no podía completar el acceso con Google.** El filtro
   del manifiesto usaba el esquema `faltas-qa` mientras el código exigía
   literalmente `faltas`. Con las dos instalaciones presentes, el acceso de la
   variante de pruebas entregaba la sesión a la aplicación real. Ahora el esquema
   se define una sola vez en `app/build.gradle.kts` (`esquemaDeAcceso`) y alimenta
   tanto el filtro del manifiesto como el texto que comprueba `LoginActivity`.
   *Pendiente del responsable:* autorizar `faltas-qa://auth` en Supabase si se
   quiere usar el acceso con Google dentro de la variante de pruebas.
2. **Callejón sin salida al «Ingresar con correo o CIP».** Esa opción abre la web
   dentro de la aplicación; si allí se tocaba «Continuar con Google», Google
   rechaza el inicio de sesión dentro de una vista web incrustada y la vuelta
   quedaba en el navegador, con la aplicación todavía sin sesión. Ahora ese bloque
   se oculta dentro de la aplicación y se indica usar el botón propio.

## Pérdida del teléfono del Token Digital (revisado el 23/09/2026)

Comprobado en el servidor: la única forma de quitar un token era `desactivar_token()`,
que exige ser administrador. Es decir, quien perdía el teléfono dependía de otra
persona, y un administrador que perdiera el suyo **no tenía ninguna salida dentro de
la aplicación**. En ese momento había 2 administradores, 13 cuentas aprobadas y un
solo token activo.

Ahora, al activar el token se entregan **ocho códigos de recuperación de un solo uso**:

- Se muestran una vez, en una pantalla que no admite capturas, y hay que confirmar
  que se guardaron antes de continuar.
- En el servidor solo queda el resumen cifrado (bcrypt) de cada código; la tabla no
  es legible con la clave pública, solo a través de las funciones.
- `usar_codigo_recuperacion()` borra el factor y permite activar el token en el
  teléfono nuevo. Diez intentos fallidos en una hora bloquean la vía por una hora.
- Quien ya tenía el token activado —el caso del administrador actual— puede
  generarlos desde «Token Digital → Generar códigos de recuperación».
- Si además se pierden los códigos, sigue existiendo la vía del administrador
  (`desactivar_token`) y, para el dueño del proyecto, borrar el factor desde el
  panel de Supabase.

Probado de extremo a extremo: en la base (generar, usar con ruido de formato,
reusar, código inválido) y en la aplicación con tres pruebas instrumentadas.

## Requisitos de Google Play resueltos

3. **Eliminación de cuenta** (su ausencia bastaba para rechazar el envío):
   pantalla «Eliminar mi cuenta» desde el inicio y desde la pantalla de cuenta
   pendiente, con confirmación y explicación de qué se borra y qué se conserva;
   página pública `eliminar-cuenta.html` en la web para quien no tenga la
   aplicación instalada; y en el servidor la tabla `solicitudes_eliminacion` con
   `solicitar_eliminacion_cuenta()` y `tiene_eliminacion_pendiente()`, con acceso
   restringido y sin permitir altas directas.
4. **Identificador del paquete**: pasó de `com.hidalgoferrai.myapplication` (el de
   la plantilla de Android Studio) a `com.hidalgoferrai.faltos`. Después de
   publicar ya no se puede cambiar, por eso se hizo antes del primer envío.
5. **Botón de acceso con Google conforme a sus normas de marca**: logotipo «G»
   oficial de cuatro colores sin tinte ni deformación, fondo blanco en tema claro
   y negro en oscuro, borde y color de texto de la especificación, y el texto
   aprobado «Continuar con Google».

## Imagen y gráficos

6. **El icono de la aplicación salía recortado.** El medallón medía 84,5dp sobre
   un lienzo de 108dp, cuando la zona segura es de 66dp: el aro dorado se cortaba
   con cualquier máscara del lanzador. Con el margen corregido a 20dp el dibujo
   mide 65,4dp y entra completo.
7. **Fondo del icono**: era dorado, igual que el aro del medallón, que así se
   perdía. Ahora es el verde del medallón, el mismo de la pantalla de arranque.
8. **Icono monocromo** (Android 13 en adelante): era un documento, ajeno a la
   identidad de la aplicación. Se dibujó la mascota en un solo color, legible
   hasta a 40 px.
9. **Pantalla de arranque**: la hora y los iconos del sistema salían oscuros sobre
   el verde oscuro. Ahora se fuerzan en claro.
10. **Encabezado a pantalla completa**: el verde se pinta también detrás de la
    barra de estado en las siete pantallas que lo llevan, en lugar de dejar una
    franja del color de fondo.
11. **Tarjetas del inicio**: las dos de una misma fila se estiran a la más alta y
    las flechas quedan alineadas abajo; antes un título de dos líneas dejaba una
    tarjeta más corta al lado de otra más larga.
12. **Peso de la mascota**: la imagen pasó de 1254×1254 y 1,5 MB a 576×576 y
    523 KB (−67 %), con lo que cada carga usa cerca de 1,3 MB de memoria en vez de
    6,3 MB. Se eliminó además una copia duplicada sin usar de 249 KB.
13. **Recursos muertos**: 58 textos, colores y dibujos sin uso, entre ellos el
    aviso del prototipo «Acceso de prueba: todavía sin contraseña ni conexión a la
    base de datos».
14. **Tipografía**: el tema pedía la familia `sans`, que no es un nombre válido en
    Android; ahora pide `sans-serif`.

## Tamaño y optimización

15. **La versión de publicación se compilaba sin optimizar** (`optimization.enable`
    estaba en `false`): el paquete llevaba 11,8 MB solo de código compilado. Con la
    optimización activada, el APK de publicación queda en **2,5 MB**.
16. Al activarla apareció un fallo real, detectado ejecutando la aplicación
    optimizada en el emulador: `NoSuchMethodException` al cargar
    `CommonComponentRegistrar`, es decir, **el escáner de documentos quedaba
    inservible** porque R8 no ve los usos por reflexión de ML Kit. Se añadieron las
    reglas de conservación en `app/src/main/keepRules/rules.keep` y el aviso
    desapareció. Comprobado además que la vista web sigue funcionando en la versión
    optimizada.

## Lo que ya estaba bien

- Un solo permiso, `INTERNET`: ni cámara, ni ubicación, ni contactos.
- Pantallas del token con captura bloqueada, secretos cifrados con el llavero de
  Android y copias de seguridad desactivadas.
- El puente con la web solo acepta mensajes del origen propio; contenido mixto
  bloqueado y acceso a archivos desactivado.
- Contraste correcto en los dos temas para todos los textos principales.
- `targetSdk = 37`, por encima del mínimo exigido por Play.

## Advertencia sobre la web que la aplicación muestra

La aplicación ya no lleva identidad institucional, pero la web que abre dentro
(`numbrsword.github.io/moral-y-disciplina/`) **sigue mostrando «PNP · CPNP
Ventanilla · Uso interno»**. Se comprobó en el emulador. Eso contradice la
declaración de herramienta independiente que se muestra en la propia aplicación y
es justo lo que revisaría Play. La propuesta `codex/independent-branding-play-readiness`
retira esa marca de la web; fusionarla es una decisión del responsable, no técnica.

## Lo que sigue dependiendo de una decisión del responsable

- Términos y política de datos definitivos (los textos actuales son borradores
  expresos y no pueden respaldar una aceptación real), publicados además por URL.
- Correo de contacto y plazo de ejecución en la página de eliminación.
- Clave de carga propia y firma del paquete; el AAB sigue sin firmar.
- Cuenta de demostración e instrucciones para el equipo revisor de Play.
- Ficha de la tienda: icono 512×512, gráfico 1024×500, capturas, declaración de
  seguridad de los datos (incluye DNI y CIP) y clasificación de contenido.
