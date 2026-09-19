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

## Seguridad y limpieza (19 set 2026) — replicar en notificaciones-pnp

Sale de la revisión de seguridad hecha sobre moral-y-disciplina. Aplica a
notificaciones-pnp si comparte proyecto Supabase (existe un esquema
`imputacion_pnp` en el mismo) o si su repo es público. Orden recomendado:
**1 → 2 → 3 → 4**. Nada de esto cambia lo que ven los usuarios, salvo el punto 2.

### 1. Exigir sesión en las Edge Functions de IA (urgente)

**Problema.** `verify_jwt` solo comprueba que el token sea un JWT válido, y la
*anon key* (pública, está en `config.js`) lo es. Con solo esa clave, cualquiera
podía llamar a las funciones de IA a costa de la cuenta de Anthropic.

**Arreglo.** Dentro de cada función, exigir un usuario real con
`auth.getUser(token)` (la anon key devuelve 403 «missing sub claim»):

```ts
import { createClient } from "jsr:@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const ORIGENES_PERMITIDOS = ["https://numbrsword.github.io"];

// Restringir el origen es solo higiene: la protección real es la sesión.
function corsHeaders(req: Request) {
  const origen = req.headers.get("origin") || "";
  const permitido = ORIGENES_PERMITIDOS.includes(origen) || /^http:\/\/localhost(:\d+)?$/.test(origen);
  return {
    "Access-Control-Allow-Origin": permitido ? origen : ORIGENES_PERMITIDOS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

async function haySesion(req: Request): Promise<boolean> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  const { data, error } = await createClient(SUPABASE_URL, SUPABASE_ANON_KEY).auth.getUser(token);
  return !error && !!data.user;
}

// En Deno.serve, justo después del OPTIONS:
//   const cors = corsHeaders(req);
//   if (!(await haySesion(req))) {
//     return new Response(JSON.stringify({ error: "Debe iniciar sesión." }),
//       { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
//   }
```

Pasos:

1. Aplicar el bloque a cada función de IA propia de notificaciones
   (`analizar-descargo-sancion`, `redactar-hecho-imputacion`,
   `sugerir-codigo-infraccion`, `asistente-normativa`). Las de moral-y-disciplina
   (`revisar-documento-ia`, `extraer-nota-informativa`, `extraer-texto-vision`,
   `asistente-md`, `generar-resumen-casos`, `redactar-analisis`) **ya están
   protegidas**: confirmar que notificaciones las llama **con sesión iniciada**
   (`supabase.functions.invoke` ya envía el token del usuario; una llamada con
   `fetch` a mano con la anon key ahora recibe 401).
2. Desplegar de una en una y probar con la anon key: debe dar **401**
   (`curl -X POST <url>/functions/v1/<funcion> -H "Authorization: Bearer <ANON>" -H "apikey: <ANON>" -d "{}"`).
3. Probar cada función de IA dentro de la app **con sesión iniciada**.
4. **No** poner este bloque en funciones que se llaman sin sesión de usuario:
   el cron de alertas (se protege con su propio secreto) y los callbacks OAuth
   (se protegen con un `state` de un solo uso y con vencimiento).

### 2. Cambio obligatorio de la clave inicial

**Problema.** Las cuentas se crearon con una clave inicial fácil de adivinar y la
app no tenía dónde cambiarla.

**Arreglo** (commit «Exige cambiar la clave inicial…»):

- `lib/acceso.js` + `lib/acceso.test.js`: copiar tal cual (son funciones puras).
- `index.html`: el modal `#modalCambiarClave` y el botón `#btnCambiarClave` en la
  barra superior.
- `app.js`: importar `esClaveInicial`/`validarClaveNueva`; en el submit del login,
  tras un ingreso correcto, `if (esClaveInicial(usuarioEscrito, clave)) abrirCambioClave({ obligatorio: true, claveActual: clave })`
  **dentro de un `try/catch`** (si falla, nunca debe impedir el ingreso); y el
  bloque «Cambio de clave» con `supabase.auth.updateUser({ password })`.
- Si las dos apps comparten usuarios de Auth, cambiarla en una vale para la otra.

### 3. Datos personales fuera del repositorio

Si el repo es público, revisar y limpiar **el árbol y también el historial**:

1. Buscar archivos de ejemplo con datos reales en cualquier commit:
   `git log --all --pretty=format: --name-only | sort -u` (mirar `.docx`, `.pdf`,
   `.xlsx`, `.csv`, `.json`). Un `.docx` es un zip: su texto está en
   `word/document.xml`.
2. Sacar esos archivos del repo y añadirlos al `.gitignore`
   (`plantillas/*_ejemplo.docx`, `.env`, `.env.*`, `supabase/.temp/`). Guardarlos
   fuera de la carpeta del proyecto.
3. Reemplazar por nombres, CIP y DNI **ficticios** los que haya en pruebas
   (`lib/*.test.js`), comentarios y *placeholders* de la interfaz (buscar con
   `git grep` cada apellido y cada CIP/DNI).
4. **Purgar el historial** (hacer antes un respaldo: `git clone --mirror . ../respaldo.git`).
   Con un script *fuera del repo* (contiene los datos reales) aplicado a cada
   commit con `filter-branch`:

   ```python
   # purga.py — vive FUERA del repo. Idempotente.
   import os, re
   EXT = {".js", ".md", ".html", ".css", ".json", ".sql", ".ts", ".toml", ".yml"}
   BORRAR = ["plantillas/<ejemplo con datos reales>.docx"]
   REGLAS = [(r"<APELLIDOS REALES>", "Apellidos Ficticios"), (r"<CIP REAL>", "400001")]
   for ruta in BORRAR:
       if os.path.exists(ruta): os.remove(ruta)
   for raiz, dirs, archivos in os.walk("."):
       dirs[:] = [d for d in dirs if d not in {".git", "node_modules"}]
       for nombre in archivos:
           if os.path.splitext(nombre)[1].lower() not in EXT: continue
           ruta = os.path.join(raiz, nombre)
           try: texto = open(ruta, "rb").read().decode("utf-8")
           except (UnicodeDecodeError, OSError): continue
           nuevo = texto
           for patron, reemplazo in REGLAS:
               nuevo = re.sub(patron, reemplazo, nuevo, flags=re.I)
           if nuevo != texto: open(ruta, "wb").write(nuevo.encode("utf-8"))
   ```

   En **Windows/PowerShell** (aquí falló la primera vez): copiar el script a una
   ruta **sin espacios**, abrir PowerShell **normal** (no como Administrador) y
   **dentro de la carpeta del repo**, y pegar **un comando por vez**:
   - `git -c core.autocrlf=false filter-branch --force --tree-filter "python C:/ruta/sin/espacios/purga.py" -- main`
   - Comprobar: `git grep -IiE "<patrón de nombres y CIP>" (git rev-list main)` debe
     salir vacío, y `git rev-parse "main^{tree}"` debe ser igual al de antes.
   - `git push --force-with-lease=main:<sha anterior de origin/main> origin main`
   - Borrar las demás ramas remotas viejas (`git push origin --delete <rama>`).
5. Los PR cerrados y las cachés de GitHub siguen apuntando a los commits viejos:
   pedir al soporte de GitHub que las limpie. Reescribir el historial reduce la
   exposición, no la elimina.

### 4. Backend en git

Las funciones y las migraciones de Supabase deben estar en el repo
(`supabase/functions/`, `supabase/migrations/`, `supabase/config.toml`):

- Funciones: `supabase functions download <nombre>`, o exportarlas desde el panel.
- Migraciones: exportar de `supabase_migrations.schema_migrations`.
- **No subir** (repo público): migraciones que crean cuentas o fijan credenciales;
  *backfills* con CIP/DNI o identificadores de personas; secretos escritos en el
  cuerpo de un job de cron (dejar marcadores `<...>`; lo ideal es Supabase Vault);
  migraciones de la otra app. Dejar un `README.md` en `supabase/migrations/` que
  diga qué se omitió y por qué.
- `supabase/config.toml`: `verify_jwt = false` **solo** para callbacks que un
  tercero llama sin token (p. ej. el de Google Drive).

### 5. Verificación final

- `npm test` (sintaxis + pruebas) y, en el navegador, ingresar y usar una función
  de IA de cada tipo.
- Repetir el barrido del punto 3 sobre `origin/main` ya publicado.
- Subir la caché del service worker (`v?` → `v?+1`).

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
