// Respaldos de recepción — lo que una persona VE y puede hacer: la evidencia con su tipo, tamaño,
// fecha y huella; retirar solo en borrador; adjuntar solo lo permitido. El acceso privado por
// empresa/proyecto, los límites y el congelamiento los hace cumplir el servidor
// (supabase/tests/compras_bloque_b/assert_respaldos.sql).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

const m = vi.hoisted(() => ({
  respaldos: [] as unknown[], adjuntar: vi.fn(), retirar: vi.fn(), url: vi.fn(), notify: vi.fn(), confirm: vi.fn(),
}))
vi.mock('../../../domain/compras/queries', () => ({
  useRespaldosRecepcionQuery: () => ({ data: m.respaldos, isLoading: false, isError: false, error: null }),
}))
vi.mock('../../../domain/compras/respaldos', async (orig) => ({
  ...(await orig<typeof import('../../../domain/compras/respaldos')>()),
  useAdjuntarRespaldoMutation: () => ({ mutateAsync: m.adjuntar, isPending: false }),
  useRetirarRespaldoMutation: () => ({ mutateAsync: m.retirar, isPending: false }),
  urlRespaldoRecepcion: m.url,
}))
vi.mock('../../shared/Dialog', () => ({ confirm: m.confirm, notify: m.notify }))

import { RespaldosRecepcionModal, tamanoLegible } from '../RespaldosRecepcionModal'

const R: { id: string; numero: string; tipo: 'bienes' | 'servicio'; estado: 'borrador' | 'registrada' | 'anulada' } = { id: 'r1', numero: 'REC-000001', tipo: 'bienes', estado: 'borrador' }
const respaldo = (extra: Record<string, unknown> = {}) => ({
  id: 'x1', recepcion_id: 'r1', ruta: 'c/p/r1/remision-ab.pdf', nombre: 'Remisión 123.pdf', tipo: 'entrega', mime: 'application/pdf',
  bytes: 52000, sha256: 'a'.repeat(64), notas: 'Firmada por bodega', created_by: 'u1', created_at: '2026-10-02T15:00:00Z', ...extra,
})
const abrir = (recepcion = R, puedeAdjuntar = true) =>
  render(<RespaldosRecepcionModal companyId="c" projectId="p" recepcion={recepcion} puedeAdjuntar={puedeAdjuntar} onClose={vi.fn()} />)
const elegir = (f: File) => fireEvent.change(screen.getByLabelText('Archivo de evidencia'), { target: { files: [f] } })

