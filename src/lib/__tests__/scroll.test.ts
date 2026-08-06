import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { scrollAppToTop } from '../scroll'

// jsdom no calcula layout: scrollHeight/clientHeight son 0 salvo que los
// definamos, que es justo la señal que usa el helper para elegir contenedor.
function mountMain({ scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }) {
  const main = document.createElement('main')
  main.className = 'app-main'
  Object.defineProperty(main, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(main, 'clientHeight', { value: clientHeight, configurable: true })
  main.scrollTo = vi.fn()
  document.body.appendChild(main)
  return main
}

beforeEach(() => {
  document.body.innerHTML = ''
  window.scrollTo = vi.fn()
})
afterEach(() => vi.restoreAllMocks())

describe('scrollAppToTop', () => {
  it('sube .app-main cuando es el contenedor con scroll (móvil)', () => {
    const main = mountMain({ scrollHeight: 2000, clientHeight: 700 })
    scrollAppToTop()
    expect(main.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('cae a window cuando .app-main no scrollea (escritorio)', () => {
    const main = mountMain({ scrollHeight: 700, clientHeight: 700 })
    scrollAppToTop()
    expect(main.scrollTo).not.toHaveBeenCalled()
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('cae a window cuando no hay .app-main (portal de cliente, landing)', () => {
    scrollAppToTop()
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('respeta el behavior indicado', () => {
    const main = mountMain({ scrollHeight: 2000, clientHeight: 700 })
    scrollAppToTop('auto')
    expect(main.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
  })
})
