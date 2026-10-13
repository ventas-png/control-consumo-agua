// AsignacionModal · ronda 4 de verificación independiente (H1, H2/H3, H4) con PROMESAS CONTROLADAS: cada petición queda pendiente hasta que la prueba la atiende (la aplica o no en
// el «servidor» y decide cuándo y qué responde), así se fuerza el orden de llegada que un cliente simulado que responde al instante nunca ejerce.
//
//   H1 · tras un guardado PARCIAL o INCIERTO la relectura renovaba `inicial` pero NO las casillas: si otro administrador cambiaba a la misma persona entre la apertura y la
//        relectura, el siguiente «Guardar» sin tocar nada borraba una asignación ajena que la persona nunca vio o REINSERTABA una que el otro acababa de revocar (acceso restituido).
//        Ahora las casillas se fusionan a tres vías: (inicial nuevo \ lo que la persona quitó) ∪ (lo que añadió).
//   H2 · un guardado de A que termina bien cuando la pantalla ya es la de B no debe cerrar la de B (ni darla por guardada); lo mismo si el modal se desmontó.
//   H4 · MM10: `editables` sale de los proyectos MOSTRADOS, nunca de la unión con lo que haya en `inicial`. (MM5, quitar `errorCarga` del guard interno de guardar(), es
//        EQUIVALENTE a nivel de DOM: el botón deshabilitado ya impide el clic y no hay otra vía —sin <form>, Enter no envía nada— para llegar a guardar() con la carga fallida;
//        el guard interno es defensa en profundidad que la interfaz no puede ejercitar, por eso no hay prueba que lo mate.)
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { useState } from 'react'

type Respuesta = { data: unknown; error: { code: string; message: string } | null; status: number }
interface Pedido {
  n: number
  op: 'select' | 'upsert' | 'delete'
  filtros: Array<[string, unknown]>
  payload?: Array<Record<string, unknown>>
  servido: boolean
  resolver: (r: Respuesta) => void
}
const srv = vi.hoisted(() => ({
  rows: [] as Array<{ user_id: string; project_id: string }>,
  pedidos: [] as unknown[],
  n: 0,
}))
const notifyMock = vi.hoisted(() => vi.fn())

vi.mock('../../../lib/supabase', () => {
  function constructor(table: string) {
    const p = {
      n: ++srv.n, op: 'select' as 'select' | 'upsert' | 'delete', filtros: [] as Array<[string, unknown]>,
      payload: undefined as Array<Record<string, unknown>> | undefined, servido: false, resolver: (() => {}) as (r: unknown) => void,
    }
    const api: Record<string, unknown> = {
      select: () => api,
      delete: () => { p.op = 'delete'; return api },
      upsert: (rows: Array<Record<string, unknown>>) => { p.op = 'upsert'; p.payload = rows; return api },
      eq: (c: string, v: unknown) => { p.filtros.push([c, v]); return api },
      in: (c: string, v: unknown[]) => { p.filtros.push([c, v]); return api },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        new Promise(res => { p.resolver = res; if (table === 'user_project_assignments') srv.pedidos.push(p); else res({ data: [], error: null, status: 200 }) }).then(ok, ko),
    }
    return api
  }
  return { supabase: { from: (t: string) => constructor(t) } }
})
vi.mock('../../shared/Dialog', () => ({ notify: notifyMock }))

import { AsignacionModal } from '../AsignacionModal'

const OK: Respuesta = { data: null, error: null, status: 201 }
const RED: Respuesta = { data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 }      // lo que DEVUELVE postgrest-js ante un fallo de red
const RECHAZO: Respuesta = { data: null, error: { code: '42501', message: 'new row violates row-level security policy' }, status: 403 }   // respuesta definitiva de la base
const pedidos = () => srv.pedidos as Pedido[]
const filtro = (p: Pedido, c: string) => p.filtros.find(f => f[0] === c)?.[1]
const deUsuario = (p: Pedido) => String(filtro(p, 'user_id') ?? p.payload?.[0]?.user_id)
const escrituras = () => pedidos().filter(p => p.op !== 'select')
const proyectosDe = (p: Pedido) => p.payload?.map(f => f.project_id) ?? filtro(p, 'project_id')

