// PortalAsambleasTab — el tab de asambleas del portal del propietario.
// Lee por portal_asambleas_unidad y vota por portal_votar_punto
// (20261105000000); la autorización es del servidor (supabase/tests/
// portal_asambleas_voto). Aquí se prueba lo que hace la UI con eso: qué
// muestra en cada estado, el vocabulario del voto, la confirmación, el
// «ya votó» y que una respuesta de otra unidad no pise la actual.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import type { AsambleaPortal, PuntoAsambleaPortal } from '../../../../types'

const h = vi.hoisted(() => ({
  fetchAsambleasUnidad: vi.fn(async (_unidadId: string) => ({ data: [] as AsambleaPortal[], error: null as string | null })),
  votarPunto: vi.fn(async (_puntoId: string, _unidadId: string, _voto: string) => ({ error: null as string | null, yaVotado: false })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { rpc: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/portal/asambleas', () => ({
  fetchAsambleasUnidad: h.fetchAsambleasUnidad,
  votarPunto: h.votarPunto,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: h.confirm, notify: h.notify }))

const { PortalAsambleasTab } = await import('../PortalAsambleasTab')

function punto(over: Partial<PuntoAsambleaPortal> = {}): PuntoAsambleaPortal {
  return {
    id: 'pt1', orden: 1, titulo: 'Aprobación del presupuesto', descripcion: null, tipo: 'votacion',
    resultado: null, mi_voto: null, conteo: null, ...over,
  }
}

function asamblea(over: Partial<AsambleaPortal> = {}): AsambleaPortal {
  return {
    id: 'a1', titulo: 'Ordinaria en curso', tipo: 'ordinaria', fecha: '2026-10-22', hora_inicio: '18:00:00',
    hora_fin: null, lugar: 'Salón social', estado: 'en_curso', quorum_requerido: 50, quorum_alcanzado: null,
    acta: null, puntos: [punto(), punto({ id: 'pt0', orden: 0, titulo: 'Informe', tipo: 'informativo' })],
    ...over,
  }
}

function lista(...asambleas: AsambleaPortal[]) {
  return { data: asambleas, error: null }
}

async function montar(unidadId = 'u1') {
  const r = render(<PortalAsambleasTab unidadId={unidadId} />)
  await act(async () => {})
  return r
}

beforeEach(() => {
  Object.values(h).forEach(m => m.mockClear())
  h.fetchAsambleasUnidad.mockImplementation(async () => lista())
  h.votarPunto.mockImplementation(async () => ({ error: null, yaVotado: false }))
  h.confirm.mockImplementation(async () => ({ isConfirmed: true }))
})

afterEach(cleanup)

describe('PortalAsambleasTab — lo que ve el propietario', () => {
  it('lee las asambleas de SU unidad y abre sola la que está en curso', async () => {
    h.fetchAsambleasUnidad.mockResolvedValue(lista(
      asamblea({ id: 'a0', titulo: 'Anterior', estado: 'finalizada', puntos: [] }),
      asamblea(),
    ))
    await montar('u7')
    expect(h.fetchAsambleasUnidad).toHaveBeenCalledWith('u7')
    expect(screen.getByText(/Aprobación del presupuesto/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ver puntos de Anterior' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('en un punto de votación de la asamblea en curso ofrece los tres votos; en el informativo, ninguno', async () => {
    h.fetchAsambleasUnidad.mockResolvedValue(lista(asamblea()))
    await montar()
    const votacion = screen.getByText(/Aprobación del presupuesto/).closest('li') as HTMLElement
    const informativo = screen.getByText(/Informe/).closest('li') as HTMLElement
    expect(within(votacion).getAllByRole('button').map(b => b.textContent)).toEqual(['👍 A favor', '👎 En contra', '⊘ Abstención'])
    expect(within(informativo).queryAllByRole('button')).toHaveLength(0)
    expect(within(votacion).getByText('Votación')).toBeTruthy()
  })

  it('fuera de en_curso no hay botones de voto', async () => {
    h.fetchAsambleasUnidad.mockResolvedValue(lista(asamblea({ estado: 'programada' })))
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Ver puntos de Ordinaria en curso' }))
    expect(screen.getByText(/Aprobación del presupuesto/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /A favor/ })).toBeNull()
  })

  it('si la unidad ya votó, muestra su voto en vez de los botones', async () => {
    h.fetchAsambleasUnidad.mockResolvedValue(lista(asamblea({ puntos: [punto({ mi_voto: 'en_contra' })] })))
    await montar()
    expect(screen.getByText('✓ Tu unidad votó: En contra')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /A favor/ })).toBeNull()
  })

  it('en la finalizada muestra los totales, el resultado y el acta', async () => {
    h.fetchAsambleasUnidad.mockResolvedValue(lista(asamblea({
      estado: 'finalizada', acta: 'Se aprobó la pintura.',
      puntos: [punto({ conteo: { a_favor: 7, en_contra: 2, abstencion: 1 }, resultado: 'Aprobado', mi_voto: 'a_favor' })],
    })))
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Ver puntos de Ordinaria en curso' }))
    const resultado = screen.getByLabelText('Resultado de Aprobación del presupuesto')
    expect(resultado.textContent).toContain('👍 7')
    expect(resultado.textContent).toContain('👎 2')
    expect(resultado.textContent).toContain('⊘ 1')
    expect(resultado.textContent).toContain('→ Aprobado')
    expect(screen.getByText('Se aprobó la pintura.')).toBeTruthy()
    expect(screen.getByText('✓ Tu unidad votó: A favor')).toBeTruthy()
  })

  it('sin asambleas, el estado vacío', async () => {
    await montar()
    expect(screen.getByText('No hay asambleas registradas')).toBeTruthy()
  })

  it('un error de carga se muestra con «Reintentar», que vuelve a pedir', async () => {
    h.fetchAsambleasUnidad.mockResolvedValueOnce({ data: [], error: 'permission denied' })
    await montar()
    expect(screen.getByText('No se pudieron cargar las asambleas')).toBeTruthy()
    expect(screen.getByText('permission denied')).toBeTruthy()
    h.fetchAsambleasUnidad.mockResolvedValueOnce(lista(asamblea()))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reintentar' })) })
    expect(h.fetchAsambleasUnidad).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/Aprobación del presupuesto/)).toBeTruthy()
  })
})

