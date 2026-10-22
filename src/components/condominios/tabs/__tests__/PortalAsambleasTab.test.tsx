// Portal residente · Asambleas: el voto del residente funciona sobre las
// asambleas CLÁSICAS (asambleas → puntos_asamblea → votos_asamblea).
// Antes listaba asambleas_digital, buscaba sus puntos con ids que nunca
// coincidían, mandaba una columna asamblea_id que votos_asamblea no tiene y los
// valores 'favor'/'contra' en vez de los del panel. Vota el propietario, una vez,
// y de las finalizadas sólo ve totales (20261104000050_asambleas_voto_residente).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import type { Asamblea, PuntoAsamblea } from '../../../../types'

const h = vi.hoisted(() => ({
  fetchAsambleasProyecto: vi.fn(async (): Promise<unknown[]> => []),
  fetchPuntosByAsambleaIds: vi.fn(async (): Promise<unknown[]> => []),
  fetchVotosUnidad: vi.fn(async (): Promise<unknown[]> => []),
  fetchConteoVotosAsambleas: vi.fn(async (): Promise<unknown[]> => []),
  createCondominioRow: vi.fn(async (): Promise<{ error: { message: string; code?: string } | null }> => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({ createCondominioRow: h.createCondominioRow }))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchAsambleasProyecto: h.fetchAsambleasProyecto,
  fetchPuntosByAsambleaIds: h.fetchPuntosByAsambleaIds,
  fetchVotosUnidad: h.fetchVotosUnidad,
  fetchConteoVotosAsambleas: h.fetchConteoVotosAsambleas,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: h.confirm, notify: h.notify }))

const { PortalAsambleasTab } = await import('../PortalAsambleasTab')

function asamblea(over: Partial<Asamblea>): Asamblea {
  return {
    company_id: 'co1', project_id: 'p1', tipo: 'ordinaria', fecha: '2026-10-20', hora_inicio: '18:00:00',
    quorum_requerido: 50, created_at: '2026-10-01T10:00:00Z',
    ...over,
  } as Asamblea
}

function punto(id: string, asamblea_id: string, orden: number, titulo: string, tipo: PuntoAsamblea['tipo']): PuntoAsamblea {
  return { id, asamblea_id, orden, titulo, tipo, created_at: '2026-10-01T10:00:00Z' }
}

const ASAMBLEAS = [
  asamblea({ id: 'a1', titulo: 'Ordinaria Octubre', estado: 'en_curso', lugar: 'Salón social' }),
  asamblea({ id: 'a2', titulo: 'Extraordinaria Agosto', tipo: 'extraordinaria', estado: 'finalizada', acta: 'Se aprobó la pintura.' }),
  asamblea({ id: 'a3', titulo: 'Ordinaria Diciembre', estado: 'programada' }),
]
const PUNTOS = [
  punto('pt1', 'a1', 1, 'Aprobar presupuesto', 'votacion'),
  punto('pt2', 'a1', 2, 'Informe de tesorería', 'informativo'),
  punto('pt3', 'a1', 3, 'Cambiar el portón', 'votacion'),
  punto('pt4', 'a2', 1, 'Pintura de fachadas', 'votacion'),
  punto('pt5', 'a3', 1, 'Contratar seguridad', 'votacion'),
]

function renderTab(esPropietario = true) {
  return render(<PortalAsambleasTab unidadId="u1" proyectoId="p1" userId="user1" esPropietario={esPropietario} />)
}

async function abrir(titulo: string) {
  await act(async () => {})
  fireEvent.click(screen.getByText(titulo))
}

beforeEach(() => {
  Object.values(h).forEach(m => m.mockClear())
  h.fetchAsambleasProyecto.mockResolvedValue(ASAMBLEAS)
  h.fetchPuntosByAsambleaIds.mockResolvedValue(PUNTOS)
  h.fetchVotosUnidad.mockResolvedValue([{ punto_id: 'pt3', voto: 'en_contra' }, { punto_id: 'pt4', voto: 'a_favor' }])
  h.fetchConteoVotosAsambleas.mockResolvedValue([{ punto_id: 'pt4', a_favor: 5, en_contra: 2, abstencion: 1 }])
  h.createCondominioRow.mockResolvedValue({ error: null })
  h.confirm.mockResolvedValue({ isConfirmed: true })
})
afterEach(cleanup)

