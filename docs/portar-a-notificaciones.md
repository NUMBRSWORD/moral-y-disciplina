# Cambios de moral-y-disciplina para portar a notificaciones-pnp

Registro de lo que se modificó en **moral-y-disciplina** (repo `FALTOS`) en la
sesión de 8–9 set 2026, para replicarlo en **notificaciones-pnp**
(`C:\Users\CPNP. VENTANILLA\OneDrive\Desktop\CHAT GPT\notificaciones-pnp-`).

> Las dos apps comparten `lib/` pero divergen en nombres. **Nunca apliques un
> diff crudo entre ellas.** Traduce campo por campo con esta tabla:

| moral-y-disciplina | notificaciones-pnp |
|---|---|
| tabla `notas_informativas` | `casos` |
| variable `nota` | `caso` |
| `fecha_falta` | `fecha_hecho` |
| `orden_sancion_generada_at` | `sancion_generada_at` |
| `orden_notificada_at` | `orden_notificada_at` (igual) |
| `imputacion_generada_at` | igual |
| `fecha_descargo`, `archivo_descargo_path/_nombre` | igual (verificar) |
| `archivo_orden_notificacion_path/_nombre` | igual (verificar) |
| tabla `profiles` (`role='admin'`) | `perfiles` |
| `renderNotasTable(...)` | `renderCasosTable(...)` |
| `estadoDeNota(n)` / `claseEstadoNota(n)` | equivalentes en notif (revisar nombre) |
| `progresoNotaHtml(n)` | `progresoCasoHtml(c)` |
| `aplicarFiltrosNotas()` | filtro equivalente en notif |
| pestaña **«Expedientes»** (`data-view="dashboard"`) | pestaña **«Casos»** |
| Edge Function `redactar-analisis` | `analizar-descargo-sancion` |
| Edge Function `revisar-documento-ia` | **mismo nombre en ambas** |
| proyecto Supabase `tndjulaitywtoocqeeiy` | (el de notificaciones) |

---

## Ya está en notificaciones (se portó DESDE ahí — no hace falta nada)

- Guía visual del trámite («Siguiente paso», stepper del modal, spinner `.is-busy`) — notif `8f50d49`, `075521b`.
- Móvil: filas como tarjetas + barra superior compacta + modales hoja inferior — notif `e8a2fb8`, `a189737`.
- Respaldo en Google Drive de expedientes cerrados — notif `648af52`.
- Validación de expediente completo firmado en Recepción — notif `57af356`.
- Alertas push automáticas por avance — notif `bde31f5`.

## Falta portar A notificaciones (esto es lo nuevo de esta sesión)

### 1. Pantalla de inicio limpia + pestaña «Seguimiento» aparte
_(commits m-y-d `a76c8cb`, `f76834d`, `5ac3a49`, `d07dfa9`)_

**Idea:** la pestaña de inicio (en notif: **«Casos»**) muestra **solo lo
pendiente**. Una pestaña nueva **«Seguimiento»** al lado guarda el buscador, el
filtro por fecha, «Exportar a Excel», «Resumen ejecutivo IA» y muestra **solo lo
resuelto** (Orden notificada). Las dos listas usan el mismo diseño de tarjetas.

Pasos:

1. **`index.html`**
   - Dejar la pestaña «Casos» como estaba. Añadir al lado:
     `<button id="tabSeguimiento" class="tab-btn" data-view="seguimiento">Seguimiento</button>`
   - Sacar de `#view-dashboard` el buscador, los `Desde/Hasta`, `Exportar a
     Excel`, `Resumen ejecutivo IA` y el `#resumenEjecutivoPanel`.
   - Crear `<section id="view-seguimiento" class="view hidden">` con: cabecera,
     `view-actions` (Exportar + Resumen IA), `#panelBusquedaNotas` (search +
     Desde/Hasta + botón «Limpiar»), `#resumenEjecutivoPanel`, y una tabla con
     `<tbody id="seguimientoTableBody">` + `<p id="seguimientoEmpty">`
     (mismas columnas que la tabla de Casos).
2. **`app.js`**
   - `showView`: añadir `"view-seguimiento": "seguimiento"` al `map`.
   - Handler de tabs: `if (target === "seguimiento") { showView("view-seguimiento"); loadCasos(); }`
   - `renderCasosTable(list, tbodyId = "...", emptyId = "...", emptyMsg = "...")`
     — parametrizar el `<tbody>`, el `<p>` de vacío y el mensaje. `if (!tbody) return;`.
   - Sacar `renderResumenRapido*` / `renderBandejaAcciones*` de dentro de
     `renderCasosTable` y llamarlos en `loadCasos`.
   - `loadCasos`: tras cargar `state.casos`:
     - `renderResumenRapido...(); renderBandejaAcciones...();`
     - `renderCasosTable(state.casos.filter(c => !casoConcluido(c)), "casosTableBody", "casosEmpty", "No hay casos pendientes. Los resueltos están en «Seguimiento».")`
     - `aplicarFiltros...()`  → renderiza en `seguimientoTableBody`.
   - `casoConcluido(c) => !!c.orden_notificada_at`.
   - En el filtro de Seguimiento: `if (!casoConcluido(c)) return false;` antes del
     resto (texto + fecha). Render → `renderCasosTable(filtrados, "seguimientoTableBody", "seguimientoEmpty", vacioMsg)`.
   - Quitar el botón plegable de búsqueda si notif lo tuviera (aquí el panel vive
     siempre visible dentro de «Seguimiento»).
