// Instalar la web como app (PWA) en el teléfono, la tablet o el escritorio.
//
// La web ya es instalable (manifest + service worker en vite.config.ts), pero el
// navegador no lo anuncia: en Android hay que encontrar «Instalar app» en el menú
// y en iPhone/iPad hay que saber que existe Compartir → «Agregar a inicio». Este
// módulo detecta qué camino de instalación tiene el navegador actual y lo expone
// a la interfaz (components/shared/InstalarApp.tsx), que es quien lo ofrece.
//
// Los caminos (`ViaInstalacion`):
//   - 'boton'      Chromium (Chrome, Edge, Samsung Internet; Android y escritorio)
//                  dispara `beforeinstallprompt`. Guardamos el evento y un botón
//                  nuestro abre el diálogo de instalación del navegador.
//   - 'ios-safari' Safari en iPhone/iPad: no hay API, solo pasos manuales.
//   - 'ios-otro'   Otro navegador en iPhone/iPad (Chrome, Edge, Firefox…): los
//                  mismos pasos, pero Compartir está en otro sitio; y dentro de
//                  apps como Instagram o Facebook no existe la opción.
//   - 'manual'     Android sin `beforeinstallprompt` (Firefox, o Chrome cuando la
//                  app ya está instalada): menú del navegador → «Instalar».
//   - null         No aplica: ya corre instalada, es la app nativa de las tiendas
//                  (Capacitor) o es un navegador de escritorio sin soporte.
//
// No-op en la app nativa: ahí no hay nada que instalar.
import { isNative } from './platform'

/** Evento de Chromium; no está en lib.dom.d.ts porque no es estándar. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<unknown>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type ViaInstalacion = 'boton' | 'ios-safari' | 'ios-otro' | 'manual' | null

export interface EstadoInstalacion {
  via: ViaInstalacion
  /** La página corre como app instalada (ventana propia, sin barra del navegador). */
  instalada: boolean
  /** Para afinar los textos: «tu iPad» en vez de «tu iPhone». */
  esTablet: boolean
}

// ─── Detección (funciones puras, se prueban con user agents reales) ──────────

/** iPhone, iPod o iPad. iPadOS 13+ se presenta como Mac: un Mac real no es táctil. */
export function esIos(ua: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/.test(ua)) return true
  return /Macintosh/.test(ua) && maxTouchPoints > 1
}

export function esIpad(ua: string, maxTouchPoints: number): boolean {
  return /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)
}

// En iOS todos los navegadores usan WebKit y su user agent se parece al de Safari;
// lo que los distingue es la marca que añade cada uno. Las últimas son webviews
// dentro de otras apps, donde «Agregar a inicio» no existe.
const IOS_NO_SAFARI =
  /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo|GSA\/|YaBrowser|FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|TikTok|Snapchat|Twitter|LinkedInApp|Pinterest/

export function esSafariDeIos(ua: string): boolean {
  return !IOS_NO_SAFARI.test(ua)
}

/** Tablet Android: su user agent lleva «Android» sin «Mobile». */
function esTabletAndroid(ua: string): boolean {
  return /Android/.test(ua) && !/Mobile/.test(ua)
}

export interface Entorno {
  nativo: boolean
  instalada: boolean
  hayEvento: boolean
  ua: string
  maxTouchPoints: number
}

export function viaDeInstalacion(e: Entorno): ViaInstalacion {
  if (e.nativo || e.instalada) return null
  if (e.hayEvento) return 'boton'
  if (esIos(e.ua, e.maxTouchPoints)) return esSafariDeIos(e.ua) ? 'ios-safari' : 'ios-otro'
  if (/Android/.test(e.ua)) return 'manual'
  return null
}

/**
 * `true` cuando la página corre como app instalada. `display-mode` lo reportan
 * Android, escritorio e iOS reciente; `navigator.standalone` es la vía clásica
 * de iOS y la única en versiones anteriores.
 *
 * `fullscreen` NO cuenta, a propósito: también lo reporta una pestaña normal
 * con el navegador en pantalla completa (F11, modo quiosco), y de esta función
 * depende que la sesión se guarde de forma persistente (lib/authStorage.ts). El
 * manifiesto pide `standalone`, así que la app instalada nunca arranca en
 * `fullscreen`; `minimal-ui` y `window-controls-overlay` son las variantes que
 * un navegador puede darle en su lugar.
 */
