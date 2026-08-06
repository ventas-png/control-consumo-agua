# App móvil (iOS y Android) con Capacitor

AdministraTodo se empaqueta como app nativa reutilizando el mismo build web de
Vite (`dist/`). No hay una segunda base de código: la app carga la SPA dentro de
un WebView y añade capacidades nativas (cámara, GPS, deep links de OAuth, push)
detrás de `isNative()`, de modo que **la web no cambia en nada**.

Los proyectos `android/` e `ios/` **ya están en el repo**, generados y
preconfigurados (permisos y deep link incluidos). No hace falta `cap add`.

---

## 1. Requisitos

| Objetivo | Necesitas |
| --- | --- |
| Compilar Android | Android Studio + JDK 21 + Android SDK 36 |
| Compilar iOS | **Mac** con Xcode 16+ (los plugins se resuelven con Swift Package Manager; **no** hace falta CocoaPods) |
| Publicar iOS | Apple Developer Program — **US$99/año** |
| Publicar Android | Google Play Console — **US$25 pago único** |
| Push | Proyecto Firebase (FCM) + clave APNs en Apple Developer |

---

## 2. Activación paso a paso

### Paso 1 — Variables de entorno (obligatorio)
Crea un `.env` en la raíz con, como mínimo:

```
VITE_SUPABASE_URL=https://nnsqmeigtgewatameexo.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_SENTRY_DSN=<dsn>        # muy recomendable: en un móvil no hay consola
```

⚠️ Vite **incrusta** estas variables dentro del binario: la app instalada apunta
de forma fija al Supabase con el que se compiló. Si faltan las dos primeras, la
app abre en **pantalla blanca** sin mensaje.

### Paso 2 — CORS para las Edge Functions (obligatorio)
En el WebView el origen no es tu dominio, sino `https://localhost` (Android) y
`capacitor://localhost` (iOS). Añade **ambos** al secret `ALLOWED_ORIGINS`
(*Supabase → Edge Functions → Secrets*), conservando los orígenes web:

```
ALLOWED_ORIGINS=https://administratodo.app,https://administratodo.com,https://localhost,capacitor://localhost
```

Sin esto el login funciona pero fallan invitaciones, cobros, correo, etc.

### Paso 3 — Compilar y abrir
```bash
npm install
npm run android    # build + sync + abre Android Studio
npm run ios        # build + sync + abre Xcode (solo en Mac)
npm run cap:sync   # tras cualquier cambio en el código web
```
`mobile:build` corre `CAPACITOR=true npm run build`, que **desactiva el service
worker y el SRI** solo para el binario. En Windows usa `cross-env` en el script.

**Meta de este paso:** la app abre y entras con **correo y contraseña**, y la
sesión sobrevive a cerrar y reabrir la app.

### Paso 4 — Login con Google
El scheme `com.administratodo.app://auth-callback` ya está registrado en los tres
sitios (código, `AndroidManifest.xml`, `Info.plist`). Solo falta autorizarlo:

**Supabase → Authentication → URL Configuration → Redirect URLs:** añade
`com.administratodo.app://auth-callback`.

En Google Cloud Console no hay que tocar nada: Google redirige a Supabase, y
Supabase reenvía al scheme de la app.

> Detalle técnico: en nativo el cliente usa **PKCE** (`flowType`), porque el deep
> link vuelve con `?code=` y se canjea con `exchangeCodeForSession`. La web sigue
> en flujo implícito a propósito — ver el comentario en `src/lib/supabase.ts`.

### Paso 5 — Iconos y splash
Hoy son los del template de Capacitor. Con tu marca:
```bash
npm i -D @capacitor/assets
# resources/icon.png (1024x1024) y resources/splash.png (2732x2732)
npx capacitor-assets generate
```

### Paso 6 — Notificaciones push
Cliente (`src/lib/push.ts`), tabla (`supabase/migrations/20260730000000_create_device_tokens.sql`)
y despachador (`supabase/functions/send-push`) ya están. Falta lo externo:

1. **Firebase**: crea el proyecto, añade apps Android e iOS, descarga
   `google-services.json` → `android/app/`. Sube tu **clave APNs** a
   Firebase → Cloud Messaging para que FCM enrute a iOS.
2. **iOS**: en Xcode habilita *Push Notifications* y *Background Modes → Remote
   notifications*.
