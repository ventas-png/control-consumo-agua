// «Antes de iniciar el turno» desde la Ruta del día, para un rol con SÓLO
// Limpieza (ver/editar): ve el nombre de cada herramienta (20261230000500).
//
// El reporte: a ese rol la lista le salía «Herramienta · Obligatoria» sin
// saber cuál llevar. La pantalla leía plantilla_tarea_herramientas con el embed
// equipos_comunes(nombre, estado) / inventario_condominio(nombre, estado), y la
// RLS de esos catálogos exige el tab de Equipos o el de Inventario: el embed
// llegaba en null.
//
// Aquí la API está falseada para responder COMO A ESE ROL: la puente con su
// embed llega sin nombre, y la RPC del turno (herramientas_del_turno) sí los
// trae. La consulta de herramientas que corre es la REAL de tabQueries; sólo se
// fijan el calendario, las tareas y los insumos del día. La regla en la base
// (quién lee, qué columnas, sólo lo del turno) la prueba
// supabase/tests/herramientas_turno/run.sh.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import type { TareaBloque, TurnoCalendarioLimpieza } from '../../../../../types'

type Err = { message: string } | null

const api = vi.hoisted(() => {
  const tablas: string[] = []
  // Lo que PostgREST le devuelve al rol sólo-Limpieza: la puente se lee, el
  // catálogo embebido no (RLS de equipos_comunes / inventario_condominio).
  const sinNombre = [
    { plantilla_tarea_id: 'barrer', equipo_id: 'escoba', inventario_id: null, cantidad: 1, obligatoria: true, equipos_comunes: null, inventario_condominio: null },
    { plantilla_tarea_id: 'barrer', equipo_id: 'trapeador', inventario_id: null, cantidad: 2, obligatoria: false, equipos_comunes: null, inventario_condominio: null },
    { plantilla_tarea_id: 'vidrios', equipo_id: null, inventario_id: 'jalador', cantidad: 1, obligatoria: false, equipos_comunes: null, inventario_condominio: null },
  ]
  const consulta = (tabla: string) => {
    tablas.push(tabla)
    const resultado = { data: tabla === 'plantilla_tarea_herramientas' ? sinNombre : [], error: null }
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'in', 'eq', 'order']) q[m] = () => q
    q.then = (ok: (v: typeof resultado) => unknown) => Promise.resolve(resultado).then(ok)
    return q
  }
  return {
    tablas,
    from: vi.fn(consulta),
    rpc: vi.fn(async (fn: string, _args?: Record<string, unknown>) => fn === 'herramientas_del_turno'
      ? {
          data: [
            { plantilla_tarea_id: 'barrer', equipo_id: 'escoba', inventario_id: null, cantidad: 1, obligatoria: true, nombre: 'Escoba', estado: 'operativo' },
            { plantilla_tarea_id: 'barrer', equipo_id: 'trapeador', inventario_id: null, cantidad: 2, obligatoria: false, nombre: 'Trapeador', estado: 'operativo' },
            // Vínculo legado a Inventario: también con su nombre.
            { plantilla_tarea_id: 'vidrios', equipo_id: null, inventario_id: 'jalador', cantidad: 1, obligatoria: false, nombre: 'Jalador', estado: 'disponible' },
          ],
          error: null as Err,
        }
      : { data: null, error: { message: `rpc inesperada: ${fn}` } as Err }),
  }
})

const mocks = vi.hoisted(() => ({
  fetchCalendarioLimpieza: vi.fn(async (..._a: unknown[]) => ({ turnos: [] as TurnoCalendarioLimpieza[], error: null as Err })),
  fetchTareasDeTurnos: vi.fn(async (..._a: unknown[]) => ({ tareas: [] as TareaBloque[], error: null as Err })),
  fetchInsumosDeTareas: vi.fn(async (..._a: unknown[]) => ({ insumos: [], error: null as Err })),
  noUsado: vi.fn(async (..._a: unknown[]) => ({ data: null, error: null as Err })),
}))

