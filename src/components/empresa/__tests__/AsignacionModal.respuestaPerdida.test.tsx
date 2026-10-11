// AsignacionModal · una escritura que termina SIN respuesta de la base (V3-02), la relectura que llega tarde (V3-05) y la lectura filtrada por persona (V3-03 a).
//
// El cliente simulado modela lo que el de `AsignacionModal.test.tsx` no puede: una petición que LLEGA al servidor y se APLICA, y cuya respuesta se pierde
// (excepción de red, o lo que devuelve de verdad @supabase/postgrest-js 2.x ante un fallo de red: NO lanza, devuelve
// `{ error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 }`). Con esa respuesta perdida el guardado NO puede presentarse como «no se aplicó nada»: la
// base ya cambió, `inicial` queda desfasado y, si la persona cambia de idea y vuelve a guardar, la pantalla dice «guardado» con la base distinta
// (misma familia que F2-01). Esperado: se relee lo que HAY (ése es el nuevo «antes»); si la relectura falla, pantalla de error con Guardar deshabilitado.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'

interface Fila { id: string; user_id: string; project_id: string }
const db = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; user_id: string; project_id: string }>,
  n: 0,
  lecturas: 0,
  fallaLectura: {} as Record<number, 'lanza' | 'error' | undefined>,
  upsert: null as null | 'aplica_y_lanza' | 'lanza_sin_aplicar' | 'aplica_y_error_de_red' | 'sin_aplicar_error_de_red' | 'aplica_y_502',
  del: null as null | 'falla' | 'aplica_y_lanza' | 'aplica_y_error_de_red',
  upserts: 0,
  deletes: 0,
  retardoLectura: null as null | ((n: number) => Promise<void>),
}))
const notifyMock = vi.hoisted(() => vi.fn())

type Respuesta = { data: unknown; error: { code: string; message: string } | null; status?: number }
const ERROR_DE_RED = { code: '', message: 'TypeError: Failed to fetch' }      // lo que DEVUELVE postgrest-js ante un fallo de red (con status 0)

vi.mock('../../../lib/supabase', () => {
  function constructor(table: string) {
    const q: { op: 'select' | 'delete' | 'upsert'; filtros: Array<[string, unknown]>; payload?: Array<Record<string, unknown>> } = { op: 'select', filtros: [] }
    const coincide = (r: Fila) => q.filtros.every(([c, v]) => (Array.isArray(v) ? v.includes((r as unknown as Record<string, unknown>)[c]) : (r as unknown as Record<string, unknown>)[c] === v))
    async function ejecutar(): Promise<Respuesta> {
      if (table !== 'user_project_assignments') return { data: [], error: null, status: 200 }
      if (q.op === 'select') {
        db.lecturas++
        const n = db.lecturas
        if (db.retardoLectura) await db.retardoLectura(n)
        const f = db.fallaLectura[n]
        if (f === 'lanza') throw new TypeError('Failed to fetch')
        if (f === 'error') return { data: null, error: ERROR_DE_RED, status: 0 }
        return { data: db.rows.filter(coincide).map(r => ({ project_id: r.project_id })), error: null, status: 200 }
      }
      if (q.op === 'upsert') {
        db.upserts++
        if (db.upsert === 'lanza_sin_aplicar') throw new TypeError('Failed to fetch')
        if (db.upsert === 'sin_aplicar_error_de_red') return { data: null, error: ERROR_DE_RED, status: 0 }
        for (const p of q.payload ?? []) {
          if (!db.rows.some(r => r.user_id === p.user_id && r.project_id === p.project_id)) db.rows.push({ id: `n${++db.n}`, user_id: String(p.user_id), project_id: String(p.project_id) })
        }
        if (db.upsert === 'aplica_y_lanza') throw new TypeError('Failed to fetch')                                                       // el servidor VALIÓ y la respuesta no llegó
        if (db.upsert === 'aplica_y_error_de_red') return { data: null, error: ERROR_DE_RED, status: 0 }
        if (db.upsert === 'aplica_y_502') return { data: null, error: { code: '', message: '<html>502 Bad Gateway</html>' }, status: 502 }  // una pasarela contesta, la base no
        return { data: null, error: null, status: 201 }
      }
      db.deletes++
      if (db.del === 'falla') return { data: null, error: { code: '500', message: 'boom' }, status: 500 }
      const borradas = db.rows.filter(coincide)
      db.rows = db.rows.filter(r => !borradas.includes(r))
      if (db.del === 'aplica_y_lanza') throw new TypeError('Failed to fetch')
      if (db.del === 'aplica_y_error_de_red') return { data: null, error: ERROR_DE_RED, status: 0 }
      return { data: null, error: null, status: 204 }
    }
    const api: Record<string, unknown> = {
      select: () => api,
      delete: () => { q.op = 'delete'; return api },
      upsert: (rows: Array<Record<string, unknown>>) => { q.op = 'upsert'; q.payload = rows; return api },
      eq: (c: string, v: unknown) => { q.filtros.push([c, v]); return api },
      in: (c: string, v: unknown[]) => { q.filtros.push([c, v]); return api },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => ejecutar().then(ok, ko),
    }
    return api
  }
  return { supabase: { from: (t: string) => constructor(t) } }
})
vi.mock('../../shared/Dialog', () => ({ notify: notifyMock }))