3. **Backend**: la tabla `device_tokens` y la función `send-push` **se despliegan
   solas** al fusionar a `main` (workflows *Apply Migrations to Production* y
   *Deploy Supabase Edge Functions*). Lo único manual es el secret:
   ```bash
   supabase secrets set FCM_SERVICE_ACCOUNT="$(cat firebase-service-account.json)"
   ```
4. **Disparo**: llama a `send-push` con `{ user_id, title, body }` desde donde ya
   insertas en `user_notifications` (p. ej. `notifications-dispatcher`).

Sin `FCM_SERVICE_ACCOUNT`, `send-push` responde `{ status: 'not_configured' }` y
no rompe nada.

### Paso 7 — Publicar
- Sube `versionCode`/`versionName` (Android) y `MARKETING_VERSION`/
  `CURRENT_PROJECT_VERSION` (iOS): hoy están en el valor inicial (1 / 1.0).
- **Play**: genera un **AAB** firmado (Play App Signing) y completa *Data safety*.
- **App Store**: archiva en Xcode → App Store Connect y completa las etiquetas de
  privacidad (cámara y ubicación).
- Política de privacidad: reutiliza la página legal existente (`LegalPage`).

---

## 3. Identidad de la app

| Dato | Valor |
| --- | --- |
| appId / applicationId / bundle id | `com.administratodo.app` |
| Nombre visible | AdministraTodo |
| minSdk / target-compileSdk | 24 / 36 |
| Deep link OAuth | `com.administratodo.app://auth-callback` |

### iOS: ciclo de vida por UIScene

Xcode avisa desde iOS 26 que `UIScene lifecycle will soon be required` y que no
adoptarlo **acabará en un assert** — es decir, un crash al arrancar en alguna iOS
futura. La plantilla de Capacitor 8 aún no lo trae (su código Swift no menciona
`UIScene`), así que la adopción está hecha a mano:

- `ios/App/App/Info.plist` declara `UIApplicationSceneManifest`, con
  `UISceneStoryboardFile = Main` para que UIKit siga montando la window y el
  `CAPBridgeViewController` desde el storyboard. **`UIMainStoryboardFile` ya no
  está**: era el equivalente pre-escenas y con el manifest presente UIKit lo
  ignora, así que quedaba solo como resto del arranque viejo. Si algún día la app
  abre en negro, ese es el primer sitio donde mirar.
- `ios/App/App/SceneDelegate.swift` recibe las aperturas por URL —incluido el
  arranque en frío vía `connectionOptions`— y las reenvía al
  `ApplicationDelegateProxy` de Capacitor, que es quien emite `appUrlOpen`.
- `AppDelegate.swift` pierde `window` y los callbacks que UIKit ya no llama en una
  app con escenas; conserva `configurationForConnecting`.

**Al tocar cualquiera de esos tres archivos, probar en dispositivo el login con
Google**: es el único consumidor real del deep link (`src/lib/nativeAuth.ts`), y
si el puente se rompe, el OAuth se queda colgado en el navegador sin volver a la
app. Probar los dos casos, que van por caminos distintos: con la app **abierta**
en segundo plano (`scene(_:openURLContexts:)`) y con la app **cerrada del todo**
(`connectionOptions` en `willConnectTo`).

Cuando Capacitor adopte escenas upstream, conviene volver a su plantilla y borrar
esta adaptación.

---

## 4. Layout en teléfono (shell responsive)

Todo el CSS del shell móvil vive en **un solo sitio**: el bloque
`@media (max-width: 767px)` de `src/index.css`. `src/styles/runtime.css` se
carga *después* (ver los imports de `src/main.tsx`), así que cualquier regla
duplicada allí gana la cascada aunque no lleve `!important` — que es
exactamente cómo apareció el bug del menú que se veía sin abrirlo. Si tocas el
drawer, hazlo en `index.css`.