vi.mock('../../../../../lib/supabase', () => ({
  supabase: { from: api.from, rpc: api.rpc },
  db: { from: api.from, rpc: api.rpc },
}))
vi.mock('../../../../../domain/condominios/tabQueries', async (importOriginal) => ({
  // fetchHerramientasDelTurno es la real: es lo que se prueba.
  ...(await importOriginal<typeof import('../../../../../domain/condominios/tabQueries')>()),
  fetchCalendarioLimpieza: mocks.fetchCalendarioLimpieza,
  fetchTareasDeTurnos: mocks.fetchTareasDeTurnos,
  fetchInsumosDeTareas: mocks.fetchInsumosDeTareas,
}))
vi.mock('../../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.noUsado,
  createCondominioRowReturning: mocks.noUsado,
  updateCondominioRow: mocks.noUsado,
  deleteCondominioRow: mocks.noUsado,
  cerrarTareaYConsumir: mocks.noUsado,
}))
vi.mock('../../../../shared/Dialog', () => ({ confirm: vi.fn(async () => ({ isConfirmed: true })), notify: vi.fn() }))
vi.mock('../../../../shared/PromptDialog', () => ({ openPromptDialog: vi.fn() }))
vi.mock('../../../../shared/ImageUploader', () => ({ MultiImageUploader: () => null, ImageUploader: () => null }))

const { VistaRutaDia } = await import('../VistaRutaDia')

const HOY = '2026-10-21'

const turno: TurnoCalendarioLimpieza = {
  bloque_id: 'b1', personal_id: 'p1', personal_nombre: 'Ana Pérez', personal_cargo: 'conserje',
  personal_estado: 'activo', fecha: HOY, turno: 'manana', estado: 'pendiente',
  iniciado_en: null, cerrado_en: null, plantilla_horario_id: 'h1', jornada_nombre: 'Mañana',
  jornada_codigo: 'MA', jornada_color: null, hora_inicio: '07:00:00', hora_fin: '15:00:00',
  horas_planificadas: 8, rutinas: [{ rutina_id: 'r1', tareas: 2, pendientes: 2, hechas: 0, trabajadas: 0 }],
  otras_tareas: 0,
}

const tarea = (id: string, orden: number, titulo: string, plantilla_id: string): TareaBloque => ({
  id, bloque_id: 'b1', titulo, orden, estado: 'pendiente', rutina_id: 'r1', plantilla_id,
  foto_urls: [], requiere_foto: false, created_at: '',
} as TareaBloque)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 21, 10, 0, 0))
  api.tablas.length = 0
  api.from.mockClear()
  api.rpc.mockClear()
  mocks.fetchCalendarioLimpieza.mockResolvedValue({ turnos: [turno], error: null })
  mocks.fetchTareasDeTurnos.mockResolvedValue({
    tareas: [tarea('t1', 0, 'Barrido de piso', 'barrer'), tarea('t2', 1, 'Limpieza de vidrios', 'vidrios')],
    error: null,
  })
  mocks.fetchInsumosDeTareas.mockResolvedValue({ insumos: [], error: null })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Ruta del día · «Antes de iniciar el turno» con sólo Limpieza', () => {
  async function abrirPreparacion() {
    render(<VistaRutaDia proyectoId="p1" companyId="co1" userId="u1" personal={[]} plantillas={[]} areas={[]} canEdit />)
    await screen.findByText(/Ana Pérez/)
    fireEvent.click(screen.getByText('▶ Iniciar'))
    const prep = await screen.findByRole('region', { name: 'Antes de iniciar el turno' })
    await within(prep).findByText(/Escoba/)
    return prep
  }

  it('ve el nombre de cada herramienta, también la del vínculo legado a Inventario', async () => {
    const prep = await abrirPreparacion()
    const items = within(prep).getAllByRole('checkbox').map(c => c.closest('label')!.textContent)
    expect(items).toEqual([
      'EscobaObligatoriaPara: Barrido de piso',
      'JaladorPara: Limpieza de vidrios',
      'Trapeador ×2Para: Barrido de piso',
    ])
    // Ni una herramienta anónima: lo que salía antes para este rol.
    expect(within(prep).queryByText(/^Herramienta/)).toBeNull()
  })

  it('las pide por el turno a la RPC, no con el embed de Equipos/Inventario que la RLS le deja vacío', async () => {
    await abrirPreparacion()
    expect(api.rpc).toHaveBeenCalledWith('herramientas_del_turno', { p_bloque_id: 'b1' })
    expect(api.tablas).not.toContain('plantilla_tarea_herramientas')
    expect(api.tablas).not.toContain('equipos_comunes')
    expect(api.tablas).not.toContain('inventario_condominio')
  })

  it('la obligatoria se marca, y hay que confirmar cada una antes de iniciar', async () => {
    const prep = await abrirPreparacion()
    expect(within(prep).getByText('Obligatoria').closest('label')!.textContent).toMatch(/^Escoba/)
    expect((within(prep).getByText('Falta confirmar 3') as HTMLButtonElement).disabled).toBe(true)
  })
})