import { AsignacionModal } from '../AsignacionModal'

const PROYECTOS = [
  { id: 'p1', nombre: 'Torre Norte' }, { id: 'p2', nombre: 'Torre Sur' }, { id: 'p3', nombre: 'Torre Este' }, { id: 'p4', nombre: 'Torre Oeste' },
]
const OP = { id: 'u-op', full_name: 'Operadora Uno', role: 'operator' }
const OP2 = { id: 'u-op2', full_name: 'Operadora Dos', role: 'operator' }
const OWNER = { id: 'u-owner', role: 'company_owner' }

const ids = (u = 'u-op') => db.rows.filter(r => r.user_id === u).map(r => r.project_id).sort()
const caja = (nombre: string) => screen.getByLabelText(nombre) as HTMLInputElement
const botonGuardar = () => screen.getByRole('button', { name: /^Guardar$|Guardando/ }) as HTMLButtonElement
const esperarCarga = () => waitFor(() => expect(screen.getByLabelText('Torre Norte')).toBeTruthy())
const aviso = () => notifyMock.mock.calls[0][0] as { title: string; text: string }

function montar(usuario = OP) {
  const onSaved = vi.fn()
  const onClose = vi.fn()
  const onReload = vi.fn()
  const r = render(<AsignacionModal usuario={usuario} proyectos={PROYECTOS} onClose={onClose} onSaved={onSaved} onReload={onReload} actor={OWNER} />)
  return { onSaved, onClose, onReload, ...r }
}

beforeEach(() => {
  cleanup()
  notifyMock.mockReset()
  db.rows = [{ id: 'a', user_id: 'u-op', project_id: 'p1' }, { id: 'b', user_id: 'u-op', project_id: 'p2' }]
  db.n = 100; db.lecturas = 0; db.fallaLectura = {}; db.upsert = null; db.del = null; db.upserts = 0; db.deletes = 0; db.retardoLectura = null
})

