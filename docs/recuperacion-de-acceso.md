# Recuperación de acceso y segundo administrador

`moral-y-disciplina` — Supabase proyecto `tndjulaitywtoocqeeiy`.

Hoy hay **un solo usuario administrador**. Si ese CIP se pierde, se bloquea o la
persona se va, **nadie más puede administrar** (crear notas, generar documentos,
gestionar efectivos, ver Recepción). Esto es un punto único de fallo que una
auditoría marca. Solución: tener siempre **al menos dos** admins y dejar
documentado cómo se recupera el acceso.

## Cómo funciona el acceso

- Los usuarios se crean en **Supabase → Authentication → Users**.
- Cada usuario tiene una fila en la tabla `public.profiles` con `role` =
  `'admin'` o `'viewer'`. Solo `role='admin'` habilita todo.
- Los oficiales inician sesión con su **CIP** (el sistema le agrega
  `@moralydisciplina.local` por dentro); la clave la fija el administrador.

## Crear un segundo administrador

1. **Supabase → Authentication → Users → Add user**
   - Email: `<CIP>@moralydisciplina.local` (ej. `12345678@moralydisciplina.local`).
   - Password: una clave temporal; entregarla a la persona para que la cambie.
   - Marcar *Auto Confirm User*.
2. **Supabase → Table Editor → `profiles`**: buscar la fila de ese usuario
   (se crea sola al registrarse) y poner `role = 'admin'`.
   - Si no aparece la fila, crearla: `id` = el UUID del usuario de Auth,
     `role` = `'admin'`.
3. Verificar: esa persona entra con su CIP y ve las pestañas de admin
   (Efectivos, Recepción, Panel, Historial, botón "+ Nueva nota").

> Recomendado: 2 admins fijos (jefe de la unidad + su suplente), y revisar la
> lista cada vez que hay cambio de destino.

## Recuperar acceso de un admin bloqueado

- **Olvidó la clave:** otro admin (o el dueño del proyecto Supabase) entra a
  **Authentication → Users**, abre el usuario y usa *Reset password* / define
  una nueva.
- **No hay ningún admin disponible:** entrar al **panel de Supabase** con la
  cuenta dueña del proyecto (`hanshidalgo98@gmail.com`) y:
  1. En *Authentication → Users*, resetear la clave del usuario, o crear uno
     nuevo como en la sección anterior.
  2. En *Table Editor → profiles*, poner `role='admin'` a ese usuario.
- **Se perdió también la cuenta de Supabase:** la recuperación es por el correo
  de esa cuenta de Google. Mantener ese correo con doble factor y datos de
  recuperación al día. Considerar agregar a un segundo miembro como
  *Owner/Administrator* de la organización en **Supabase → Organization →
  Team**.

## Respaldo de datos (por si hay que reconstruir)

- **Automático:** Supabase guarda backups del proyecto.
- **Manual:** desde la app, *Ajustes → Descargar respaldo* genera un `.json` con
  todo. Guardar una copia mensual fuera de línea.
- **Documentos firmados:** copia en Google Drive de la cuenta institucional
  (pestaña Recepción → "Conectar Drive").
