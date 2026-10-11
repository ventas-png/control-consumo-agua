// Pantalla «Asignar Acceso a Proyectos» (AsignacionModal) contra una tabla user_project_assignments simulada en memoria.
//
// Lo que cubre (y por qué):
//  · el guardado ya no «borra todas y vuelve a insertar»: inserta las que faltan y borra SÓLO las que sobran, de modo que
//    (i) si el insert falla no queda una ventana con CERO asignaciones y (ii) las filas que no cambian se conservan tal cual
//    (mismo id, created_at y permission_type);
//  · un DELETE que la RLS filtra devuelve 0 filas SIN error: la pantalla lo comprueba y no dice «guardado»;
//  · los errores de la base (ASIGNACION_PROPIA_NO_PERMITIDA, ASIGNACION_EMPRESA_DISTINTA, 42501) se traducen a un mensaje útil;
//  · un administrador (que no es propietario ni superadministrador) no puede editarse a sí mismo: el botón Guardar queda
//    deshabilitado con la explicación (el servidor lo rechazaría igual: migración 20261026000600);
//  · la diferencia se calcula de TRES VÍAS contra lo que había al ABRIR el modal (no contra una lectura nueva al guardar): dos
//    administradores a la vez no deshacen el trabajo del otro (sondas S4 y S5 del verificador);
//  · si la lectura inicial FALLA se muestra el error y Guardar queda deshabilitado (nunca se borra por una lectura fallida: S6);
//  · guardar() no deja rechazos sin manejar (S2) y tras un fallo PARCIAL avisa «se aplicó una parte» y recarga la lista (S3);
//  · una asignación a un proyecto que la pantalla no lista se conserva (S8) y el upsert se hace con ignoreDuplicates (DO NOTHING).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

interface Fila { id: string; user_id: string; project_id: string; permission_type: string; created_at: string }
interface ErrorBd { code: string; message: string }

const db = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; user_id: string; project_id: string; permission_type: string; created_at: string }>,
  log: [] as string[],
  failWrite: null as { code: string; message: string } | null,   // falla insert/upsert
  blockDelete: false,                                              // el DELETE «funciona» pero la RLS lo filtra: 0 filas, sin error
  siguiente: 1000,
  lecturas: 0,                                                     // cuántos SELECT van (1 = la carga del modal, 2 = la comprobación posterior)
  fallaLectura: {} as Record<number, { code: string; message: string } | 'lanza' | undefined>,
  failDelete: null as { code: string; message: string } | null,
  lanzaEn: null as null | 'upsert' | 'delete',                     // una EXCEPCIÓN de red (TypeError), no un error devuelto por la base
  alEscribir: null as null | (() => void),                        // lo que hace «otro administrador» justo antes de la primera escritura
  upsertOpts: [] as Array<Record<string, unknown> | undefined>,
}))
const notifyMock = vi.hoisted(() => vi.fn())

