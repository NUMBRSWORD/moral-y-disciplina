# Cumplimiento de la Ley N.° 31814 (Ley de IA) — moral-y-disciplina

Auditoría del uso de Inteligencia Artificial en la app contra el Reglamento de la Ley
N.° 31814, aprobado por Decreto Supremo N.° 115-2025-PCM (El Peruano, 9-set-2025).
Metodología y checklist reutilizable: skill `normativa-ia-peru` (`~/.claude/skills/`),
para aplicar también a notificaciones-pnp y a cualquier función de IA futura.

**Ámbito:** la app es de una entidad de la Administración Pública (Comisaría PNP
Ventanilla) → el Reglamento **sí aplica** (art. 3). No cae en las excepciones del art. 4
(no es uso personal, ni un sistema de defensa/seguridad nacional).

## 1. Inventario de funciones con IA y su clasificación de riesgo

| Función (Edge Function) | Qué hace | ¿Decide algo sola? | Riesgo (art. 22-24) |
|---|---|---|---|
| `redactar-analisis` | Redacta un borrador del "Análisis y Evaluación" del descargo para la Orden de Sanción | **No.** Escribe en un `<textarea>` editable; el tercio de sanción lo elige el humano en un desplegable; el humano hace clic en "Generar Orden de Sanción" por separado | Ver §2 — es la más cercana a la zona gris del art. 24.1.e |
| `revisar-documento-ia` | Revisa consistencia de la imputación antes de generarla; verifica que el cargo de notificación/expediente corresponda; detecta el puesto en el rol de servicio y avisa si la persona estaba de vacaciones/permiso | **No.** Solo muestra observaciones/advertencias en pantalla; nunca bloquea ni completa nada por sí sola | Riesgo aceptable (función de control de calidad, no decisoria) |
| `extraer-nota-informativa` | Extrae de un PDF/imagen (nota, rol de servicio) los campos para autocompletar el formulario | **No.** Todos los campos autocompletados quedan en inputs editables (`dataset.autofilled`); el humano guarda aparte | Riesgo aceptable |
| `extraer-texto-vision` | OCR/transcripción de PDFs difíciles de leer | Extracción de texto, no interpretación ni decisión | Riesgo aceptable |
| `generar-resumen-casos` | Resumen ejecutivo en texto libre del estado de los expedientes, para el admin | Informativo; no persiste ni afecta ningún expediente | Riesgo aceptable |
| `asistente-md` | Responde consultas sobre el procedimiento y las directivas internas | Informativo | Riesgo aceptable |

**Conclusión general:** en las 6 funciones, la IA **redacta, extrae o advierte — nunca
decide ni ejecuta por sí sola**. Cada resultado pasa por una pantalla editable y un clic
humano explícito antes de tener cualquier efecto (guardar, generar un documento,
notificar). Esto ya satisface, en los hechos, el núcleo del art. 24.11/31.4 (supervisión
humana con capacidad de corregir o invalidar), esté o no la función clasificada como
riesgo alto.

## 2. El punto que requiere una decisión que no es técnica

El art. 24.1.e clasifica como riesgo alto la IA para "procesos de selección, evaluación,
contratación y cese de trabajadores... así como establecer condiciones laborales". La
Exposición de Motivos lo ejemplifica casi enteramente con **sesgo en reclutamiento**
(edad, sexo, lugar de residencia de postulantes), no con sistemas disciplinarios de
personal ya en servicio. La letra no lo dice con esas palabras, pero `redactar-analisis`
participa en la redacción de un documento (Orden de Sanción) que impone una sanción
disciplinaria a un efectivo — lo más cercano a "evaluación... de trabajadores" que hay en
esta app.

**No es una pregunta que se resuelva en el código.** El propio Reglamento (art. 23.3 y
24.2) da un canal formal: el desarrollador/implementador puede pedirle a la **SGTD**
(Secretaría de Gobierno y Transformación Digital, PCM) una consulta para que determine
si el sistema es de riesgo alto. **Recomendación: hacer esa consulta formalmente.**
Mientras se resuelve, esta app ya cumple las salvaguardas de riesgo alto que importan
(§1, §3) por diseño, así que el costo de esperar la respuesta es bajo.

