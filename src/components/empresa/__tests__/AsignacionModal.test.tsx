// Pantalla «Asignar Acceso a Proyectos» (AsignacionModal) contra una tabla user_project_assignments simulada en memoria.
//
// Lo que cubre (y por qué):
//  · el guardado ya no «borra todas y vuelve a insertar»: inserta las que faltan y borra SÓLO las que sobran, de modo que
//    (i) si el insert falla no queda una ventana con CERO asignaciones y (ii) las filas que no cambian se conservan tal cual
//    (mismo id, created_at y permission_type);
//  · un DELETE que la RLS filtra devuelve 0 filas SIN error: la pantalla lo comprueba y no dice «guardado»;
//  · los errores de la base (ASIGNACION_PROPIA_NO_PERMITIDA, ASIGNACION_EMPRESA_DISTINTA, 42501) se traducen a un mensaje útil;
//  · un administrador (que no es propietario ni superadministrador) no puede editarse a sí mismo: el botón Guardar queda
//    deshabilitado con la explicación (el servidor lo rechazaría igual: migración 20261026000600).
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
        return { data: db.rows.filter(coincide).map(r => ({ project_id: r.project_id })), error: null }
      }
      if (q.op === 'delete') {
        db.log.push('delete')
        if (db.blockDelete) return { data: [], error: null }
        const borradas = db.rows.filter(coincide)
        db.rows = db.rows.filter(r => !borradas.includes(r))
        return { data: q.devuelve ? borradas.map(r => ({ project_id: r.project_id })) : null, error: null }
      }
      db.log.push(q.op)
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
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(ejecutar()).then(ok, ko),
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

function montar(props: Partial<{ usuario: typeof OPERADOR; actor: { id: string; role: string } }> = {}) {
  const onSaved = vi.fn()
  const onClose = vi.fn()
  render(
    <AsignacionModal
      usuario={props.usuario ?? OPERADOR}
      proyectos={PROYECTOS}
      onClose={onClose}
      onSaved={onSaved}
      {...(props.actor ? { actor: props.actor } : { actor: { id: 'u-owner', role: 'company_owner' } })}
    />,
  )
  return { onSaved, onClose }
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