vi.mock('../../../lib/supabase', () => {
  function constructor(table: string) {
    const q: { op: 'select' | 'delete' | 'insert' | 'upsert'; filtros: Array<[string, unknown]>; payload?: Array<Record<string, unknown>>; opts?: { ignoreDuplicates?: boolean }; devuelve: boolean } =
      { op: 'select', filtros: [], devuelve: false }
    const coincide = (r: Fila) => q.filtros.every(([c, v]) => (Array.isArray(v) ? v.includes((r as unknown as Record<string, unknown>)[c]) : (r as unknown as Record<string, unknown>)[c] === v))
    function ejecutar(): { data: unknown; error: ErrorBd | null } {
      if (table !== 'user_project_assignments') return { data: [], error: null }
      if (q.op === 'select') {
        db.log.push('select')
        db.lecturas++
        const f = db.fallaLectura[db.lecturas]
        if (f === 'lanza') throw new TypeError('Failed to fetch')
        if (f) return { data: null, error: f }
        return { data: db.rows.filter(coincide).map(r => ({ project_id: r.project_id })), error: null }
      }
      if (db.alEscribir) { const otro = db.alEscribir; db.alEscribir = null; otro() }
      if (q.op === 'delete') {
        db.log.push('delete')
        if (db.lanzaEn === 'delete') throw new TypeError('Failed to fetch')
        if (db.failDelete) return { data: null, error: db.failDelete }
        if (db.blockDelete) return { data: [], error: null }
        const borradas = db.rows.filter(coincide)
        db.rows = db.rows.filter(r => !borradas.includes(r))
        return { data: q.devuelve ? borradas.map(r => ({ project_id: r.project_id })) : null, error: null }
      }
      db.log.push(q.op)
      if (q.op === 'upsert') db.upsertOpts.push(q.opts as Record<string, unknown> | undefined)
      if (db.lanzaEn === 'upsert') throw new TypeError('Failed to fetch')
      if (db.failWrite) return { data: null, error: db.failWrite }
      const nuevas: Fila[] = []
      for (const p of q.payload ?? []) {
        const existe = db.rows.some(r => r.user_id === p.user_id && r.project_id === p.project_id)
        if (existe) {
          if (q.op === 'upsert' && q.opts?.ignoreDuplicates) continue
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "user_project_assignments_user_id_project_id_key"' } }
        }
        nuevas.push({ id: `nueva-${++db.siguiente}`, user_id: String(p.user_id), project_id: String(p.project_id),
          permission_type: String(p.permission_type ?? 'total'), created_at: '2026-10-10T00:00:00Z' })
      }
      db.rows.push(...nuevas)
      return { data: q.devuelve ? nuevas.map(r => ({ project_id: r.project_id })) : null, error: null }
    }
    const api: Record<string, unknown> = {
      select: () => { if (q.op !== 'select') q.devuelve = true; return api },
      delete: () => { q.op = 'delete'; return api },
      insert: (rows: Array<Record<string, unknown>>) => { q.op = 'insert'; q.payload = rows; return api },
      upsert: (rows: Array<Record<string, unknown>>, opts?: { ignoreDuplicates?: boolean }) => { q.op = 'upsert'; q.payload = rows; q.opts = opts; return api },
      eq: (c: string, v: unknown) => { q.filtros.push([c, v]); return api },
      in: (c: string, v: unknown[]) => { q.filtros.push([c, v]); return api },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        try { return Promise.resolve(ejecutar()).then(ok, ko) } catch (e) { return Promise.reject(e).then(ok, ko) }
      },
    }
    return api
  }
  return { supabase: { from: (t: string) => constructor(t) } }
})

vi.mock('../../shared/Dialog', () => ({ notify: notifyMock }))

import { AsignacionModal } from '../AsignacionModal'

const PROYECTOS = [
  { id: 'p1', nombre: 'Torre Norte' },
  { id: 'p2', nombre: 'Torre Sur' },
  { id: 'p3', nombre: 'Torre Este' },
]
const OPERADOR = { id: 'u-op', full_name: 'Operadora Uno', role: 'operator' }
const ADMIN = { id: 'u-admin', full_name: 'Administrador Uno', role: 'admin' }

function fila(id: string, user: string, proyecto: string, permiso = 'total'): Fila {
  return { id, user_id: user, project_id: proyecto, permission_type: permiso, created_at: '2026-01-02T03:04:05Z' }
}

function montar(props: Partial<{ usuario: typeof OPERADOR; actor: { id: string; role: string }; proyectos: typeof PROYECTOS }> = {}) {
  const onSaved = vi.fn()
  const onClose = vi.fn()
  const onReload = vi.fn()
  render(
    <AsignacionModal
      usuario={props.usuario ?? OPERADOR}
      proyectos={props.proyectos ?? PROYECTOS}
      onClose={onClose}
      onSaved={onSaved}
      onReload={onReload}
      actor={props.actor ?? { id: 'u-owner', role: 'company_owner' }}
    />,
  )
  return { onSaved, onClose, onReload }
}

async function esperarCarga() {
  await waitFor(() => expect(screen.getByLabelText('Torre Norte')).toBeTruthy())
}
const guardar = () => fireEvent.click(screen.getByRole('button', { name: /Guardar/ }))
const escrituras = () => db.log.filter(o => o !== 'select')

beforeEach(() => {
  cleanup()
  db.rows = [fila('f1', 'u-op', 'p1', 'lectura'), fila('f2', 'u-op', 'p2', 'total')]
  db.log = []
  db.failWrite = null
  db.blockDelete = false
  db.siguiente = 1000
  db.lecturas = 0
  db.fallaLectura = {}
  db.failDelete = null
  db.lanzaEn = null
  db.alEscribir = null
  db.upsertOpts = []
  notifyMock.mockReset()
})

