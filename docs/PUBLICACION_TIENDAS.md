# Publicar AdministraTodo en App Store y Google Play — paso a paso

Guía operativa para llevar la app nativa (Capacitor 8, proyectos `ios/` y
`android/` ya en el repo) a las dos tiendas. Complementa a `MOBILE.md`, que
explica cómo **compilar y probar** la app; aquí está lo que falta para
**publicarla** y para pasar la revisión de Apple y de Google a la primera.

Identidad fija de la app (no cambiarla una vez publicada):

| Dato | Valor | Dónde vive |
| --- | --- | --- |
| Bundle ID (iOS) / applicationId (Android) | `com.administratodo.app` | `capacitor.config.ts`, `ios/App/App.xcodeproj`, `android/app/build.gradle` |
| Nombre visible | AdministraTodo | `capacitor.config.ts`, `Info.plist`, `strings.xml` |
| Política de privacidad | `https://administratodo.com/politica-privacidad` | `src/App.tsx` (`LEGAL_ROUTES`) |
| Términos de servicio | `https://administratodo.com/terminos-servicio` | ídem |
| Deep link OAuth | `com.administratodo.app://auth-callback` | `src/lib/nativeAuth.ts` |

---

## 0. Antes de empezar: qué está listo y qué falta

**Ya está hecho en el repo**

- Proyectos nativos generados, con permisos (cámara, GPS, push) y sus textos de
  justificación en `Info.plist` y `AndroidManifest.xml`. La galería **no pide
  permiso** en Android: `@capacitor/camera` usa el *Photo Picker* del sistema.
  No declarar `READ_MEDIA_IMAGES`: Play obliga a justificarlo (política de
  permisos de fotos y videos) y rechaza las apps que no necesitan la galería
  entera.
- Deep link de login con Google registrado en los dos sistemas.
- Página de privacidad y términos públicas y pre-renderizadas (sirven para los
  enlaces obligatorios de las dos tiendas).
- Build nativo (`npm run mobile:build`) que desactiva service worker y SRI.
- Firma de release en Android lista para leer un `android/keystore.properties`
  que **no se versiona** (sección 5.1).
- **Eliminación de cuenta por el propio usuario** (Apple 5.1.1 v, Google Play
  *Account deletion*): opción **Eliminar mi cuenta** en *Mi perfil* (panel de
  empresa) y en los portales de residentes y clientes, con confirmación en dos
  pasos (contraseña + palabra `ELIMINAR`), servida por la edge function
  `delete-own-account`; y la URL pública para pedirlo sin la app,
  `https://administratodo.com/eliminar-cuenta` (pre-renderizada, ES/EN). Reglas,
  retención y procedimiento de soporte en `docs/ELIMINACION_CUENTA.md`.
- **Sin venta del plan dentro de la app** (Apple 3.1.1, política de pagos de
  Google Play): el plan es una suscripción digital y las tiendas rechazan
  venderla fuera de su sistema de cobro. En la app nativa no aparecen la
  landing comercial (abre directo en el login), precios, «Actualizar plan»,
  la tarjeta *Mi plan* (cambio de plan y portal de Stripe), la ampliación de
  límites ni los avisos de prueba vencida o pago fallido. Sí se mantienen el
  registro de empresa y de residentes (crear cuenta no es vender) y los pagos
  de cuotas y agua de los residentes, que son servicios del mundo real (Apple
  3.1.3(e)). La empresa contrata en la web y usa lo contratado en la app
  (3.1.3(c), servicios empresariales). La regla vive en un solo sitio,
  `src/lib/ventaDePlanes.ts`: **toda pantalla nueva que venda o amplíe el plan
  debe pasar por `mostrarVentaDePlanes()`**, y antes de cada envío basta un
  `grep -rn "createCheckoutSession\|createBillingPortalSession\|openBillingSection" src/components`
  para comprobar que no apareció otra.
- `ITSAppUsesNonExemptEncryption = NO` en `Info.plist` (solo HTTPS estándar):
  App Store Connect ya no pregunta por cifrado en cada subida.
- Ningún plugin usa APIs de «razón obligatoria» sin declarar (`ITMS-91053`):
  se quitó `@capacitor/preferences`, que usaba `UserDefaults` sin manifiesto de
  privacidad y ya no se usaba. Si vuelve a hacer falta un plugin así, ver la
  sección 10.

**Falta y es bloqueante para la revisión** (decidir antes de subir nada):

1. ~~**Eliminación de cuenta desde la app.**~~ **Resuelto** (ver arriba). Queda
   sólo declararlo en las consolas: la URL en Play Console (sección 5.3) y
   «el usuario puede solicitar el borrado» en las dos declaraciones de datos
   (sección 8). Para el revisor de Apple, el camino es *Mi perfil → Eliminar mi
   cuenta* con la cuenta de prueba (es un único propietario: al borrarla la
   empresa de prueba queda suspendida, así que hay que recrearla o usar otra
   cuenta de prueba para la siguiente revisión).
