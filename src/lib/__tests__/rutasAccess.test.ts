import { describe, it, expect } from 'vitest'
import { filterRutasByProjectAccess } from '../rutasAccess'
import type { Ruta, Contador, Unidad, Registro } from '../../types'

const P_21B = 'proj-21b'
const P_SQ = 'proj-sq'
const ME = 'user-me'

const ruta = (r: Partial<Ruta> & Pick<Ruta, 'id'>): Ruta => ({
  nombre: r.id,
  tipo_ruta: 'clientes',
  cliente_ids: [],
  contador_ids: [],
  unidad_ids: [],
  completada: false,
  created_at: '2026-01-01',
  ...r,
})
const contador = (id: string, project_id: string): Contador =>
  ({ id, project_id } as Contador)
const unidad = (id: string, project_id: string, cliente_id?: string): Unidad =>
  ({ id, project_id, cliente_id } as Unidad)
const registro = (cliente_id: string, project_id: string): Registro =>
  ({ cliente_id, project_id } as Registro)

const run = (
  rutas: Ruta[],
  opts: { contadores?: Contador[]; unidades?: Unidad[]; registros?: Registro[]; accessible?: string[]; userId?: string } = {},
) =>
  filterRutasByProjectAccess({
    rutas,
    contadores: opts.contadores ?? [],
    unidades: opts.unidades ?? [],
    registros: opts.registros ?? [],
    accessibleProjectIds: new Set(opts.accessible ?? [P_21B]),
    userId: opts.userId ?? ME,
  }).map(r => r.id)

describe('filterRutasByProjectAccess', () => {
  it('keeps a route whose explicit project_id is accessible', () => {
    const rutas = [ruta({ id: 'with-pid', project_id: P_21B, tipo_ruta: 'unidades', unidad_ids: ['u1'] })]
    // No unidades provided: decision must come from project_id alone.
    expect(run(rutas)).toEqual(['with-pid'])
  })

  it('hides a route whose explicit project_id is inaccessible', () => {
    const rutas = [ruta({ id: 'with-pid', project_id: P_SQ, tipo_ruta: 'clientes', cliente_ids: ['cl1'] })]
    expect(run(rutas)).toEqual([])
  })

  it('keeps an assigned route even when its project_id is inaccessible', () => {
    const rutas = [ruta({ id: 'mine', project_id: P_SQ, asignado_a: ME })]
    expect(run(rutas)).toEqual(['mine'])
  })

  it('hides a unidades route whose units are all in an inaccessible project', () => {
    const rutas = [ruta({ id: 'sq-units', tipo_ruta: 'unidades', unidad_ids: ['u1', 'u2'] })]
    const unidades = [unidad('u1', P_SQ), unidad('u2', P_SQ)]
    expect(run(rutas, { unidades })).toEqual([])
  })

  it('keeps a unidades route whose units are in an accessible project', () => {
    const rutas = [ruta({ id: 'my-units', tipo_ruta: 'unidades', unidad_ids: ['u1'] })]
    const unidades = [unidad('u1', P_21B)]
    expect(run(rutas, { unidades })).toEqual(['my-units'])
  })

  it('keeps a cross-project unidades route when at least one unit is accessible', () => {
    const rutas = [ruta({ id: 'mixed', tipo_ruta: 'unidades', unidad_ids: ['u1', 'u2'] })]
    const unidades = [unidad('u1', P_SQ), unidad('u2', P_21B)]
    expect(run(rutas, { unidades })).toEqual(['mixed'])
  })

  it('hides a contadores route whose meters are all inaccessible', () => {
    const rutas = [ruta({ id: 'sq-meters', tipo_ruta: 'contadores', contador_ids: ['c1'] })]
    const contadores = [contador('c1', P_SQ)]
    expect(run(rutas, { contadores })).toEqual([])
  })

  it('hides a clientes route whose clientes map (via units) to an inaccessible project', () => {
    const rutas = [ruta({ id: 'sq-clients', tipo_ruta: 'clientes', cliente_ids: ['cl1', 'cl2'] })]
    const unidades = [unidad('u1', P_SQ, 'cl1'), unidad('u2', P_SQ, 'cl2')]
    expect(run(rutas, { unidades })).toEqual([])
  })

  it('keeps a clientes route whose clientes map to an accessible project (via readings)', () => {
    const rutas = [ruta({ id: 'my-clients', tipo_ruta: 'clientes', cliente_ids: ['cl1'] })]
    const registros = [registro('cl1', P_21B)]
    expect(run(rutas, { registros })).toEqual(['my-clients'])
  })

  it('keeps a clientes route whose clientes cannot be mapped to any project (ambiguous)', () => {
    const rutas = [ruta({ id: 'orphan', tipo_ruta: 'clientes', cliente_ids: ['cl-unknown'] })]
    expect(run(rutas)).toEqual(['orphan'])
  })

  it('always keeps routes assigned to the current user, even in an inaccessible project', () => {
    const rutas = [ruta({ id: 'sq-mine', tipo_ruta: 'unidades', unidad_ids: ['u1'], asignado_a: ME })]
    const unidades = [unidad('u1', P_SQ)]
    expect(run(rutas, { unidades })).toEqual(['sq-mine'])
  })

  it('reproduces the reported scenario: a 21B viewer only sees the 21B route', () => {
    const rutas = [
      ruta({ id: 'Contadores de Jardines Verticales', tipo_ruta: 'clientes', cliente_ids: ['assoc-21b'] }),
      ruta({ id: 'Lecturas SQ', tipo_ruta: 'unidades', unidad_ids: ['apto-5d', 'apto-5c'] }),
      ruta({ id: 'SQ Lectura Clientes', tipo_ruta: 'clientes', cliente_ids: ['sq-cl1', 'sq-cl2'] }),
    ]
    const unidades = [
      unidad('apto-5d', P_SQ),
      unidad('apto-5c', P_SQ),
      unidad('sq-home', P_SQ, 'sq-cl1'),
      unidad('sq-home2', P_SQ, 'sq-cl2'),
    ]
    // The 21B association cliente is linked to 21B through its consumption readings.
    const registros = [registro('assoc-21b', P_21B)]
    expect(run(rutas, { unidades, registros, accessible: [P_21B] })).toEqual([
      'Contadores de Jardines Verticales',
    ])
  })

  it('an admin who can see every project keeps all routes', () => {
    const rutas = [
      ruta({ id: 'a', tipo_ruta: 'unidades', unidad_ids: ['u1'] }),
      ruta({ id: 'b', tipo_ruta: 'unidades', unidad_ids: ['u2'] }),
    ]
    const unidades = [unidad('u1', P_21B), unidad('u2', P_SQ)]
    expect(run(rutas, { unidades, accessible: [P_21B, P_SQ] })).toEqual(['a', 'b'])
  })
})
