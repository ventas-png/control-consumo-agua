// Regresión del TypeError `undefined is not an object (evaluating 'e._result.default')`
// que Sentry vio en producción (/admin-dashboard, 2026-07-31).
//
// Origen: el helper de preload de Vite termina en `e().catch(s)` y `s` solo
// relanza si NADIE llamó `preventDefault()` sobre el evento `vite:preloadError`.
// El listener de main.tsx SÍ lo llama (para recargar ante un chunk viejo tras un
// deploy), así que la promesa deja de rechazar y RESUELVE con `undefined`.
// React.lazy guarda ese undefined como módulo y revienta al leer `.default`.
//
// Sin el guard de lazySafe/lazyWithPreload, el primer test de aquí abajo falla
// con exactamente ese TypeError.
import { Suspense } from 'react'
import { act, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { lazySafe, lazyWithPreload } from '../lazyWithPreload'

function Ok() {
  return <div>contenido cargado</div>
}

// Lo que Vite entrega cuando el preloadError fue preventDefault()-ado.
const chunkSwallowed = () => Promise.resolve(undefined as unknown as { default: typeof Ok })

describe('lazySafe', () => {
  it('suspende (no rompe) cuando la factory resuelve undefined', async () => {
    const Componente = lazySafe(chunkSwallowed)

    render(
      <Suspense fallback={<div>cargando…</div>}>
        <Componente />
      </Suspense>,
    )

    // Clave: hay que dejar que React REINTENTE el render tras resolverse la
    // promesa. El crash no ocurre en el primer render (que suspende) sino en ese
    // reintento, al leer `payload._result.default`. Sin `act` el test pasaría
    // igual con y sin guard, sin probar nada.
    await act(async () => { await Promise.resolve() })

    // Se queda en el fallback hasta que la recarga de main.tsx entra en efecto.
    expect(screen.getByText('cargando…')).toBeTruthy()
  })

  it('renderiza normal cuando la factory resuelve bien', async () => {
    const Componente = lazySafe(() => Promise.resolve({ default: Ok }))

    render(
      <Suspense fallback={<div>cargando…</div>}>
        <Componente />
      </Suspense>,
    )

    expect(await screen.findByText('contenido cargado')).toBeTruthy()
  })
})

describe('lazyWithPreload', () => {
  it('suspende (no rompe) cuando la factory resuelve undefined', async () => {
    const Componente = lazyWithPreload(chunkSwallowed)

    render(
      <Suspense fallback={<div>cargando…</div>}>
        <Componente />
      </Suspense>,
    )

    await act(async () => { await Promise.resolve() })

    expect(screen.getByText('cargando…')).toBeTruthy()
  })

  it('renderiza normal y memoiza el import entre preload y render', async () => {
    const factory = vi.fn(() => Promise.resolve({ default: Ok }))
    const Componente = lazyWithPreload(factory)

    void Componente.preload()
    void Componente.preload()

    render(
      <Suspense fallback={<div>cargando…</div>}>
        <Componente />
      </Suspense>,
    )

    expect(await screen.findByText('contenido cargado')).toBeTruthy()
    // Una sola descarga del chunk pese a dos preloads + el render.
    expect(factory).toHaveBeenCalledTimes(1)
  })
})
