// T7/PR3 (sección A) — Contrato de las lecturas bespoke de tabs de condominios.
// Mock encadenable por-tabla: from(table) devuelve un builder thenable que
// resuelve al resultado configurado para esa tabla (permite afirmar las 4
// queries paralelas de fetchProyectoResumen).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state: { byTable: Record<string, unknown>; fallback: unknown } = {
    byTable: {}, fallback: { data: null, count: null, error: null },
  }
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'gte', 'lte', 'update', 'maybeSingle', 'single']) b[m] = () => b
    b.then = (resolve: (v: unknown) => void) => resolve(state.byTable[table] ?? state.fallback)
    return b
  }
  return { state, from: (t: string) => makeBuilder(t) }
})

// `db` es la misma instancia que `supabase` (retipada); el mock espeja eso.
vi.mock('../../../lib/supabase', () => {
  const client = { from: h.from }
  return { supabase: client, db: client }
})

import {
  fetchDirectorioResidentes,
  fetchProyectosResumen,
  fetchMensajesPortal,
  activarPortalUnidad,
  fetchFondoReservaAprobado,
  fetchFondoReservaMovimientos,
  fetchPresupuestosAnio,
  fetchGastosAnioMontos,
  fetchEjecucionesMantenimiento,
  fetchPuntosAsambleaConVotos,
  fetchAsambleasDigital,
  fetchPuntosByAsambleaIds,
  fetchVotosUnidad,
  fetchVotosVotacion,
  fetchHuespedesByReservas,
  fetchVisitantesActivosByReservas,
  fetchContratosByUnidad,
  fetchReservasStrByUnidad,
  fetchConfigCondominioTerminos,
  fetchVisitantesPorDpi,
  fetchSolicitudesMudanzaByUnidad,
  fetchTerminosMudanzaPorProyecto,
  fetchCuotasPlanPago,
  countRecibosByProyecto,
  fetchCuotaCondominioNotas,
  fetchGeneracionCuotasLogs,
  fetchRecursosPlantillas,
} from '../tabQueries'

beforeEach(() => { h.state.byTable = {}; h.state.fallback = { data: null, count: null, error: null } })

describe('fetchDirectorioResidentes', () => {
  it('devuelve filas de unidades+clientes', async () => {
    h.state.byTable.unidades = { data: [{ nombre: 'A-1', clientes: { nombre: 'Ana' } }], error: null }
    expect(await fetchDirectorioResidentes('p1')).toEqual([{ nombre: 'A-1', clientes: { nombre: 'Ana' } }])
  })
  it('sin data → []', async () => {
    expect(await fetchDirectorioResidentes('p1')).toEqual([])
  })
})

describe('fetchProyectosResumen', () => {
  it('agrupa por proyecto las 4 queries batched (filas etiquetadas + counts por conteo)', async () => {
    h.state.byTable.cuotas_condominio = { data: [
      { project_id: 'p1', estado: 'pagado', monto: 100, fecha_vencimiento: null },
      { project_id: 'p2', estado: 'pendiente', monto: 50, fecha_vencimiento: '2026-01-01' },
    ], error: null }
    h.state.byTable.tickets_mantenimiento = { data: [{ project_id: 'p1', estado: 'abierto' }], error: null }
    h.state.byTable.unidades = { data: [{ project_id: 'p1' }, { project_id: 'p1' }, { project_id: 'p2' }], error: null }
    h.state.byTable.visitantes = { data: [{ project_id: 'p2' }], error: null }
    const r = await fetchProyectosResumen(['p1', 'p2'], 'co1', '2026-06-06')
    expect(r.p1).toEqual({
      cuotas: [{ project_id: 'p1', estado: 'pagado', monto: 100, fecha_vencimiento: null }],
      tickets: [{ project_id: 'p1', estado: 'abierto' }],
      unidadesCount: 2,
      visitantesCount: 0,
    })
    expect(r.p2.cuotas).toHaveLength(1)
    expect(r.p2.unidadesCount).toBe(1)
    expect(r.p2.visitantesCount).toBe(1)
  })
  it('filas de proyectos fuera de la lista se ignoran; sin data degrada a base vacía', async () => {
    h.state.byTable.cuotas_condominio = { data: [{ project_id: 'ajeno', estado: 'pagado', monto: 1, fecha_vencimiento: null }], error: null }
    const r = await fetchProyectosResumen(['p1'], 'co1', '2026-06-06')
    expect(r).toEqual({ p1: { cuotas: [], tickets: [], unidadesCount: 0, visitantesCount: 0 } })
  })
  it('sin proyectos → {} sin disparar queries', async () => {
    expect(await fetchProyectosResumen([], 'co1', '2026-06-06')).toEqual({})
  })
})

