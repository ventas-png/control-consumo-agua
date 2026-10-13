// AsignacionModal: la guarda DENTRO de guardar() (no sólo el atributo `disabled` del botón) y los cambios de actor / carga en vuelo, con PROMESAS CONTROLADAS.
// `fireEvent.click` sobre un botón deshabilitado NO dispara onClick (como el navegador), así que una prueba que sólo lo usa no ejerce la guarda de guardar(): aquí se invoca
// el manejador de React directamente (Enter, un lector de pantalla, código), y quitar `!permiso.permitido` de guardar() deja la prueba en rojo.
//  · A1 · el actor pierde el rol de principal con el modal ABIERTO (sesión refrescada): Guardar se deshabilita y un clic forzado no escribe;
//  · A2 · mientras la lectura inicial está EN VUELO, ni Guardar ni un clic forzado escriben (aunque el actor sea el principal);
//  · A3 · grafías del rol del actor que NO son el principal (mayúsculas, espacios, «owner», «admin» con espacio…): el cliente espeja al servidor, que compara el texto exacto;
//  · A4 · el principal que pasa a administrador DESPUÉS de pulsar Guardar: la escritura ya en vuelo no se «deshace», pero el siguiente paso (DELETE) ya no se ofrece con otro clic;
//  · A5 · el administrador que abre la pantalla y la lectura inicial responde tarde: el aviso «solo el propietario» está desde el primer pintado y las casillas siguen deshabilitadas al terminar la carga.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'

const h = vi.hoisted(() => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
  return {
    deferred,
    notify: vi.fn(),
    fetchUserProjectAssignments: vi.fn(),
    guardarAsignacionesProyecto: vi.fn(),
  }
})

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}), auth: {} } }))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify }))
vi.mock('../../../domain/empresa/usuarios', async () => {
  const real = await vi.importActual<typeof import('../../../domain/empresa/usuarios')>('../../../domain/empresa/usuarios')
  return { ...real, fetchUserProjectAssignments: h.fetchUserProjectAssignments, guardarAsignacionesProyecto: h.guardarAsignacionesProyecto }
})

import { AsignacionModal } from '../AsignacionModal'

const PROYECTOS = [{ id: 'p1', nombre: 'Torre Norte' }, { id: 'p2', nombre: 'Torre Sur' }]
const OBJETIVO = { id: 'u-op', full_name: 'Operadora Uno', role: 'operator' }

function pintar(actor: { id: string; role: string }) {
  return (
    <AsignacionModal usuario={OBJETIVO} proyectos={PROYECTOS} onClose={vi.fn()} onSaved={vi.fn()} onReload={vi.fn()} actor={actor} />
  )
}
const guardarBtn = () => screen.getByRole('button', { name: /Guardar/ }) as HTMLButtonElement
// Invoca el manejador onClick de React del elemento aunque esté deshabilitado.
function forzarClick(el: HTMLElement) {
  const clave = Object.keys(el).find(k => k.startsWith('__reactProps$'))!
  ;(el as unknown as Record<string, { onClick?: () => void }>)[clave].onClick?.()
}

beforeEach(() => {
  cleanup()
  h.notify.mockReset()
  h.fetchUserProjectAssignments.mockReset()
  h.guardarAsignacionesProyecto.mockReset()
  h.guardarAsignacionesProyecto.mockResolvedValue({ error: null, parcial: false })
})

