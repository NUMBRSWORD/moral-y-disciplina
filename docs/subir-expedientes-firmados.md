# Subir expedientes firmados en lote

Acordado el 28/09/2026 y construido el 29/09/2026 sobre tres modelos reales.

## Qué se quiere

El caso ya terminó: el investigado firmó y la sanción está impuesta. El
administrador junta todos esos expedientes completos, los escanea o los tiene en
PDF, y **los sube todos de una vez**. La aplicación lee cada documento, reconoce
de quién es y a qué falta corresponde, y lo guarda en ese expediente.

Lo que antes obligaba a hacer, y ya no: entrar caso por caso, buscar al
efectivo en la lista y subirle su PDF.

## Dónde encaja en la base

Ya existe `public.expedientes`, una fila por nota:

| Columna | Qué guarda |
|---|---|
| `nota_id` | La falta a la que pertenece |
| `archivo_expediente_path` / `archivo_expediente_nombre` | El PDF firmado |
| `numero_oficio`, `numero_ht` | Referencias del documento |
| `dias_sancion` | Días impuestos |

El archivo va al depósito `expedientes`, cuya política de subida ya exige ser
administrador.

## Las tres piezas (así se plantearon el 28/09/2026; las tres están hechas)

1. **La IA aprende a leer un expediente firmado.** Hoy `extraer-nota-informativa`
   distingue nota de falta y de reincorporación. Hace falta un tipo nuevo que
   devuelva: número de la nota de falta, persona (grado, apellidos, nombres),
   código de infracción y días de sanción. Los modelos que enviará el responsable
   sirven para afinar ese prompt.
2. **Carga en lote con revisión**, igual que las dos que ya funcionan en la web
   (`btnFaltasLote` y `btnReincorporacionLote`): lee todos los PDF, los cruza con
   los casos existentes y muestra **una sola lista** («este PDF va al expediente
   de tal persona, nota N.º tal»). Se confirma de un toque y se guardan todos.
   La revisión se mantiene a propósito: un expediente firmado archivado en el
   caso equivocado es un error grave que no se descubre hasta mucho después.
3. **El botón de la aplicación.** Hoy «Subir expediente completo» abre el módulo
   web de consulta, que lista todos los expedientes; por eso el responsable ve
   una pantalla que no quería. Debe abrir directamente el escáner nativo
   (`ExpedienteActivity`, que ya escanea y elige PDF) con selección múltiple, y
   entregar el lote a la carga del punto 2.

## Lo que ya existe y se reutiliza

- `extractPdfText()` en la web: PDF a texto, con reconocimiento óptico de respaldo.
- `extraer-nota-informativa`: la función de IA a la que se le agrega el tipo nuevo.
- Los dos lotes actuales, que ya resuelven leer varios archivos, cruzarlos con los
  casos y revisar antes de guardar.
- `ExpedienteActivity`: escáner y selección de PDF ya hechos y probados.

## Lo que enseñaron los modelos reales (29/09/2026)

El responsable envió tres fajos escaneados. De ahí salieron cuatro cosas que no
se habrían adivinado, y dos de ellas ya causaban datos erróneos:

1. **Un PDF trae varios expedientes seguidos.** Uno de los fajos tenía 25 páginas
   con cinco expedientes; el segundo empieza en la página 6. Cada uno abre con su
   Hoja de Trámite del SIGE. Por eso hay que recortar el PDF: si se adjunta
   entero a cada caso, el expediente de cada efectivo contendría los datos de los
   demás.
2. **El código se escribe con guion**: `L-21` en la imputación, `L21` en la orden.
3. **«Sanción» en la imputación es el rango del Anexo**, no lo impuesto: «De
   AMONESTACION a CUATRO (04) días de Sanción Simple». Solo el campo «SANCIÓN
   IMPUESTA» de la orden dice lo que se resolvió.
4. **La notificación puede ser una hoja aparte**: «Notificación y entrega de acto
   administrativo», con diecisiete casillas donde se marca cuál de los actos se
   notifica (1 imputación, 2 orden de sanción, 3 archivo…) y la constancia de
   recepción con firma y huella. En los modelos antiguos ese recuadro iba al pie
   del propio documento.

Detalle práctico: varias páginas venían escaneadas de lado. El escáner de la
aplicación endereza solo, pero conviene escanear derecho para que la lectura
no dependa de eso.

Falta ver en documento real un expediente terminado en **archivo**: es el único
camino que todavía no se ha podido comprobar contra un documento de verdad.

## Cómo funciona (construido el 29/09/2026)

El administrador toca **«Subir expediente completo»** en la aplicación: se abre
el escáner nativo, escanea el fajo entero y, al continuar, la web abre la
pantalla de revisión con todos los expedientes ya separados. Desde un ordenador
es el botón **«Expedientes firmados (PDF)»**, que admite varios PDF a la vez.

El recorrido completo:

1. **Leer, página por página.** Los expedientes firmados son escaneos sin capa
   de texto —comprobado en los tres modelos reales: cero fuentes tipográficas—,
   así que el texto sale siempre del reconocimiento óptico. Se mandan **de a
   cuatro páginas, pidiendo una marca de corte entre ellas**, y el servidor
   comprueba que vuelvan las cuatro; si la cuenta no cuadra, solo ese lote se
   repite de a una. Así se conserva el límite exacto entre páginas sin gastar
   una llamada por hoja: un fajo de veinticinco se lee en siete llamadas y no en
   veinticinco, lo que importa porque el tope diario de IA es de 300 para todo
   el sistema.
2. **Separar.** Cada expediente abre con su inicio de imputación —o con una
   Hoja de Trámite, en los fajos que ya pasaron por mesa de partes. La apertura
   normal es la imputación: **la Hoja de Trámite se genera en el SIGE después**,
   al remitir el expediente, así que el que devuelve firmado el investigado no
   la trae. Lo que venga antes de la primera apertura se queda con el primer
   expediente en vez de perderse.
3. **Leer los datos** con las reglas de `lib/expedienteFirmado.js`.
4. **Pedir ayuda a la IA**, solo para los expedientes a los que les falte una
   llave (tipo `expediente_firmado` de `extraer-nota-informativa`). La IA nunca
   pisa lo que las reglas ya leyeron, ni decide a qué caso pertenece nada.
5. **Cruzar** con los casos: número de nota, luego CIP, luego nombre.
6. **Revisar**, en una sola lista con tres estados: listo, por revisar, detenido.
7. **Confirmar la fecha** en que se notificó la orden. Se propone leída de la
   casilla 2 de la hoja de notificación, pero se confirma a la vista: de ella
   arrancan los tres días hábiles para apelar, y una fecha legal no se guarda
   adivinada.
8. **Recortar y guardar.** Se saca del PDF solo las páginas de ese expediente y
   se guarda **en el mismo sitio que el formulario de un solo caso**: depósito
   `notas` y `registrar_notificacion_orden`, que es lo que deja el caso por
   concluido.

### Lo que la revisión detiene

No se guarda nada sin confirmar, y estas filas no se pueden confirmar:

- no se encontró el caso, o coinciden varios;
- el expediente no trae ni orden de sanción ni resolución de archivo;
- **dos expedientes del mismo lote apuntan al mismo caso** (se escaneó dos veces
  o el cruce se equivocó en uno; se detienen los dos).

Y estas avisan pero sí se pueden guardar: se encontró por CIP o por nombre en
vez de por número de nota, falta alguna pieza, la sanción no se dejó leer, el
caso ya tenía un expediente (se reemplaza), o la IA completó parte de los datos.

### Dónde se guarda, y por qué importa

El legajo firmado vive en `notas_informativas.archivo_orden_notificacion_path`,
y `orden_notificada_at` es lo que marca el caso como concluido. Es el sitio que
usa el formulario de un solo caso y donde el resto de la aplicación lo busca.

La primera versión de la carga en lote lo guardaba en `public.expedientes`, una
tabla que existe con campos de oficio, HT y días **pero está vacía: nadie la
usa**. La consecuencia era seria: los casos nunca habrían pasado a concluidos y
la bandeja habría seguido pidiendo un expediente ya subido, para siempre.

De paso, la lectura compara los **días del papel** con los que la web registró
al generar la orden (`sancion_dias`). Si no cuadran, uno de los dos está mal y
la fila se detiene a revisión.

### El oficio y la Hoja de Trámite se anotan después

Ninguno de los dos existe cuando se sube el legajo: el oficio se hace **después**
de tener el expediente completo, y la Hoja de Trámite la emite el SIGE y vuelve
**recepcionada por DIVOPUS**, como documento a adjuntar.

Por eso el caso no queda mudo al archivarlo: pasa a **«Expediente recibido,
falta el oficio»**, y después a **«Oficio hecho, falta la Hoja de Trámite»**.
Los dos salen además en la bandeja de pendientes. Ambos adjuntos se guardan en
`expedientes_remitidos`, que ya tenía sus columnas y su formulario en Recepción.

### Tres arreglos en la base que hicieron falta

Salieron al construir esto, con la tabla todavía vacía:

1. **Faltaba la política de UPDATE en `expedientes`.** El formulario manual
   insertaba la fila, subía el PDF y lo enlazaba con un `update` que RLS
   descartaba en silencio: el archivo quedaba en el depósito sin pertenecer a
   ningún expediente. Era un fallo real, no solo del lote.
2. **`numero_oficio` y `numero_ht` eran obligatorios.** El expediente suelto no
   trae ninguno de los dos; obligarlos forzaba a inventar un valor. Ahora son
   opcionales.
3. **Nada impedía duplicar.** Repetir la carga creaba un segundo expediente en
   cada caso sin avisar. Ahora `nota_id` es único y volver a subir es reemplazar,
   decidido a la vista y borrando el archivo anterior.

### Qué se comprobó de verdad

- Con el fajo real de 25 páginas: recortes de 5, 5 y 15 páginas, cada uno un PDF
  válido, y **cada página del recorte pesa exactamente lo que la página original
  que le toca** y distinto de las demás. Corta lo que debe cortar.
