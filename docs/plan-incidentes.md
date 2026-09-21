# Plan de respuesta a incidentes de seguridad y de datos personales

Borrador para aprobación del Comisario. Completar los contactos entre [corchetes]. Verificar con asesoría
legal los plazos de notificación vigentes (Ley 29733 y su Reglamento; Marco de Confianza Digital, DL 1412 y
DS 029-2021-PCM: reporte de incidentes de seguridad digital).

## Qué es un incidente
Acceso o uso no autorizado a cuentas o datos, pérdida o filtración de datos, clave conocida por terceros,
respaldo o dispositivo perdido, fallo que expone expedientes de otros, o uso indebido de la IA.

## Roles
- **Responsable de respuesta:** [nombre / cargo]. Decide y coordina.
- **Administrador técnico:** [nombre]. Contiene y corrige.
- **Comisario:** informa a la superioridad y decide la notificación externa.

## Primeras 2 horas: contener
1. Anotar quién detectó, cuándo y qué se vio. No borrar nada.
2. Cambiar la clave de la cuenta afectada y cerrar sus sesiones (Supabase → Authentication → Users).
3. Si hay sospecha de uso de la IA: revisar `uso_ia` (llamadas por usuario y día) y, si hace falta, retirar la
   clave de IA de los secretos de Supabase.
4. Si hay sospecha de acceso a expedientes: revisar el historial (pestaña Historial / tabla `audit_log`) y los
   registros de acceso de Supabase (Auth y Storage).

## Primeras 24 horas: evaluar
- Qué datos y de cuántas personas; si son sensibles (ingresos, disciplinarios); si hubo copia o solo acceso.
- Causa: clave conocida, error de configuración, cuenta de un tercero, dispositivo.

## Notificar
- Al Comisario y a la superioridad de inmediato.
- A la Autoridad Nacional de Protección de Datos Personales y a los titulares afectados, cuando el incidente
  ponga en riesgo sus derechos, en el plazo que fije la norma vigente [confirmar plazo con asesoría legal].
- Al Centro Nacional de Seguridad Digital, si corresponde como incidente de seguridad digital de una entidad
  pública [confirmar canal y plazo].

## Después
- Corregir la causa, cambiar las claves que hagan falta y probar el arreglo.
- Registrar el incidente y lo aprendido en `docs/` (sin datos personales) y revisar esta guía.

## Registro de incidentes (plantilla)
| Fecha y hora | Detectó | Qué pasó | Datos y personas | Acciones | Notificaciones | Cierre |
|---|---|---|---|---|---|---|