describe('PortalResidenteTab helpers', () => {
  it('fetchMensajesPortal devuelve filas', async () => {
    h.state.byTable.mensajes_portal = { data: [{ id: 'm1', estado: 'nuevo' }], error: null }
    expect(await fetchMensajesPortal('u1')).toEqual([{ id: 'm1', estado: 'nuevo' }])
  })
  it('activarPortalUnidad éxito → { error: null }', async () => {
    h.state.byTable.unidades = { error: null }
    expect(await activarPortalUnidad('u1', 'tok')).toEqual({ error: null })
  })
  it('activarPortalUnidad error → mensaje legible', async () => {
    h.state.byTable.unidades = { error: { message: 'rls' } }
    expect(await activarPortalUnidad('u1', 'tok')).toEqual({ error: 'rls' })
  })
})

describe('PortalTransparenciaTab reads', () => {
  // Regresión del fix de queries rotas: las tres funciones apuntaban a tablas/
  // columnas inexistentes (fondo_reserva sin `estado`, fondo_reserva_movimientos
  // y presupuestos_condominio no existen). Los mocks quedan keyed por las tablas
  // REALES para fijar el contrato.
  it('fetchFondoReservaAprobado lee de fondo_reserva_condominio', async () => {
    h.state.byTable.fondo_reserva_condominio = { data: [{ concepto: 'reserva', estado: 'aprobado', monto: 900 }], error: null }
    expect(await fetchFondoReservaAprobado('p1')).toEqual([{ concepto: 'reserva', estado: 'aprobado', monto: 900 }])
  })
  it('fetchFondoReservaMovimientos lee de fondo_reserva (ledger)', async () => {
    h.state.byTable.fondo_reserva = { data: [{ tipo: 'aportacion', monto: 50 }], error: null }
    expect(await fetchFondoReservaMovimientos('p1')).toEqual([{ tipo: 'aportacion', monto: 50 }])
  })
  it('fetchPresupuestosAnio lee de presupuesto_condominio', async () => {
    h.state.byTable.presupuesto_condominio = { data: [{ categoria: 'agua', monto_presupuestado: 1000 }], error: null }
    expect(await fetchPresupuestosAnio('p1', 2026)).toEqual([{ categoria: 'agua', monto_presupuestado: 1000 }])
  })
  it('fetchGastosAnioMontos degrada a []', async () => {
    expect(await fetchGastosAnioMontos('p1', 2026)).toEqual([])
  })
})

describe('fetchEjecucionesMantenimiento', () => {
  it('devuelve filas del plan', async () => {
    h.state.byTable.ejecuciones_mantenimiento = { data: [{ id: 'e1', fecha: '2026-01-01' }], error: null }
    expect(await fetchEjecucionesMantenimiento('plan1')).toEqual([{ id: 'e1', fecha: '2026-01-01' }])
  })
  it('sin data → []', async () => {
    expect(await fetchEjecucionesMantenimiento('plan1')).toEqual([])
  })
})

