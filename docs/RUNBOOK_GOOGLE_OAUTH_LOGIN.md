# Runbook — Login con Google (Supabase OAuth) roto

## Síntoma

El usuario pulsa "Continuar con Google", completa la selección de cuenta y el
consent de Google, y **vuelve a la landing sin sesión**. Desde el fix del
frontend (captura del error del callback en `lib/supabase.ts` +
`useOAuthSession`), el modal de login se reabre mostrando el motivo; antes el
rebote era completamente silencioso.

## Diagnóstico (2 minutos)

1. Supabase Dashboard → **Logs → Auth** (o `get_logs service=auth` vía MCP).
2. Buscar entradas `path=/callback` con nivel `error` alrededor de la hora del
   intento. La firma del incidente de 2026-07-16:

   ```
   msg:   500: Unable to exchange external code: 4/0A…
   error: oauth2: "invalid_client" "The provided client secret is invalid."
   ```

   Google autentica bien (por eso el usuario ve todas las pantallas de Google),
   pero cuando GoTrue canjea el authorization code contra
   `oauth2.googleapis.com/token`, Google rechaza las credenciales del servidor.

## Causa

El **Client Secret** del proveedor Google guardado en Supabase Auth no coincide
con el secret vigente del OAuth Client en Google Cloud Console. Pasa
típicamente cuando alguien **regenera/rota el secret en Google Cloud Console**
(p. ej. al configurar otra integración con el mismo OAuth Client) y no lo
actualiza en Supabase.

## Corrección

1. **Google Cloud Console** → APIs & Services → Credentials → abrir el OAuth
   2.0 Client ID que usa el login (el que tiene como redirect URI
   `https://nnsqmeigtgewatameexo.supabase.co/auth/v1/callback`).
2. Copiar el **Client secret** vigente (o crear uno nuevo con "Add secret" y
   copiar ese; deshabilitar el viejo hasta confirmar).
3. **Supabase Dashboard** → Authentication → Sign In / Providers → **Google**
   → pegar el Client Secret → Save.
4. Probar "Continuar con Google" en `https://administratodo.com` en una ventana
   de incógnito. En Logs → Auth, el `/callback` debe salir sin error y seguido
   de un `login` con `provider: google`.

## Ojo: hay DOS lugares con credenciales de Google

| Uso | Dónde vive el secret |
|---|---|
| Login "Continuar con Google" (Supabase Auth) | Dashboard → Authentication → Providers → Google |
| Conexión Gmail por empresa (edge `google-oauth-initiate` / `google-oauth-callback`) | Secrets de Edge Functions (`GOOGLE_CLIENT_ID` / secret de la boveda correspondiente) |

Si se rota el secret del OAuth Client en Google Cloud Console, hay que
actualizarlo en **ambos** (si comparten OAuth Client). Rotar en un solo lado
deja el otro con `invalid_client`.

## Estados relacionados que confunden el diagnóstico

- **Auth user huérfano** (existe en `auth.users` pero sin fila en
  `app_users`): el registro de residente respondía "El correo electrónico ya
  está registrado" para siempre. Desde el fix en `create-cliente-account`, si
  la identidad verifica 3-de-3 contra `clientes`, el login huérfano se adopta
  (nueva contraseña + perfil) en lugar de rechazarse.
- Un usuario Google **sin** perfil `app_users` y **sin** registro en `clientes`
  (ej. `ventas@mayanresidenciales.com`) verá el onboarding de residente y no
  podrá completarlo: ese flujo es solo para residentes. Para personal de una
  empresa, crear el usuario desde Empresa → Usuarios (o invitación) con el
  mismo correo ANTES de que entre con Google.
- **«No se encontró un cliente…» con los datos correctos** (formulario «Crear
  cuenta de cliente»): casi siempre el residente **ya tiene cuenta** — por
  ejemplo entró con «Continuar con Google» y completó el onboarding minutos
  antes. `create-cliente-account` responde el MISMO error genérico cuando no
  encuentra al cliente y cuando ya tiene cuenta (anti-enumeración), así que el
  texto cubre ambos casos y dice cómo entrar. Para confirmarlo: en Clientes la
  columna **Cuenta** muestra «Cuenta activa», y en los logs de la función hay un
  `warn` «el cliente ya tiene cuenta de portal» con el `cliente_id`. El
  residente debe iniciar sesión (Google o «¿Olvidaste tu contraseña?»), no
  registrarse otra vez.
- **Contraseña rechazada por Auth** (`weak_password`, `reasons: ["pwned"]`):
  el proyecto tiene activa la protección contra contraseñas filtradas
  (Dashboard → Authentication → Settings → Passwords), y Auth rechaza con 422
  cualquier contraseña que aparezca en HaveIBeenPwned aunque cumpla la
  validación del formulario (8+ caracteres, mayúscula, minúscula, número).
  Antes el residente veía «No se pudo crear la cuenta. Intente nuevamente.» y
  reintentar con la misma contraseña fallaba siempre; ahora el mensaje dice que
  la contraseña es común o está filtrada y que elija otra. En los logs de la
  función queda `warn` «Auth create rejected password: weak_password».
- **Cliente «Habilitado» sin CUI/DUI, fecha de nacimiento o correo**: nunca va
  a poder registrarse (el alta verifica los tres 3-de-3). El formulario de
  Clientes ya no permite guardar la cuenta habilitada sin esos tres datos; para
  los que quedaron así de antes, completar los datos o deshabilitar la cuenta.

Diagnóstico rápido de un residente por DPI (SQL Editor; devuelve solo
booleanos, sin PII):

```sql
select c.puede_crear_cuenta,
       c.fecha_nacimiento is not null as tiene_fecha,
       c.email is not null            as tiene_email,
       exists (select 1 from public.app_users au where au.cliente_id = c.id) as tiene_cuenta,
       (select u.raw_app_meta_data->>'provider' from public.app_users au
          join auth.users u on u.id = au.id where au.cliente_id = c.id limit 1) as proveedor_login
  from public.clientes c
 where c.cui_dui = '<DPI sin espacios>';
```
