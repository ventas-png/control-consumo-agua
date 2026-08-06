import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// isNative se mockea por test: initNativeApp tiene que ser un no-op en web.
vi.mock('../platform', () => ({ isNative: vi.fn(), getPlatform: vi.fn() }))

import { aplicarViewportNativo, VIEWPORT_NATIVO, initNativeApp } from '../nativeApp'
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

beforeEach(() => { vi.mocked(isNative).mockReset() })
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