- Con los dos expedientes reales de 6 páginas: cero caracteres de texto en todas,
  confirmando que el reconocimiento óptico es obligatorio.
- En el navegador: el módulo carga sin errores y la pantalla de revisión abre y
  cierra.
- 26 pruebas de la carga en lote, 52 del lector, 330 en toda la web.

Sin comprobar todavía contra documento real: un expediente terminado en
**archivo** (sin sanción), y el recorrido entero con sesión iniciada, que
necesita las credenciales del responsable.

## Qué datos hay que leer de cada expediente

Analizados los tres modelos reales, estos son los datos y para qué sirve cada uno.
La diferencia importante es entre **llave** (sirve para encontrar el caso) y
**contenido** (se guarda o se comprueba, pero no identifica nada).

### Llaves, en el orden en que se confía en ellas

| Dato | Dónde está | Por qué se confía |
|---|---|---|
| **N.º de Nota Informativa de la falta** (12 dígitos) | Descripción del hecho, en la imputación y otra vez en la orden | Identifica **el caso**, no a la persona. Es la única llave que distingue dos faltas del mismo efectivo |
| **CIP del investigado** (6-8 dígitos) | Impreso en la decisión de la orden («CIP N° 31447206») y en el acta | Identifica **al efectivo** sin ambigüedad: `efectivos.cip` es único |
| **Código de infracción** (L-24) | Descripción de la infracción y en la decisión | No identifica solo; sirve para desempatar cuando el efectivo tiene varios casos |
| **Fecha del documento** | Al pie: «Ventanilla, 21 de agosto del 2026» | Desempate final y aviso si el expediente es de otro periodo que el caso |
| Apellidos y nombres | En todas las páginas | **El más débil.** Ver abajo |

El cruce va en ese orden y, si tras afinar por código queda más de un caso posible,
**no elige**: lo manda a revisión. Archivar el expediente firmado en el caso
equivocado es un error que no se descubre hasta mucho después.

### Contenido que se guarda o se comprueba

| Dato | Para qué |
|---|---|
| **Días impuestos y tipo** (8, Sanción Simple) | Es el resultado; va a `dias_sancion` |
| **Grado y nombre del investigado** | Se muestra en la revisión para que se vea a quién se le está archivando |
| **Superior que sanciona** | No es llave. Sirve para comprobar que el expediente es el que la web generó y para dejar constancia de quién firmó |
| **DNI del investigado** | Comprobación cruzada cuando el CIP se lee mal |
| **N.º de oficio y de Hoja de Trámite** | Referencias, cuando el fajo viene por mesa de partes |
| **Piezas presentes** | Para avisar si falta la notificación firmada, el acta o la orden |

### Los tres tropiezos de los modelos reales

1. **Los días se pueden leer mal, y es el error más caro.** Un mismo expediente
   trae tres cifras de días: el **rango** del Anexo I («De 8 a 10 días de Sanción
   Simple»), que aparece dos veces —en la imputación y dentro de la propia orden—;
   el **plazo para impugnar** («tres (3) días hábiles»); y la **decisión**, que es
   la única válida («con ocho (08) días de Sanción Simple»). Leer el rango en vez
   de la decisión registra 10 días donde se impusieron 8. Por eso solo se acepta
   lo que sigue a «SANCIONAR al», o el campo «SANCIÓN IMPUESTA» de la orden
   antigua; sin ninguno de los dos, se declara no resuelto en vez de adivinar.

2. **El orden del nombre cambia dentro del mismo expediente.** En un caso real la
   imputación decía «S3 PNP AYTHON JHON, Rodriguez Peramas» y el acta y la orden,
   del mismo efectivo, «S3 PNP Rodriguez Peramas AYTHON JHON». Por eso el nombre
   no puede ser la llave principal y la comparación es por palabras sueltas, sin
   depender del orden. Es la razón de peso para usar el CIP.

3. **No todo expediente trae Hoja de Trámite.** El fajo de mesa de partes sí, pero
   el expediente suelto empieza directamente por el inicio de imputación. El corte
   admite las dos aperturas, y descarta expresamente la hoja de «Notificación y
   entrega de acto administrativo», que menciona «1.- Inicio de imputación» solo
   porque es una de sus diecisiete casillas.

Detalle menor pero real: las páginas llegan desordenadas. En un modelo la segunda
hoja de la orden venía antes que la primera. La lectura trabaja sobre el bloque
entero, no página por página, así que no le afecta.

### Qué queda para la IA

Las reglas de arriba no necesitan IA. La IA entra solo cuando el reconocimiento
óptico devuelve texto sucio y alguna llave no se deja leer: se le pasa el texto
del bloque y se le pide **únicamente** número de nota, CIP, código y días. Nunca
decide a qué caso pertenece; eso lo hace el cruce, y lo confirma una persona.

## Riesgo a tener presente

`app.js` no tiene pruebas automáticas (hallazgo M8 de la auditoría), y ahí viven
las cargas en lote que usa el comando a diario. La lógica nueva de cruce debe
escribirse en `lib/`, que sí tiene pruebas, y dejar `app.js` solo como conexión.
