# Instalar AdministraTodo como app desde la web (PWA)

La web de AdministraTodo se puede instalar en el teléfono, la tablet o la
computadora **sin pasar por las tiendas**: queda con su ícono en la pantalla de
inicio y abre a pantalla completa, sin la barra del navegador. Es la misma web,
con las mismas cuentas y los mismos datos.

Sirve desde ya, mientras se publican las apps de App Store y Google Play
(`docs/PUBLICACION_TIENDAS.md`), y puede seguir conviviendo con ellas después.

---

## 1. Cómo se instala (para compartir con los usuarios)

En teléfonos y tablets la web muestra sola, una vez, el aviso **«Instala
AdministraTodo»**. Si se cierra con «Ahora no» no vuelve a salir en 30 días,
pero la opción queda siempre a mano: en el panel y en el portal de agua, en
**Mi perfil → Instalar la app**; en el portal de condominios, en el enlace
**Instalar la app** del pie de página.

| Dispositivo | Pasos |
| --- | --- |
| **Android** (Chrome, Edge, Samsung Internet) | Entrar a la web → en el aviso, **Instalar** → confirmar. También desde el menú **⋮ → Instalar app**. |
| **iPhone y iPad** (Safari) | Entrar a la web → tocar **Compartir** (el cuadro con la flecha hacia arriba; si no se ve, primero **•••**) → **Agregar a inicio** → **Agregar**. |
| **iPhone y iPad** (Chrome, Edge, Firefox) | Igual, pero **Compartir** está junto a la barra de direcciones. Si la opción no aparece —pasa dentro de Instagram, Facebook y otras apps—, abrir la página en Safari. |
| **Computadora** (Chrome, Edge) | Ícono de instalar en la barra de direcciones, o **Mi perfil → Instalar la app**. |

Después se abre desde el ícono, como cualquier app. La primera vez pide iniciar
sesión aunque el usuario ya la tuviera abierta en el navegador: en iPhone y iPad
la app instalada guarda sus datos aparte de Safari.

---

## 2. En qué se diferencia de la app de las tiendas

| | Instalada desde la web (PWA) | App de App Store / Google Play |
| --- | --- | --- |
| Cómo llega | Desde el navegador, sin revisión | Publicación y revisión en cada tienda |
| Actualizaciones | Solas, con cada despliegue de la web | Hay que compilar y subir cada versión |
| Sesión | Se cierra al cerrar la app, como en la web | Se mantiene abierta |
| Notificaciones push | No | Sí, cuando se configure Firebase (`MOBILE.md`, paso 6) |
| Planes y precios | Se muestran: es la web | Ocultos (reglas de las tiendas, `src/lib/ventaDePlanes.ts`) |
| Cámara y ubicación | Sí, con el permiso del navegador | Sí, con el permiso del sistema |
| Sin conexión | Abre y muestra lo ya consultado | Igual |

---

## 3. Qué hay en el código

- **Manifiesto y service worker**: `vite.config.ts` (plugin `VitePWA`). El
  manifiesto no bloquea la orientación (`orientation: 'any'`): una tablet puede
  usarse en horizontal. El build de la app nativa (`CAPACITOR=true`) no lleva
  service worker.
- **Íconos**: los del manifiesto están en `public/pwa-*.png`. El de iPhone y
  iPad es `public/apple-touch-icon.png` y tiene que ser un cuadrado completo,
  sin transparencia (iOS pinta de negro lo transparente y redondea él las
  esquinas); lo genera `scripts/generar-iconos-nativos.mjs`.
- **Detección** (`src/lib/pwaInstall.ts`): qué camino de instalación tiene cada
  navegador. Chrome, Edge y Samsung avisan con el evento `beforeinstallprompt`,
  y un botón propio abre su diálogo; iPhone y iPad no tienen ninguna API, así que
  ahí solo se muestran los pasos. No ofrece nada dentro de la app ya instalada
  ni de la app nativa.
- **Aviso, opción de Perfil y enlace del pie**
  (`src/components/shared/InstalarApp.tsx`): el aviso se monta una sola vez en
  `src/main.tsx`. Sale solo en teléfonos y tablets, después de que el usuario
  decide sobre las cookies (ocupan el mismo sitio). El enlace del pie lo vuelve
  a abrir en cualquier dispositivo.
- **Instalada abre en el login** (`src/components/landing/LandingPage.tsx`): la
  página comercial queda detrás y se puede ver cerrando el login.
- **Barra de estado y bordes de la pantalla** (`src/index.css`, «Barra de
  estado»): instalada en iPhone o iPad la página se dibuja debajo de la barra de
  estado. Una franja con el verde de la marca la hace legible, y cada pantalla
  reserva ese hueco arriba; con el teléfono en horizontal se reserva también el
  lado de la muesca. Una pantalla nueva a página completa necesita lo mismo: la
  clase `at-bajo-barra-estado` o `var(--at-inset-top)`.

---

## 4. Qué se probó y qué falta probar en un dispositivo

Probado en este repo con Chromium, simulando tamaños de teléfono y tablet, el
área segura de iOS y el evento de instalación: el aviso en cada navegador, las
28 secciones del panel sin desbordes a seis tamaños (iPhone y iPad en vertical y
horizontal, tablet Android), y que ninguna pantalla deje contenido bajo la barra
de estado. Las pantallas se revisaron con datos vacíos.

No hay forma de probar un iPhone o un iPad reales desde aquí. Antes de
recomendarla a los usuarios, revisar en un dispositivo de cada tipo:

1. **Instalar** con los pasos de la sección 1 y abrir desde el ícono: sin barra
   del navegador y con el login a la vista.
2. **iPhone / iPad**: arriba hay una franja verde con la hora y la batería en
   blanco, y nada del contenido queda tapado (panel, portal de residentes,
   registro). En iOS 26.1 Apple cambió cómo se dibuja esa zona; si la franja no
   se ve o hay un hueco doble, avisar.
3. **Iniciar sesión** con correo y con Google. En iPhone, Google abre una hoja
   del navegador y debe volver sola a la app.
4. **Girar** el dispositivo: en tablet el panel se acomoda en horizontal; en
   teléfono la muesca no tapa el menú.
5. **Lectura con foto y ubicación**: el navegador pide los dos permisos y la
   foto se adjunta.
6. **Cerrar la app y volver a abrirla**: pide iniciar sesión de nuevo (es lo
   esperado hoy, ver sección 2).

---

## 5. Límites conocidos

- **iPhone y iPad no muestran pantalla de carga propia**: al abrir se ve la
  pantalla en blanco un instante. Se puede añadir con imágenes
  `apple-touch-startup-image` (una por tamaño de dispositivo).
- **El ícono y el nombre se fijan al instalar** en iPhone y iPad: si cambian,
  hay que quitar la app de la pantalla de inicio y agregarla de nuevo. En
  Android se actualizan solos, con unos días de retraso.
- **Quitar la app borra sus datos locales** (sesión y lo guardado para usar sin
  conexión). Los datos de la cuenta no se tocan: están en el servidor.
- **Si ya la habían agregado a inicio antes de este cambio** en iPhone o iPad,
  conviene quitarla y agregarla otra vez.

Cuando las apps estén en las tiendas, la web puede recomendar la de Google Play
en lugar de instalarse ella misma, añadiendo `related_applications` y
`prefer_related_applications` al manifiesto.
