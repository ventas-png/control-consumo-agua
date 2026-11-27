// Instalar la web como app (PWA): qué camino de instalación ofrece cada
// navegador y cuándo no hay que ofrecer ninguno. Ver src/lib/pwaInstall.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Se mockea @capacitor/core (no src/lib/platform) para recorrer el camino real.
const capacitor = vi.hoisted(() => ({
  isNativePlatform: vi.fn<() => boolean>(),
  getPlatform: vi.fn<() => string>(),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: capacitor }))

// User agents reales.
const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 15; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 370.0.0.24.107',
  // iPadOS se presenta como un Mac; lo delata la pantalla táctil.
  ipadSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  ipadClasico: 'Mozilla/5.0 (iPad; CPU OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
}

type Modulo = typeof import('../pwaInstall')

/** Módulo recién cargado: su estado (evento guardado, oyentes) es global. */
async function cargar(): Promise<Modulo> {
  vi.resetModules()
  return import('../pwaInstall')
}

function simularNavegador(ua: string, maxTouchPoints = 0) {
  vi.stubGlobal('navigator', { userAgent: ua, maxTouchPoints })
}

/** jsdom no trae matchMedia. `modo` es el display-mode que reporta el navegador. */
function simularDisplayMode(modo: 'browser' | 'standalone' | 'fullscreen' | 'minimal-ui' | 'window-controls-overlay') {
  window.matchMedia = vi.fn((q: string) => ({
    matches: q === `(display-mode: ${modo})`, media: q, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

/** El evento de Chromium: `prompt()` abre el diálogo y `userChoice` trae la respuesta. */
function eventoInstalable(respuesta: 'accepted' | 'dismissed' = 'accepted') {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
  }
  e.prompt = vi.fn(() => Promise.resolve())
  e.userChoice = Promise.resolve({ outcome: respuesta })
  return e
}

const matchMediaOriginal = window.matchMedia

// Cada test carga el módulo de nuevo, y cada carga engancha sus oyentes en la
// MISMA window. Se anotan para quitarlos al terminar: si no, el `preventDefault`
// de un test anterior haría pasar las aserciones del siguiente.
let enganchados: Array<[string, EventListenerOrEventListenerObject]> = []

beforeEach(() => {
  capacitor.isNativePlatform.mockReturnValue(false)
  capacitor.getPlatform.mockReturnValue('web')
  simularDisplayMode('browser')
  simularNavegador(UA.androidChrome, 5)
  localStorage.clear()
  enganchados = []
  const original = window.addEventListener.bind(window)
  vi.spyOn(window, 'addEventListener').mockImplementation((tipo: string, oyente: EventListenerOrEventListenerObject, opciones?: boolean | AddEventListenerOptions) => {
    enganchados.push([tipo, oyente])
    original(tipo, oyente, opciones)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  enganchados.forEach(([tipo, oyente]) => window.removeEventListener(tipo, oyente))
  vi.unstubAllGlobals()
  window.matchMedia = matchMediaOriginal
})

describe('detección de iPhone y iPad', () => {
  it('reconoce iPhone, iPad clásico y iPadOS (que dice ser un Mac)', async () => {
    const { esIos, esIpad } = await cargar()
    expect(esIos(UA.iphoneSafari, 5)).toBe(true)
    expect(esIos(UA.ipadClasico, 5)).toBe(true)
    expect(esIos(UA.ipadSafari, 5)).toBe(true)
    expect(esIpad(UA.ipadSafari, 5)).toBe(true)
    expect(esIpad(UA.iphoneSafari, 5)).toBe(false)
  })

  it('un Mac de verdad no es un iPad: no tiene pantalla táctil', async () => {
    const { esIos, esIpad } = await cargar()
    expect(esIos(UA.macSafari, 0)).toBe(false)
    expect(esIpad(UA.macSafari, 0)).toBe(false)
  })

  it('distingue Safari de los demás navegadores y de las apps con navegador propio', async () => {
    const { esSafariDeIos } = await cargar()
    expect(esSafariDeIos(UA.iphoneSafari)).toBe(true)
    expect(esSafariDeIos(UA.ipadSafari)).toBe(true)
    expect(esSafariDeIos(UA.iphoneChrome)).toBe(false)
    expect(esSafariDeIos(UA.iphoneInstagram)).toBe(false)
  })
})

describe('viaDeInstalacion', () => {
  const base = { nativo: false, instalada: false, hayEvento: false, ua: UA.androidChrome, maxTouchPoints: 5 }

  it('con el evento del navegador ofrece el botón, sea cual sea el dispositivo', async () => {
    const { viaDeInstalacion } = await cargar()
    expect(viaDeInstalacion({ ...base, hayEvento: true })).toBe('boton')
    expect(viaDeInstalacion({ ...base, hayEvento: true, ua: UA.windowsFirefox, maxTouchPoints: 0 })).toBe('boton')
  })

  it('en iPhone y iPad solo hay pasos manuales, distintos fuera de Safari', async () => {
    const { viaDeInstalacion } = await cargar()
    expect(viaDeInstalacion({ ...base, ua: UA.iphoneSafari })).toBe('ios-safari')
    expect(viaDeInstalacion({ ...base, ua: UA.ipadSafari })).toBe('ios-safari')
    expect(viaDeInstalacion({ ...base, ua: UA.iphoneChrome })).toBe('ios-otro')
    expect(viaDeInstalacion({ ...base, ua: UA.iphoneInstagram })).toBe('ios-otro')
  })

  it('Android sin evento (Firefox, o Chrome con la app ya instalada): pasos por el menú', async () => {
    const { viaDeInstalacion } = await cargar()
    expect(viaDeInstalacion({ ...base, ua: UA.androidFirefox })).toBe('manual')
    expect(viaDeInstalacion(base)).toBe('manual')
  })

  it('escritorio sin evento: no hay cómo instalar', async () => {
    const { viaDeInstalacion } = await cargar()
    expect(viaDeInstalacion({ ...base, ua: UA.windowsFirefox, maxTouchPoints: 0 })).toBeNull()
    expect(viaDeInstalacion({ ...base, ua: UA.macSafari, maxTouchPoints: 0 })).toBeNull()
  })

  it('nunca dentro de la app ya instalada ni de la app nativa', async () => {
    const { viaDeInstalacion } = await cargar()
    expect(viaDeInstalacion({ ...base, hayEvento: true, instalada: true })).toBeNull()
    expect(viaDeInstalacion({ ...base, ua: UA.iphoneSafari, instalada: true })).toBeNull()
    expect(viaDeInstalacion({ ...base, hayEvento: true, nativo: true })).toBeNull()
    expect(viaDeInstalacion({ ...base, ua: UA.iphoneSafari, nativo: true })).toBeNull()
  })
})

describe('estaInstalada', () => {
  it('es false en una pestaña normal', async () => {
    const { estaInstalada } = await cargar()
    expect(estaInstalada()).toBe(false)
  })

  it.each(['standalone', 'minimal-ui', 'window-controls-overlay'] as const)('es true con display-mode %s', async (modo) => {
    simularDisplayMode(modo)
    const { estaInstalada } = await cargar()
    expect(estaInstalada()).toBe(true)
  })

  it('una pestaña en pantalla completa (F11, modo quiosco) no es la app instalada', async () => {
    simularDisplayMode('fullscreen')
    const { estaInstalada } = await cargar()
    expect(estaInstalada()).toBe(false)
  })

  it('es true con navigator.standalone, la vía clásica de iOS', async () => {
    vi.stubGlobal('navigator', { userAgent: UA.iphoneSafari, maxTouchPoints: 5, standalone: true })
    const { estaInstalada } = await cargar()
    expect(estaInstalada()).toBe(true)
  })

  it('no falla si el navegador no tiene matchMedia', async () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia
    const { estaInstalada } = await cargar()
    expect(estaInstalada()).toBe(false)
  })
})

describe('estado en vivo', () => {
  it('guarda el evento del navegador, evita su barra propia y ofrece el botón', async () => {
    const m = await cargar()
    m.initPwaInstall()
    expect(m.leerInstalacion().via).toBe('manual')

    const avisar = vi.fn()
    m.suscribirInstalacion(avisar)
    const evento = eventoInstalable()
    window.dispatchEvent(evento)

    expect(evento.defaultPrevented).toBe(true)
    expect(m.leerInstalacion().via).toBe('boton')
    expect(avisar).toHaveBeenCalledTimes(1)
  })

  it('pedirInstalacion abre el diálogo; si el usuario acepta ya no hay nada que ofrecer', async () => {
    const m = await cargar()
    m.initPwaInstall()
    const evento = eventoInstalable('accepted')
    window.dispatchEvent(evento)

    await expect(m.pedirInstalacion()).resolves.toBe('aceptada')
    expect(evento.prompt).toHaveBeenCalledTimes(1)
    expect(m.leerInstalacion().via).toBeNull()
  })

  it('si el usuario dice que no, el evento queda gastado y se vuelve a los pasos', async () => {
    const m = await cargar()
    m.initPwaInstall()
    window.dispatchEvent(eventoInstalable('dismissed'))

    await expect(m.pedirInstalacion()).resolves.toBe('rechazada')
    expect(m.leerInstalacion().via).toBe('manual')
    // El evento es de un solo uso: un segundo intento no tiene con qué.
    await expect(m.pedirInstalacion()).resolves.toBe('no-disponible')
  })

  it('sin evento, pedirInstalacion no hace nada', async () => {
    const m = await cargar()
    m.initPwaInstall()
    await expect(m.pedirInstalacion()).resolves.toBe('no-disponible')
  })

  it('al instalarse (appinstalled) deja de ofrecerse en esa misma pestaña', async () => {
    const m = await cargar()
    m.initPwaInstall()
    window.dispatchEvent(eventoInstalable())
    window.dispatchEvent(new Event('appinstalled'))
    expect(m.leerInstalacion().via).toBeNull()
  })

  it('la foto del estado conserva la referencia mientras nada cambia', async () => {
    const m = await cargar()
    m.initPwaInstall()
    const antes = m.leerInstalacion()
    expect(m.leerInstalacion()).toBe(antes)
    window.dispatchEvent(eventoInstalable())
    expect(m.leerInstalacion()).not.toBe(antes)
  })

  it('en iPhone ofrece los pasos de Safari sin esperar ningún evento', async () => {
    simularNavegador(UA.iphoneSafari, 5)
    const m = await cargar()
    m.initPwaInstall()
    expect(m.leerInstalacion()).toEqual({ via: 'ios-safari', instalada: false, esTablet: false })
  })

  it('reconoce la tablet: iPad y Android sin «Mobile»', async () => {
    simularNavegador(UA.ipadSafari, 5)
    let m = await cargar()
    m.initPwaInstall()
    expect(m.leerInstalacion().esTablet).toBe(true)

    simularNavegador(UA.androidTablet, 5)
    m = await cargar()
    m.initPwaInstall()
    expect(m.leerInstalacion().esTablet).toBe(true)
  })

  it('corriendo instalada no ofrece nada, aunque el navegador mande el evento', async () => {
    simularDisplayMode('standalone')
    const m = await cargar()
    m.initPwaInstall()
    window.dispatchEvent(eventoInstalable())
    expect(m.leerInstalacion()).toMatchObject({ via: null, instalada: true })
  })

  it('en la app nativa no escucha nada: no hay nada que instalar', async () => {
    capacitor.isNativePlatform.mockReturnValue(true)
    capacitor.getPlatform.mockReturnValue('android')
    const m = await cargar()
    m.initPwaInstall()
    expect(enganchados).toEqual([])
    const evento = eventoInstalable()
    window.dispatchEvent(evento)
    expect(evento.defaultPrevented).toBe(false)
    expect(m.leerInstalacion().via).toBeNull()
  })
})

describe('aviso descartado', () => {
  const DIA = 24 * 3600_000

  it('no está descartado hasta que el usuario lo cierra', async () => {
    const { avisoDescartado } = await cargar()
    expect(avisoDescartado()).toBe(false)
  })

  it('tras cerrarlo no vuelve a salir en 30 días, y después sí', async () => {
    const { avisoDescartado, descartarAviso, DIAS_SIN_AVISO } = await cargar()
    const hoy = Date.UTC(2026, 10, 27)
    descartarAviso(hoy)
    expect(avisoDescartado(hoy + DIA)).toBe(true)
    expect(avisoDescartado(hoy + (DIAS_SIN_AVISO - 1) * DIA)).toBe(true)
    expect(avisoDescartado(hoy + (DIAS_SIN_AVISO + 1) * DIA)).toBe(false)
  })

  it('un valor guardado que no es una fecha no lo oculta para siempre', async () => {
    const { avisoDescartado } = await cargar()
    localStorage.setItem('at-instalar-app-descartado', 'true')
    expect(avisoDescartado()).toBe(false)
  })
})