## 3. Salvaguardas ya implementadas (evidencia, no promesa)

- **Supervisión humana real** (§1): ninguna función de IA se auto-ejecuta sin un clic
  humano posterior, en ningún flujo.
- **Transparencia hacia quien opera la función**: todos los botones de IA dicen
  explícitamente "✨ ... con IA" antes de usarse (`svgIco("ia")` + texto).
- **Privacidad desde el diseño** (art. 26/29.b, ya resuelto en
  `docs/auditoria-y-cumplimiento.md`): el padrón completo con DNI solo lo ve el admin
  (RLS `efectivos_solo_admin_ve_padron`); a las funciones de IA no se les manda más dato
  personal del necesario para la tarea puntual.
- **Trazabilidad**: `documentos_generados` guarda cada versión de imputación/acta/orden
  con quién y cuándo la generó; `audit_log` registra cambios en las tablas.

## 4. Brechas — pendientes de completar

| Brecha | Artículo | Acción sugerida |
|---|---|---|
| **No hay explicación en lenguaje simple para el investigado** sobre qué parte del "Análisis y Evaluación" fue redactada con apoyo de IA | 25.2/25.3 | Evaluar una línea fija al pie de la Orden de Sanción o en el expediente digital ("el análisis fue redactado con apoyo de IA y revisado por el funcionario firmante"). Pendiente de decisión del usuario — no es solo técnico, afecta la redacción del documento oficial |
| **"IA transparente" del backlog** (qué archivo/puntos detectó `redactar-analisis`) sigue sin construirse | 25.1/25.3 | Ya estaba en el backlog de mejoras por UX; ahora tiene además respaldo normativo — subir su prioridad |
| **No hay Política institucional de uso de IA formalizada** | 28.1 | El texto ya está publicado dentro de la app (pestaña **Cumplimiento**) con firma electrónica simple. Falta que el Comisario y demás mandos tengan cuenta (ver `docs/recuperacion-de-acceso.md`) y la firmen ahí |
| **No se han hecho auditorías de seguridad periódicas** (solo la de esta sesión, una vez) | 29.c | Agendar una revisión de este documento + `docs/auditoria-y-cumplimiento.md` cada 6-12 meses, no solo cuando algo falla |
| **Evaluación de impacto (art. 30)** no se había hecho antes de lanzar `redactar-analisis` (la función ya está en producción) | 30 | Completada recién ahora, ver §5 — quedó documentada aunque tarde; para la **próxima** función de IA, hacerla ANTES de lanzar |
| **Plazo del art. 25 + Cap. I Título VI para el Poder Ejecutivo ya venció** (≈10-set-2026) | Disp. Compl. Primera | La Política institucional (§28.1) y la transparencia algorítmica (art. 25) ya no son "para más adelante" — el plazo pasó. Priorizar la firma de la política institucional |

## 5. Evaluación de impacto — `redactar-analisis`

> Se completa esta, por ser la función más cercana a una decisión que afecta a un
> tercero. Las demás (§1) son de riesgo aceptable y no requieren evaluación formal, pero
> quedan igual de documentadas en la tabla de §1 por transparencia.

- **Entidad / sistema:** Comisaría PNP Ventanilla — módulo Moral y Disciplina
  (moral-y-disciplina)
- **Fecha de la evaluación:** 2026-09-14 (retroactiva; la función ya estaba en producción)
- **Responsable que la firma:** ______________________________

### 1. Qué hace la función
Recibe el texto del descargo (o su ausencia) y el código de infracción; devuelve un
borrador del "Análisis y Evaluación" en JSON, que el oficial/admin ve en un textarea
editable dentro del formulario de la Orden de Sanción.