describe('asambleas / votaciones', () => {
  it('fetchPuntosAsambleaConVotos devuelve filas con join', async () => {
    h.state.byTable.puntos_asamblea = { data: [{ id: 'p1', votos_asamblea: [] }], error: null }
    expect(await fetchPuntosAsambleaConVotos('a1')).toEqual([{ id: 'p1', votos_asamblea: [] }])
  })
  it('fetchPuntosAsambleaConVotos sin data → []', async () => {
    expect(await fetchPuntosAsambleaConVotos('a1')).toEqual([])
  })
  it('fetchAsambleasDigital devuelve filas', async () => {
    h.state.byTable.asambleas_digital = { data: [{ id: 'a1' }], error: null }
    expect(await fetchAsambleasDigital('proj1')).toEqual([{ id: 'a1' }])
  })
  it('fetchPuntosByAsambleaIds (.in) devuelve filas', async () => {
    h.state.byTable.puntos_asamblea = { data: [{ id: 'p1', asamblea_id: 'a1' }], error: null }
    expect(await fetchPuntosByAsambleaIds(['a1'])).toEqual([{ id: 'p1', asamblea_id: 'a1' }])
  })
  it('fetchVotosUnidad degrada a []', async () => {
    expect(await fetchVotosUnidad('u1')).toEqual([])
  })
  it('fetchVotosVotacion devuelve filas con join', async () => {
    h.state.byTable.votos = { data: [{ id: 'v1', unidades: { nombre: 'A-1' } }], error: null }
    expect(await fetchVotosVotacion('vot1')).toEqual([{ id: 'v1', unidades: { nombre: 'A-1' } }])
  })
})

describe('rentas / STR', () => {
  it('fetchHuespedesByReservas con ids vacíos no consulta → []', async () => {
    expect(await fetchHuespedesByReservas([])).toEqual([])
  })
  it('fetchHuespedesByReservas devuelve filas', async () => {
    h.state.byTable.huespedes_str = { data: [{ id: 'h1', reserva_str_id: 'r1' }], error: null }
    expect(await fetchHuespedesByReservas(['r1'])).toEqual([{ id: 'h1', reserva_str_id: 'r1' }])
  })
  it('fetchVisitantesActivosByReservas con ids vacíos → []', async () => {
    expect(await fetchVisitantesActivosByReservas([])).toEqual([])
  })
  it('fetchVisitantesActivosByReservas devuelve filas', async () => {
    h.state.byTable.visitantes = { data: [{ reserva_str_id: 'r1' }], error: null }
    expect(await fetchVisitantesActivosByReservas(['r1'])).toEqual([{ reserva_str_id: 'r1' }])
  })
  it('fetchContratosByUnidad degrada a []', async () => {
    expect(await fetchContratosByUnidad('u1')).toEqual([])
  })
  it('fetchReservasStrByUnidad devuelve filas', async () => {
    h.state.byTable.reservas_str = { data: [{ id: 'r1' }], error: null }
    expect(await fetchReservasStrByUnidad('u1')).toEqual([{ id: 'r1' }])
  })
  it('fetchConfigCondominioTerminos devuelve la fila (maybeSingle)', async () => {
    h.state.byTable.config_condominio = { data: { id: 'c1', terminos_mudanza: 'X' }, error: null }
    expect(await fetchConfigCondominioTerminos('p1', 'co1')).toEqual({ id: 'c1', terminos_mudanza: 'X' })
  })
  it('fetchConfigCondominioTerminos sin fila → null', async () => {
    expect(await fetchConfigCondominioTerminos('p1', 'co1')).toBeNull()
  })
})

describe('seguridad / accesos', () => {
  it('fetchVisitantesPorDpi devuelve { data, error } con filas', async () => {
    h.state.byTable.visitantes = { data: [{ id: 'v1', unidades: { nombre: 'A-1' } }], error: null }
    expect(await fetchVisitantesPorDpi('co1', '123')).toEqual({
      data: [{ id: 'v1', unidades: { nombre: 'A-1' } }], error: null,
    })
  })
  it('fetchVisitantesPorDpi sin filas → { data: [], error: null }', async () => {
    expect(await fetchVisitantesPorDpi('co1', '123')).toEqual({ data: [], error: null })
  })
  it('fetchVisitantesPorDpi propaga el error', async () => {
    h.state.byTable.visitantes = { data: null, error: { message: 'rls' } }
    expect(await fetchVisitantesPorDpi('co1', '123')).toEqual({ data: [], error: { message: 'rls' } })
  })
})

