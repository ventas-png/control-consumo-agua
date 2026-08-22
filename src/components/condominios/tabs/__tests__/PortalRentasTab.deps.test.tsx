// Regresión react-hooks/exhaustive-deps (PortalRentasTab:235).
//
// `allowedSubTabs` era un array literal condicional: identidad nueva en cada
// render, así que el efecto que corrige `subTab` se re-ejecutaba SIEMPRE (y no
// podía declararlo sin arriesgar un ciclo con su propio `setSubTab`). Con el
// useMemo sobre `tipoAprobado` la dependencia es real y el efecto solo corre
// cuando la autorización cambia.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import type { SolicitudRentaUnidad } from '../../../../types'

const h = vi.hoisted(() => ({
  fetchContratosByUnidad: vi.fn(async () => []),
  fetchReservasStrByUnidad: vi.fn(async () => []),
  fetchHuespedesByReservas: vi.fn(async () => []),
  fetchInquilinosDeUnidad: vi.fn(async () => ({ data: [] })),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../lib/storageUrls', () => ({
  useSignedUrl: (src: string | null) => (src ? `https://firmado.test/${src}` : null),
}))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  createCondominioRowReturning: vi.fn(async () => ({ error: null, data: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRowsByIds: vi.fn(async () => ({ error: null })),
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchContratosByUnidad: h.fetchContratosByUnidad,
  fetchReservasStrByUnidad: h.fetchReservasStrByUnidad,
  fetchHuespedesByReservas: h.fetchHuespedesByReservas,
}))
vi.mock('../../../../domain/portal/inquilinos', () => ({
  fetchInquilinosDeUnidad: h.fetchInquilinosDeUnidad,
  registrarInquilino: vi.fn(),
  quitarInquilino: vi.fn(),
}))
vi.mock('../../../shared/ImageUploader', () => ({ ImageUploader: () => null }))
vi.mock('../../../../domain/portal/solicitudRenta', () => ({
  reservarSolicitudRenta: vi.fn(async () => ({ solicitudId: 'sol-1', error: null })),
  enviarSolicitudRenta: vi.fn(async () => ({ error: null })),
  descartarSolicitudRenta: vi.fn(async () => ({ error: null })),
}))

const { PortalRentasTab } = await import('../PortalRentasTab')

function solicitud(tipo: string | null): SolicitudRentaUnidad | null {
  if (!tipo) return null
  return { id: 's1', estado: 'aprobada', tipo_renta: tipo, tipo_aprobado: tipo } as unknown as SolicitudRentaUnidad
}

function tab(tipo: string | null) {
  return (
    <PortalRentasTab
      unidadId="u1" unidadNombre="Apto. 2A" proyectoId="p1" companyId="c1"
      solicitudRenta={solicitud(tipo)} onSolicitudChange={() => {}}
    />
  )
}

beforeEach(() => { Object.values(h).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('PortalRentasTab — allowedSubTabs estable', () => {
  it('con solo STR autorizado, el sub-tab activo salta a STR', async () => {
    render(tab('str'))
    await act(async () => {})

    // El botón del sub-tab STR queda seleccionado; el de arrendamiento no existe.
    expect(screen.queryByText('📄 Arrendamiento')).toBeNull()
    expect(screen.getByText('🏨 STR / Corto Plazo')).toBeTruthy()
  })

  it('con "ambas" quedan disponibles los dos sub-tabs y gana arrendamiento', async () => {
    render(tab('ambas'))
    await act(async () => {})

    expect(screen.getByText('📄 Arrendamiento')).toBeTruthy()
    expect(screen.getByText('🏨 STR / Corto Plazo')).toBeTruthy()
  })

  it('el efecto NO se re-ejecuta al re-renderizar con la misma autorización', async () => {
    const { rerender } = render(tab('str'))
    await act(async () => {})
    const cargasIniciales = h.fetchContratosByUnidad.mock.calls.length

    rerender(tab('str'))
    rerender(tab('str'))
    await act(async () => {})

    // Sin ciclo: ni el efecto de sub-tab ni el de carga se vuelven a disparar.
    expect(h.fetchContratosByUnidad.mock.calls.length).toBe(cargasIniciales)
  })

  it('reacciona cuando la autorización cambia de STR a arrendamiento', async () => {
    const { rerender } = render(tab('str'))
    await act(async () => {})
    expect(screen.queryByText('📄 Arrendamiento')).toBeNull()

    rerender(tab('arrendamiento'))
    await act(async () => {})

    expect(screen.getByText('📄 Arrendamiento')).toBeTruthy()
    expect(screen.queryByText('🏨 STR / Corto Plazo')).toBeNull()
  })
})