describe('AsignacionModal.guardar · el actor cambia o la carga está en vuelo', () => {
  it('A1 · el propietario abre, marca p2 y la sesión se refresca como ADMINISTRADOR: Guardar queda deshabilitado, aparece el aviso y un clic forzado no escribe', async () => {
    h.fetchUserProjectAssignments.mockResolvedValue({ data: [{ project_id: 'p1' }], error: null })
    const { rerender } = render(pintar({ id: 'u-yo', role: 'company_owner' }))
    await waitFor(() => expect(screen.getByLabelText('Torre Norte')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Torre Sur'))
    expect(guardarBtn().disabled).toBe(false)

    rerender(pintar({ id: 'u-yo', role: 'admin' }))              // mismo usuario, nuevo actor (misma instancia: no se remonta)
    expect(guardarBtn().disabled).toBe(true)
    expect(screen.getByRole('note').textContent).toMatch(/propietario/)
    expect((screen.getByLabelText('Torre Sur') as HTMLInputElement).disabled).toBe(true)
    forzarClick(guardarBtn())
    await act(async () => { await Promise.resolve() })
    expect(h.guardarAsignacionesProyecto).not.toHaveBeenCalled()
  })

  it('A2 · con la lectura inicial EN VUELO (promesa sin resolver) el propietario no puede guardar ni forzando el clic; al resolver, Guardar se habilita', async () => {
    const lectura = h.deferred<{ data: Array<{ project_id: string }> | null; error: string | null }>()
    h.fetchUserProjectAssignments.mockReturnValue(lectura.promise)
    render(pintar({ id: 'u-yo', role: 'company_owner' }))
    expect(screen.getByText('Cargando...')).toBeTruthy()
    expect(guardarBtn().disabled).toBe(true)
    forzarClick(guardarBtn())
    await act(async () => { await Promise.resolve() })
    expect(h.guardarAsignacionesProyecto).not.toHaveBeenCalled()

    await act(async () => { lectura.resolve({ data: [], error: null }) })
    await waitFor(() => expect(screen.getByLabelText('Torre Norte')).toBeTruthy())
    expect(guardarBtn().disabled).toBe(false)
  })

  it.each([
    'Company_Owner', 'COMPANY_OWNER', ' company_owner', 'company_owner ', 'owner', 'propietario', 'Super_Admin', 'SUPERADMIN', 'super-admin', 'super admin', 'admin ', 'root',
  ])('A3 · el actor con role «%s» NO es el principal: Guardar deshabilitado y la escritura no se llama aunque se fuerce el clic', async rol => {
    h.fetchUserProjectAssignments.mockResolvedValue({ data: [], error: null })
    render(pintar({ id: 'u-yo', role: rol }))
    await waitFor(() => expect(screen.getByLabelText('Torre Norte')).toBeTruthy())
    expect(guardarBtn().disabled).toBe(true)
    forzarClick(guardarBtn())
    await act(async () => { await Promise.resolve() })
    expect(h.guardarAsignacionesProyecto).not.toHaveBeenCalled()
  })

  it('A4 · el guardado pulsado como propietario está EN VUELO (promesa sin resolver) cuando la sesión pasa a administrador: la llamada ya hecha se conserva (una sola vez) y no se dispara otra', async () => {
    h.fetchUserProjectAssignments.mockResolvedValue({ data: [{ project_id: 'p1' }], error: null })
    const guardado = h.deferred<{ error: string | null; parcial: boolean }>()
    h.guardarAsignacionesProyecto.mockReturnValue(guardado.promise)
    const { rerender } = render(pintar({ id: 'u-yo', role: 'company_owner' }))
    await waitFor(() => expect(screen.getByLabelText('Torre Norte')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Torre Sur'))
    fireEvent.click(guardarBtn())
    expect(h.guardarAsignacionesProyecto).toHaveBeenCalledTimes(1)

    rerender(pintar({ id: 'u-yo', role: 'admin' }))
    const enVuelo = screen.getByRole('button', { name: /Guardando/ }) as HTMLButtonElement
    expect(enVuelo.disabled).toBe(true)
    forzarClick(enVuelo)                                          // intento de doble envío ya como administrador
    await act(async () => { await Promise.resolve() })
    expect(h.guardarAsignacionesProyecto).toHaveBeenCalledTimes(1)

    await act(async () => { guardado.resolve({ error: null, parcial: false }) })
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('A5 · un administrador con la lectura inicial tardía: el aviso «solo el propietario» está desde el principio y las casillas siguen deshabilitadas cuando llegan', async () => {
    const lectura = h.deferred<{ data: Array<{ project_id: string }> | null; error: string | null }>()
    h.fetchUserProjectAssignments.mockReturnValue(lectura.promise)
    render(pintar({ id: 'u-yo', role: 'admin' }))
    expect(screen.getByRole('note').textContent).toMatch(/propietario/)
    expect(guardarBtn().disabled).toBe(true)
    await act(async () => { lectura.resolve({ data: [{ project_id: 'p1' }], error: null }) })
    await waitFor(() => expect(screen.getByLabelText('Torre Norte')).toBeTruthy())
    expect((screen.getByLabelText('Torre Norte') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Torre Sur') as HTMLInputElement).disabled).toBe(true)
    expect(guardarBtn().disabled).toBe(true)
  })
})