2. **«Iniciar sesión con Apple» o esconder Google en iOS.** La guideline 4.8
   de Apple (*Login Services*) obliga a ofrecer también *Sign in with Apple*
   cuando hay login social de terceros. **Resuelto en el código**: la app
   ofrece «Continuar con Apple» junto a Google en iOS y en la web, por el mismo
   camino de Supabase que Google (`src/lib/loginProviders.ts` decide qué botones
   salen; `LoginModal` en `src/components/landing/Nav.tsx` y `LoginScreen` los
   pintan). **Falta configurar** (`MOBILE.md`, paso 4): *Sign in with Apple* en
   el App ID, un Services ID, una clave `.p8`, el proveedor Apple en Supabase y
   compilar con `VITE_APPLE_SIGN_IN=true`. Mientras no esté, el binario cumple
   igual: sin la variable la app de iOS no muestra ningún login social (ni
   Google). Android no tiene esta regla y no muestra Apple.
3. ~~**Iconos y splash de marca.**~~ **Resuelto**: salen del logo de la web
   (`public/favicon.svg`) con `scripts/generar-iconos-nativos.mjs` (sección 3).
   Queda verlos en un teléfono de cada plataforma (sección 7, punto 1).

**Falta y es opcional para la v1**

- Push (Firebase + APNs). **Solo se activa compilando con
  `VITE_PUSH_ENABLED=true`, y esa variable va únicamente cuando Firebase y APNs
  ya están configurados** (`MOBILE.md`, paso 6). No es opcional dejarla puesta
  sin Firebase: en Android, registrar el dispositivo sin `google-services.json`
  **cierra la app** (Capacitor relanza la excepción de Firebase en el hilo
  nativo y en cada arranque con sesión), lo que el *pre-launch report* de Play
  detecta como crash. Sin la variable no se pide permiso ni se registra nada.
  Si no se activa en la v1, dejar la capability de *Push Notifications* sin
  añadir en Xcode para que la revisión no pregunte por ella.

---

## 1. Cuentas y costos

