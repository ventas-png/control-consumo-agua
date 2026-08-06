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