/** Aplica la escritura en el «servidor» (sin responder todavía). */
function aplicar(p: Pedido) {
  if (p.op === 'upsert') {
    for (const f of p.payload ?? []) {
      if (!srv.rows.some(r => r.user_id === f.user_id && r.project_id === f.project_id)) srv.rows.push({ user_id: String(f.user_id), project_id: String(f.project_id) })
    }
  } else if (p.op === 'delete') {
    const u = filtro(p, 'user_id'), ps = filtro(p, 'project_id') as string[]
    srv.rows = srv.rows.filter(r => !(r.user_id === u && ps.includes(r.project_id)))
  }
}
const datosDe = (u: string) => srv.rows.filter(r => r.user_id === u).map(r => ({ project_id: r.project_id }))
async function responder(p: Pedido, r: Respuesta) { p.servido = true; await act(async () => { p.resolver(r) }) }
/** Atiende un SELECT con el estado ACTUAL del servidor para esa persona. */
async function leerAhora(p: Pedido) { await responder(p, { data: datosDe(deUsuario(p)), error: null, status: 200 }) }
/** El siguiente pedido SIN servir de esa operación y persona. */
async function siguiente(op: Pedido['op'], user: string): Promise<Pedido> {
  let hallado: Pedido | undefined
  await waitFor(() => { hallado = pedidos().find(p => !p.servido && p.op === op && deUsuario(p) === user); expect(hallado).toBeTruthy() })
  return hallado as Pedido
}
const sinServir = () => pedidos().filter(p => !p.servido)
const ids = (u: string) => srv.rows.filter(r => r.user_id === u).map(r => r.project_id).sort()

const PROYECTOS = [
  { id: 'p1', nombre: 'Torre Norte' }, { id: 'p2', nombre: 'Torre Sur' }, { id: 'p3', nombre: 'Torre Este' }, { id: 'p4', nombre: 'Torre Oeste' },
]
const NOMBRE: Record<string, string> = Object.fromEntries(PROYECTOS.map(p => [p.id, p.nombre]))
const A = { id: 'u-a', full_name: 'Persona A', role: 'operator' }
const B = { id: 'u-b', full_name: 'Persona B', role: 'operator' }
const OWNER = { id: 'u-owner', role: 'company_owner' }
const caja = (id: string) => screen.getByLabelText(NOMBRE[id]) as HTMLInputElement
const marcadas = () => PROYECTOS.filter(p => (screen.queryByLabelText(p.nombre) as HTMLInputElement | null)?.checked === true).map(p => p.id)      // sólo las casillas que se muestran
const botonGuardar = () => screen.getByRole('button', { name: /^Guardar$|Guardando/ }) as HTMLButtonElement
const modalDe = (usuario = A, extra: Partial<{ onClose: () => void; onSaved: () => void; onReload: () => void; proyectos: typeof PROYECTOS }> = {}) =>
  <AsignacionModal usuario={usuario} proyectos={extra.proyectos ?? PROYECTOS} onClose={extra.onClose ?? (() => {})} onSaved={extra.onSaved ?? (() => {})} onReload={extra.onReload} actor={OWNER} />

/** Abre el modal de A (que tiene {p1,p2}) y espera sus casillas. */
async function abrirA(extra: Parameters<typeof modalDe>[1] = {}) {
  const r = render(modalDe(A, extra))
  await leerAhora(await siguiente('select', 'u-a'))
  await waitFor(() => expect(caja('p1').checked).toBe(true))
  return r
}

beforeEach(() => {
  cleanup()
  notifyMock.mockReset()
  srv.rows = [{ user_id: 'u-a', project_id: 'p1' }, { user_id: 'u-a', project_id: 'p2' }, { user_id: 'u-b', project_id: 'p3' }]
  srv.pedidos = []
  srv.n = 0
})