3. **`styles.css`**
   - El bloque de tarjetas móviles: cambiar el selector `#view-dashboard ...`
     por `:is(#view-dashboard, #view-seguimiento) ...` para que la lista de
     Seguimiento también se vea como tarjetas.
   - `#tabSeguimiento { color: var(--accent); font-weight: 600; }` (pestaña en verde).
4. Estado **«Concluido»**: en `estadoDeCaso`/`claseEstadoCaso` añadir
   `if (casoConcluido(c)) return "Concluido" / "pill-yes"`. En `progresoCasoHtml`,
   si está concluido marcar los pasos como `is-done` (sin `is-current`) y anteponer
   `✓` al texto de la píldora.

### 2. «Cargo del expediente firmado» + IA de completitud
_(commit m-y-d `b536b42` + Edge Function `revisar-documento-ia` **v8**)_

**Idea:** el paso «Notificación de la Orden de Sanción» pasa a llamarse
**«Cargo del expediente firmado»**: se sube el legajo COMPLETO firmado
(Imputación, notificación, descargo/acta, Orden, cargo de notificación) en un
solo PDF. «Verificar con IA» dice qué documentos trae el PDF y cuáles faltan. Si
el caso ya tiene descargo firmado cargado, se avisa que va adjunto y la IA no lo
cuenta como faltante.

Pasos:

1. **Edge Function `revisar-documento-ia`** (desplegar en el proyecto Supabase de
   notificaciones — es el MISMO nombre de función). Añadir:
   - `SYSTEM_PROMPT_EXPEDIENTE`: revisa el legajo completo, reconoce cada
     documento por encabezados aunque el OCR esté sucio, y devuelve
     `{consistente, presentes:[], faltantes:[], observaciones:[], fecha_detectada}`.
     Un documento marcado «ya consta por separado» cuenta como presente.
   - `buildUserMessageExpediente(input)`: arma el mensaje con investigado, código,
     sanción, la lista `componentesEsperados` (`{etiqueta, yaConsta}`) y el
     `textoDocumento`.
   - En `Deno.serve`: `else if (input.tipo === "expediente_completo") { system = ...; userMessage = buildUserMessageExpediente(input); }`
   - `max_tokens: 1500`, y filtrar `b.type === "text"` al leer `data.content`.
   - El código exacto está en `moral-y-disciplina` → función `revisar-documento-ia` v8.
2. **`app.js`** (adaptar `nota`→`caso`, etc.):
   - `componentesEsperadosExpediente(caso)`: `["Inicio de Imputación de Infracción
     Leve", "Notificación de la imputación al investigado", caso.fecha_descargo ?
     {etiqueta:"Descargo firmado del investigado", yaConsta: !!caso.archivo_descargo_path}
     : {etiqueta:"Acta de No Descargo"}, "Orden de Sanción", "Cargo de notificación
     firmado por el investigado"]`.
   - En `renderCasoDetail`, la tarjeta de notificación de la Orden:
     - Título → `Cargo del expediente firmado`.
     - Texto de ayuda → «Suba el legajo completo firmado en un solo PDF…».
     - Si `caso.archivo_descargo_path`: `<p class="campo-guardado">✓ El descargo
       firmado ya está registrado (nombre) y queda adjunto…</p>`.
     - Label del input → «Cargo del expediente firmado (un solo PDF con todos los
       documentos)». Botón → «✨ Verificar con IA que esté completo». Submit → «Registrar».
     - En la rama «ya notificada»: mostrar el link del legajo firmado y, si hay
       descargo, el link del descargo adjunto.
   - `verificarNotificacionOrdenIA(caso)`: llamar `revisar-documento-ia` con
     `tipo: "expediente_completo"`, `componentesEsperados`, `textoDocumento`
     (de `extractPdfText` / OCR). Pintar `data.faltantes` en negrita y
     `data.observaciones`. Seguir rellenando `fecha_detectada`.
   - `submitNotificacionOrden`: subir el PDF como
     `${caso.id}/expediente_firmado_${Date.now()}_${file.name}` y llamar al RPC
     `registrar_notificacion_orden` (sin cambios). Spinner en el botón.
   - Textos de «siguiente paso» / bandeja: «Cargue el expediente firmado / Suba el
     legajo completo firmado en un PDF (la IA revisa que esté completo)…».

## Al terminar en notificaciones

- `node --check app.js`, `node --test lib/*.test.js`.
- Verificar en el navegador (preview) las dos vistas y la tarjeta nueva.
- Subir la caché del service worker (`v?` → `v?+1`) para que los celulares
  recojan el cambio.
- `git commit` + `git push`.
