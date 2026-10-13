// AsignacionModal · lecturas en vuelo (F2-08). Dos defectos que ninguna prueba veía porque el cliente simulado respondía al instante:
//   · M11 · una lectura OBSOLETA (de otra persona, o de un intento anterior) que llega tarde NO debe pisar lo que ya se mostró: sin la guardia `vigente` pintaba
//     las casillas de la persona anterior y fijaba SU conjunto inicial, y el siguiente guardado calculaba la diferencia contra otra persona;
//   · M15 · mientras «Reintentar» vuelve a cargar, la pantalla vuelve a «Cargando…» con Guardar deshabilitado: si no, quedaban casillas VACÍAS con Guardar
//     activo (borraría todo lo editable) durante la relectura.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'

const h = vi.hoisted(() => ({ notify: vi.fn(), guardar: vi.fn(), leer: vi.fn() }))

vi.mock('../../shared/Dialog', () => ({ notify: h.notify }))
vi.mock('../../../domain/empresa/usuarios', async importOriginal => {
  const original = await importOriginal<typeof import('../../../domain/empresa/usuarios')>()
  return { ...original, fetchUserProjectAssignments: h.leer, guardarAsignacionesProyecto: h.guardar }
})
vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}), auth: {} } }))

import { AsignacionModal } from '../AsignacionModal'

const PROYECTOS = [{ id: 'p1', nombre: 'Torre Norte' }, { id: 'p2', nombre: 'Torre Sur' }]
const PERSONA_A = { id: 'u-a', full_name: 'Persona A', role: 'operator' }
const PERSONA_B = { id: 'u-b', full_name: 'Persona B', role: 'operator' }
const ACTOR = { id: 'u-owner', role: 'company_owner' }
type Lectura = { data: Array<{ project_id: string }> | null; error: string | null }
const caja = (nombre: string) => screen.getByLabelText(nombre) as HTMLInputElement
const botonGuardar = () => screen.getByRole('button', { name: /^Guardar$/ }) as HTMLButtonElement

beforeEach(() => { cleanup(); h.notify.mockReset(); h.guardar.mockReset(); h.leer.mockReset(); h.guardar.mockResolvedValue({ error: null, parcial: false }) })

describe('AsignacionModal · una lectura obsoleta no pisa la actual (M11)', () => {
  it('se pasa de la persona A a la B; la lectura de A llega DESPUÉS de la de B: se ve y se guarda contra B, nunca contra A', async () => {
    const pendiente: Record<string, (v: Lectura) => void> = {}
    h.leer.mockImplementation((id: string) => new Promise<Lectura>(res => { pendiente[id] = res }))
    const { rerender } = render(<AsignacionModal usuario={PERSONA_A} proyectos={PROYECTOS} onClose={() => {}} onSaved={() => {}} actor={ACTOR} />)
    rerender(<AsignacionModal usuario={PERSONA_B} proyectos={PROYECTOS} onClose={() => {}} onSaved={() => {}} actor={ACTOR} />)
    await waitFor(() => expect(h.leer).toHaveBeenCalledTimes(2))
    await act(async () => { pendiente['u-b']({ data: [{ project_id: 'p2' }], error: null }) })
    await waitFor(() => expect(caja('Torre Sur').checked).toBe(true))
    expect(caja('Torre Norte').checked).toBe(false)
    // llega tarde la lectura de la persona A (tenía p1)
    await act(async () => { pendiente['u-a']({ data: [{ project_id: 'p1' }], error: null }) })
    expect(caja('Torre Norte').checked).toBe(false)           // no se pintó lo de A
    expect(caja('Torre Sur').checked).toBe(true)
    fireEvent.click(caja('Torre Norte'))                      // se guarda contra el conjunto inicial de B ({p2}), no el de A ({p1})
    fireEvent.click(botonGuardar())
    await waitFor(() => expect(h.guardar).toHaveBeenCalled())
    expect(h.guardar).toHaveBeenCalledWith('u-b', ['p2'], ['p1', 'p2'], ['p1', 'p2'])
  })
})

describe('AsignacionModal · mientras «Reintentar» relee, Guardar sigue deshabilitado (M15)', () => {
  it('tras un fallo de lectura, Reintentar vuelve a «Cargando…», sin casillas ni error y con Guardar deshabilitado hasta que la relectura responde', async () => {
    h.leer.mockResolvedValueOnce({ data: null, error: 'TypeError: Failed to fetch' })
    render(<AsignacionModal usuario={PERSONA_A} proyectos={PROYECTOS} onClose={() => {}} onSaved={() => {}} actor={ACTOR} />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    let responder: (v: Lectura) => void = () => {}
    h.leer.mockImplementationOnce(() => new Promise<Lectura>(res => { responder = res }))
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }))
    // la relectura sigue en vuelo
    await waitFor(() => expect(screen.getByText('Cargando...')).toBeTruthy())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByLabelText('Torre Norte')).toBeNull()                     // ninguna casilla vacía que invite a guardar
    expect(botonGuardar().disabled).toBe(true)
    fireEvent.click(botonGuardar())                                               // ni siquiera forzando el clic
    await new Promise(r => setTimeout(r, 20))
    expect(h.guardar).not.toHaveBeenCalled()
    await act(async () => { responder({ data: [{ project_id: 'p1' }], error: null }) })
    await waitFor(() => expect(caja('Torre Norte').checked).toBe(true))
    expect(botonGuardar().disabled).toBe(false)
  })
})