| Decisión | Por qué |
| --- | --- |
| El drawer se esconde con `translateX(-100%)`, nunca con píxeles | Su ancho es `min(280px, 85vw)`. Un desplazamiento fijo de `-256px` dejaba **24px del menú dentro de la pantalla** en cualquier teléfono de ≥330px: como va con `z-index: 200`, tapaba el borde izquierdo de todas las vistas (títulos y breadcrumbs cortados) sin que nadie hubiera tocado el hamburguesa. |
| La sombra del drawer solo con `.open` | `box-shadow: 0 0 30px` no tiene desplazamiento, así que con el panel fuera de pantalla el halo se seguía dibujando sobre los primeros 30px del contenido. |
| La topbar es `position: sticky` y **el scroll sigue siendo el del documento** | Antes la topbar (con el botón de menú) se iba de pantalla al bajar y el contenido se metía bajo la barra de estado de iOS, transparente por `viewport-fit=cover`. `sticky` lo arregla sin cambiar quién scrollea. Lleva `!important` porque `Topbar.tsx` trae `position: relative` inline. |
| **NO** dar altura fija al shell para que scrollee `.app-main` | Se probó (`height: 100dvh` + `overflow: hidden`) y hubo que revertirlo: en iOS Safari un `position: fixed` dentro de un contenedor con scroll se posiciona respecto a **ese contenedor**, no al viewport. Los ~40 overlays de modal de la app son `position: fixed` y viven dentro de `.app-main`, así que **todos** quedaban recortados y sin poder scrollear. Mientras scrollee el documento, `.app-main` nunca llega a scrollear y los modales se posicionan contra el viewport. |
| `scrollAppToTop()` (`src/lib/scroll.ts`) en vez de `window.scrollTo` | Elige el contenedor que realmente tiene scroll, así sigue funcionando si algún día una vista sí monta su propio scroller. |
| En la app NATIVA el zoom se desactiva por viewport (`src/lib/nativeApp.ts`) | Complemento del anterior, no sustituto. **Safari ignora `maximum-scale` y `user-scalable` desde iOS 10** por accesibilidad, así que en la web el único freno es el font-size. **WKWebView sí los respeta**, de modo que el arreglo del font-size no bastaba dentro de la app: había que cortarlo también por viewport. Solo corre bajo `isNative()`, así que el navegador conserva el pinch-zoom. Se mantiene `viewport-fit=cover`, del que dependen los `env(safe-area-inset-*)`. |
| El conmutador del portal y las cabeceras reservan `env(safe-area-inset-top)` | Con `viewport-fit=cover` la página arranca bajo la barra de estado. El conmutador Condominios/Agua es `sticky; top: 0` y quedaba bajo el reloj y la batería, **sin poder tocarse**. Los dos casos son excluyentes (con conmutador manda él; sin él, la cabecera), y una regla de selector hermano evita sumar el hueco dos veces. |
| El hueco superior se resuelve con `max(env(safe-area-inset-top), var(--at-safe-top))` | `--at-safe-top` la publica `publicarAltoBarraDeEstado()` con el `height` que reporta `StatusBar.getInfo()` — el alto real, medido por el lado nativo, sin pasar por CSS. Es lo que salva el caso de este WebView, donde `env()` vale 0. Usa también el `overlays` que devuelve el plugin: si `overlaysWebView: false` ya bajó el `webView.frame`, la variable va a 0 y los dos mecanismos no se suman. En la web la variable no existe y manda el `env()`, que ahí sí funciona. |
| En la app NATIVA el hueco de la barra de estado NO lo pone el CSS, lo pone `StatusBar.overlaysWebView: false` | **`env(safe-area-inset-top)` resuelve a 0 en este WebView** — medido sobre una captura del aparato, donde los chips arrancan exactamente a los 8px del padding inline. Con el inset a cero la fila anterior no reserva nada, y renunciar a `viewport-fit=cover` tampoco sirve: si el motor no conoce los insets, `contain` no tiene por dónde encoger. `setOverlaysWebView({ overlay: false })` no es CSS: en iOS el plugin baja el `webView.frame` por debajo de la barra y pinta la franja con `backgroundColor` (`StatusBar.swift`). Va en `capacitor.config.ts` (manda, y se aplica antes que la capa web) y en `configurarBarraDeEstado()` como cinturón. La fila anterior se queda porque sigue siendo el mecanismo de la **web** (PWA en standalone). **Android**: con `targetSdk 36` el sistema impone edge-to-edge y esta opción no tiene efecto. |
| Todo campo de formulario va a `font-size: 16px !important` en teléfono | Safari amplía la página al enfocar un campo cuyo font-size computado sea **menor de 16px**, y al cerrar el formulario **no deshace el zoom**: la página se queda ampliada y a partir de ahí se arrastra de lado con el dedo. Se reportó como "desborde" en varias pantallas; no había tal desborde. El `!important` no es opcional: hay ~235 archivos con `style={{ fontSize: '13px' }}` en sus inputs y un estilo en atributo gana siempre a la hoja, así que la regla existía desde antes y nunca llegó a aplicarse. |
| Los sub-menús de sección usan `<TabStrip>` | Una sola fila con scroll horizontal, el patrón que ya tenía Condominios. Con `flex-wrap`, un módulo como Contabilidad (9 pestañas) ocupaba cuatro líneas antes de llegar al contenido. |