describe('paquetería / mudanza (portal)', () => {
  it('fetchSolicitudesMudanzaByUnidad devuelve filas', async () => {
    h.state.byTable.solicitud_mudanza_unidad = { data: [{ id: 's1' }], error: null }
    expect(await fetchSolicitudesMudanzaByUnidad('u1')).toEqual([{ id: 's1' }])
  })
  it('fetchSolicitudesMudanzaByUnidad sin data → []', async () => {
    expect(await fetchSolicitudesMudanzaByUnidad('u1')).toEqual([])
  })
  it('fetchTerminosMudanzaPorProyecto devuelve el texto', async () => {
    h.state.byTable.config_condominio = { data: { terminos_mudanza: 'Reglas…' }, error: null }
    expect(await fetchTerminosMudanzaPorProyecto('p1')).toBe('Reglas…')
  })
  it('fetchTerminosMudanzaPorProyecto sin fila → null', async () => {
    expect(await fetchTerminosMudanzaPorProyecto('p1')).toBeNull()
  })
})

describe('cuotas / cobranza', () => {
  it('fetchCuotasPlanPago devuelve filas', async () => {
    h.state.byTable.cuotas_plan_pago = { data: [{ id: 'c1', numero: 1 }], error: null }
    expect(await fetchCuotasPlanPago('plan1')).toEqual([{ id: 'c1', numero: 1 }])
  })
  it('fetchCuotasPlanPago sin data → []', async () => {
    expect(await fetchCuotasPlanPago('plan1')).toEqual([])
  })
  it('countRecibosByProyecto devuelve el count', async () => {
    h.state.byTable.recibos_digitales = { data: null, count: 7, error: null }
    expect(await countRecibosByProyecto('p1')).toBe(7)
  })
  it('countRecibosByProyecto sin count → 0', async () => {
    expect(await countRecibosByProyecto('p1')).toBe(0)
  })
  it('fetchCuotaCondominioNotas devuelve las notas', async () => {
    h.state.byTable.cuotas_condominio = { data: { notas: 'parcial' }, error: null }
    expect(await fetchCuotaCondominioNotas('c1')).toBe('parcial')
  })
  it('fetchCuotaCondominioNotas sin fila → null', async () => {
    expect(await fetchCuotaCondominioNotas('c1')).toBeNull()
  })
  it('fetchGeneracionCuotasLogs devuelve filas', async () => {
    h.state.byTable.generacion_cuotas_log = { data: [{ id: 'l1' }], error: null }
    expect(await fetchGeneracionCuotasLogs('p1', 'co1')).toEqual([{ id: 'l1' }])
  })
})

describe('fetchRecursosPlantillas', () => {
  it('aplana el embed del recurso (nombre, unidad, estado) en cada puente', async () => {
    h.state.byTable.plantilla_tarea_suministros = { data: [
      { id: 's1', plantilla_tarea_id: 'pl1', suministro_id: 'sum1', cantidad: 0.5, suministros_condominio: { nombre: 'Cloro', unidad_medida: 'litro', activo: true } },
    ], error: null }
    h.state.byTable.plantilla_tarea_herramientas = { data: [
      { id: 'h1', plantilla_tarea_id: 'pl1', inventario_id: 'inv1', cantidad: 1, obligatoria: true, inventario_condominio: { nombre: 'Hidrolavadora', estado: 'dado_de_baja' } },
    ], error: null }
    const r = await fetchRecursosPlantillas('p1', 'co1')
    expect(r.error).toBeNull()
    expect(r.suministros).toEqual([
      { id: 's1', plantilla_tarea_id: 'pl1', suministro_id: 'sum1', cantidad: 0.5, suministro_nombre: 'Cloro', unidad_medida: 'litro', suministro_activo: true },
    ])
    expect(r.herramientas).toEqual([
      { id: 'h1', plantilla_tarea_id: 'pl1', inventario_id: 'inv1', cantidad: 1, obligatoria: true, inventario_nombre: 'Hidrolavadora', inventario_estado: 'dado_de_baja' },
    ])
  })

  it('propaga el error en lugar de degradar a listas "vacías" engañosas', async () => {
    h.state.byTable.plantilla_tarea_suministros = { data: null, error: { message: 'permission denied' } }
    const r = await fetchRecursosPlantillas('p1', 'co1')
    expect(r.error).toEqual({ message: 'permission denied' })
    expect(r.suministros).toEqual([])
  })

  it('sin filas → listas vacías sin error', async () => {
    const r = await fetchRecursosPlantillas('p1', 'co1')
    expect(r).toEqual({ suministros: [], herramientas: [], error: null })
  })
})