describe('V3-02 · la respuesta de la PRIMERA escritura se pierde con la escritura ya hecha en el servidor', () => {
  // La persona añade p3; el INSERT llega y se aplica, la respuesta no. Después cambia de idea (ya no quiere p3) y vuelve a guardar. La base debe quedar {p1,p2}.
  async function añadirYCambiarDeIdea(modo: NonNullable<typeof db.upsert>, tituloEsperado: RegExp) {
    db.upsert = modo
    const m = montar(); await esperarCarga()
    fireEvent.click(caja('Torre Este'))                                    // quiere añadir p3
    fireEvent.click(botonGuardar())
    await waitFor(() => expect(notifyMock).toHaveBeenCalled())
    expect(ids()).toEqual(['p1', 'p2', 'p3'])                              // el servidor SÍ lo aplicó
    expect(aviso().title).toMatch(tituloEsperado)
    expect(aviso().text).toMatch(/No se pudo confirmar si los cambios se aplicaron/)
    expect(m.onReload).toHaveBeenCalledTimes(1)                            // la lista de atrás pudo cambiar
    expect(m.onSaved).not.toHaveBeenCalled()
    // se releyó lo que HAY en la base: p3 aparece marcado
    await waitFor(() => expect(db.lecturas).toBe(2))
    db.upsert = null; notifyMock.mockReset()
    fireEvent.click(caja('Torre Este'))                                    // cambia de idea: ya no quiere p3
    expect(caja('Torre Este').checked).toBe(false)
    fireEvent.click(botonGuardar())
    await waitFor(() => expect(m.onSaved).toHaveBeenCalled())
    expect(ids()).toEqual(['p1', 'p2'])                                    // la persona NO se queda con p3, que ya no quería
    expect(notifyMock).not.toHaveBeenCalled()
  }

  it('E1 · una EXCEPCIÓN de red tras aplicarse el INSERT: se relee y quitar p3 después SÍ lo borra', async () => {
    await añadirYCambiarDeIdea('aplica_y_lanza', /No se pudo confirmar el guardado/)
  })

  it('E1b · lo que devuelve DE VERDAD postgrest-js ante un fallo de red ({ error: { message: "TypeError: Failed to fetch", code: "" }, status: 0 }): lo mismo', async () => {
    await añadirYCambiarDeIdea('aplica_y_error_de_red', /No se pudo confirmar el guardado/)
  })

  it('una pasarela que contesta 502 SIN código de la base (no llegó a la base o no se sabe) también es ambigua', async () => {
    await añadirYCambiarDeIdea('aplica_y_502', /No se pudo confirmar el guardado/)
  })

  it('si la petición NO llegó al servidor (excepción sin aplicar) el resultado es el mismo y seguro: se relee, la base sigue igual y el reintento converge', async () => {
    db.upsert = 'lanza_sin_aplicar'
    const m = montar(); await esperarCarga()
    fireEvent.click(caja('Torre Este'))
    fireEvent.click(botonGuardar())
    await waitFor(() => expect(notifyMock).toHaveBeenCalled())
    expect(ids()).toEqual(['p1', 'p2'])                                    // no se aplicó nada
    expect(m.onReload).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(db.lecturas).toBe(2))
    db.upsert = null; notifyMock.mockReset()
    fireEvent.click(botonGuardar())                                        // reintento SIN tocar: la selección en pantalla se conservó
    await waitFor(() => expect(m.onSaved).toHaveBeenCalled())
    expect(ids()).toEqual(['p1', 'p2', 'p3'])
  })

  it('E3 · el DELETE solo (sin inserts) se aplica y la respuesta se pierde: se relee y re-marcar p2 después SÍ lo deja en la base', async () => {
    db.del = 'aplica_y_lanza'
    const m = montar(); await esperarCarga()
    fireEvent.click(caja('Torre Sur'))                                     // quita p2 (sólo borrado)
    fireEvent.click(botonGuardar())
    await waitFor(() => expect(notifyMock).toHaveBeenCalled())
    expect(ids()).toEqual(['p1'])                                          // el servidor SÍ lo borró
    expect(aviso().title).toMatch(/No se pudo confirmar el guardado/)
    expect(m.onReload).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(db.lecturas).toBe(2))
    db.del = null; notifyMock.mockReset()
    fireEvent.click(caja('Torre Sur'))                                     // cambia de idea: sí quiere p2 (la pantalla lo muestra desmarcado tras la relectura)
    expect(caja('Torre Sur').checked).toBe(true)
    fireEvent.click(botonGuardar())
    await waitFor(() => expect(m.onSaved).toHaveBeenCalled())
    expect(ids()).toEqual(['p1', 'p2'])                                    // sin la relectura, la diferencia salía vacía y p2 se quedaba borrada con «guardado»
  })

  it('E3b · lo mismo con el DELETE que devuelve el error de red (status 0) en vez de lanzar', async () => {
    db.del = 'aplica_y_error_de_red'
    const m = montar(); await esperarCarga()
    fireEvent.click(caja('Torre Sur'))
    fireEvent.click(botonGuardar())
    await waitFor(() => expect(notifyMock).toHaveBeenCalled())
    expect(ids()).toEqual(['p1'])
    await waitFor(() => expect(db.lecturas).toBe(2))
    db.del = null; notifyMock.mockReset()
    fireEvent.click(caja('Torre Sur'))
    fireEvent.click(botonGuardar())
    await waitFor(() => expect(m.onSaved).toHaveBeenCalled())
    expect(ids()).toEqual(['p1', 'p2'])
  })

  it('E2 · (control) el INSERT valió y el DELETE aplicado perdió su respuesta: ya era PARCIAL con la relectura; sigue convergiendo', async () => {
    db.del = 'aplica_y_lanza'
    const m = montar(); await esperarCarga()
    fireEvent.click(caja('Torre Sur')); fireEvent.click(caja('Torre Este'))
    fireEvent.click(botonGuardar())
    await waitFor(() => expect(notifyMock).toHaveBeenCalled())
    expect(ids()).toEqual(['p1', 'p3'])                                    // ambos se aplicaron en el servidor
    expect(aviso().title).toMatch(/a medias/)                              // hubo una escritura confirmada: «a medias», no «no se pudo confirmar»
    expect(aviso().text).toMatch(/Se aplicó una parte de los cambios/)
    await waitFor(() => expect(db.lecturas).toBe(2))
    db.del = null; notifyMock.mockReset()
    fireEvent.click(caja('Torre Sur'))                                     // ahora quiere p2 de vuelta
    fireEvent.click(botonGuardar())
    await waitFor(() => expect(m.onSaved).toHaveBeenCalled())
    expect(ids()).toEqual(['p1', 'p2', 'p3'])
  })

  it('un error CON código de la base (42501) en la primera escritura NO es ambiguo: no se relee ni se recarga la lista (nada se aplicó)', async () => {
    // el simulador de esta suite sólo modela fallos de red; el caso con código vive en AsignacionModal.test.tsx («un fallo del insert (nada se aplicó) NO es parcial»). Aquí se
    // comprueba el contraste: con la petición que FUNCIONA no hay relectura de más (1 carga + 1 comprobación posterior).
    const m = montar(); await esperarCarga()
    fireEvent.click(caja('Torre Este'))
    fireEvent.click(botonGuardar())
    await waitFor(() => expect(m.onSaved).toHaveBeenCalled())
    expect(db.lecturas).toBe(2)
    expect(m.onReload).not.toHaveBeenCalled()
  })

  it('D1 · el guardado queda incierto y la relectura TAMBIÉN falla (la red sigue caída): pantalla de error, Guardar deshabilitado y Reintentar descarta la selección', async () => {
    db.upsert = 'aplica_y_lanza'
    montar(); await esperarCarga()
    fireEvent.click(caja('Torre Este'))
    db.fallaLectura = { 2: 'lanza' }                                       // 1 = carga, 2 = relectura tras el fallo incierto
    fireEvent.click(botonGuardar())
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(botonGuardar().disabled).toBe(true)                             // nunca se guarda a ciegas
    expect(screen.queryByLabelText('Torre Norte')).toBeNull()
    db.upsert = null
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }))
    await esperarCarga()
    expect(caja('Torre Este').checked).toBe(true)                          // lo que HAY en la base (el INSERT sí se aplicó)
    expect(botonGuardar().disabled).toBe(false)
  })
})