Los cuatro invariantes que conviene comprobar al tocar esto, en un viewport de
teléfono:

1. El drawer cerrado no asoma ni un píxel.
2. `document.scrollWidth` no supera el ancho del viewport.
3. La topbar se queda en `top: 0` después de scrollear.
4. **Ningún ancestro de un modal es un contenedor que scrollee de verdad**
   (`overflow: auto/scroll` con `scrollHeight > clientHeight`). Es lo que en
   iOS Safari atrapa a los `position: fixed`, y no se reproduce en Chromium —
   hay que razonarlo o probarlo en un dispositivo.

El guard contra el arrastre lateral vive en `#root { overflow-x: clip }`, y esa
elección tiene dos trampas detrás:

- **No sirve en `html` ni en `body`.** El overflow del elemento raíz se propaga
  al viewport y la propagación solo contempla `visible/hidden/scroll/auto`, así
  que un `clip` ahí no hace nada; y como `html` es `visible`, el overflow de
  `body` también propaga. Medido en ambos: el documento seguía arrastrándose.
- **Tiene que ser `clip`, no `hidden`.** `overflow-x: hidden` con
  `overflow-y: visible` es inválido: el segundo se convierte en `auto` y el
  elemento pasa a ser un contenedor con scroll — que es justo lo que atrapa a
  los `position: fixed` en iOS (invariante 4). `clip` no crea scrollport.

---

## 5. Notas de diseño (por qué)

- **Sesión persistente en nativo**: `src/lib/supabase.ts` usa `localStorage` en
  nativo (el `sessionStorage` del WebView se vacía al cerrar la app) y mantiene
  `sessionStorage` en web (endurecimiento anti-XSS).
  Se probó antes con `@capacitor/preferences` y **se revirtió**: en un iPhone real
  el login se colgaba — el token llegaba correctamente pero el guardado asíncrono
  de la sesión quedaba pendiente y `signInWithPassword` nunca resolvía, así que el
  usuario solo veía "la conexión tardó demasiado" a los 20 s. Un storage síncrono
  no puede introducir ese cuelgue. En la app nativa el WebView solo carga nuestro
  propio bundle (no hay contenido remoto), así que no aplica el motivo por el que
  la web evita `localStorage`.
- **PKCE solo en nativo**: activarlo también en web rompería la recuperación de
  contraseña, porque el *code verifier* vive en `sessionStorage` y no sobrevive a
  abrir el enlace del correo en otra pestaña o navegador.
- **Sin service worker en nativo**: el bundle va empaquetado y se actualiza por
  las tiendas; un SW serviría assets obsoletos.
- **Sin SRI en nativo**: el `integrity` protege assets servidos por CDN; en local
  no aporta y el `crossorigin` puede romper WKWebView.
- **Cámara/GPS como mejora progresiva**: los plugins dan permisos del SO y mejor
  fiabilidad (en iOS WKWebView `navigator.geolocation` no existe), siempre detrás
  de `isNative()` para no alterar el comportamiento web.
- **La CSP de `vercel.json` no aplica en nativo**: son cabeceras HTTP de Vercel y
  los archivos se sirven localmente. Por eso el CORS de las Edge Functions (paso
  2) sí hay que configurarlo aparte.
- **Recuperación de contraseña desde la app**: en nativo el enlace del correo
  apunta al deep link, no a `window.location.origin` (que dentro del WebView es
  `https://localhost` y en un correo no lleva a ninguna parte). auth-js guarda el
  *code verifier* marcado como `recovery` y al canjearlo emite
  `PASSWORD_RECOVERY`, que es lo que la app ya escucha para mostrar el formulario.
  **Limitación:** hay que abrir el correo en el mismo teléfono que pidió el
  restablecimiento; desde otro dispositivo no hay verifier. Quien necesite
  cambiarla en otro equipo puede hacerlo desde la web.
- **Token de push por dispositivo**: se registra con la función
  `register_device_token` (SECURITY DEFINER) en vez de un `upsert`. Si el usuario
  A cierra sesión y B entra en el mismo teléfono, el token es el mismo: el upsert
  quedaría bloqueado por RLS (la fila aún es de A) y, peor, las notificaciones de
  A seguirían llegando al teléfono que ahora usa B. La función reasigna el token
  al usuario con sesión activa de forma atómica.
