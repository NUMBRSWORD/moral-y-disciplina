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
| C1 | Credenciales iniciales predecibles en cuentas antiguas; el cambio obligatorio solo se exigía en el navegador | Crítica | Exigencia en servidor: ver estado final abajo · rotación de claves: **acción del responsable** |
| A1 | Las reglas de Storage no relacionaban los archivos con el expediente de cada oficial; sin límites de tamaño ni tipo | Alta | Ver estado final |
| A2 | «Hoy» en hora UTC y días hábiles sin feriados (TUO Ley 27444, art. 134.1) | Alta | Ver estado final |
| A3 | Las funciones de IA validaban sesión pero no que el usuario estuviera aprobado; sin cuota ni tope de entrada | Alta | Ver estado final |
| A4 | `extraer-nota-informativa` fallaba con notas grupales largas | Alta | Ver estado final |
| A5 | Sin copias automáticas de la base; cuentas personales como titulares | Alta | **Acción del responsable** + guía |
| A6 | Datos personales (Ley 29733): sin aviso de privacidad, flujo transfronterizo, registro, incidentes | Alta | Ver estado final |
| A7 | La IA preseleccionaba la sanción; la evaluación de impacto decía lo contrario | Alta | Ver estado final |
| M1-M10 | CSP e integridad de subrecursos, credenciales en texto claro, 2FA, auditoría de `profiles`, monitoreo, pruebas de `app.js`, firma digital, retención | Media | Ver estado final |

## Lo que solo puede hacer el responsable de la cuenta
1. Rotar las claves de las cuentas que aún conservan la clave inicial (script en la guía privada).
2. Activar 2FA en todas las cuentas y ajustar el largo mínimo de clave en el panel de Supabase.
3. Decidir el plan de Supabase (copias automáticas y sin pausa por inactividad) o programar la copia.
4. Trasladar la titularidad de Supabase, GitHub y Google a cuentas institucionales.
5. Registrar el banco de datos personales ante la Autoridad Nacional de Protección de Datos y firmar
   la política institucional de IA (pestaña Cumplimiento).
6. Consultar a la SGTD si `redactar-analisis` es de riesgo alto (art. 23.3 y 24.2 del Reglamento de IA).