describe('V3-05 · la relectura posterior a un fallo llega cuando la pantalla ya muestra a OTRA persona', () => {
  it('E4 · no pisa el conjunto inicial de la persona nueva: quitar p4 a u-op2 lo borra', async () => {
    db.rows.push({ id: 'c', user_id: 'u-op2', project_id: 'p4' })
    db.del = 'falla'
    const m = montar(OP); await esperarCarga()
    fireEvent.click(caja('Torre Sur')); fireEvent.click(caja('Torre Este'))             // u-op: quita p2, añade p3 → el DELETE falla (parcial)
    let soltar: () => void = () => {}
    db.retardoLectura = n => (n === 2 ? new Promise<void>(res => { soltar = res }) : Promise.resolve())   // 1 = carga de u-op · 2 = su relectura tras el parcial: queda en vuelo · 3 = la carga de u-op2
    fireEvent.click(botonGuardar())
    await waitFor(() => expect(notifyMock).toHaveBeenCalled())
    // mientras la relectura está en vuelo el padre pasa el mismo modal a OTRA persona (sin `key`)
    m.rerender(<AsignacionModal usuario={OP2} proyectos={PROYECTOS} onClose={m.onClose} onSaved={m.onSaved} onReload={m.onReload} actor={OWNER} />)
    await waitFor(() => expect(caja('Torre Oeste').checked).toBe(true))                 // ya se muestra u-op2 = {p4}
    await act(async () => { soltar() })                                                 // llega tarde la relectura de u-op = {p1,p2,p3}
    db.del = null; notifyMock.mockReset()
    fireEvent.click(caja('Torre Oeste'))                                                // u-op2: quita p4
    fireEvent.click(botonGuardar())
    await waitFor(() => expect(m.onSaved).toHaveBeenCalled())
    expect(ids('u-op2')).toEqual([])                                                    // su `inicial` real era {p4}: se borra (con el de u-op pisándolo, la diferencia no incluía el borrado)
    expect(ids('u-op')).toEqual(['p1', 'p2', 'p3'])                                     // y u-op queda como lo dejó su guardado parcial
  })

  it('y si la relectura tardía FALLA, tampoco pone a la persona nueva en la pantalla de error', async () => {
    db.rows.push({ id: 'c', user_id: 'u-op2', project_id: 'p4' })
    db.del = 'falla'
    const m = montar(OP); await esperarCarga()
    fireEvent.click(caja('Torre Sur')); fireEvent.click(caja('Torre Este'))
    let soltar: () => void = () => {}
    db.retardoLectura = n => (n === 2 ? new Promise<void>(res => { soltar = res }) : Promise.resolve())
    db.fallaLectura = { 2: 'lanza' }
    fireEvent.click(botonGuardar())
    await waitFor(() => expect(notifyMock).toHaveBeenCalled())
    m.rerender(<AsignacionModal usuario={OP2} proyectos={PROYECTOS} onClose={m.onClose} onSaved={m.onSaved} onReload={m.onReload} actor={OWNER} />)
    await waitFor(() => expect(caja('Torre Oeste').checked).toBe(true))
    await act(async () => { soltar() })
    await new Promise(r => setTimeout(r, 20))
    expect(screen.queryByRole('alert')).toBeNull()                                      // u-op2 sigue editable
    expect(botonGuardar().disabled).toBe(false)
  })
})