describe('PortalAsambleasTab — asambleas clásicas', () => {
  it('lee las asambleas del proyecto, sus puntos por esos ids, los votos de la unidad y los totales sólo de las finalizadas', async () => {
    renderTab()
    await act(async () => {})
    expect(h.fetchAsambleasProyecto).toHaveBeenCalledWith('p1')
    expect(h.fetchPuntosByAsambleaIds).toHaveBeenCalledWith(['a1', 'a2', 'a3'])
    expect(h.fetchVotosUnidad).toHaveBeenCalledWith('u1')
    expect(h.fetchConteoVotosAsambleas).toHaveBeenCalledWith(['a2'])
    expect(screen.getByText(/Ordinaria · .*📍 Salón social/)).toBeTruthy()
    expect(screen.getByText('▼ 3 puntos', { exact: false })).toBeTruthy()
  })

  it('el propietario vota con los valores del panel, firmado y sin asamblea_id, tras confirmar', async () => {
    renderTab()
    await abrir('Ordinaria Octubre')
    fireEvent.click(screen.getByRole('button', { name: 'A favor: Aprobar presupuesto' }))

    await waitFor(() => expect(h.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(h.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '¿Votar «A favor»?' }))
    expect(h.createCondominioRow).toHaveBeenCalledWith('votos_asamblea', {
      punto_id: 'pt1', unidad_id: 'u1', voto: 'a_favor', registrado_por: 'user1',
    })
    expect(await screen.findByText('✓ Tu unidad votó: A favor')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'En contra: Aprobar presupuesto' })).toBeNull()
  })

  it('«En contra» y «Abstención» mandan en_contra y abstencion', async () => {
    renderTab()
    await abrir('Ordinaria Octubre')
    fireEvent.click(screen.getByRole('button', { name: 'En contra: Aprobar presupuesto' }))
    await waitFor(() => expect(h.createCondominioRow).toHaveBeenLastCalledWith('votos_asamblea', expect.objectContaining({ voto: 'en_contra' })))
    cleanup()

    renderTab()
    await abrir('Ordinaria Octubre')
    fireEvent.click(screen.getByRole('button', { name: 'Abstención: Aprobar presupuesto' }))
    await waitFor(() => expect(h.createCondominioRow).toHaveBeenLastCalledWith('votos_asamblea', expect.objectContaining({ voto: 'abstencion' })))
  })

  it('si no confirma, no vota', async () => {
    h.confirm.mockResolvedValue({ isConfirmed: false })
    renderTab()
    await abrir('Ordinaria Octubre')
    fireEvent.click(screen.getByRole('button', { name: 'A favor: Aprobar presupuesto' }))
    await act(async () => {})
    expect(h.createCondominioRow).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'A favor: Aprobar presupuesto' })).toBeTruthy()
  })

  it('sólo los puntos de votación de una asamblea en curso ofrecen votar', async () => {
    renderTab()
    await abrir('Ordinaria Octubre')
    expect(screen.queryByRole('button', { name: 'A favor: Informe de tesorería' })).toBeNull()
    fireEvent.click(screen.getByText('Ordinaria Diciembre'))
    expect(screen.getByText('Contratar seguridad', { exact: false })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'A favor: Contratar seguridad' })).toBeNull()
  })

  it('un punto ya votado muestra el voto de la unidad y no ofrece votar de nuevo', async () => {
    renderTab()
    await abrir('Ordinaria Octubre')
    expect(screen.getByText('✓ Tu unidad votó: En contra')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'A favor: Cambiar el portón' })).toBeNull()
  })

  it('quien no es propietario (inquilino, familiar) ve los puntos pero no vota', async () => {
    renderTab(false)
    await abrir('Ordinaria Octubre')
    expect(screen.queryByRole('button', { name: 'A favor: Aprobar presupuesto' })).toBeNull()
    expect(screen.getByText('Vota el propietario de la unidad.')).toBeTruthy()
    expect(screen.getByText('✓ Tu unidad votó: En contra')).toBeTruthy()
  })

  it('una asamblea finalizada muestra los totales, el voto de la unidad y el acta', async () => {
    renderTab()
    await abrir('Extraordinaria Agosto')
    expect(screen.getByTitle('A favor').textContent).toBe('👍 5')
    expect(screen.getByTitle('En contra').textContent).toBe('👎 2')
    expect(screen.getByTitle('Abstención').textContent).toBe('⊘ 1')
    expect(screen.getByText('Tu unidad: A favor')).toBeTruthy()
    expect(screen.getByText('📜 Ver acta')).toBeTruthy()
    expect(screen.getByText('Se aprobó la pintura.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Pintura de fachadas/ })).toBeNull()
  })

  it('si la unidad ya tenía voto (UNIQUE), avisa y recarga en vez de mostrar un error crudo', async () => {
    h.createCondominioRow.mockResolvedValue({ error: { message: 'duplicate key value', code: '23505' } })
    renderTab()
    await abrir('Ordinaria Octubre')
    fireEvent.click(screen.getByRole('button', { name: 'A favor: Aprobar presupuesto' }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning', title: 'Tu unidad ya votó' })))
    await waitFor(() => expect(h.fetchVotosUnidad).toHaveBeenCalledTimes(2))
  })

  it('si la base rechaza el voto (RLS: la votación cerró), avisa y recarga', async () => {
    h.createCondominioRow.mockResolvedValue({ error: { message: 'new row violates row-level security policy', code: '42501' } })
    renderTab()
    await abrir('Ordinaria Octubre')
    fireEvent.click(screen.getByRole('button', { name: 'A favor: Aprobar presupuesto' }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'error', text: 'La votación ya no está abierta o no puedes votar por esta unidad.',
    })))
    await waitFor(() => expect(h.fetchAsambleasProyecto).toHaveBeenCalledTimes(2))
  })

  it('cualquier otro error se muestra y no da el voto por registrado', async () => {
    h.createCondominioRow.mockResolvedValue({ error: { message: 'Failed to fetch' } })
    renderTab()
    await abrir('Ordinaria Octubre')
    fireEvent.click(screen.getByRole('button', { name: 'A favor: Aprobar presupuesto' }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Failed to fetch' })))
    expect(screen.queryByText('✓ Tu unidad votó: A favor')).toBeNull()
    expect(h.fetchAsambleasProyecto).toHaveBeenCalledTimes(1)
  })
})