describe('H1 · tras un guardado INCIERTO, la relectura reconcilia las casillas con lo que otro administrador hizo entretanto', () => {
  // La persona A tiene {p1,p2}. La persona pulsa Guardar con su cambio; el upsert llega al servidor y se APLICA, pero su respuesta se pierde (incierto → relectura).
  // Entre la escritura y la relectura OTRO administrador cambia a la misma persona. Después se pulsa Guardar otra vez, sin tocar nada.
  type Caso = {
    nombre: string
    propio: Array<'+p3' | '-p2'>             // lo que la persona marca/desmarca antes del primer Guardar
    ajeno: (rows: typeof srv.rows) => typeof srv.rows
    casillas: string[]                        // lo esperado tras la relectura
    reintento: { upserts: string[][]; deletes: string[][] }   // las ESCRITURAS NUEVAS del segundo Guardar
    final: string[]                           // lo que queda en el servidor al terminar
  }
  const quita = (id: string) => (rows: typeof srv.rows) => rows.filter(r => !(r.user_id === 'u-a' && r.project_id === id))
  const pon = (id: string) => (rows: typeof srv.rows) => [...rows, { user_id: 'u-a', project_id: id }]
  const casos: Caso[] = [
    { nombre: 'ALTA ajena (p4), SIN cambio propio pendiente: no se borra p4 al reintentar',
      propio: ['+p3'], ajeno: pon('p4'), casillas: ['p1', 'p2', 'p3', 'p4'], reintento: { upserts: [], deletes: [] }, final: ['p1', 'p2', 'p3', 'p4'] },
    { nombre: 'BAJA ajena (p2), SIN cambio propio pendiente: no se reinserta p2 al reintentar',
      propio: ['+p3'], ajeno: quita('p2'), casillas: ['p1', 'p3'], reintento: { upserts: [], deletes: [] }, final: ['p1', 'p3'] },
    { nombre: 'ALTA ajena (p4), CON cambio propio pendiente (quitar p2): el reintento borra sólo p2 y respeta p4',
      propio: ['+p3', '-p2'], ajeno: pon('p4'), casillas: ['p1', 'p3', 'p4'], reintento: { upserts: [], deletes: [['p2']] }, final: ['p1', 'p3', 'p4'] },
    { nombre: 'BAJA ajena (p1), CON cambio propio pendiente (quitar p2): el reintento borra sólo p2 y no reinserta p1',
      propio: ['+p3', '-p2'], ajeno: quita('p1'), casillas: ['p3'], reintento: { upserts: [], deletes: [['p2']] }, final: ['p3'] },
  ]

  it.each(casos)('$nombre', async caso => {
    const onSaved = vi.fn(), onClose = vi.fn(), onReload = vi.fn()
    await abrirA({ onSaved, onClose, onReload })
    for (const c of caso.propio) fireEvent.click(caja(c.slice(1)))
    fireEvent.click(botonGuardar())
    const up = await siguiente('upsert', 'u-a')
    aplicar(up); await responder(up, RED)                                       // el INSERT se aplicó y su respuesta se perdió → incierto → relectura en vuelo
    const relectura = await siguiente('select', 'u-a')
    srv.rows = caso.ajeno(srv.rows)                                             // OTRO administrador cambia a la misma persona antes de la relectura
    await leerAhora(relectura)
    await waitFor(() => expect(notifyMock).toHaveBeenCalledTimes(1))
    expect(notifyMock.mock.calls[0][0].title).toMatch(/No se pudo confirmar el guardado/)
    expect(onReload).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(marcadas()).toEqual(caso.casillas))              // la pantalla refleja lo que HAY (y respeta lo que la persona pidió)
    expect(onSaved).not.toHaveBeenCalled()

    const antes = escrituras().length
    fireEvent.click(botonGuardar())                                             // «revisa las casillas y guarda de nuevo» — sin tocar nada
    if (caso.reintento.deletes.length === 0 && caso.reintento.upserts.length === 0) {
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))             // sin diferencias no hay nada que escribir: se da por guardado
      expect(escrituras().length).toBe(antes)
    } else {
      for (const esperado of caso.reintento.deletes) {
        const del = await siguiente('delete', 'u-a')
        expect(proyectosDe(del)).toEqual(esperado)
        aplicar(del); await responder(del, OK)
      }
      await leerAhora(await siguiente('select', 'u-a'))                         // comprobación posterior
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
      const nuevas = escrituras().slice(antes)
      expect(nuevas.filter(p => p.op === 'upsert').map(proyectosDe)).toEqual(caso.reintento.upserts)
      expect(nuevas.filter(p => p.op === 'delete').map(proyectosDe)).toEqual(caso.reintento.deletes)
    }
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(ids('u-a')).toEqual(caso.final)
    expect(sinServir()).toEqual([])
  })

  it('PARCIAL con respuesta definitiva de la base (el upsert valió y el DELETE fue rechazado) + ALTA ajena: se reconcilia igual y el reintento borra sólo lo propio', async () => {
    const onSaved = vi.fn()
    await abrirA({ onSaved })
    fireEvent.click(caja('p3')); fireEvent.click(caja('p2'))                    // quiere +p3 y -p2
    fireEvent.click(botonGuardar())
    const up = await siguiente('upsert', 'u-a')
    aplicar(up); await responder(up, OK)                                        // p3 insertado y confirmado
    const del1 = await siguiente('delete', 'u-a')
    await responder(del1, RECHAZO)                                              // el DELETE de p2 lo rechaza la base: parcial (no incierto)
    srv.rows.push({ user_id: 'u-a', project_id: 'p4' })                         // otro administrador añade p4
    await leerAhora(await siguiente('select', 'u-a'))                           // relectura {p1,p2,p3,p4}
    await waitFor(() => expect(notifyMock).toHaveBeenCalledTimes(1))
    expect(notifyMock.mock.calls[0][0].title).toMatch(/guardadas a medias/)
    await waitFor(() => expect(marcadas()).toEqual(['p1', 'p3', 'p4']))         // p2 sigue desmarcada (lo pidió la persona), p4 aparece marcada
    fireEvent.click(botonGuardar())
    const del2 = await siguiente('delete', 'u-a')
    expect(proyectosDe(del2)).toEqual(['p2'])
    aplicar(del2); await responder(del2, OK)
    await leerAhora(await siguiente('select', 'u-a'))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(ids('u-a')).toEqual(['p1', 'p3', 'p4'])
    expect(pedidos().filter(p => p.op === 'upsert').length).toBe(1)             // el INSERT de p3 no se repite
  })

  it('lo que se marca MIENTRAS el guardado está en vuelo no se pierde cuando llega la relectura', async () => {
    await abrirA()
    fireEvent.click(caja('p3'))
    fireEvent.click(botonGuardar())
    const up = await siguiente('upsert', 'u-a')                                 // el guardado sigue en vuelo; las casillas siguen activas
    fireEvent.click(caja('p4'))                                                 // la persona marca p4 mientras tanto (no iba en lo que se envió)
    aplicar(up); await responder(up, RED)
    await leerAhora(await siguiente('select', 'u-a'))                           // relectura {p1,p2,p3}
    await waitFor(() => expect(notifyMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(marcadas()).toEqual(['p1', 'p2', 'p3', 'p4']))   // p4 sigue marcada
    fireEvent.click(botonGuardar())
    const up2 = await siguiente('upsert', 'u-a')
    expect(proyectosDe(up2)).toEqual(['p4'])                                    // y es lo único que falta por escribir
  })

  it('MM10 · una fila de un proyecto que la pantalla NO muestra y que aparece en `inicial` tras la relectura NO se borra al reintentar', async () => {
    await abrirA({ proyectos: PROYECTOS.slice(0, 3) })                          // la pantalla muestra p1..p3; p9 existe pero quien edita no lo ve
    fireEvent.click(caja('p3'))
    fireEvent.click(botonGuardar())
    const up = await siguiente('upsert', 'u-a')
    aplicar(up); await responder(up, RED)
    srv.rows.push({ user_id: 'u-a', project_id: 'p9' })                         // otro administrador (que sí ve p9) se lo asigna a la persona
    await leerAhora(await siguiente('select', 'u-a'))                           // relectura {p1,p2,p3,p9}
    await waitFor(() => expect(notifyMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(marcadas()).toEqual(['p1', 'p2', 'p3']))
    const antes = escrituras().length
    fireEvent.click(botonGuardar())                                             // reintento sin tocar nada
    await act(async () => { await new Promise(res => setTimeout(res, 20)) })
    expect(escrituras().length).toBe(antes)                                     // ni un DELETE de p9
    expect(ids('u-a')).toEqual(['p1', 'p2', 'p3', 'p9'])
  })
})