| Tienda | Cuenta | Costo | Verificación |
| --- | --- | --- | --- |
| App Store | [Apple Developer Program](https://developer.apple.com/programs/enroll/) | US$99 / año | Individual: 1–2 días. Organización: necesita **número D-U-N-S** de la empresa, 1–2 semanas. |
| Google Play | [Google Play Console](https://play.google.com/console/signup) | US$25 pago único | Identidad del desarrollador (documento) y, para organización, D-U-N-S. |

Recomendación: inscribirse como **organización** (Prestadora de Servicios /
Mayan Residenciales) en las dos tiendas. Dos motivos: la ficha muestra el nombre
de la empresa y no el de una persona, y en Google Play las cuentas
**personales nuevas** deben superar una prueba cerrada con **12 testers durante
14 días** antes de poder publicar en producción; las cuentas de organización
no tienen ese requisito.

Pedir el D-U-N-S es gratis en
<https://developer.apple.com/enroll/duns-lookup/> y tarda hasta 30 días: es lo
primero que hay que lanzar, porque bloquea todo lo demás.

Empezar los dos trámites el mismo día; mientras llegan, avanzar con las
secciones 2 a 4.

---

## 2. Máquinas y herramientas

| Objetivo | Necesitas |
| --- | --- |
| Compilar y subir **iOS** | Un **Mac** con **Xcode 26 o superior**: desde el 28 de abril de 2026 App Store Connect rechaza toda subida compilada con un SDK anterior a iOS 26. No hay forma de compilar iOS en Windows o Linux. |
| Compilar y subir **Android** | Android Studio (incluye JDK 21 y SDK 36). Vale Windows, Mac o Linux. |
| Ambos | Node 22 (`"engines"` de `package.json`), el `.env` de producción (sección 2.1). |

### 2.1 Variables de entorno del binario

Vite **incrusta** las variables en el bundle: la app de la tienda queda atada
para siempre al Supabase con el que se compiló. Antes de cada build de tienda,
el `.env` de la raíz debe tener **los valores de producción**:

```
VITE_SUPABASE_URL=https://nnsqmeigtgewatameexo.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key de producción>
VITE_SENTRY_DSN=<dsn>            # imprescindible en móvil: no hay consola
VITE_POSTHOG_KEY=<key>           # si se quiere analítica (opt-in por consentimiento)
```

Si faltan las dos primeras la app abre en **pantalla blanca**, sin mensaje.

### 2.2 Backend: CORS y redirect (una sola vez)

Pasos 2 y 4 de `MOBILE.md`, resumidos:

1. **Supabase → Edge Functions → Secrets → `ALLOWED_ORIGINS`**: añadir
   `https://localhost` (Android) y `capacitor://localhost` (iOS), conservando
   los dominios web. Sin esto el login entra pero fallan invitaciones, cobros y
   correo.
2. **Supabase → Authentication → URL Configuration → Redirect URLs**: añadir
   `com.administratodo.app://auth-callback` (login con Google y recuperación de
   contraseña desde la app).

---

## 3. Iconos y splash de marca

**Hechos.** El ícono, el splash y los gráficos de la ficha de Play salen del
logo de la web y de la PWA: la cuadrícula de `public/favicon.svg` sobre verde
`#1B3B36`. Los dibuja `scripts/generar-iconos-nativos.mjs` y escribe cada PNG
al tamaño exacto de cada plataforma:

| Archivo | Para qué |
| --- | --- |
| `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` | Ícono de iOS, 1024×1024 **sin canal alfa** (App Store rechaza el ícono con alfa). iOS redondea las esquinas. App Store Connect toma el ícono de aquí: no se sube aparte. |
| `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732*.png` | Splash de iOS: cuadrícula centrada sobre el verde. |
| `android/app/src/main/res/mipmap-*/ic_launcher_foreground.png` | Capa frontal del ícono adaptativo de Android, dentro de la zona segura. El fondo es el color `ic_launcher_background` (`values/ic_launcher_background.xml`). |
| `android/app/src/main/res/mipmap-*/ic_launcher.png` y `ic_launcher_round.png` | Ícono para Android 7, que no tiene ícono adaptativo. |
| `android/app/src/main/res/drawable*/splash.png` | Splash de Android hasta la versión 11. Desde Android 12 el sistema muestra el ícono sobre `windowSplashScreenBackground` (`values/styles.xml`), también en el verde de la marca. |
| `docs/tiendas/play-icono-512.png` | Ícono de alta resolución para la ficha de Play: 512×512, PNG de 32 bits. |
| `docs/tiendas/play-grafico-funciones-1024x500.png` | Gráfico de funciones de la ficha de Play (obligatorio): logo, nombre y lema de la web. Se puede cambiar por uno propio del mismo tamaño. |
| `public/apple-touch-icon.png` | Ícono de pantalla de inicio de la **web instalada** en iPhone/iPad (PWA, `docs/PWA_INSTALACION.md`): 180×180, cuadrado y sin transparencia, como el de la app. |

Para cambiar el logo o el color, editar el script (colores y proporciones van
al principio) y volver a correrlo:

```bash
npx playwright install chromium   # solo la primera vez
node scripts/generar-iconos-nativos.mjs
```

Si cambia el color de fondo, cambiarlo también en
`android/app/src/main/res/values/ic_launcher_background.xml`. Después,
compilar como siempre (`npm run mobile:build` y Xcode o Android Studio) y
probar en el teléfono.

No usar `@capacitor/assets` para esto: genera la capa frontal del ícono de
Android a 48 dp y la estira a 72 dp, así que el ícono queda borroso; además
reformatea `AndroidManifest.xml` y deja PNG sin usar en el `Splash.imageset`.

---

## 4. Versiones: dónde se suben y cuándo

Cada subida a una tienda necesita un número **mayor** que el anterior. Hoy todo
está en el valor inicial.

| Plataforma | Campo | Archivo | Regla |
| --- | --- | --- | --- |
| Android | `versionCode` | `android/app/build.gradle` | Entero. **Sube en cada AAB** que se suba a Play, aunque sea de pruebas. Nunca se puede repetir. |
| Android | `versionName` | `android/app/build.gradle` | Texto que ve el usuario (`"1.0"`). |
| iOS | `CURRENT_PROJECT_VERSION` (Build) | Xcode → target App → General | Entero. **Sube en cada archivo** subido a App Store Connect. |
| iOS | `MARKETING_VERSION` (Version) | Xcode → target App → General | Lo que ve el usuario (`1.0`). Sube en cada versión publicada. |

Convención sugerida: `versionName` = `MARKETING_VERSION`, la misma en las dos
tiendas: `1.0` la primera, luego `1.0.1` para correcciones y `1.1` para
novedades. `versionCode` y `CURRENT_PROJECT_VERSION` = contador que empieza en
1 y sube de uno en uno con cada build. (La `"version"` de `package.json` es la
de la web y no tiene que coincidir.)

Para la primera publicación: `versionCode 1` / `versionName "1.0"` y
Version `1.0` / Build `1`. Son los valores que ya tiene el proyecto, y `1.0` es
la versión que App Store Connect crea por defecto al dar de alta la app, así que
no hay que cambiar nada.

---

## 5. Android → Google Play

### 5.1 Crear la llave de firma (una sola vez, y guardarla bien)

Play usa **Play App Signing**: Google guarda la llave definitiva y tú firmas
con una **llave de subida** (*upload key*). Si la pierdes, se puede pedir un
reset a Google; aun así, guárdala en un gestor de contraseñas o en una caja
fuerte de la empresa, nunca en el repo.

```bash
keytool -genkeypair -v \
  -keystore administratodo-upload.jks \
  -alias administratodo \
  -keyalg RSA -keysize 2048 -validity 10000
```

`keytool` viene con el JDK que instala Android Studio (en Mac:
`/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool`).
Responde con los datos de la empresa y guarda las dos contraseñas (del keystore
y de la llave). Luego mueve el `.jks` fuera del repo (por ejemplo a
`~/claves/`) y crea `android/keystore.properties` con:

```
storeFile=/ruta/absoluta/a/administratodo-upload.jks
storePassword=********
keyAlias=administratodo
keyPassword=********
```

`android/app/build.gradle` lee ese archivo si existe y firma el `release` con
él. El archivo y los `.jks` están en `.gitignore`: **`git status` nunca debe
mostrarlos**.

### 5.2 Generar el AAB

```bash
npm run mobile:build          # build web con CAPACITOR=true + cap sync
cd android
./gradlew bundleRelease       # en Windows: gradlew.bat bundleRelease
```

El archivo queda en `android/app/build/outputs/bundle/release/app-release.aab`.
Alternativa con interfaz: Android Studio → *Build → Generate Signed App Bundle*,
eligiendo el mismo `.jks`.

Antes de subirlo, instalar el release en un teléfono real y hacer la prueba de
humo de la sección 7:

```bash
./gradlew assembleRelease     # genera el APK firmado equivalente
adb install -r app/build/outputs/apk/release/app-release.apk
```

### 5.3 Crear la app en Play Console

1. **Play Console → Crear app**: nombre `AdministraTodo`, idioma
   predeterminado *Español (Latinoamérica)*, tipo *App*, *Gratis*. El tipo
   gratis/de pago **no se puede cambiar** después.
2. **Configuración de la app** (panel *Configura tu app*). Hay que completar
   **todo** antes de poder publicar:
   - *Política de privacidad*: `https://administratodo.com/politica-privacidad`.
   - *Acceso a la app*: «Toda o parte de la funcionalidad está restringida» y
     añadir **credenciales de una cuenta de prueba** (crear un tenant demo con
     datos ficticios, rol administrador). Sin esto los revisores no pasan del
     login y rechazan por «no se pudo revisar».
   - *Anuncios*: No contiene anuncios.
   - *Clasificación del contenido*: cuestionario IARC; categoría *Utilidad,
     productividad, comunicación u otros*. Resultado esperado: PEGI 3 / Para
     todos.
   - *Público objetivo*: 18 o más (es una herramienta de gestión).
   - *Aplicaciones de noticias*: No. *Aplicación gubernamental*: No.
   - *Seguridad de los datos*: ver la tabla de la sección 8.
   - *Funciones financieras*: si el cobro en línea al residente (Stripe) está
     activo en producción, declararlo en «Otras funciones financieras»; si no,
     «Mi app no ofrece funciones financieras». Google puede pedir documentación.
   - *Eliminación de cuenta*: URL `https://administratodo.com/eliminar-cuenta`
     (página pública con instrucciones y correo de soporte) y marcar que también
     se puede desde la app (*Mi perfil → Eliminar mi cuenta*). Google acepta
     ambas vías; la página explica además qué datos se borran y cuáles se
     conservan, que es lo que la política pide declarar.
3. **Ficha de Play Store** (*Presencia en la tienda → Ficha principal*):
   - Nombre (30 caracteres), descripción breve (80), descripción completa (4000).
   - Icono 512×512 PNG, **gráfico de funciones** 1024×500 (obligatorio): los
     dos están en `docs/tiendas/` (sección 3).
   - Capturas de **teléfono**: mínimo 2, recomendable 4–8, relación 16:9 o 9:16,
     lado mayor entre 320 y 3840 px. Tomarlas de un teléfono real o del
     emulador Pixel.
   - Capturas de tablet 7" y 10": opcionales salvo que se quiera aparecer en
     tablets. La app es responsiva; vale con capturas del emulador de tablet.
   - Correo de contacto del desarrollador (visible al público).

### 5.4 Subir y publicar por fases

1. **Pruebas → Pruebas internas → Crear versión**. La primera vez Play ofrece
   activar **Play App Signing**: aceptar y subir el `app-release.aab`. Añadir
   testers por correo (hasta 100) y repartir el enlace de opt-in. Disponible en
   minutos, sin revisión.
2. **Pruebas cerradas** (obligatorio solo con cuenta personal: 12 testers con
   opt-in durante 14 días seguidos; después hay que **solicitar acceso a
   producción** desde el panel y Google responde en unos días).
3. **Producción → Crear versión** con el mismo AAB (o uno nuevo con
   `versionCode` mayor). *Países*: elegir los de operación (Guatemala, México y
   los que apliquen). *Enviar para revisión*.
4. Primera revisión: típicamente de 1 a 7 días. Las siguientes suelen ser
   horas. Mientras, el estado se ve en *Panel → Estado de publicación*.

---

## 6. iOS → App Store

### 6.1 Identificador y firma (Apple Developer)

1. <https://developer.apple.com/account> → *Certificates, Identifiers &
   Profiles → Identifiers → +* → **App IDs** → tipo *App*:
   - Description: `AdministraTodo`.
   - Bundle ID: *Explicit* → `com.administratodo.app`.
   - Capabilities: ninguna obligatoria para la v1. *Push Notifications* solo si
     se activa push ahora. *Sign in with Apple*: activarla en este App ID, que
     es el principal del Services ID del login (`MOBILE.md`, paso 4); no cambia
     el binario ni hace falta añadirla en Xcode (el flujo va por el navegador).
2. No hace falta crear certificados ni perfiles a mano: Xcode lo hace con
   *Automatically manage signing*.

### 6.2 Preparar el proyecto en Xcode (en el Mac)

```bash
npm run ios     # mobile:build + abre ios/App/App.xcodeproj en Xcode
```

En Xcode, con el target **App** seleccionado:

- *Signing & Capabilities*: marcar *Automatically manage signing* y elegir el
  **Team** de la empresa. Xcode crea el certificado de distribución y el
  perfil. Si aparece «no profiles found», revisar que el Bundle ID coincida con
  el App ID creado en 6.1.
- *General → Identity*: Version `1.0`, Build `1` (sección 4); ya vienen así.
- *General → Deployment Info*: la app soporta iPhone **y iPad** (`TARGETED_DEVICE_FAMILY
  = 1,2`). Esto obliga a subir **capturas de iPad** y a que la revisión pruebe
  en iPad. Si no se quiere dar soporte a iPad en la v1, dejar solo *iPhone*
  aquí (equivale a `TARGETED_DEVICE_FAMILY = 1`).
- Hacer *Product → Run* en un simulador de iPhone y en un dispositivo real al
  menos una vez: la primera ejecución en dispositivo valida el certificado.

### 6.3 Crear la app en App Store Connect

<https://appstoreconnect.apple.com> → *Apps → +* → *Nueva app*:

- Plataforma: iOS. Nombre: `AdministraTodo` (único en toda la App Store; si
  está tomado, probar `AdministraTodo - Condominios` o similar; el nombre de
  la ficha no tiene que coincidir con `CFBundleDisplayName`).
- Idioma principal: *Spanish (Mexico)*. Bundle ID: `com.administratodo.app`.
- SKU: `administratodo-ios` (interno). Acceso de usuarios: *Acceso completo*.

### 6.4 Archivar y subir

En Xcode:

1. Seleccionar como destino **Any iOS Device (arm64)** (no un simulador; con un
   simulador seleccionado *Archive* está deshabilitado).
2. *Product → Archive*. Al terminar se abre *Organizer*.
3. *Distribute App* → **App Store Connect** (en las versiones recientes de
   Xcode aparece como *TestFlight & App Store*) → *Distribute*. Xcode firma con
   el equipo elegido y sube el build con sus símbolos. Si en vez de eso aparece
   la lista de opciones (*Custom*): *Upload*, dejar marcado *Upload your app's
   symbols* y aceptar la firma automática.
4. La pregunta de cifrado de exportación (*Missing Compliance*) no debería
   aparecer: `Info.plist` ya declara `ITSAppUsesNonExemptEncryption = false`
   (la app solo usa HTTPS estándar, que está exento). Si aun así la pide,
   responder **No** a «¿usa cifrado no exento?».

5. En 10–30 minutos el build aparece en App Store Connect → *TestFlight*.

### 6.5 TestFlight

- *Pruebas internas*: hasta 100 personas del equipo de App Store Connect, sin
  revisión. Instalan la app **TestFlight** y aceptan la invitación.
- *Pruebas externas*: hasta 10 000 por enlace público; el primer build pasa una
  **revisión beta** (1–2 días). Útil para los administradores de condominios
  antes del lanzamiento.

Hacer en TestFlight la prueba de humo de la sección 7, sobre todo el deep link
en los dos arranques (app en segundo plano y app cerrada del todo): con
`VITE_APPLE_SIGN_IN=true`, el login con Apple y con Google; sin la variable, la
recuperación de contraseña desde la app, que es entonces el único consumidor del
deep link (ver `MOBILE.md` §3).

### 6.6 Ficha de la App Store y envío a revisión

En App Store Connect → la app → versión `1.0`:

- **Capturas**: obligatorias para iPhone 6.9" (1320×2868 o 1290×2796); se
  reutilizan para el resto de tamaños. Si se mantiene iPad: iPad 13"
  (2064×2752). Tomarlas del simulador con ⌘S. Mínimo 1, máximo 10 por tamaño.
- Texto promocional (170), descripción (4000), palabras clave (100, separadas
  por coma, no repetir el nombre), URL de soporte (por ejemplo
  `https://administratodo.com`), URL de marketing (opcional).
- **URL de política de privacidad**: `https://administratodo.com/politica-privacidad`.
- Categoría: *Business* (principal), *Productivity* (secundaria).
- **Clasificación por edades**: responder *No* a todo → 4+.
- **Privacidad de la app** (*App Privacy*): declarar lo de la sección 8.
- **Información de revisión**: marcar *Se requiere inicio de sesión* y dar
  **usuario y contraseña de la cuenta de prueba** (la misma que en Play).
  Notas para el revisor, en inglés: qué hace la app; que es un servicio para
  empresas administradoras que se contrata fuera de la app, sin compras dentro
  de ella (3.1.3(c)), y que los pagos de residentes son cuotas y servicios del
  inmueble, servicios del mundo real (3.1.3(e)); para qué se usan la cámara
  (medidor, portería, asistencia, adjuntos) y el GPS (lecturas y marcaje de
  turno), y cómo llegar a una pantalla que use cada permiso. Indicar también
  dónde está la eliminación de cuenta (*Profile → Delete my account*) y la URL
  pública `https://administratodo.com/eliminar-cuenta`, con una **segunda
  cuenta** para probar el borrado (si borran la cuenta principal, la empresa de
  prueba queda suspendida). Un teléfono de contacto.
- *Versión*: seleccionar el build subido desde TestFlight.
- *Lanzamiento*: «Manual» para controlar el día, o «Automático».
- **Enviar para revisión**. Primera revisión: 1–3 días laborables; las
  siguientes, normalmente menos de 24 h. Si rechazan, responden en el *Resolution
  Center* con la guideline exacta; se corrige, se sube build nuevo (Build +1) y
  se reenvía sin perder la cola.

---

## 7. Prueba de humo antes de cada envío (en dispositivo real, build release)

1. El ícono en la pantalla de inicio es el de la marca (cuadrícula sobre
   verde, no la X azul de Capacitor) y la app abre con el splash verde y entra
   al login (no pantalla blanca).
2. Login con correo y contraseña; cerrar la app del todo y reabrir: sigue la
   sesión.
3. Deep link en los dos arranques (app abierta y app cerrada del todo): en
   Android, login con Google; en iOS, login con Apple y con Google si el build
   lleva `VITE_APPLE_SIGN_IN=true` (bloqueante #2), o recuperación de
   contraseña desde la app abriendo el enlace del correo en el mismo iPhone si
   no la lleva.
4. Registrar una lectura con foto de cámara y con foto de galería: la cámara
   pide permiso con el texto en español; en Android la galería abre el
   selector de fotos del sistema **sin** pedir permiso.
5. Una lectura con GPS: aparece el permiso de ubicación «mientras se usa».
6. Una acción que pase por una edge function (invitar usuario, enviar correo):
   si responde 403, falta el origen en `ALLOWED_ORIGINS` (sección 2.2).
7. Recuperar contraseña desde la app y abrir el correo **en el mismo teléfono**.
8. Girar el teléfono, abrir un modal, hacer scroll: nada queda bajo la barra de
   estado ni se arrastra de lado (`MOBILE.md` §4). En Android 15 o superior
   revisar también la **barra de navegación inferior**: con `targetSdk 36` el
   sistema impone *edge-to-edge* (Capacitor lo gestiona con
   `SystemBars.insetsHandling`, por defecto `css`), y es lo primero que salta en
   las capturas del *pre-launch report*.
9. Recorrer la app nativa buscando venta del plan: no debe haber precios,
   «Actualizar plan», «Mi plan», «Ampliar plan» ni avisos de prueba o pago
   (sección 0). Al primer arranque debe verse el login, no la landing.
10. Sin `VITE_PUSH_ENABLED`, al iniciar sesión **no** aparece el permiso de
    notificaciones; en Android, la app no se cierra tras el login.
11. En Sentry aparece el `release` del build (comprobar que llegan eventos).

---

## 8. Declaración de datos (Play *Data safety* y Apple *App Privacy*)

Rellenar las dos con la misma verdad. Inventario según el código actual:

| Dato | Se recoge | Para qué | Compartido con terceros | Play: tipo | Apple: categoría |
| --- | --- | --- | --- | --- | --- |
| Nombre, correo | Sí | Cuenta y funcionamiento | No (Supabase es procesador, no «tercero» a efectos de la declaración) | Información personal | Contact Info — *linked to user* |
| Contraseña | Sí (hash en Supabase Auth) | Autenticación | No | Credenciales | — (no se declara) |
| Fotos (medidor, comprobantes) | Sí | Funcionalidad de la app | No | Fotos y vídeos | User Content — Photos |
| Ubicación precisa | Sí, solo al registrar lectura | Funcionalidad | No | Ubicación → Precisa | Location — Precise, *linked to user* |
| Datos financieros (pagos, saldos) | Sí | Cobros | Stripe (si el pago en línea está activo) | Información financiera → Historial de pagos | Financial Info — Payment Info |
| Token de dispositivo (push) | Sí, si push activo | Notificaciones | Firebase/APNs | ID de dispositivo | Identifiers — Device ID |
| Registros de fallos | Sí (Sentry) | Diagnóstico | Sentry | Registros de fallos | Diagnostics — Crash Data |
| Analítica de uso | Solo con consentimiento (PostHog, opt-in) | Analítica | PostHog | Interacciones con la app | Usage Data — Product Interaction |
| Datos de residentes y proveedores que captura el usuario (nombres, teléfonos, direcciones) | Sí | Funcionalidad | No | Información personal → Nombre, Dirección, Teléfono | Contact Info, User Content |

Marcar en ambas: **se cifra en tránsito** (sí), **el usuario puede solicitar el
borrado** (sí: desde la app en *Mi perfil → Eliminar mi cuenta* y sin la app en
`https://administratodo.com/eliminar-cuenta`), **no se usa para publicidad ni
tracking** (Apple: *Data not used for tracking*; no hay ATT que pedir).

| Declaración | Valor |
| --- | --- |
| Play *Data safety* → *Eliminación de cuenta* → URL | `https://administratodo.com/eliminar-cuenta` |
| Play *Data safety* → «¿Los usuarios pueden solicitar que se eliminen sus datos?» | Sí (desde la app y desde la URL) |
| Apple *App Privacy* / notas de revisión | Borrado dentro de la app (*Profile → Delete my account*) y la misma URL |
| Qué se borra y qué se conserva (si lo preguntan) | `docs/ELIMINACION_CUENTA.md` y la propia página pública |

---

## 9. Después de publicar: actualizaciones

- La app nativa **no tiene service worker**: cualquier cambio del código web
  llega a los usuarios **solo con un build nuevo en las tiendas**. La web en
  Vercel sigue desplegándose sola; la app no.
- Rutina de actualización: subir versiones (sección 4) → `npm run mobile:build`
  → AAB (5.2) y archivo (6.4) → pruebas internas / TestFlight → producción.
- Cambios de **permisos** (nuevo `uses-permission` o nueva clave `NS*UsageDescription`)
  o de **datos recogidos** obligan a actualizar *Data safety* y *App Privacy*
  antes de enviar; si no, la tienda bloquea la publicación.
- Apple exige compilar con el SDK de la última versión mayor de iOS a partir
  de finales de abril de cada año (desde el 28 de abril de 2026: Xcode 26 /
  iOS 26 SDK). Google exige un `targetSdk` de como mucho un año de antigüedad a
  partir del 31 de agosto. El proyecto está en SDK 36 / iOS 15+ y cumple hoy;
  mantener Xcode y Android Studio actualizados antes de cada subida.
- Respuestas a reseñas: Play Console y App Store Connect permiten contestar;
  conviene hacerlo en los primeros meses.

---

## 10. Problemas frecuentes

| Síntoma | Causa y solución |
| --- | --- |
| Pantalla blanca al abrir la app de la tienda | `.env` sin `VITE_SUPABASE_URL`/`ANON_KEY` en el build. Rehacer `mobile:build` con el `.env` de producción. |
| El login entra pero invitaciones/cobros devuelven 403 | Falta `https://localhost` o `capacitor://localhost` en `ALLOWED_ORIGINS`. |
| Google se queda en el navegador y no vuelve a la app | Falta `com.administratodo.app://auth-callback` en *Redirect URLs* de Supabase, o se tocó `SceneDelegate.swift`/`AppDelegate.swift`. |
| Play: «Debes usar un versionCode distinto» | Ya se subió un AAB con ese número. Subir `versionCode` y regenerar. |
| Play: «El paquete debe estar firmado con la llave de subida» | Se firmó con otro `.jks`. Usar la llave registrada o pedir reset de upload key en Play Console → *Integridad de la app*. |
| Xcode: «No signing certificate» / «No profiles for com.administratodo.app» | Team sin seleccionar o App ID no creado. Sección 6.1 y 6.2. |
| App Store Connect: «ITMS-90xxx Missing Purpose String» | Falta una clave `NS*UsageDescription` para un permiso que un plugin declara. Las cuatro actuales cubren cámara, galería (lectura y escritura) y ubicación. |
| Rechazo Apple 5.1.1(ii): el texto del permiso no explica el uso | Los textos de `Info.plist` tienen que cubrir todo lo que la app hace con la cámara y la ubicación, no solo un caso. Hoy: cámara para el medidor, portería (visitantes, documentos, paquetes), asistencia (foto al marcar el turno) y adjuntos; ubicación para lecturas y marcaje de turno. Si una función nueva usa la cámara o el GPS para otra cosa, actualizar el texto antes de subir el build. |
| App Store Connect: «Invalid App Icon: transparency / alpha channel» | El `icon-only.png` de `resources/` tiene alfa. Exportar en RGB sin transparencia y regenerar. |
| Rechazo Apple 5.1.1(v) *Account deletion* | Ya existe (*Mi perfil → Eliminar mi cuenta* y `/eliminar-cuenta`). Si lo rechazan, comprobar que la cuenta de prueba llega a *Mi perfil* y que `delete-own-account` está desplegada (`deploy-functions.yml`) y en `ALLOWED_ORIGINS` el origen de la app. |
| Rechazo Apple 4.8 *Login services* | No debería ocurrir: con `VITE_APPLE_SIGN_IN=true` la app ofrece *Sign in with Apple* junto a Google, y sin la variable no muestra login social (bloqueante #2 de la sección 0). Si aparece, comprobar en el binario qué botones salen (`src/lib/loginProviders.ts`) y que nadie añadió otro login social sin Apple al lado. |
| «Continuar con Apple» vuelve con error de callback y Google funciona | El *Secret Key* del proveedor Apple en Supabase caducó (Apple lo limita a 6 meses). Renovarlo: `docs/RUNBOOK_GOOGLE_OAUTH_LOGIN.md`. |
| Rechazo Apple 2.1 *App completeness*: «no pudimos iniciar sesión» | Credenciales de prueba caducadas o con 2FA. Mantener la cuenta demo viva y sin SSO/2FA. |
| App Store Connect: «ITMS-91053: Missing API declaration» | Una dependencia nativa usa una API de «razón obligatoria» (`UserDefaults`, fechas de archivos, espacio en disco…) sin manifiesto de privacidad. El correo nombra la categoría. Solución: actualizar el plugin a una versión que traiga su `PrivacyInfo.xcprivacy` o, si no existe, añadir uno al target *App* en Xcode (*File → New → App Privacy*) declarando esa categoría y su motivo. Candidatos a vigilar: `IONCameraLib` e `IONGeolocationLib`, que bajan por Swift Package Manager al compilar. |
| Rechazo Apple 3.1.1 *In-App Purchase* o Play *Payments policy* | No debería ocurrir: la app nativa no vende ni amplía el plan (sección 0). Si aparece, alguien añadió una pantalla de venta sin pasar por `mostrarVentaDePlanes()` (`src/lib/ventaDePlanes.ts`): localizarla con el `grep` de la sección 0. Los pagos de cuotas y agua de residentes están permitidos (Apple 3.1.3(e)); indicarlo en las notas de revisión si preguntan. |
| Play: crash al iniciar sesión en el *pre-launch report* | Se compiló con `VITE_PUSH_ENABLED=true` sin `google-services.json`. Quitar la variable o configurar Firebase (`MOBILE.md`, paso 6). |
| Play: declaración de «permisos de fotos y videos» | Alguien añadió `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO` al `AndroidManifest.xml`. Quitarlo: la galería funciona con el *Photo Picker* sin permiso (sección 0). |
| Play: aviso de compatibilidad con páginas de memoria de **16 KB** | Lo exige Play para apps que apuntan a Android 15+. Revisarlo en *Explorador de app bundle*; si una biblioteca nativa no está alineada, actualizar Capacitor, el plugin afectado o el Android Gradle Plugin. |
| Rechazo Apple 4.2 *Minimum functionality*: «es solo un sitio web empaquetado» | Resaltar en las notas de revisión las capacidades nativas: cámara para medidores, GPS, sesión persistente, (push). Las capturas deben mostrar esas pantallas. |
