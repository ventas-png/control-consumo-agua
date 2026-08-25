// Las novedades de turno tienen dónde aparecer.
//
// Se capturan en `TareasPersonalTab` (el operativo, durante el turno) y se leen
// aquí (quien revisa, después). Sin este montaje la captura sería otro dato
// muerto: escrito en la base y sin pantalla que lo muestre.
//
// Lo que se cubre: que la vista se alcance, que traiga las novedades de tareas
// y no las de limpieza, que «atender» escriba sobre `tareas_bloque` —la vista
// es compartida, la tabla no— y que los filtros de la ronda de revisión (fecha,
// empleado) no escondan un hallazgo abierto.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { BloqueTurno, PersonalCondominio, RevisionTarea, TareaBloque } from '../../../../types'

type RowError = { message: string; code?: string } | null

// `tabMutations` NO se mockea: el mapeo fuente → tabla de `atenderNovedad` es
// justamente lo que se quiere verificar, y mockear el módulo lo saltaría. Se
// intercepta un escalón más abajo, en el cliente, para ver la tabla real.
const mocks = vi.hoisted(() => {
  const escrituras: { tabla: string; id: string; patch: Record<string, unknown> }[] = []
  let error: RowError = null
  return {
    escrituras,
    fallarCon(e: RowError) { error = e },
    from: (tabla: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: (_col: string, id: string) => {
          escrituras.push({ tabla, id, patch })
          return Promise.resolve({ error })
        },
      }),
      insert: () => Promise.resolve({ error }),
    }),
    reset() { escrituras.length = 0; error = null },
    openPromptDialog: vi.fn(async () => null as Record<string, string> | null),
    notify: vi.fn(),
  }
})

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: mocks.from },
  db: { from: mocks.from },
}))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: mocks.openPromptDialog }))

const { RevisionTareasTab } = await import('../RevisionTareasTab')

// ── Datos ──────────────────────────────────────────────────────────────────

const personal = [
  { id: 'per1', nombre: 'Ana', cargo: 'conserje', estado: 'activo' },
] as PersonalCondominio[]

/** Cerrado: es el único estado que la ronda de revisión mira. */
const bloque = {
  id: 'blo1', personal_id: 'per1', turno: 'manana',
  fecha: '2026-08-20', estado: 'completado',
} as BloqueTurno

function tarea(over: Partial<TareaBloque> = {}): TareaBloque {
  return {
    id: 'tar1', bloque_id: 'blo1', titulo: 'Revisar bombas', orden: 0,
    requiere_foto: false, estado: 'con_observacion', foto_urls: [],
    created_at: '2026-08-20T10:00:00.000Z',
    ...over,
  } as TareaBloque
}

function montar(tareas: TareaBloque[]) {
  return render(
    <RevisionTareasTab
      bloques={[bloque]}
      tareas={tareas}
      revisiones={[] as RevisionTarea[]}
      personal={personal}
      userId="u1"
      canEdit
      onRefresh={() => {}}
    />,
  )
}

const irANovedades = () => fireEvent.click(screen.getByRole('tab', { name: /Novedades/ }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.reset()
})
afterEach(cleanup)

describe('RevisionTareasTab · las novedades del turno se leen aquí', () => {
  it('la vista arranca en revisión y la de novedades se alcanza', () => {
    montar([tarea({ novedad: 'La llave gotea' })])
    expect(screen.getByRole('tab', { name: /Revisión/ }).getAttribute('aria-selected')).toBe('true')

    irANovedades()
    expect(screen.getByText('La llave gotea')).toBeTruthy()
    expect(screen.getByText(/🧰 Revisar bombas/)).toBeTruthy()
  })

  it('la pestaña cuenta el mantenimiento pendiente', () => {
    // Es lo que hace que alguien entre: sin el número, la vista existe pero
    // nadie sabe que hay algo esperando.
    montar([
      tarea({ id: 'a', novedad: 'fuga', requiere_mantenimiento: true }),
      tarea({ id: 'b', novedad: 'rayón', requiere_mantenimiento: false }),
    ])
    expect(screen.getByRole('tab', { name: /Novedades \(1\)/ })).toBeTruthy()
  })

  it('sin nada pendiente la pestaña no muestra número', () => {
    montar([tarea({ novedad: 'rayón' })])
    expect(screen.getByRole('tab', { name: /Novedades/ }).textContent).not.toMatch(/\d/)
  })

  it('atender escribe sobre tareas_bloque, no sobre ejecuciones_limpieza', async () => {
    // La vista es compartida con Limpieza; la tabla la decide la fuente. Si esto
    // se rompe, «atender» un hallazgo de turno tocaría la tabla equivocada.
    montar([tarea({ novedad: 'fuga', requiere_mantenimiento: true })])
    irANovedades()
    fireEvent.click(screen.getByText('✓ Marcar atendida'))

    await waitFor(() => expect(mocks.escrituras).toHaveLength(1))
    expect(mocks.escrituras[0]).toEqual({
      tabla: 'tareas_bloque', id: 'tar1', patch: { requiere_mantenimiento: false },
    })
  })

  it('un error al atender se avisa', async () => {
    mocks.fallarCon({ message: 'permission denied' })
    montar([tarea({ novedad: 'fuga', requiere_mantenimiento: true })])
    irANovedades()
    fireEvent.click(screen.getByText('✓ Marcar atendida'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
  })
})

describe('RevisionTareasTab · los filtros de la ronda no esconden hallazgos', () => {
  it('una novedad de otro día se sigue viendo', () => {
    // Los filtros de fecha y empleado son para revisar un turno concreto. Una
    // fuga no deja de importar porque el administrador esté mirando el martes.
    montar([tarea({ novedad: 'fuga del lunes', requiere_mantenimiento: true })])

    // El filtro arranca en HOY, y el bloque es del 2026-08-20: en la ronda no
    // aparece nada.
    expect(screen.getByText('Sin turnos cerrados para revisar')).toBeTruthy()

    irANovedades()
    expect(screen.getByText('fuga del lunes')).toBeTruthy()
  })
})

describe('RevisionTareasTab · la ronda de revisión muestra lo reportado', () => {
  it('lee novedad y cae a notas_operativo en las filas viejas', () => {
    const { rerender } = montar([tarea({ novedad: 'lo nuevo' })])
    // Se abre el turno del 20: hay que llevar el filtro a esa fecha.
    fireEvent.change(screen.getByDisplayValue(new Date().toISOString().slice(0, 10)),
      { target: { value: '2026-08-20' } })
    // El turno viene colapsado. El chevron burbujea al contenedor con el
    // onClick; el nombre no sirve de ancla porque también está en el select.
    fireEvent.click(screen.getByText('▾'))
    expect(screen.getByText(/💬 lo nuevo/)).toBeTruthy()

    rerender(
      <RevisionTareasTab
        bloques={[bloque]}
        tareas={[tarea({ novedad: null, notas_operativo: 'lo viejo' })]}
        revisiones={[] as RevisionTarea[]}
        personal={personal}
        userId="u1"
        canEdit
        onRefresh={() => {}}
      />,
    )
    expect(screen.getByText(/💬 lo viejo/)).toBeTruthy()
  })
})