describe('AsignacionModal · guardado por diferencias', () => {
  it('carga las asignaciones actuales como casillas marcadas', async () => {
    montar()
    await esperarCarga()
    expect((screen.getByLabelText('Torre Norte') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Torre Sur') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Torre Este') as HTMLInputElement).checked).toBe(false)
  })

  it('guardar SIN cambios no escribe nada (las filas quedan tal cual)', async () => {
    const { onSaved, onClose } = montar()
    await esperarCarga()
    guardar()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
    expect(escrituras()).toEqual([])
    expect(db.rows.map(r => r.id)).toEqual(['f1', 'f2'])
  })

  it('agregar un proyecto inserta SÓLO ese y conserva las otras filas con su id, created_at y permission_type', async () => {
    const { onSaved } = montar()
    await esperarCarga()
    fireEvent.click(screen.getByLabelText('Torre Este'))
    guardar()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const f1 = db.rows.find(r => r.project_id === 'p1')
    expect(f1).toEqual(fila('f1', 'u-op', 'p1', 'lectura'))          // la fila que no cambió es la MISMA (no se recreó como «total»)
    expect(db.rows.find(r => r.project_id === 'p2')?.id).toBe('f2')
    expect(db.rows.filter(r => r.project_id === 'p3')).toHaveLength(1)
    expect(escrituras()).not.toContain('delete')
  })

  it('quitar un proyecto borra SÓLO esa fila', async () => {
    const { onSaved } = montar()
    await esperarCarga()
    fireEvent.click(screen.getByLabelText('Torre Sur'))
    guardar()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(db.rows).toEqual([fila('f1', 'u-op', 'p1', 'lectura')])
    expect(escrituras()).toEqual(['delete'])
  })

  it('si el insert FALLA no se borra nada: la persona NO se queda con cero asignaciones', async () => {
    db.failWrite = { code: '42501', message: 'new row violates row-level security policy for table "user_project_assignments"' }
    const { onSaved } = montar()
    await esperarCarga()
    fireEvent.click(screen.getByLabelText('Torre Sur'))     // quita p2 …
    fireEvent.click(screen.getByLabelText('Torre Este'))    // … y agrega p3 (el insert falla)
    guardar()
    await waitFor(() => expect(notifyMock).toHaveBeenCalled())
    expect(onSaved).not.toHaveBeenCalled()
    expect(db.rows.map(r => r.id).sort()).toEqual(['f1', 'f2'])   // ambas filas siguen ahí
  })

  it('un DELETE que la RLS filtra (0 filas, sin error) NO se presenta como guardado', async () => {
    db.blockDelete = true
    const { onSaved } = montar()
    await esperarCarga()
    fireEvent.click(screen.getByLabelText('Torre Sur'))
    guardar()
    await waitFor(() => expect(notifyMock).toHaveBeenCalled())
    expect(onSaved).not.toHaveBeenCalled()
    expect(notifyMock.mock.calls[0][0]).toMatchObject({ variant: 'error' })
  })
})

describe('AsignacionModal · mensajes de error útiles', () => {
  async function fallar(error: { code: string; message: string }) {
    db.failWrite = error
    montar()
    await esperarCarga()
    fireEvent.click(screen.getByLabelText('Torre Este'))
    guardar()
    await waitFor(() => expect(notifyMock).toHaveBeenCalled())
    return notifyMock.mock.calls[0][0] as { title: string; text: string; variant: string }
  }

  it('ASIGNACION_PROPIA_NO_PERMITIDA → explica que no se cambian los propios proyectos', async () => {
    const aviso = await fallar({ code: '42501', message: 'ASIGNACION_PROPIA_NO_PERMITIDA: nadie cambia sus propias asignaciones de proyecto' })
    expect(aviso.variant).toBe('error')
    expect(aviso.text).toMatch(/propios proyectos/)
    expect(aviso.text).toMatch(/otro administrador|propietario|superadministrador/)
  })

  it('ASIGNACION_EMPRESA_DISTINTA → explica que persona y proyecto deben ser de la misma empresa', async () => {
    const aviso = await fallar({ code: '23514', message: 'ASIGNACION_EMPRESA_DISTINTA: la persona y el proyecto deben pertenecer a la misma empresa' })
    expect(aviso.text).toMatch(/misma empresa/)
  })

  it('42501 de la RLS → explica el permiso (sólo proyectos que ve, a otras personas de su empresa)', async () => {
    const aviso = await fallar({ code: '42501', message: 'new row violates row-level security policy for table "user_project_assignments"' })
    expect(aviso.text).toMatch(/No tienes permiso/)
  })

  it('cualquier otro error conserva un mensaje genérico en español', async () => {
    const aviso = await fallar({ code: '57014', message: 'canceling statement due to statement timeout' })
    expect(aviso.text).toMatch(/No se pudieron guardar las asignaciones/)
  })
})

