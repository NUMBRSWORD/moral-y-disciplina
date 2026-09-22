# Auditoría de seguridad y cumplimiento — 21-sep-2026

Revisión de la app (`numbrsword.github.io/moral-y-disciplina`), del proyecto Supabase, de las Edge
Functions y del pipeline de despliegue. Complementa `docs/auditoria-y-cumplimiento.md` (ronda
anterior) y `docs/cumplimiento-ley-ia.md`.

> **Este documento es público a propósito y no incluye detalles de explotación.** El informe técnico
> completo (con evidencia) se guarda fuera del repositorio.

## Método
Consultas de solo lectura a la base (políticas de acceso, funciones, triggers, almacenamiento,
cuentas), avisos del linter de Supabase, registros de 24 h, lectura del código y comparación con la
normativa (Ley 29733, Ley 31814 y DS 115-2025-PCM, TUO de la Ley 27444, Ley 30714 y DS 016-2025-IN)
y con referencias internacionales (OWASP Top 10, NIST SP 800-63B, ISO/IEC 27001).

## Hallazgos y estado

Estado: **Corregido** (código o base de datos) · **Acción del responsable** (solo puede hacerlo
quien administra la cuenta u organización) · **Documentado** (plantilla o guía lista).

| ID | Hallazgo | Sev. | Estado |
|---|---|---|---|
| C1 | Credenciales iniciales predecibles en cuentas antiguas; el cambio obligatorio solo se exigía en el navegador | Crítica | **Corregido:** el servidor no da acceso a una cuenta con cambio de clave pendiente. **Acción del responsable:** rotar esas claves (script privado) |
| A1 | Storage: los archivos de un expediente eran legibles por cualquier usuario aprobado; sin límites de tamaño ni tipo | Alta | **Corregido** (migraciones `storage_por_expediente_y_limites` y `casos_imputacion_limites_y_lectura_acotada`, que completa el depósito `casos-imputacion-pnp`) |
| A2 | «Hoy» en hora UTC y días hábiles sin feriados (TUO Ley 27444, art. 134.1) | Alta | **Corregido** (`lib/fechas.js`, +19 pruebas) |
| A3 | Funciones de IA: sesión válida pero no usuario aprobado; sin cuota ni tope de entrada; 4 funciones sin protección | Alta | **Corregido** en las 10 funciones (`autorizar_uso_ia`). Las 4 que solo estaban en el servidor ya tienen copia en `supabase/functions` |
| A4 | `extraer-nota-informativa` fallaba con notas grupales largas | Alta | **Corregido** (más margen y mensajes claros) |
| A5 | Sin copias automáticas de la base; cuentas personales como titulares | Alta | **Acción del responsable** (guía en `docs/respaldos.md`) |
| A6 | Datos personales (Ley 29733): aviso, flujo transfronterizo, registro, incidentes | Alta | **Corregido en la app** (aviso, resumen sin nombres) · **Documentado** (`docs/proteccion-datos-personales.md`, `docs/plan-incidentes.md`) · trámites: responsable |
| A7 | La IA preseleccionaba la sanción; la evaluación de impacto decía lo contrario | Alta | **Corregido** (solo sugiere; aviso de apoyo de IA opcional; documento actualizado) · consulta a la SGTD: responsable |
| M1 | Librerías de un tercero sin versión fija ni CSP | Media | **Parcial:** versión fija de la librería de Supabase; CSP y copia propia de las librerías, pendientes |
| M4 | 2FA solo en 1 de 2 administradores; largo mínimo de clave solo en el navegador | Media | **Acción del responsable** (panel de Supabase) |
| M5 | Cambios de rol y aprobaciones sin auditoría | Media | **Corregido** (triggers en `profiles`, `roles_servicio`, `solicitudes_acceso`, `firmas_documentos`) |
| M9 | La firma en Cumplimiento parecía firma digital | Media | **Corregido** (se aclara que es constancia interna, Ley 27269) |
| M3, M7, M8, M10 | Credenciales en texto claro (cron, Drive), sin monitoreo, `app.js` sin pruebas, retención automática | Media | Pendiente / documentado |

## Lo que solo puede hacer el responsable de la cuenta
1. Rotar las claves de las cuentas que aún conservan la clave inicial (script en la guía privada).
2. Activar 2FA en todas las cuentas y ajustar el largo mínimo de clave en el panel de Supabase.
3. Decidir el plan de Supabase (copias automáticas y sin pausa por inactividad) o programar la copia.
4. Trasladar la titularidad de Supabase, GitHub y Google a cuentas institucionales.
5. Registrar el banco de datos personales ante la Autoridad Nacional de Protección de Datos y firmar
   la política institucional de IA (pestaña Cumplimiento).
6. Consultar a la SGTD si `redactar-analisis` es de riesgo alto (art. 23.3 y 24.2 del Reglamento de IA).
