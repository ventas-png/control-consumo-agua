import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// isNative se mockea por test: initNativeApp tiene que ser un no-op en web.
vi.mock('../platform', () => ({ isNative: vi.fn(), getPlatform: vi.fn() }))

import {
  aplicarViewportNativo,
  asegurarSafeAreaTop,
  medirSafeAreaTop,
  VIEWPORT_NATIVO,
  VIEWPORT_NATIVO_SIN_COVER,
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

describe('asegurarSafeAreaTop', () => {
  it('no toca el viewport cuando el WebView sí popula el inset', () => {
    const meta = montarMetaViewport(VIEWPORT_NATIVO)
    asegurarSafeAreaTop(() => 59)
    expect(meta.getAttribute('content')).toBe(VIEWPORT_NATIVO)
  })

  // Sin inset, `calc(8px + env(...))` se queda en 8px y los chips
  // Condominios/Agua acaban bajo el reloj, donde no se pueden tocar. Quitar
  // `cover` hace que el motor encaje el viewport dentro del área segura.
  it('quita viewport-fit=cover cuando el inset resuelve a 0', () => {
    const meta = montarMetaViewport(VIEWPORT_NATIVO)
    asegurarSafeAreaTop(() => 0)
    expect(meta.getAttribute('content')).toBe(VIEWPORT_NATIVO_SIN_COVER)
    expect(VIEWPORT_NATIVO_SIN_COVER).toContain('viewport-fit=contain')
  })

  // La alternativa no puede reintroducir el auto-zoom que arregló el viewport nativo.
  it('la alternativa conserva el bloqueo de zoom', () => {
    expect(VIEWPORT_NATIVO_SIN_COVER).toContain('maximum-scale=1.0')
    expect(VIEWPORT_NATIVO_SIN_COVER).toContain('user-scalable=no')
  })

  it('no revienta si no hay meta viewport', () => {
    document.head.innerHTML = ''
    expect(() => asegurarSafeAreaTop(() => 0)).not.toThrow()
  })
})

describe('medirSafeAreaTop', () => {
  // La sonda es un efecto secundario sobre el DOM: si se quedara puesta,
  // acumularía un <div> por arranque.
  it('retira la sonda del DOM', () => {
    const antes = document.body.childElementCount
    medirSafeAreaTop()
    expect(document.body.childElementCount).toBe(antes)
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
