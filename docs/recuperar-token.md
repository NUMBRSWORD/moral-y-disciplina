# Si pierde el teléfono del Token Digital

Salida de emergencia del responsable, que funciona siempre porque es el dueño del
proyecto Supabase. No depende de acordarse de ningún código ni de que otra
persona esté disponible.

## Los tres pasos

1. Entre a **supabase.com/dashboard** y abra el proyecto **MORAL Y DISCIPLINA**.
2. Menú izquierdo → **SQL Editor** → **New query**. Pegue esto y pulse **Run**:

   ```sql
   delete from auth.mfa_factors
    where user_id = (select id from auth.users where email = 'hanshidalgo98@gmail.com');
   ```

   Para desbloquear a otra persona, cambie el correo por el de su cuenta.

3. En el teléfono nuevo, abra Faltos y entre. La pantalla del token dirá
   **«LISTO PARA ACTIVAR»** en vez de pedir el código del equipo anterior.
   Toque **Activar mi Token Digital** y **guarde los ocho códigos** que aparecen.

## Qué hace exactamente

Borra el segundo factor de esa cuenta. No toca la cuenta, ni los expedientes, ni
las firmas, ni los permisos: solo obliga a volver a activar el token. La sesión
abierta en otros equipos deja de estar verificada y tendrá que activarlo de nuevo.

## Por qué conviene además guardar los códigos

Esta salida depende de tener acceso al panel de Supabase. Si algún día se pierde
ese acceso —cuenta de Google del proyecto, cambio de responsable— los ocho
códigos de recuperación siguen siendo la única forma de entrar sin ayuda de
nadie. La pantalla que los muestra no permite capturas de pantalla: use el botón
**Copiar** o anótelos en papel.

## Lo que no se hizo, y por qué

Se evaluó enviar el código por correo o por mensaje de texto. No se implementó:
la cuenta de Google ya es la primera llave del acceso, así que mandar la segunda
al mismo correo deja las dos en la misma puerta. Los mensajes de texto, además,
son el segundo factor más débil y requieren contratar un proveedor de pago.

Queda pendiente, si algún día molesta este procedimiento: una pantalla de
administrador para restablecer el token de cualquier cuenta con dos toques, de
forma que los dos administradores puedan rescatarse mutuamente sin tocar la base.
