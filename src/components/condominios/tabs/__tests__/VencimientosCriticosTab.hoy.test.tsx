// Regresión react-hooks/exhaustive-deps (VencimientosCriticosTab:98).
//
// `diffDias` se recreaba en cada render sobre un `hoy = new Date()` también
// nuevo, así que el memo de `items` no podía declararlo: los días restantes
// quedaban congelados en el valor de la primera evaluación y solo se
// refrescaban si cambiaban los datos. Ahora `hoy` es estable dentro del día
// (el memo memoiza de verdad) y el conteo se recalcula al cambiar de día.
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
    renderTab([poliza('a', '2026-09-01'), poliza('b', '2026-12-31')])
    expect(kpi('Próximos 30d')).toBe(1)
  })

  it('al cambiar el día la cuenta regresiva baja y reclasifica el KPI', () => {
    // Vence el 2026-09-19. El 18/ago faltan 31 días (fuera de la ventana de
    // 30); dos medianoches después ya son 30 y entra en la ventana. Antes de la
    // corrección el memo nunca se recalculaba con el paso del tiempo: la
    // pantalla abierta seguía diciendo "En 31d" indefinidamente.
    renderTab([poliza('a', '2026-09-19')])
    expect(kpi('Próximos 30d')).toBe(0)
    expect(screen.getByText('En 31d')).toBeTruthy()

    // 19/ago 00:00 — el ancla del día pasa de las 14:30 a la medianoche, así que
    // el conteo en días enteros todavía no cambia.
    act(() => { vi.advanceTimersByTime(9.5 * 3600 * 1000) })
    expect(screen.getByText('En 31d')).toBeTruthy()

    // 20/ago 00:00 — primer día completo transcurrido.
    act(() => { vi.advanceTimersByTime(24 * 3600 * 1000) })
    expect(screen.getByText('En 30d')).toBeTruthy()
    expect(kpi('Próximos 30d')).toBe(1)
  })

  it('el conteo NO deriva al avanzar el reloj DENTRO del mismo día', () => {
    // Identidad estable de `hoy`: sin ella, cada render con `new Date()` movía
    // la cuenta regresiva a media tarde según la hora en que se re-renderizara.
    const polizas = [poliza('a', '2026-09-01')]
    const { rerender } = renderTab(polizas)
    expect(screen.getByText('En 13d')).toBeTruthy()

    act(() => { vi.advanceTimersByTime(8 * 3600 * 1000) })   // 22:30, aún día 18
    rerender(
      <VencimientosCriticosTab
        vencimientosExtra={[]} polizas={polizas} contratosProveedores={[]} inspecciones={[]}
        proyectoId="p1" companyId="c1" moneda="Q" canCreate canEdit onRefresh={() => {}}
      />,
    )

    expect(screen.getByText('En 13d')).toBeTruthy()
  })
})
