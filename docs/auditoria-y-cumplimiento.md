# Auditoría de calidad — moral-y-disciplina (set 2026)

Revisión de código, base de datos, seguridad, accesibilidad y operación de
`numbrsword.github.io/moral-y-disciplina/` (Supabase `tndjulaitywtoocqeeiy`).

## Resultado

**Calificación: B → A- tras las correcciones de esta ronda.** Base de acceso
(RLS) sólida, librería testeada, respaldo redundante y rastro de auditoría.

---

## Hallazgos y estado

### Corregidos en código / base de datos

| Hallazgo | Corrección | Commit / migración |
|---|---|---|
| CI no verificaba `app.js` (los tests solo cubren `lib/`) | `npm test` ahora corre `scripts/check.mjs` (`node --check` de los 14 JS) antes de los tests; el workflow ya bloquea build/deploy si `test` falla | `scripts/check.mjs`, `package.json` |
| 5 `alert()` bloqueantes | Reemplazados por `toast()` | app.js |
| `<button>` sin `type` dentro de `<form>` (envío accidental) | Barrido al iniciar: `button:not([type]) → type="button"` | app.js |
| Errores de formulario no anunciados por lector de pantalla | `role="alert"` en los 14 `<p class="error">` | app.js, index.html |
| `prefers-color-scheme` no se detectaba (usuario nuevo siempre oscuro) | El script del `<head>` ahora respeta la preferencia del SO si no hay elección guardada | index.html |
| Chart.js y xlsx se descargaban en cada carga aunque no se usen | Carga diferida con `import()` dinámico (solo al abrir Panel / exportar) | app.js |
| 12 claves foráneas sin índice de cobertura (advisor `unindexed_foreign_keys`) | Índices `ix_*` creados | migración `auditoria_indices_fk` |
| 6 políticas RLS re-evaluaban `auth.uid()` por fila (advisor `auth_rls_initplan`) | Envueltas en `(select auth.uid())` | migración `auditoria_rls_initplan` |
| Funciones `SECURITY DEFINER` ejecutables por `anon` (advisor 0028) | `REVOKE EXECUTE … FROM anon` en las 10 funciones de `public`; `authenticated` conserva solo lo que la app y la RLS necesitan (verificado con `has_function_privilege`) | migración `auditoria_revoke_anon_execute` + `auditoria_revoke_anon_explicito` |
| Emojis 🌙/☀️ y 🔎/✨/☁/⬇/✍/📲 como iconografía | Set SVG (helper `svgIco`) | commits previos + este |
| **`Ctrl+K` mostraba CIP y DNI de todo el personal a cualquier oficial** (Ley N° 29733) | El padrón completo ahora **solo lo ve el administrador**: RLS `efectivos` SELECT = `es_admin() OR cip = cip_actual()` (el oficial solo recibe su propia ficha, la única que necesita para sus documentos), y la sección "Personas" del buscador se oculta a los no-admin. El CIP del investigado se guardó en cada nota (`investigado_cip`) para que la Orden de Sanción se genere sin consultar el padrón. | migración `efectivos_solo_admin_ve_padron` + `notas_denormaliza_investigado_cip` + app.js |

> Nota operativa: el backfill del `investigado_cip` emparejó 92 de 111 notas por
> nombre exacto. En las 19 restantes (nombre con otra grafía, o investigado que no
> está en Efectivos) un oficial no-admin no podrá generar la Orden hasta que el
> **administrador** corrija el nombre en Efectivos / en la nota, o genere él la
> Orden (el admin siempre puede, usa el padrón completo).

### Aceptados (riesgo asumido por el responsable — dejar constancia por escrito)

- **Funciones RPC ejecutables por usuarios autenticados (advisor 0029).** Es el
  diseño: cada RPC se autoprotege con `es_admin() OR oficial_constato_cip =
  cip_actual()`. No se revoca porque el cliente las necesita.
- **`pg_net` en el esquema `public`** y **`imputacion_pnp.set_updated_at` con
  `search_path` mutable**: pertenecen a la otra app (`notificaciones-pnp`) que
  comparte el proyecto Supabase. No se tocan desde aquí.
- **RLS activo sin políticas en `google_drive_conexion` / `google_drive_oauth_estados`**:
  intencional — solo las Edge Functions (service_role) las leen; el `refresh_token`
  nunca llega al navegador.

### Pendiente — acción del usuario (no se puede hacer desde el código)

1. **Supabase → Authentication → Providers/Policies: activar "Leaked password
   protection"** (bloquea claves aparecidas en filtraciones conocidas). 1 clic.
2. **Segundo administrador.** Hoy hay un solo CIP admin → punto único de fallo.
   Ver `docs/recuperacion-de-acceso.md`.
3. **Acta de protección de datos y retención.** Ver la plantilla al final de
   este documento.

---

## Política de datos personales y retención (plantilla para firmar)

> **CPNP Ventanilla — Módulo Moral y Disciplina (infracciones leves)**
>
> 1. **Datos tratados.** Nombres, grado, CIP, DNI, unidad, y datos del
>    procedimiento disciplinario (notas informativas, descargos, órdenes de
>    sanción) del personal PNP de la comisaría.
> 2. **Finalidad.** Gestión del procedimiento disciplinario por infracciones
>    leves conforme a la Ley N° 30714 y su reglamento.
> 3. **Base legal.** Ejercicio de la función disciplinaria de la PNP.
> 4. **Acceso.**
>    - **Administrador** (jefe de la unidad o quien designe): acceso total.
>    - **Oficial instructor**: solo los expedientes donde figura como oficial
>      que constató la falta.
>    - El **padrón de personal** (nombres, grado, CIP, DNI de todos) solo es
>      accesible para los usuarios con rol administrador. Un oficial no-admin
>      solo ve su propia ficha y sus propios expedientes.
>      Administradores designados: __________________________________________.
> 5. **Conservación.** Los expedientes y archivos generados se conservan por
>    ______ años desde el cierre (sugerido: el plazo de prescripción del régimen
>    disciplinario + 1 año). Vencido el plazo se anonimizan o eliminan.
> 6. **Respaldo.** Supabase (base de datos y archivos) + copia en Google Drive
>    de la cuenta institucional. Copia manual en JSON disponible desde Ajustes.
> 7. **Responsable del tratamiento.** _____________________  Firma: ___________
>    Fecha: ___________

---

## Recuperación de acceso — ver `docs/recuperacion-de-acceso.md`