### 2. Por qué puede ser riesgo alto (o por qué la duda)
Art. 24.1.e — participa en la redacción de un documento que impone una sanción
disciplinaria a un trabajador (efectivo PNP). Ver §2 de este documento sobre la
ambigüedad del literal y la recomendación de consultar a la SGTD.

### 3. ¿La IA decide algo por sí sola, o solo asiste?
Solo asiste. El texto queda en `#sancionAnalisis` (editable). El **tercio de la sanción**
(amonestación / días) lo elige el humano en `<select id="fTercio">`, no la IA. El envío
final es un `submit` explícito de `submitSancion`, con un botón separado del de "Redactar
con IA". Si el humano no toca nada, el documento igual requiere ese clic para generarse.

### 4. Datos que recibe la IA
Texto del descargo (si existe), código de infracción, tercio elegido. No se le manda DNI,
CIP, ni el padrón de Efectivos — el nombre del investigado se compone en el cliente
después, no lo redacta la IA.

### 5. Riesgos identificados
- La IA podría redactar un análisis que sugiera de facto una severidad no acorde a los
  hechos, y el humano lo apruebe sin leerlo con atención ("automation bias").
- Si el descargo tiene lenguaje ambiguo, la IA podría omitir un argumento de defensa
  relevante.

### 6. Medidas adoptadas para mitigar cada riesgo
- El botón "Generar Orden de Sanción" es una acción separada y explícita, nunca
  automática al terminar de redactar.
- El texto queda 100% editable antes de guardar; no hay modo de "aceptar sin ver".
- Pendiente (ver §4): mostrar de qué parte del descargo se basó la IA (transparencia
  25.1/25.3), para que revisar el borrador sea más rápido y más confiable que reescribirlo
  de cero — hoy el oficial tiene que leer el descargo original aparte para verificar.

### 7. Transparencia hacia el usuario y hacia el afectado
El botón dice "✨ Analizar descargo y redactar con IA" (visible antes de usarlo, cumple
25.1 hacia quien opera la función). Hacia el investigado (el afectado por la sanción):
no hay hoy una mención de que el análisis tuvo apoyo de IA — ver brecha en §4.

### 8. Consulta a la SGTD (si aplica)
No se ha hecho todavía. Recomendada (ver §2) antes de dar por cerrada la clasificación de
riesgo.

---

## Política institucional de uso de IA (art. 28.1)

> **Esta política ya no se firma en papel.** El mismo texto vive dentro de la
> app (pestaña **Cumplimiento**) y cada firmante entra con su propia cuenta y
> hace clic en "Firmar" — queda registrado quién, con qué cargo, cuándo y
> sobre qué versión exacta del texto firmó. El texto de abajo es la
> referencia histórica de la versión inicial.

> **CPNP Ventanilla — Módulo Moral y Disciplina**
>
> 1. **Alcance.** Esta política cubre toda función de Inteligencia Artificial usada en el
>    módulo Moral y Disciplina (ver inventario en §1 de `docs/cumplimiento-ley-ia.md`).
> 2. **Principios.** Se adoptan los del art. 7 del Reglamento de la Ley N.° 31814: no
>    discriminación, privacidad, protección de derechos fundamentales, seguridad y
>    proporcionalidad, transparencia, rendición de cuentas, supervisión humana.
> 3. **Regla de supervisión humana.** Ninguna función de IA de este módulo produce un
>    documento, guarda un dato o notifica a alguien sin que un funcionario autorizado lo
>    revise y confirme explícitamente antes.
> 4. **Datos.** Se aplica lo establecido en la Política de datos personales de
>    `docs/auditoria-y-cumplimiento.md` (el padrón completo del personal solo lo ve el
>    administrador; a las funciones de IA no se les envía más dato del necesario).
> 5. **Revisión periódica.** Este documento y el inventario de §1 se revisan al menos
>    una vez cada 12 meses, o al agregar una función de IA nueva.
> 6. **Responsable del tratamiento.** _____________________  Firma: ___________
>    Fecha: ___________