beforeEach(() => {
  m.respaldos = [respaldo()]
  m.adjuntar.mockResolvedValue({ respaldo: respaldo(), reutilizado: false })
  m.confirm.mockResolvedValue(true)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('tamanoLegible', () => {
  it('B, KB y MB', () => {
    expect(tamanoLegible(900)).toBe('900 B')
    expect(tamanoLegible(52000)).toBe('51 KB')
    expect(tamanoLegible(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

describe('Respaldos de una recepción', () => {
  it('lista la evidencia con su tipo, tamaño, huella y notas', () => {
    abrir()
    expect(screen.getByText('Remisión 123.pdf')).toBeTruthy()
    expect(screen.getAllByText('Entrega').length).toBeGreaterThan(0)
    expect(screen.getByText(/51 KB/)).toBeTruthy()
    expect(screen.getByText(/SHA-256 aaaaaaaa/)).toBeTruthy()
    expect(screen.getByText('Firmada por bodega')).toBeTruthy()
  })

  it('sin archivos lo dice', () => {
    m.respaldos = []
    abrir()
    expect(screen.getByTestId('sin-respaldos')).toBeTruthy()
  })

  it('«Ver» abre un enlace firmado (el bucket es privado)', async () => {
    m.url.mockResolvedValue('https://firmado.example/x')
    const abre = vi.spyOn(window, 'open').mockImplementation(() => null)
    abrir()
    fireEvent.click(screen.getByText('Ver'))
    await waitFor(() => expect(abre).toHaveBeenCalledWith('https://firmado.example/x', '_blank', 'noopener,noreferrer'))
    expect(m.url).toHaveBeenCalledWith('c/p/r1/remision-ab.pdf')
    abre.mockRestore()
  })

  it('en BORRADOR se puede retirar; registrada, ya no (la evidencia no se edita ni se retira)', async () => {
    abrir(R)
    fireEvent.click(screen.getByText('Retirar'))
    await waitFor(() => expect(m.retirar).toHaveBeenCalledWith(expect.objectContaining({ id: 'x1' })))
    cleanup()
    abrir({ ...R, estado: 'registrada' })
    expect(screen.queryByText('Retirar')).toBeNull()
    expect(screen.getByText(/la evidencia no se edita ni se retira/)).toBeTruthy()
    expect(screen.getByText(/Adjuntar no cambia la recepción ni su asiento/)).toBeTruthy()
  })

  it('retirar con éxito: avisa que se quitó de la recepción y del almacenamiento', async () => {
    m.retirar.mockResolvedValueOnce(undefined)
    abrir(R)
    fireEvent.click(screen.getByText('Retirar'))
    await waitFor(() => expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Archivo retirado' })))
  })

  it('si el archivo NO se pudo eliminar de Storage no hay éxito: avisa con la ruta pendiente de limpiar', async () => {
    const { RetiroRespaldoError } = await import('../../../domain/compras/respaldos')
    m.retirar.mockRejectedValueOnce(new RetiroRespaldoError('Se retiró el registro de «Remisión 123.pdf», pero el archivo NO se eliminó (caído). Quedó sin referencia en «c/p/r1/remision-ab.pdf»', 'almacenamiento', 'c/p/r1/remision-ab.pdf'))
    abrir(R)
    fireEvent.click(screen.getByText('Retirar'))
    await waitFor(() => expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'warning', title: expect.stringMatching(/archivo pendiente de limpiar/), text: expect.stringMatching(/c\/p\/r1\/remision-ab\.pdf/),
    })))
    expect(m.notify).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }))
  })

  it('si el servidor rechaza el retiro, es un error y no un éxito', async () => {
    const { RetiroRespaldoError } = await import('../../../domain/compras/respaldos')
    m.retirar.mockRejectedValueOnce(new RetiroRespaldoError('No se retiró «Remisión 123.pdf»: la recepción salió de borrador.', 'registro'))
    abrir(R)
    fireEvent.click(screen.getByText('Retirar'))
    await waitFor(() => expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', title: 'No se pudo retirar' })))
    expect(m.notify).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }))
  })

  it('una recepción registrada admite evidencia ADICIONAL', async () => {
    abrir({ ...R, estado: 'registrada' })
    elegir(new File(['%PDF'], 'flete.pdf', { type: 'application/pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar' }))
    await waitFor(() => expect(m.adjuntar).toHaveBeenCalledWith(expect.objectContaining({ recepcionId: 'r1', tipo: 'entrega', companyId: 'c', projectId: 'p' })))
  })

  it('no se adjunta lo que no es PDF/imagen ni lo que pesa más de 10 MB (sin llegar al servidor)', async () => {
    abrir()
    elegir(new File(['x'], 'virus.exe', { type: 'application/x-msdownload' }))
    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar' }))
    await waitFor(() => expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning', text: expect.stringMatching(/PDF, JPG, PNG o WEBP/) })))
    const grande = new File(['x'], 'grande.pdf', { type: 'application/pdf' })
    Object.defineProperty(grande, 'size', { value: 11 * 1024 * 1024 })
    elegir(grande)
    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar' }))
    await waitFor(() => expect(m.notify).toHaveBeenLastCalledWith(expect.objectContaining({ text: expect.stringMatching(/10 MB/) })))
    expect(m.adjuntar).not.toHaveBeenCalled()
  })

  it('una conformidad de servicio se tipifica como «conformidad»', async () => {
    abrir({ ...R, tipo: 'servicio' })
    expect(screen.getByText(/Acta o soporte de la conformidad del servicio/)).toBeTruthy()
    elegir(new File(['%PDF'], 'acta.pdf', { type: 'application/pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar' }))
    await waitFor(() => expect(m.adjuntar).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'conformidad' })))
  })

  it('sin permiso de captura solo se consulta; una recepción anulada no admite más archivos', () => {
    abrir(R, false)
    expect(screen.queryByLabelText('Archivo de evidencia')).toBeNull()
    expect(screen.queryByText('Retirar')).toBeNull()
    cleanup()
    abrir({ ...R, estado: 'anulada' })
    expect(screen.queryByLabelText('Archivo de evidencia')).toBeNull()
  })

  it('si el servidor rechaza, lo dice con su mensaje', async () => {
    m.adjuntar.mockRejectedValueOnce(new Error('COMPRAS_RESPALDO_PERMISO: no tienes permiso'))
    abrir()
    elegir(new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar' }))
    await waitFor(() => expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: expect.stringMatching(/COMPRAS_RESPALDO_PERMISO/) })))
  })
})
