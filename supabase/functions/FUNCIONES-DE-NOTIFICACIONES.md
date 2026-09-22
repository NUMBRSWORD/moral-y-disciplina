# Funciones de IA de notificaciones-pnp

Estas cuatro funciones están desplegadas en el mismo proyecto Supabase
(`tndjulaitywtoocqeeiy`), pero **las usa la app notificaciones-pnp**, no esta web:

- `analizar-descargo-sancion` (equivale a `redactar-analisis` de esta web)
- `redactar-hecho-imputacion`
- `sugerir-codigo-infraccion`
- `asistente-normativa`

Antes solo existían en el servidor. Se copiaron aquí (21 set 2026) tal como
estaban desplegadas, ya con la protección `autorizar_uso_ia` (usuario aprobado y
tope diario), para no perderlas si se borra o se daña el proyecto.

Esta web no las llama. Editar estos archivos no cambia nada en producción hasta
que se vuelvan a desplegar (`supabase functions deploy <nombre>`).