describe('H2 · el guardado de una pantalla que ya no está no cierra ni da por guardada la actual', () => {
  it('VF-3 · el guardado de A VALE cuando la pantalla ya es la de B (sin remontar): no se cierra el modal de B ni se da por guardado, pero la lista de atrás sí se recarga', async () => {
    const onClose = vi.fn(), onSaved = vi.fn(), onReload = vi.fn()
    const r = await abrirA({ onClose, onSaved, onReload })
    fireEvent.click(caja('p3'))
    fireEvent.click(botonGuardar())
    const up = await siguiente('upsert', 'u-a')                                 // el guardado de A queda en vuelo
    r.rerender(modalDe(B, { onClose, onSaved, onReload }))
    await leerAhora(await siguiente('select', 'u-b'))
    await waitFor(() => expect(caja('p3').checked).toBe(true))                  // ya se ve B (tiene p3)
    aplicar(up); await responder(up, OK)
    await leerAhora(await siguiente('select', 'u-a'))                           // comprobación posterior de A
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1))              // la base cambió: la lista de atrás se recarga
    expect(onClose).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    expect(marcadas()).toEqual(['p3'])                                          // B sigue en pantalla, intacta
    await waitFor(() => expect(botonGuardar().disabled).toBe(false))
  })

  it('el modal REMONTADO por otra persona (key) tampoco se cierra por el guardado tardío de la anterior', async () => {
    const onClose = vi.fn(), onSaved = vi.fn(), onReload = vi.fn()
    let cambiar: (u: typeof A) => void = () => {}
    function Padre() {
      const [u, setU] = useState(A)
      cambiar = setU
      return <div key={u.id}>{modalDe(u, { onClose, onSaved, onReload })}</div>       // un contenedor con key remonta el modal igual que la Sección
    }
    render(<Padre />)
    await leerAhora(await siguiente('select', 'u-a'))
    await waitFor(() => expect(caja('p1').checked).toBe(true))
    fireEvent.click(caja('p3'))
    fireEvent.click(botonGuardar())
    const up = await siguiente('upsert', 'u-a')
    await act(async () => { cambiar(B) })                                       // A se desmonta y se monta B
    await leerAhora(await siguiente('select', 'u-b'))
    await waitFor(() => expect(marcadas()).toEqual(['p3']))
    aplicar(up); await responder(up, OK)
    await leerAhora(await siguiente('select', 'u-a'))
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1))
    expect(onClose).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    expect(marcadas()).toEqual(['p3'])
  })

  it('un guardado que termina bien cuando el modal ya se cerró (Cancelar mientras guardaba) no vuelve a cerrar ni a «guardar»: sólo recarga la lista', async () => {
    const onClose = vi.fn(), onSaved = vi.fn(), onReload = vi.fn()
    const r = await abrirA({ onClose, onSaved, onReload })
    fireEvent.click(caja('p3'))
    fireEvent.click(botonGuardar())
    const up = await siguiente('upsert', 'u-a')
    r.unmount()                                                                 // el padre desmontó el modal
    aplicar(up); await responder(up, OK)
    await leerAhora(await siguiente('select', 'u-a'))
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1))
    expect(onClose).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('control · sin cambiar de pantalla el guardado correcto SÍ da por guardado y cierra (una vez cada uno) y no recarga aparte', async () => {
    const onClose = vi.fn(), onSaved = vi.fn(), onReload = vi.fn()
    await abrirA({ onClose, onSaved, onReload })
    fireEvent.click(caja('p3'))
    fireEvent.click(botonGuardar())
    const up = await siguiente('upsert', 'u-a')
    aplicar(up); await responder(up, OK)
    await leerAhora(await siguiente('select', 'u-a'))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onReload).not.toHaveBeenCalled()
  })
})
