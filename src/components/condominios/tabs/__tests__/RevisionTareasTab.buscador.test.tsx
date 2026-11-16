// Revisión Admin — buscador en las dos vistas: la ronda de revisión acota los
// turnos cerrados por empleado, cargo, turno, título de tarea o lo reportado en
// ella; la vista de novedades (compartida con Limpieza) acota por lugar, texto,
// persona y fecha. Nada de esto toca los contadores ni los filtros de siempre.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { BloqueTurno, PersonalCondominio, RevisionTarea, TareaBloque } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  atenderNovedad: vi.fn(async () => ({ error: null })),
  openPromptDialog: vi.fn(async () => null as Record<string, string> | null),
  notify: vi.fn(),
}))
vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  atenderNovedad: mocks.atenderNovedad,
}))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: mocks.openPromptDialog }))

const { RevisionTareasTab } = await import('../RevisionTareasTab')

const FECHA = '2026-08-20'
const personal = [
  { id: 'per1', nombre: 'Ana', cargo: 'conserje', estado: 'activo' },
  { id: 'per2', nombre: 'Pedro López', cargo: 'guardia', estado: 'activo' },
] as PersonalCondominio[]
const bloques = [
  { id: 'blo1', personal_id: 'per1', turno: 'manana', fecha: FECHA, estado: 'completado' },
  { id: 'blo2', personal_id: 'per2', turno: 'noche', fecha: FECHA, estado: 'incompleto' },
] as BloqueTurno[]
const tarea = (id: string, bloque_id: string, titulo: string, over: Partial<TareaBloque> = {}) => ({
  id, bloque_id, titulo, orden: 0, requiere_foto: false, estado: 'completada', foto_urls: [],
  created_at: '2026-08-20T10:00:00.000Z', ...over,
} as TareaBloque)
const tareas = [
  tarea('t1', 'blo1', 'Revisar bombas', { novedad: 'La llave gotea' }),
  tarea('t2', 'blo2', 'Ronda nocturna', { estado: 'con_observacion', novedad: 'Luminaria fundida', requiere_mantenimiento: true }),
]

function montar() {
  render(<RevisionTareasTab bloques={bloques} tareas={tareas} revisiones={[] as RevisionTarea[]} personal={personal} userId="u1" canEdit onRefresh={() => {}} />)
}
// Sólo las cabeceras de tarjeta: el <select> del filtro repite «Nombre — cargo».
const turnosVisibles = () => ['Ana', 'Pedro López'].filter(n =>
  screen.queryAllByText(new RegExp(`^${n} — `)).some(el => el.tagName !== 'OPTION'))
const irAFecha = () => fireEvent.change(screen.getByDisplayValue(new Date().toISOString().slice(0, 10)), { target: { value: FECHA } })

beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)

describe('Revisión Admin · buscador de la ronda', () => {
  it('acota los turnos cerrados por empleado, cargo, turno, tarea o lo reportado, sin acentos', () => {
    montar()
    irAFecha()
    const buscador = screen.getByRole('searchbox', { name: 'Buscar turno cerrado' })
    expect(turnosVisibles()).toEqual(['Ana', 'Pedro López'])
    fireEvent.change(buscador, { target: { value: 'LOPEZ' } })
    expect(turnosVisibles()).toEqual(['Pedro López'])
    fireEvent.change(buscador, { target: { value: 'conserje' } })
    expect(turnosVisibles()).toEqual(['Ana'])
    fireEvent.change(buscador, { target: { value: 'noche' } })
    expect(turnosVisibles()).toEqual(['Pedro López'])
    fireEvent.change(buscador, { target: { value: 'bombas' } })
    expect(turnosVisibles()).toEqual(['Ana'])
    // Lo que el operativo reportó también cuenta: ¿en qué turno salió la luminaria?
    fireEvent.change(buscador, { target: { value: 'luminaria' } })
    expect(turnosVisibles()).toEqual(['Pedro López'])
    fireEvent.change(buscador, { target: { value: 'zzz' } })
    expect(turnosVisibles()).toEqual([])
    expect(screen.getByText('Ningún turno coincide con «zzz»')).toBeTruthy()
    fireEvent.change(buscador, { target: { value: '' } })
    expect(turnosVisibles()).toEqual(['Ana', 'Pedro López'])
  })

  it('sin turnos cerrados para el filtro manda el estado vacío de siempre', () => {
    montar()
    // El filtro arranca en HOY y los turnos son del 20: no hay nada que acotar.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar turno cerrado' }), { target: { value: 'ana' } })
    expect(screen.getByText('Sin turnos cerrados para revisar')).toBeTruthy()
    expect(screen.queryByText(/Ningún turno coincide/)).toBeNull()
  })
})

describe('Revisión Admin · buscador de novedades', () => {
  it('acota por lugar, texto o persona sin tocar el contador de mantenimiento', () => {
    montar()
    fireEvent.click(screen.getByRole('tab', { name: /Novedades/ }))
    expect(screen.getByText('La llave gotea')).toBeTruthy()
    expect(screen.getByText('Luminaria fundida')).toBeTruthy()
    const buscador = screen.getByRole('searchbox', { name: 'Buscar novedad' })

    fireEvent.change(buscador, { target: { value: 'gotea' } })
    expect(screen.getByText('La llave gotea')).toBeTruthy()
    expect(screen.queryByText('Luminaria fundida')).toBeNull()
    expect(screen.getByText('🛠 Solo mantenimiento pendiente (1)')).toBeTruthy()

    fireEvent.change(buscador, { target: { value: 'pedro' } })
    expect(screen.getByText('Luminaria fundida')).toBeTruthy()
    expect(screen.queryByText('La llave gotea')).toBeNull()
    fireEvent.change(buscador, { target: { value: 'bombas' } })
    expect(screen.getByText('La llave gotea')).toBeTruthy()

    fireEvent.change(buscador, { target: { value: 'zzz' } })
    expect(screen.getByText('Ninguna novedad coincide con «zzz»')).toBeTruthy()
    expect(screen.queryByText('Sin novedades reportadas')).toBeNull()
    fireEvent.change(buscador, { target: { value: '' } })
    expect(screen.getByText('La llave gotea')).toBeTruthy()
    expect(screen.getByText('Luminaria fundida')).toBeTruthy()
  })
})
