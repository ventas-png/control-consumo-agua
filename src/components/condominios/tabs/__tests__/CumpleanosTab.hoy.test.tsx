// Regresión react-hooks/exhaustive-deps (CumpleanosTab:111).
//
// `const hoy = new Date()` creaba un objeto nuevo en cada render, así que el
// memo de "esta semana" no podía declararlo como dependencia: leía un `hoy` de
// la primera evaluación y no se enteraba del cambio de día. Con useHoyDate el
// valor es estable DENTRO del día (el memo sigue memoizando de verdad) y se
// renueva al cruzar la medianoche local.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { StrictMode } from 'react'
import type { PersonalCondominio } from '../../../../types'
import { CumpleanosTab } from '../CumpleanosTab'

function persona(id: string, nombre: string, fecha: string): PersonalCondominio {
  return { id, nombre, cargo: 'conserje', fecha_nacimiento: fecha } as unknown as PersonalCondominio
}

/** Valor del KPI cuya etiqueta se pasa (los KPIs son valor + etiqueta juntos). */
function kpi(label: string): number {
  const etiqueta = screen.getByText(label)
  const valor = etiqueta.parentElement?.querySelector('div:nth-child(2)')
  return Number(valor?.textContent)
}

/** Nombres listados dentro del banner "¡Hoy es el cumpleaños de:". */
function cumplenHoy(): string {
  const banner = screen.getByText('¡Hoy es el cumpleaños de:').parentElement
  return banner?.textContent ?? ''
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 7, 18, 14, 30, 0))   // martes 18/ago/2026, 14:30 local
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('CumpleanosTab — "hoy" reactivo', () => {
  it('cuenta el cumpleaños de hoy con la fecha local vigente', () => {
    render(<CumpleanosTab personal={[persona('p1', 'Marta', '1990-08-18')]} clientesBirthday={[]} />)
    expect(kpi('Hoy')).toBe(1)
    expect(screen.getByText('¡Hoy es el cumpleaños de:')).toBeTruthy()
  })

  it('al cruzar la medianoche recalcula: el de hoy deja de serlo y entra el de mañana', () => {
    render(
      <CumpleanosTab
        personal={[persona('p1', 'Marta', '1990-08-18'), persona('p2', 'Luis', '1985-08-19')]}
        clientesBirthday={[]}
      />,
    )
    expect(kpi('Hoy')).toBe(1)
    expect(cumplenHoy()).toContain('Marta')
    expect(cumplenHoy()).not.toContain('Luis')

    // 9h30m hasta las 00:00 del 19 + margen.
    act(() => { vi.advanceTimersByTime(9.5 * 3600 * 1000 + 1000) })

    expect(kpi('Hoy')).toBe(1)
    expect(cumplenHoy()).toContain('Luis')
    expect(cumplenHoy()).not.toContain('Marta')
  })

  it('"esta semana" solo cuenta los 7 días siguientes al día vigente', () => {
    render(
      <CumpleanosTab
        personal={[
          persona('p1', 'Dentro', '1990-08-22'),   // +4 días
          persona('p2', 'Fuera', '1990-08-30'),    // +12 días
        ]}
        clientesBirthday={[]}
      />,
    )
    expect(kpi('Esta semana')).toBe(1)
  })

  it('el memo NO se recalcula si no cambian ni los datos ni el día', () => {
    const personal = [persona('p1', 'Marta', '1990-08-18')]
    const { rerender } = render(<CumpleanosTab personal={personal} clientesBirthday={[]} />)
    const antes = screen.getByText('Esta semana').parentElement?.innerHTML

    // Mismo array (misma identidad) + avance de reloj dentro del día: el
    // snapshot de "hoy" debe conservar su identidad y el render ser idéntico.
    act(() => { vi.advanceTimersByTime(3 * 3600 * 1000) })
    rerender(<CumpleanosTab personal={personal} clientesBirthday={[]} />)

    expect(screen.getByText('Esta semana').parentElement?.innerHTML).toBe(antes)
  })

  it('bajo StrictMode no duplica temporizadores ni deja efectos colgando', () => {
    const { unmount } = render(
      <StrictMode>
        <CumpleanosTab personal={[persona('p1', 'Marta', '1990-08-18')]} clientesBirthday={[]} />
      </StrictMode>,
    )
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
