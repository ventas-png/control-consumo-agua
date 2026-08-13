import { describe, it, expect } from 'vitest'
import {
  filterContadoresByProjectAccess,
  filterRegistrosByProjectAccess,
  filterTarifasByProjectAccess,
} from '../aguaAccess'
import {
  buildClienteProjectIndex,
  filterClientesByProjectAccess,
  filterUnidadesByProjectAccess,
  type ProjectScope,
} from '../projectScope'
import type { Cliente, Contador, Registro, Tarifa, Unidad } from '../../types'

// Dos condominios de la MISMA empresa: el usuario está asignado al 21B.
const P_21B = 'proj-21b'
const P_AJENO = 'proj-ajeno'

const contador = (id: string, project_id: string): Contador => ({ id, project_id } as Contador)
const unidad = (id: string, project_id: string, cliente_id?: string): Unidad =>
  ({ id, project_id, cliente_id } as Unidad)
const tarifa = (id: string, project_id: string): Tarifa => ({ id, project_id } as Tarifa)
const cliente = (id: string): Cliente => ({ id } as Cliente)
const registro = (id: string, over: Partial<Registro> = {}): Registro =>
  ({ id, cliente_id: 'c-x', ...over } as Registro)

const scope = (over: Partial<ProjectScope> = {}): ProjectScope => ({
  accessibleProjectIds: new Set([P_21B]),
  exempt: false,
  clienteProjects: new Map(),
  ...over,
})

describe('filterContadoresByProjectAccess', () => {
  const contadores = [contador('m-propio', P_21B), contador('m-ajeno', P_AJENO)]

  it('deja solo los medidores de los proyectos accesibles', () => {
    expect(filterContadoresByProjectAccess(contadores, scope()).map(c => c.id)).toEqual(['m-propio'])
  })

  it('un rol exento ve todos los medidores de la empresa', () => {
    expect(filterContadoresByProjectAccess(contadores, scope({ exempt: true }))).toHaveLength(2)
  })
})

describe('filterTarifasByProjectAccess', () => {
  it('deja solo las tarifas de los proyectos accesibles', () => {
    const tarifas = [tarifa('t-propia', P_21B), tarifa('t-ajena', P_AJENO)]
    expect(filterTarifasByProjectAccess(tarifas, scope()).map(t => t.id)).toEqual(['t-propia'])
  })
})

describe('filterUnidadesByProjectAccess', () => {
  it('deja solo las unidades de los proyectos accesibles', () => {
    const unidades = [unidad('u-propia', P_21B), unidad('u-ajena', P_AJENO)]
    expect(filterUnidadesByProjectAccess(unidades, scope()).map(u => u.id)).toEqual(['u-propia'])
  })
})

describe('filterRegistrosByProjectAccess', () => {
  const run = (registros: Registro[], opts: { contadores?: Contador[]; scope?: ProjectScope } = {}) =>
    filterRegistrosByProjectAccess({
      registros,
      contadores: opts.contadores ?? [],
      scope: opts.scope ?? scope(),
    }).map(r => r.id)

  it('usa el project_id sellado cuando existe', () => {
    const registros = [
      registro('r-propia', { project_id: P_21B }),
      registro('r-ajena', { project_id: P_AJENO }),
    ]
    expect(run(registros)).toEqual(['r-propia'])
  })

  it('sin project_id, deriva el proyecto del contador de la lectura', () => {
    const registros = [
      registro('r-propia', { contador_id: 'm-propio' }),
      registro('r-ajena', { contador_id: 'm-ajeno' }),
    ]
    const contadores = [contador('m-propio', P_21B), contador('m-ajeno', P_AJENO)]
    expect(run(registros, { contadores })).toEqual(['r-propia'])
  })

  it('sin project_id ni contador, deriva el proyecto del cliente', () => {
    const clienteProjects = buildClienteProjectIndex({
      unidades: [unidad('u1', P_21B, 'c-propio'), unidad('u2', P_AJENO, 'c-ajeno')],
    })
    const registros = [
      registro('r-propia', { cliente_id: 'c-propio' }),
      registro('r-ajena', { cliente_id: 'c-ajeno' }),
    ]
    expect(run(registros, { scope: scope({ clienteProjects }) })).toEqual(['r-propia'])
  })

  it('lectura irresoluble (sin proyecto, sin contador y con cliente desconocido) se conserva', () => {
    expect(run([registro('r-huerfana', { cliente_id: 'c-sin-datos' })])).toEqual(['r-huerfana'])
  })

  it('el project_id sellado manda sobre el contador (no se re-deriva)', () => {
    const contadores = [contador('m-ajeno', P_AJENO)]
    const registros = [registro('r-propia', { project_id: P_21B, contador_id: 'm-ajeno' })]
    expect(run(registros, { contadores })).toEqual(['r-propia'])
  })

  it('un rol exento ve todas las lecturas de la empresa', () => {
    const registros = [
      registro('r-propia', { project_id: P_21B }),
      registro('r-ajena', { project_id: P_AJENO }),
    ]
    expect(run(registros, { scope: scope({ exempt: true }) })).toHaveLength(2)
  })
})

describe('filterClientesByProjectAccess (agua)', () => {
  it('oculta al cliente que solo opera en proyectos ajenos y conserva al no mapeable', () => {
    const clienteProjects = buildClienteProjectIndex({
      unidades: [unidad('u1', P_21B, 'c-propio'), unidad('u2', P_AJENO, 'c-ajeno')],
      registros: [registro('r1', { cliente_id: 'c-por-lectura', project_id: P_21B })],
    })
    const clientes = [cliente('c-propio'), cliente('c-ajeno'), cliente('c-por-lectura'), cliente('c-nuevo')]
    expect(filterClientesByProjectAccess(clientes, scope({ clienteProjects })).map(c => c.id))
      .toEqual(['c-propio', 'c-por-lectura', 'c-nuevo'])
  })
})