describe('PortalAsambleasTab — el voto', () => {
  it('confirma y vota con el vocabulario del panel; la UI pasa a «Tu unidad votó»', async () => {
    h.fetchAsambleasUnidad.mockResolvedValue(lista(asamblea()))
    await montar('u1')
    fireEvent.click(screen.getByRole('button', { name: '👍 A favor' }))
    await waitFor(() => expect(h.votarPunto).toHaveBeenCalledWith('pt1', 'u1', 'a_favor'))
    expect(h.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '¿Votar «A favor»?' }))
    expect(await screen.findByText('✓ Tu unidad votó: A favor')).toBeTruthy()
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Voto registrado' }))
  })

  it.each([
    ['👎 En contra', 'en_contra'],
    ['⊘ Abstención', 'abstencion'],
  ])('«%s» manda %s', async (boton, voto) => {
    h.fetchAsambleasUnidad.mockResolvedValue(lista(asamblea()))
    await montar('u1')
    fireEvent.click(screen.getByRole('button', { name: boton }))
    await waitFor(() => expect(h.votarPunto).toHaveBeenCalledWith('pt1', 'u1', voto))
  })

  it('si cancela la confirmación, no vota', async () => {
    h.confirm.mockResolvedValueOnce({ isConfirmed: false })
    h.fetchAsambleasUnidad.mockResolvedValue(lista(asamblea()))
    await montar()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '👍 A favor' })) })
    expect(h.votarPunto).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '👍 A favor' })).toBeTruthy()
  })

  it('si el servidor dice que la unidad ya votó, avisa y recarga para mostrar el voto real', async () => {
    h.fetchAsambleasUnidad.mockResolvedValueOnce(lista(asamblea()))
    h.fetchAsambleasUnidad.mockResolvedValueOnce(lista(asamblea({ puntos: [punto({ mi_voto: 'abstencion' })] })))
    h.votarPunto.mockResolvedValueOnce({ error: 'Esta unidad ya votó en este punto.', yaVotado: true })
    await montar()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '👍 A favor' })) })
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning', title: 'Ya votaste' }))
    expect(h.fetchAsambleasUnidad).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('✓ Tu unidad votó: Abstención')).toBeTruthy()
  })

  it('cualquier otro rechazo se muestra y los botones siguen ahí', async () => {
    h.fetchAsambleasUnidad.mockResolvedValue(lista(asamblea()))
    h.votarPunto.mockResolvedValueOnce({ error: 'La votación sólo está abierta mientras la asamblea está en curso.', yaVotado: false })
    await montar()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '👍 A favor' })) })
    expect(h.notify).toHaveBeenCalledWith({
      variant: 'error', title: 'No se registró el voto',
      text: 'La votación sólo está abierta mientras la asamblea está en curso.',
    })
    expect(screen.queryByText(/Tu unidad votó/)).toBeNull()
    expect(screen.getByRole('button', { name: '👍 A favor' })).toBeTruthy()
  })
})

describe('PortalAsambleasTab — el efecto declara `cargar`', () => {
  it('recarga al cambiar de unidad (los votos son por unidad) y no en cada render', async () => {
    const { rerender } = await montar('u1')
    rerender(<PortalAsambleasTab unidadId="u1" />)
    await act(async () => {})
    expect(h.fetchAsambleasUnidad).toHaveBeenCalledTimes(1)

    rerender(<PortalAsambleasTab unidadId="u2" />)
    await act(async () => {})
    expect(h.fetchAsambleasUnidad).toHaveBeenCalledTimes(2)
    expect(h.fetchAsambleasUnidad).toHaveBeenLastCalledWith('u2')
  })

  it('descarta la respuesta de la unidad abandonada (fuera de orden)', async () => {
    let resolverPrimera: (v: { data: AsambleaPortal[]; error: string | null }) => void = () => {}
    h.fetchAsambleasUnidad.mockImplementationOnce(() => new Promise(res => { resolverPrimera = res }))
    h.fetchAsambleasUnidad.mockImplementationOnce(async () => lista(asamblea({ titulo: 'Asamblea de la unidad NUEVA' })))

    const { rerender } = render(<PortalAsambleasTab unidadId="u1" />)
    rerender(<PortalAsambleasTab unidadId="u2" />)
    await act(async () => {})
    expect(screen.getByText(/unidad NUEVA/)).toBeTruthy()

    await act(async () => { resolverPrimera(lista(asamblea({ titulo: 'Asamblea de la unidad VIEJA' }))) })
    expect(screen.queryByText(/unidad VIEJA/)).toBeNull()
    expect(screen.getByText(/unidad NUEVA/)).toBeTruthy()
  })

  it('bajo StrictMode el doble montaje no duplica el estado visible', async () => {
    h.fetchAsambleasUnidad.mockResolvedValue(lista(asamblea({ titulo: 'Ordinaria 2026' })))
    render(<StrictMode><PortalAsambleasTab unidadId="u1" /></StrictMode>)
    await act(async () => {})
    expect(screen.getAllByText(/Ordinaria 2026/)).toHaveLength(1)
  })
})
