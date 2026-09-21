# Protección de datos personales — guía para el responsable (Ley N.° 29733 y su Reglamento)

Borrador técnico para que la Comisaría y su asesoría legal completen lo que solo ellos pueden hacer.
No es una opinión legal vinculante. Los datos entre [corchetes] los completa la unidad. Verificar con
asesoría legal el número y la vigencia del Reglamento de la Ley 29733 y los plazos vigentes.

## 1. Qué datos trata el sistema
- **Personal que usa la app:** nombres, grado, CIP, DNI, teléfono (solicitudes de acceso).
- **Personas investigadas:** nombres, grado, CIP, datos del procedimiento disciplinario por infracciones
  leves (notas, descargos, órdenes de sanción, cumplimiento).
- **Remuneración por grado** y el descuento aproximado por persona: los ingresos económicos son dato
  sensible; solo lo ve el administrador (Panel).

## 2. Lo que ya está hecho
- Aviso de privacidad visible en el acceso y en Cumplimiento.
- Cada oficial ve solo los expedientes (y archivos) donde figura; el padrón completo, solo el administrador.
- Auditoría de cambios (incluidos roles y aprobaciones) y cambio de clave exigido en el servidor.
- Minimización hacia la IA: el resumen ejecutivo va sin nombres.
- Plazo de conservación fijado en la política de datos: 5 años desde el cierre del expediente.

## 3. Lo que debe hacer el responsable
| # | Acción | Quién | Estado |
|---|---|---|---|
| 1 | Registrar el banco de datos personales ante la Autoridad Nacional de Protección de Datos Personales [código de registro] | Comisaría / Región Policial | Pendiente |
| 2 | Completar el aviso de privacidad (responsable, medio para ejercer derechos) | Comisaría | Pendiente |
| 3 | **Flujo transfronterizo:** Anthropic (EE. UU.), Supabase (Brasil), Google (EE. UU.). Documentar el destino, la finalidad y las garantías, e informarlo en el registro | Comisaría + asesoría legal | Pendiente |
| 4 | Contratos o cláusulas de encargo de tratamiento con Supabase, Google y Anthropic (o sus términos aceptados, archivados) | Titular de la cuenta | Pendiente |
| 5 | Designar a quien atiende los derechos de acceso, rectificación, cancelación y oposición, y el plazo interno de respuesta | Comisaría | Pendiente |
| 6 | Aprobar el plan de incidentes (`docs/plan-incidentes.md`) | Comisario | Pendiente |
| 7 | Trasladar la titularidad de Supabase, GitHub y Google a cuentas institucionales | Comisaría / TI regional | Pendiente |

## 4. Derechos de los titulares (procedimiento sugerido)
1. Recibir la solicitud por escrito (puede ser en la unidad). 2. Verificar la identidad. 3. Buscar al titular
en Efectivos y en sus expedientes (Seguimiento → ficha de la persona). 4. Responder dentro del plazo legal
[días]. 5. Registrar la solicitud y la respuesta. La cancelación de datos de un expediente en curso o
dentro de su plazo de conservación puede no proceder: dejar constancia del motivo.

## 5. Encargados y transferencias (inventario)
| Proveedor | Qué recibe | País | Finalidad |
|---|---|---|---|
| Supabase | Base de datos y archivos | Brasil | Almacenar el sistema |
| Google (Drive) | Copia de respaldo de expedientes | EE. UU. | Respaldo |
| Google (acceso) | Identidad de quien elige entrar con Google | EE. UU. | Autenticación |
| Anthropic | Texto de descargos, hechos y documentos de cada tarea de IA (resumen sin nombres) | EE. UU. | Redactar, extraer y revisar con supervisión humana |
