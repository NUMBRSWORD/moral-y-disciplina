# Parte 2: reglas de los depósitos de archivos (Storage)

**APLICADA el 19/09/2026** en el proyecto `tndjulaitywtoocqeeiy` (MORAL Y DISCIPLINA),
como migración `aprobacion_de_cuentas_parte2_storage`. Este archivo queda como registro.

## Qué quedó

Las 7 reglas ahora exigen además `public.esta_aprobado()`. Una cuenta con sesión pero
pendiente de aprobación ya no puede leer ni subir estos archivos.

| Depósito | Regla | Operación | Condición |
|---|---|---|---|
| `notas` | autenticados ven archivos de notas | SELECT | `bucket_id = 'notas' AND public.esta_aprobado()` |
| `notas` | autenticados suben archivos de notas | INSERT | `bucket_id = 'notas' AND public.esta_aprobado()` |
| `expedientes` | autenticados ven archivos de expedientes | SELECT | `bucket_id = 'expedientes' AND public.esta_aprobado()` |
| `directivas` | directivas_storage_select_authenticated | SELECT | `bucket_id = 'directivas' AND public.esta_aprobado()` |
| `casos-imputacion-pnp` | imputacion_pnp autenticados leen sustento | SELECT | `bucket_id = 'casos-imputacion-pnp' AND public.esta_aprobado()` |
| `casos-imputacion-pnp` | imputacion_pnp autenticados suben sustento | INSERT | `bucket_id = 'casos-imputacion-pnp' AND public.esta_aprobado()` |
| `casos-imputacion-pnp` | imputacion_pnp autenticados eliminan sustento | DELETE | `bucket_id = 'casos-imputacion-pnp' AND public.esta_aprobado()` |

En las reglas de INSERT la condición va en *WITH CHECK*; en SELECT y DELETE, en *USING*.

## Por qué está en un archivo aparte

`storage.objects` pertenece al rol `supabase_storage_admin`. Según cómo se ejecute el SQL,
el rol `postgres` puede recibir el error *"must be owner of table objects"*. Al ir en una
transacción separada, ese fallo no cancelaría el resto de la migración.

## Si hay que volver atrás

Quitar `and public.esta_aprobado()` de cada una de las 7 reglas, dejando solo la condición
de `bucket_id`. Hacerlo **antes** de correr `aprobacion-de-cuentas-REVERTIR.sql`, porque
ese archivo borra la función `esta_aprobado()`. Si el editor de SQL lo rechaza, se puede
editar cada regla desde **Storage → Policies** en el panel.
