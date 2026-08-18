// Regresión react-hooks/exhaustive-deps (VencimientosCriticosTab:98), sobre el
// cálculo de fecha de calendario que llegó con #772.
//
// Dos defectos distintos convergen en esta pantalla y las pruebas cubren los dos:
//
//   · `diffDias` se recreaba en cada render sobre un `hoy = new Date()` también
//     nuevo, así que el memo de `items` no podía declararlo: los días restantes
//     quedaban congelados en la primera evaluación y sólo se refrescaban si
//     cambiaban los datos. Ahora `hoy` viene de `useHoyDate()` —identidad
//     estable dentro del día, renovada al cruzar la medianoche local—.
//   · el conteo se hacía con `Math.floor((new Date(fechaStr) - hoy) / 86400000)`,
//     que mezcla una fecha parseada en UTC con un instante local y se desplaza
//     un día según la hora. Ahora es `diasHastaFechaCalendario`, que cuenta días
//     de CALENDARIO: sin horas, sin milisegundos y sin round-trip por UTC.
//
// De ahí las cifras de abajo. Del 18/ago al 19/sep hay 32 días de calendario
// (13 hasta el 31/ago + 19 de septiembre); la aritmética anterior decía 31.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import type { PolizaSeguro } from '../../../../types'

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
}))

const VencimientosCriticosTab = (await import('../VencimientosCriticosTab')).default

function poliza(id: string, fecha: string): PolizaSeguro {
  return { id, tipo: 'Incendio', aseguradora: `Asegura-${id}`, fecha_vencimiento: fecha } as unknown as PolizaSeguro
}

function renderTab(polizas: PolizaSeguro[]) {
  return render(
    <VencimientosCriticosTab
      vencimientosExtra={[]} polizas={polizas} contratosProveedores={[]} inspecciones={[]}
      proyectoId="p1" companyId="c1" moneda="Q" canCreate canEdit onRefresh={() => {}}
    />,
  )
}

/** Valor del KPI cuya etiqueta se pasa. */
function kpi(label: string): number {
  const etiqueta = screen.getByText(label)
  return Number(etiqueta.parentElement?.querySelector('div:nth-child(1)')?.textContent)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 7, 18, 14, 30, 0))
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('VencimientosCriticosTab — días restantes reactivos al día', () => {
  it('clasifica por días restantes con la fecha vigente', () => {
    // 2026-09-01 está a 14 días del 18/ago: dentro de la ventana de 30.
    renderTab([poliza('a', '2026-09-01'), poliza('b', '2026-12-31')])
    expect(kpi('Próximos 30d')).toBe(1)
  })

  it('al cruzar cada medianoche la cuenta baja UN día', () => {
    // Vence el 2026-09-19, a 32 días de calendario del 18/ago. Cada medianoche
    // resta exactamente uno: 32 → 31 → 30. Antes de la corrección de hooks el
    // memo no se recalculaba nunca con el paso del tiempo y la pantalla abierta
    // se quedaba clavada en el primer valor.
    renderTab([poliza('a', '2026-09-19')])
    expect(screen.getByText('En 32d')).toBeTruthy()
    expect(kpi('Próximos 30d')).toBe(0)

    // 19/ago 00:00. Con el cálculo de calendario el salto es inmediato: no
    // depende de la hora del ancla, sólo de la fecha.
    act(() => { vi.advanceTimersByTime(9.5 * 3600 * 1000) })
    expect(screen.getByText('En 31d')).toBeTruthy()
    expect(kpi('Próximos 30d')).toBe(0)

    // 20/ago 00:00 — ya entra en la ventana de 30 días.
    act(() => { vi.advanceTimersByTime(24 * 3600 * 1000) })
    expect(screen.getByText('En 30d')).toBeTruthy()
    expect(kpi('Próximos 30d')).toBe(1)
  })

  it('el conteo NO deriva al avanzar el reloj DENTRO del mismo día', () => {
    // Identidad estable de `hoy`: sin ella, cada render con `new Date()` movía
    // la cuenta regresiva según la hora en que se re-renderizara. 2026-09-01
    // está a 14 días de calendario del 18/ago, y sigue estándolo a las 22:30.
    const polizas = [poliza('a', '2026-09-01')]
    const { rerender } = renderTab(polizas)
    expect(screen.getByText('En 14d')).toBeTruthy()

    act(() => { vi.advanceTimersByTime(8 * 3600 * 1000) })   // 22:30, aún día 18
    rerender(
      <VencimientosCriticosTab
        vencimientosExtra={[]} polizas={polizas} contratosProveedores={[]} inspecciones={[]}
        proyectoId="p1" companyId="c1" moneda="Q" canCreate canEdit onRefresh={() => {}}
      />,
    )

    expect(screen.getByText('En 14d')).toBeTruthy()
  })

  it('cuenta días de CALENDARIO, no bloques de 24 horas', () => {
    // La diferencia entre las dos aritméticas. A las 14:30 del 18/ago, el
    // 2026-09-19 dista 32 días de calendario; `Math.floor((utc - local)/86400000)`
    // daba 31 porque descontaba las horas ya transcurridas del día en curso.
    renderTab([poliza('a', '2026-09-19')])
    expect(screen.getByText('En 32d')).toBeTruthy()
    expect(screen.queryByText('En 31d')).toBeNull()
  })
})