describe('V3-03 (a) · la lectura de asignaciones filtra por la persona', () => {
  // Con filas de OTRAS personas en la tabla simulada, el modal de u-op debe mostrar sólo lo suyo. Sin `.eq('user_id', …)` en fetchUserProjectAssignments el modal pintaba como marcados los
  // proyectos de todos y la comprobación posterior al guardar se equivocaba (mutante N08: sobrevivía a las 192 pruebas porque nadie sembraba filas ajenas).
  it('N08 · con filas de u-op2 en p3 y p4, el modal de u-op muestra sólo {p1,p2}', async () => {
    db.rows.push({ id: 'x1', user_id: 'u-op2', project_id: 'p3' }, { id: 'x2', user_id: 'u-op2', project_id: 'p4' })
    montar(); await esperarCarga()
    expect(caja('Torre Norte').checked).toBe(true)
    expect(caja('Torre Sur').checked).toBe(true)
    expect(caja('Torre Este').checked).toBe(false)
    expect(caja('Torre Oeste').checked).toBe(false)
  })

  it('N08b · y al guardar sólo escribe lo suyo: las filas de u-op2 quedan intactas', async () => {
    db.rows.push({ id: 'x1', user_id: 'u-op2', project_id: 'p3' })
    const m = montar(); await esperarCarga()
    fireEvent.click(caja('Torre Sur'))
    fireEvent.click(botonGuardar())
    await waitFor(() => expect(m.onSaved).toHaveBeenCalled())
    expect(ids('u-op')).toEqual(['p1'])
    expect(ids('u-op2')).toEqual(['p3'])
  })

  it('N08c · la comprobación posterior tampoco se confunde con las filas de otra persona: u-op añade p3, que u-op2 ya tiene, y el guardado vale', async () => {
    db.rows.push({ id: 'x1', user_id: 'u-op2', project_id: 'p3' })
    const m = montar(); await esperarCarga()
    fireEvent.click(caja('Torre Este'))
    fireEvent.click(botonGuardar())
    await waitFor(() => expect(m.onSaved).toHaveBeenCalled())
    expect(ids('u-op')).toEqual(['p1', 'p2', 'p3'])
    expect(ids('u-op2')).toEqual(['p3'])
  })
})