export function estaInstalada(): boolean {
  if (typeof window === 'undefined') return false
  const modo = (m: string) => window.matchMedia?.(`(display-mode: ${m})`).matches === true
  if (modo('standalone') || modo('minimal-ui') || modo('window-controls-overlay')) return true
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

// ─── Estado (un pequeño store para useSyncExternalStore) ─────────────────────

let eventoPendiente: BeforeInstallPromptEvent | null = null
// El usuario aceptó instalar en esta misma pestaña: la pestaña sigue en modo
// navegador (display-mode no cambia), pero ya no hay nada que ofrecerle.
let recienInstalada = false
let iniciado = false
const oyentes = new Set<() => void>()

function calcular(): EstadoInstalacion {
  if (typeof window === 'undefined') return { via: null, instalada: false, esTablet: false }
  const ua = navigator.userAgent
  const maxTouchPoints = navigator.maxTouchPoints ?? 0
  const instalada = estaInstalada()
  return {
    via: viaDeInstalacion({
      nativo: isNative(),
      instalada: instalada || recienInstalada,
      hayEvento: eventoPendiente !== null,
      ua,
      maxTouchPoints,
    }),
    instalada,
    esTablet: esIpad(ua, maxTouchPoints) || esTabletAndroid(ua),
  }
}

let estado: EstadoInstalacion = { via: null, instalada: false, esTablet: false }

function actualizar(): void {
  const nuevo = calcular()
  if (nuevo.via === estado.via && nuevo.instalada === estado.instalada && nuevo.esTablet === estado.esTablet) return
  estado = nuevo
  oyentes.forEach((avisar) => avisar())
}

/**
 * Empieza a escuchar al navegador. Hay que llamarla al arrancar (main.tsx), antes
 * de montar React: Chromium dispara `beforeinstallprompt` una sola vez, poco
 * después de cargar la página, y si nadie lo guardó se pierde.
 */
export function initPwaInstall(): void {
  if (iniciado || typeof window === 'undefined' || isNative()) return
  iniciado = true
  window.addEventListener('beforeinstallprompt', (e) => {
    // Sin esto Chrome en Android muestra su propia barra inferior, que competiría
    // con nuestro aviso (y aparecería aunque el usuario lo hubiera descartado).
    e.preventDefault()
    eventoPendiente = e as BeforeInstallPromptEvent
    actualizar()
  })
  window.addEventListener('appinstalled', () => {
    eventoPendiente = null
    recienInstalada = true
    actualizar()
  })
  // Pasar de pestaña a ventana instalada (o al revés) sin recargar.
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', actualizar)
  actualizar()
}

export function suscribirInstalacion(avisar: () => void): () => void {
  oyentes.add(avisar)
  return () => {
    oyentes.delete(avisar)
  }
}

/** Foto estable del estado: la misma referencia mientras nada cambie. */
export function leerInstalacion(): EstadoInstalacion {
  return estado
}

export type ResultadoInstalacion = 'aceptada' | 'rechazada' | 'no-disponible'

/**
 * Abre el diálogo de instalación del navegador (solo con la vía 'boton'). Tiene
 * que llamarse desde un clic: el navegador lo exige.
 */
export async function pedirInstalacion(): Promise<ResultadoInstalacion> {
  const evento = eventoPendiente
  if (!evento) return 'no-disponible'
  // El evento sirve para un solo uso: se suelta antes de esperar la respuesta.
  eventoPendiente = null
  try {
    await evento.prompt()
    const { outcome } = await evento.userChoice
    if (outcome === 'accepted') recienInstalada = true
    return outcome === 'accepted' ? 'aceptada' : 'rechazada'
  } catch {
    return 'no-disponible'
  } finally {
    actualizar()
  }
}

// ─── Abrir el aviso a mano ───────────────────────────────────────────────────
// Para las pantallas sin sitio para una tarjeta propia (el pie del portal de
// condominios): un enlace «Instalar la app» que vuelve a mostrar el aviso,
// aunque el usuario lo hubiera cerrado.

const EVENTO_ABRIR_AVISO = 'at:instalar-app'

export function abrirAvisoDeInstalacion(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_ABRIR_AVISO))
}

export function alAbrirAvisoDeInstalacion(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENTO_ABRIR_AVISO, handler)
  return () => window.removeEventListener(EVENTO_ABRIR_AVISO, handler)
}

// ─── Aviso automático: recordar que el usuario lo cerró ──────────────────────

const CLAVE_DESCARTE = 'at-instalar-app-descartado'
/** El aviso no vuelve a salir hasta pasado este tiempo desde que se cerró. */
export const DIAS_SIN_AVISO = 30

export function avisoDescartado(ahora: number = Date.now()): boolean {
  try {
    const cuando = Number(localStorage.getItem(CLAVE_DESCARTE))
    return Number.isFinite(cuando) && cuando > 0 && ahora - cuando < DIAS_SIN_AVISO * 24 * 3600_000
  } catch {
    return false
  }
}

export function descartarAviso(ahora: number = Date.now()): void {
  try {
    localStorage.setItem(CLAVE_DESCARTE, String(ahora))
  } catch {
    /* almacenamiento no disponible (modo privado): el aviso saldrá otra vez */
  }
}
