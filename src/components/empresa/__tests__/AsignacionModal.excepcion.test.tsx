// AsignacionModal.guardar(): red de seguridad propia, aparte de la de guardarAsignacionesProyecto (que no lanza).
// Si el dominio lanzara de todos modos (un cambio futuro, un fallo inesperado de la librería), el modal NO debe dejar un rechazo sin
// manejar ni el botón en «Guardando…»: avisa con un mensaje claro y deja volver a intentar. Sonda S2 del verificador.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ notify: vi.fn(), guardar: vi.fn() }))

vi.mock('../../shared/Dialog', () => ({ notify: h.notify }))
vi.mock('../../../domain/empresa/usuarios', async importOriginal => {
  const original = await importOriginal<typeof import('../../../domain/empresa/usuarios')>()
  return {
    ...original,
    fetchUserProjectAssignments: vi.fn().mockResolvedValue({ data: [{ project_id: 'p1' }], error: null }),
    guardarAsignacionesProyecto: h.guardar,
  }
})
vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}), auth: {} } }))

import { AsignacionModal } from '../AsignacionModal'

const PROYECTOS = [{ id: 'p1', nombre: 'Torre Norte' }, { id: 'p2', nombre: 'Torre Sur' }]

beforeEach(() => { cleanup(); h.notify.mockReset(); h.guardar.mockReset() })

describe('AsignacionModal · guardar() con try/catch', () => {
  it('si el guardado LANZA: mensaje claro, sin rechazo sin manejar, onSaved no se llama y el botón vuelve a «Guardar»', async () => {
    h.guardar.mockRejectedValue(new TypeError('Failed to fetch'))
    const rechazos: unknown[] = []
    const capturar = (e: unknown) => rechazos.push(e)
    process.on('unhandledRejection', capturar)
    const onSaved = vi.fn()
    const onClose = vi.fn()
    render(<AsignacionModal usuario={{ id: 'u-op', full_name: 'Operadora Uno', role: 'operator' }} proyectos={PROYECTOS}
                            onClose={onClose} onSaved={onSaved} actor={{ id: 'u-owner', role: 'company_owner' }} />)
    await waitFor(() => expect(screen.getByLabelText('Torre Norte')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Torre Sur'))
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }))
    await waitFor(() => expect(h.notify).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 30))
    process.off('unhandledRejection', capturar)
    expect(rechazos).toEqual([])
    expect(h.notify.mock.calls[0][0]).toMatchObject({ variant: 'error', text: expect.stringMatching(/No se pudieron guardar las asignaciones/) })
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: /^Guardar$/ })).toBeTruthy())
  })

  it('recibe lo que el modal calcula: inicial leído al abrir, deseadas SÓLO de lo que se muestra y las editables', async () => {
    h.guardar.mockResolvedValue({ error: null, parcial: false })
    const onSaved = vi.fn()
    render(<AsignacionModal usuario={{ id: 'u-op', full_name: 'Operadora Uno', role: 'operator' }} proyectos={PROYECTOS}
                            onClose={() => {}} onSaved={onSaved} actor={{ id: 'u-owner', role: 'company_owner' }} />)
    await waitFor(() => expect(screen.getByLabelText('Torre Norte')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Torre Sur'))
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(h.guardar).toHaveBeenCalledWith('u-op', ['p1'], ['p1', 'p2'], ['p1', 'p2'])
  })
})
