import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// isNative se mockea por test: initNativeApp tiene que ser un no-op en web.
vi.mock('../platform', () => ({ isNative: vi.fn(), getPlatform: vi.fn() }))

const statusBar = {
  setOverlaysWebView: vi.fn().mockResolvedValue(undefined),
  setStyle: vi.fn().mockResolvedValue(undefined),
  setBackgroundColor: vi.fn().mockResolvedValue(undefined),
}
vi.mock('@capacitor/status-bar', () => ({
  StatusBar: statusBar,
  Style: { Dark: 'DARK', Light: 'LIGHT', Default: 'DEFAULT' },
}))

import {
  aplicarViewportNativo,
  configurarBarraDeEstado,
  VIEWPORT_NATIVO,
  initNativeApp,
} from '../nativeApp'
import { isNative } from '../platform'

const VIEWPORT_WEB = 'width=device-width, initial-scale=1.0, viewport-fit=cover'

function montarMetaViewport(content = VIEWPORT_WEB) {
  document.head.innerHTML = ''
  const meta = document.createElement('meta')
  meta.setAttribute('name', 'viewport')
  meta.setAttribute('content', content)
  document.head.appendChild(meta)
  return meta
}

beforeEach(() => {
  vi.mocked(isNative).mockReset()
  statusBar.setOverlaysWebView.mockClear().mockResolvedValue(undefined)
  statusBar.setStyle.mockClear().mockResolvedValue(undefined)
  statusBar.setBackgroundColor.mockClear().mockResolvedValue(undefined)
})
afterEach(() => { document.head.innerHTML = '' })

describe('aplicarViewportNativo', () => {
  it('desactiva el zoom para que iOS no amplíe al enfocar un campo', () => {
    const meta = montarMetaViewport()
    aplicarViewportNativo()
    expect(meta.getAttribute('content')).toBe(VIEWPORT_NATIVO)
    expect(VIEWPORT_NATIVO).toContain('maximum-scale=1.0')
    expect(VIEWPORT_NATIVO).toContain('user-scalable=no')
  })

  // Los env(safe-area-inset-*) del conmutador del portal y de la topbar dependen
  // de que se conserve: sin él, el contenido dejaría de reservar el notch.
  it('conserva viewport-fit=cover', () => {
    const meta = montarMetaViewport()
    aplicarViewportNativo()
    expect(meta.getAttribute('content')).toContain('viewport-fit=cover')
  })

  it('no revienta si no hay meta viewport', () => {
    document.head.innerHTML = ''
    expect(() => aplicarViewportNativo()).not.toThrow()
  })
})

describe('configurarBarraDeEstado', () => {
  // El arreglo de verdad: `env(safe-area-inset-top)` resuelve a 0 en este
  // WebView, así que el hueco de la barra de estado NO puede depender del CSS.
  // Con overlay:false el plugin baja el webView.frame por el lado nativo.
  it('pide que la barra de estado no se superponga al WebView', async () => {
    await configurarBarraDeEstado()
    expect(statusBar.setOverlaysWebView).toHaveBeenCalledWith({ overlay: false })
  })

  // Sin overlay, la franja la pinta el plugin: si no se le da color, queda
  // blanca — y con Style.Dark (íconos claros) el reloj sería ilegible.
  it('deja la franja en el verde de marca con íconos claros', async () => {
    await configurarBarraDeEstado()
    expect(statusBar.setStyle).toHaveBeenCalledWith({ style: 'DARK' })
    expect(statusBar.setBackgroundColor).toHaveBeenCalledWith({ color: '#1B3B36' })
  })

  it('no propaga el fallo si un método del plugin rechaza', async () => {
    statusBar.setOverlaysWebView.mockRejectedValueOnce(new Error('sin plugin'))
    await expect(configurarBarraDeEstado()).resolves.toBeUndefined()
  })
})

describe('initNativeApp', () => {
  it('NO toca el viewport en web — allí el zoom debe seguir disponible', () => {
    vi.mocked(isNative).mockReturnValue(false)
    const meta = montarMetaViewport()
    initNativeApp()
    expect(meta.getAttribute('content')).toBe(VIEWPORT_WEB)
  })

  it('aplica el viewport sin zoom dentro de la app nativa', () => {
    vi.mocked(isNative).mockReturnValue(true)
    const meta = montarMetaViewport()
    initNativeApp()
    expect(meta.getAttribute('content')).toBe(VIEWPORT_NATIVO)
  })
})