describe('AsignacionModal · un administrador no se edita a sí mismo', () => {
  it('el administrador sobre SU propia fila: Guardar deshabilitado y con la explicación', async () => {
    montar({ usuario: ADMIN, actor: { id: 'u-admin', role: 'admin' } })
    await esperarCarga()
    const boton = screen.getByRole('button', { name: /Guardar/ }) as HTMLButtonElement
    expect(boton.disabled).toBe(true)
    expect(screen.getByText(/No puedes cambiar tus propios proyectos/)).toBeTruthy()
  })

  it('el administrador sobre OTRA persona: Guardar habilitado y sin el aviso', async () => {
    montar({ usuario: OPERADOR, actor: { id: 'u-admin', role: 'admin' } })
    await esperarCarga()
    expect((screen.getByRole('button', { name: /Guardar/ }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(/No puedes cambiar tus propios proyectos/)).toBeNull()
  })

  it.each(['company_owner', 'super_admin', 'superadmin'])('%s sí puede editar su propia fila (es exento)', async rol => {
    montar({ usuario: { ...ADMIN, role: rol }, actor: { id: 'u-admin', role: rol } })
    await esperarCarga()
    expect((screen.getByRole('button', { name: /Guardar/ }) as HTMLButtonElement).disabled).toBe(false)
  })
})


describe('AsignacionModal · tres vías contra lo que había al ABRIR (dos administradores a la vez)', () => {
  it('S4 · otro administrador añade p3 mientras el modal está abierto; éste sólo quita p2: p3 SOBREVIVE y p2 se borra', async () => {
    const { onSaved } = montar()
    await esperarCarga()
    db.rows.push(fila('f3', 'u-op', 'p3'))                    // lo asignó otro administrador; esta pantalla nunca lo vio
    fireEvent.click(screen.getByLabelText('Torre Sur'))       // éste sólo quiere QUITAR p2
    guardar()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(db.rows.map(r => r.project_id).sort()).toEqual(['p1', 'p3'])
    expect(db.rows.find(r => r.project_id === 'p3')?.id).toBe('f3')     // la fila del otro administrador es la MISMA
    expect(escrituras()).toEqual(['delete'])
  })

  it('S5 · otro administrador QUITA p2 mientras el modal está abierto; éste añade p3 (con p2 aún marcado en su pantalla): p2 NO resucita', async () => {
    const { onSaved } = montar()
    await esperarCarga()
    db.rows = db.rows.filter(r => r.project_id !== 'p2')       // lo quitó otro administrador
    fireEvent.click(screen.getByLabelText('Torre Este'))       // éste sólo quiere AÑADIR p3 (p2 sigue marcado en SU pantalla)
    guardar()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(db.rows.map(r => r.project_id).sort()).toEqual(['p1', 'p3'])
    expect(escrituras()).toEqual(['upsert'])                    // sólo escribió lo que él cambió: nada de p2
  })

  it('el mismo proyecto asignado a la vez por otro administrador no es un error y su fila se conserva (upsert con ignoreDuplicates)', async () => {
    const { onSaved } = montar()
    await esperarCarga()
    fireEvent.click(screen.getByLabelText('Torre Este'))
    db.alEscribir = () => db.rows.push(fila('f-otro', 'u-op', 'p3'))       // el otro administrador llega primero
    guardar()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(notifyMock).not.toHaveBeenCalled()
    expect(db.rows.filter(r => r.project_id === 'p3')).toEqual([fila('f-otro', 'u-op', 'p3')])
  })

  it('las opciones del upsert son onConflict user_id,project_id con ignoreDuplicates (ON CONFLICT DO NOTHING, nunca DO UPDATE)', async () => {
    const { onSaved } = montar()
    await esperarCarga()
    fireEvent.click(screen.getByLabelText('Torre Este'))
    guardar()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(db.upsertOpts).toEqual([{ onConflict: 'user_id,project_id', ignoreDuplicates: true }])
  })

  it('S8 · una asignación a un proyecto que la pantalla NO lista (p9) sobrevive al guardar', async () => {
    db.rows.push(fila('f9', 'u-op', 'p9'))
    const { onSaved } = montar()
    await esperarCarga()
    fireEvent.click(screen.getByLabelText('Torre Este'))
    guardar()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(db.rows.map(r => r.project_id).sort()).toEqual(['p1', 'p2', 'p3', 'p9'])
    expect(db.rows.find(r => r.project_id === 'p9')?.id).toBe('f9')
  })

  it('… también si se vacía todo lo que la pantalla muestra: lo oculto (p9) NO se borra', async () => {
    db.rows.push(fila('f9', 'u-op', 'p9'))
    const { onSaved } = montar()
    await esperarCarga()
    fireEvent.click(screen.getByLabelText('Torre Norte'))
    fireEvent.click(screen.getByLabelText('Torre Sur'))
    guardar()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(db.rows).toEqual([fila('f9', 'u-op', 'p9')])
  })
})

describe('AsignacionModal · si la lectura inicial FALLA no se borra nada', () => {
  async function esperarError() {
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  }

  it.each([
    ['la base devuelve un error', { 1: { code: '', message: 'TypeError: Failed to fetch' } }],
    ['la lectura lanza una excepción', { 1: 'lanza' as const }],
  ])('S6 · %s: se muestra el error, no hay casillas y Guardar queda DESHABILITADO', async (_caso, falla) => {
    db.fallaLectura = falla
    const { onSaved } = montar()
    await esperarError()
    expect(screen.getByRole('alert').textContent).toMatch(/No se pudieron cargar las asignaciones actuales/)
    expect(screen.queryByLabelText('Torre Norte')).toBeNull()
    const boton = screen.getByRole('button', { name: /Guardar/ }) as HTMLButtonElement
    expect(boton.disabled).toBe(true)
    fireEvent.click(boton)
    await new Promise(r => setTimeout(r, 30))
    expect(escrituras()).toEqual([])
    expect(onSaved).not.toHaveBeenCalled()
    expect(db.rows.map(r => r.id)).toEqual(['f1', 'f2'])            // nada se borró
  })

  it('Reintentar vuelve a leer y, si ahora funciona, muestra las casillas y habilita Guardar', async () => {
    db.fallaLectura = { 1: { code: '', message: 'TypeError: Failed to fetch' } }
    montar()
    await esperarError()
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }))
    await esperarCarga()
    expect((screen.getByLabelText('Torre Norte') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('button', { name: /Guardar/ }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('AsignacionModal · fallos al guardar', () => {
  it('S2 · una EXCEPCIÓN (no un error devuelto) en el insert se captura: mensaje claro, sin rechazos sin manejar y el botón vuelve a «Guardar»; como pudo aplicarse, se relee y se recarga la lista (V3-02)', async () => {
    db.lanzaEn = 'upsert'
    const rechazos: unknown[] = []
    const h = (e: unknown) => rechazos.push(e)
    process.on('unhandledRejection', h)
    const { onSaved, onReload } = montar()
    await esperarCarga()
    fireEvent.click(screen.getByLabelText('Torre Este'))
    guardar()
    await waitFor(() => expect(notifyMock).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 30))
    process.off('unhandledRejection', h)
    expect(rechazos).toEqual([])
    expect(notifyMock.mock.calls[0][0]).toMatchObject({ variant: 'error', text: expect.stringMatching(/No se pudieron guardar las asignaciones/) })
    expect(onSaved).not.toHaveBeenCalled()
    expect(notifyMock.mock.calls[0][0]).toMatchObject({ title: 'No se pudo confirmar el guardado', text: expect.stringMatching(/No se pudo confirmar si los cambios se aplicaron/) })
    expect(onReload).toHaveBeenCalledTimes(1)                        // la petición pudo llegar y aplicarse aunque aquí no fue así: la lista de atrás se recarga y el modal relee
    expect(db.lecturas).toBe(2)                                      // carga inicial + relectura (ahora ése es el «antes»)
    expect(db.rows.map(r => r.id)).toEqual(['f1', 'f2'])
    await waitFor(() => expect(screen.getByRole('button', { name: /^Guardar$/ })).toBeTruthy())
  })

  it('S3 · el insert vale y el DELETE falla: aviso de guardado PARCIAL («se aplicó una parte»), recarga de la lista y el diálogo sigue abierto', async () => {
    db.failDelete = { code: '', message: 'TypeError: Failed to fetch' }
    const { onSaved, onClose, onReload } = montar()
    await esperarCarga()
    fireEvent.click(screen.getByLabelText('Torre Sur'))     // quita p2
    fireEvent.click(screen.getByLabelText('Torre Este'))    // agrega p3
    guardar()
    await waitFor(() => expect(notifyMock).toHaveBeenCalled())
    const aviso = notifyMock.mock.calls[0][0] as { title: string; text: string }
    expect(aviso.title).toMatch(/a medias/)
    expect(aviso.text).toMatch(/Se aplicó una parte de los cambios/)
    expect(aviso.text).toMatch(/Vuelve a guardar/)
    expect(onReload).toHaveBeenCalledTimes(1)
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(db.rows.map(r => r.project_id).sort()).toEqual(['p1', 'p2', 'p3'])     // p3 entró, p2 sigue (estado parcial)
    // volver a guardar CONVERGE (es idempotente): el insert de p3 ya está hecho y no falla, y ahora el DELETE funciona
    db.failDelete = null
    notifyMock.mockReset()
    guardar()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(db.rows.map(r => r.project_id).sort()).toEqual(['p1', 'p3'])
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('una excepción de red en el DELETE tras un insert que valió también es PARCIAL', async () => {
    db.lanzaEn = 'delete'
    const { onReload } = montar()
    await esperarCarga()
    fireEvent.click(screen.getByLabelText('Torre Sur'))
    fireEvent.click(screen.getByLabelText('Torre Este'))
    guardar()
    await waitFor(() => expect(notifyMock).toHaveBeenCalled())
    expect((notifyMock.mock.calls[0][0] as { text: string }).text).toMatch(/Se aplicó una parte de los cambios/)
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('S7 · la lectura de comprobación falla DESPUÉS de escribir bien: se avisa, es parcial (sí se escribió) y se recarga', async () => {
    db.fallaLectura = { 2: { code: '', message: 'TypeError: Failed to fetch' } }
    const { onSaved, onReload } = montar()
    await esperarCarga()
    fireEvent.click(screen.getByLabelText('Torre Este'))
    guardar()
    await waitFor(() => expect(notifyMock).toHaveBeenCalled())
    expect((notifyMock.mock.calls[0][0] as { text: string }).text).toMatch(/No se pudo comprobar/)
    expect(onSaved).not.toHaveBeenCalled()
    expect(onReload).toHaveBeenCalledTimes(1)
    expect(db.rows.map(r => r.project_id).sort()).toEqual(['p1', 'p2', 'p3'])
  })

  it('un fallo del insert (nada se aplicó) NO es parcial: sin «Se aplicó una parte» y sin recargar', async () => {
    db.failWrite = { code: '42501', message: 'new row violates row-level security policy for table "user_project_assignments"' }
    const { onReload } = montar()
    await esperarCarga()
    fireEvent.click(screen.getByLabelText('Torre Este'))
    guardar()
    await waitFor(() => expect(notifyMock).toHaveBeenCalled())
    expect((notifyMock.mock.calls[0][0] as { text: string }).text).not.toMatch(/Se aplicó una parte/)
    expect(onReload).not.toHaveBeenCalled()
  })

  it('el actor es OBLIGATORIO: sin él no habría compuerta (error de tipos si se omite)', () => {
    // @ts-expect-error `actor` es obligatorio en AsignacionModal; si esta línea dejara de ser un error de tipos, tsc fallaría
    const sinActor = <AsignacionModal usuario={OPERADOR} proyectos={PROYECTOS} onClose={() => {}} onSaved={() => {}} />
    expect(sinActor).toBeTruthy()
  })
})

describe('AsignacionModal · tras un guardado PARCIAL el conjunto inicial se refresca (F2-01)', () => {
  // Antes `inicial` se fijaba sólo al abrir. Tras un parcial (el insert de p3 valió y el DELETE de p2 falló) la base ya tiene {p1,p2,p3}, pero el modal seguía creyendo {p1,p2}:
  // si la persona cambiaba de idea y volvía a guardar, la diferencia se calculaba contra un estado que ya no era cierto y la fila ya insertada se quedaba, con el aviso «guardado».
  async function parcial() {
    db.lanzaEn = 'delete'
    const m = montar()
    await esperarCarga()
    fireEvent.click(screen.getByLabelText('Torre Sur'))     // quita p2 …
    fireEvent.click(screen.getByLabelText('Torre Este'))    // … y añade p3: el upsert vale, el DELETE lanza una excepción de red
    guardar()
    await waitFor(() => expect(notifyMock).toHaveBeenCalled())
    expect((notifyMock.mock.calls[0][0] as { title: string }).title).toMatch(/a medias/)
    expect(db.rows.map(r => r.project_id).sort()).toEqual(['p1', 'p2', 'p3'])      // p3 YA está en la base y p2 sigue
    db.lanzaEn = null
    notifyMock.mockReset()
    return m
  }

  it('la persona deshace su cambio (re-marca p2, desmarca p3) y guarda: p3, que ya se había insertado, se QUITA y la base queda como la pantalla {p1,p2}', async () => {
    const { onSaved } = await parcial()
    fireEvent.click(screen.getByLabelText('Torre Sur'))     // re-marca p2
    fireEvent.click(screen.getByLabelText('Torre Este'))    // desmarca p3
    expect((screen.getByLabelText('Torre Sur') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Torre Este') as HTMLInputElement).checked).toBe(false)
    guardar()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(db.rows.map(r => r.project_id).sort()).toEqual(['p1', 'p2'])
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('deja p2 desmarcado y desmarca p3: se borran las DOS (antes sólo p2 y p3 quedaba asignado con la pantalla diciendo «guardado»)', async () => {
    const { onSaved } = await parcial()
    fireEvent.click(screen.getByLabelText('Torre Este'))    // desmarca p3 (p2 ya estaba desmarcado)
    guardar()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(db.rows.map(r => r.project_id).sort()).toEqual(['p1'])
  })

  it('sin cambiar la selección, reintentar sigue convergiendo (sólo falta el DELETE de p2)', async () => {
    const { onSaved } = await parcial()
    guardar()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(db.rows.map(r => r.project_id).sort()).toEqual(['p1', 'p3'])
    expect(escrituras()).toEqual(['upsert', 'delete', 'delete'])        // ni vuelve a insertar p3 ni toca otra cosa: sólo el DELETE de p2
  })

  it('si la relectura posterior al parcial FALLA no se sabe qué hay en la base: error con «Reintentar» y Guardar DESHABILITADO (nunca se guarda a ciegas)', async () => {
    db.lanzaEn = 'delete'
    montar()
    await esperarCarga()
    fireEvent.click(screen.getByLabelText('Torre Sur'))
    fireEvent.click(screen.getByLabelText('Torre Este'))
    db.fallaLectura = { 2: { code: '', message: 'TypeError: Failed to fetch' } }      // 1 = carga inicial; 2 = la relectura que sigue al parcial
    guardar()
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByRole('alert').textContent).toMatch(/No se pudieron cargar las asignaciones actuales/)
    expect((screen.getByRole('button', { name: /Guardar/ }) as HTMLButtonElement).disabled).toBe(true)
    db.lanzaEn = null
    const antes = escrituras().length
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }))
    await esperarCarga()
    expect((screen.getByLabelText('Torre Este') as HTMLInputElement).checked).toBe(true)         // lo que HAY en la base ahora (p3 entró)
    expect((screen.getByLabelText('Torre Sur') as HTMLInputElement).checked).toBe(true)          // y p2 sigue
    expect((screen.getByRole('button', { name: /Guardar/ }) as HTMLButtonElement).disabled).toBe(false)
    expect(escrituras().length).toBe(antes)                                                      // Reintentar sólo lee
  })

  it('un fallo en el que NO se aplicó nada no relee ni cambia el conjunto inicial (una sola lectura: la de la carga)', async () => {
    db.failWrite = { code: '42501', message: 'new row violates row-level security policy for table "user_project_assignments"' }
    montar()
    await esperarCarga()
    fireEvent.click(screen.getByLabelText('Torre Este'))
    guardar()
    await waitFor(() => expect(notifyMock).toHaveBeenCalled())
    expect(db.lecturas).toBe(1)
  })
})
