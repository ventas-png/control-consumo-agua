// Módulos por proyecto (migración 20261127000000_modulos_por_proyecto).
//
// La empresa contrata módulos (companies.servicio_agua / servicio_condominios /
// servicio_rentas) y cada proyecto elige en cuáles de ellos opera
// (projects.modulo_*). Un módulo está activo en un proyecto cuando la empresa lo
// contrató Y el proyecto lo tiene encendido: el interruptor del proyecto sólo
// resta sobre lo contratado.
//
// Aquí vive la lógica pura; quién puede mover los interruptores y que un
// proyecto no quede vacío lo hace cumplir la base (trg_projects_modulos_guard).
import type { Cliente, Contador, Proyecto, Registro, Ruta, Tarifa, Unidad } from '../types'
import { filterClientesByProjectAccess, filterUnidadesByProjectAccess, type ProjectScope } from './projectScope'
import { filterContadoresByProjectAccess, filterRegistrosByProjectAccess, filterTarifasByProjectAccess } from './aguaAccess'

export type ModuloServicio = 'agua' | 'condominios' | 'rentas'

export const MODULOS_SERVICIO: readonly ModuloServicio[] = ['agua', 'condominios', 'rentas'] as const

export const MODULO_LABEL: Record<ModuloServicio, string> = {
  agua: 'Agua',
  condominios: 'Condominios',
  rentas: 'Rentas',
}

export const MODULO_ICONO: Record<ModuloServicio, string> = {
  agua: '💧',
  condominios: '🏢',
  rentas: '🏘️',
}

type ColumnaModulo = 'modulo_agua' | 'modulo_condominios' | 'modulo_rentas'
export const COLUMNA_MODULO: Record<ModuloServicio, ColumnaModulo> = {
  agua: 'modulo_agua',
  condominios: 'modulo_condominios',
  rentas: 'modulo_rentas',
}

/** Flags de servicio de la empresa, tal como vienen en la sesión. */
export interface ServiciosEmpresa {
  servicio_agua?: boolean
  servicio_condominios?: boolean
  servicio_rentas?: boolean
}

/**
 * Módulos que la empresa tiene contratados. Misma lectura que el resto de la
 * app: Agua y Condominios se dan por contratados salvo `false` explícito
 * (sesiones sin el flag resuelto); Rentas sólo con `true` (nace apagado).
 */
export function modulosContratados(empresa: ServiciosEmpresa | null | undefined): ModuloServicio[] {
  if (!empresa) return []
  const out: ModuloServicio[] = []
  if (empresa.servicio_agua !== false) out.push('agua')
  if (empresa.servicio_condominios !== false) out.push('condominios')
  if (empresa.servicio_rentas === true) out.push('rentas')
  return out
}

/**
 * ¿El proyecto tiene encendido este módulo? Sólo `false` lo apaga: un proyecto
 * leído antes de que exista la columna (el front se publica antes que la
 * migración) se comporta como hasta ahora, con todo encendido.
 */
export function proyectoTieneModulo(proyecto: Pick<Proyecto, ColumnaModulo>, modulo: ModuloServicio): boolean {
  return proyecto[COLUMNA_MODULO[modulo]] !== false
}

/** Proyectos que operan en un módulo. Devuelve la MISMA lista si ninguno lo apagó. */
export function proyectosConModulo<P extends Pick<Proyecto, ColumnaModulo>>(proyectos: P[], modulo: ModuloServicio): P[] {
  return proyectos.every(p => proyectoTieneModulo(p, modulo))
    ? proyectos
    : proyectos.filter(p => proyectoTieneModulo(p, modulo))
}

/** Módulos activos de un proyecto: los contratados por la empresa que el proyecto no apagó. */
export function modulosActivosDeProyecto(
  proyecto: Pick<Proyecto, ColumnaModulo>,
  contratados: readonly ModuloServicio[],
): ModuloServicio[] {
  return contratados.filter(m => proyectoTieneModulo(proyecto, m))
}

/**
 * Valida la selección de módulos de un proyecto antes de guardarla. Devuelve el
 * mensaje de error o `null`. La base repite la regla (MODULOS_PROYECTO_VACIO).
 */
export function validarSeleccionModulos(
  seleccion: Record<ModuloServicio, boolean>,
  contratados: readonly ModuloServicio[],
): string | null {
  return contratados.some(m => seleccion[m])
    ? null
    : 'El proyecto debe conservar al menos un módulo activo.'
}

/**
 * ¿El menú de un módulo debe ocultarse porque NINGUNO de los proyectos que la
 * persona ve opera en él? Sólo decide con la lista ya cargada y no vacía: sin
 * proyectos (empresa nueva, o alguien sin asignación) manda el resto de la app.
 * Rentas no pasa por aquí: tiene propiedades independientes, que no cuelgan de
 * ningún proyecto.
 */
export function moduloSinProyectos(proyectos: Pick<Proyecto, ColumnaModulo>[], modulo: 'agua' | 'condominios'): boolean {
  return proyectos.length > 0 && proyectos.every(p => !proyectoTieneModulo(p, modulo))
}

/** Colecciones de Manejo Agua que llevan (o resuelven) un proyecto. */
export interface ColeccionesAgua {
  proyectos: Proyecto[]
  unidades: Unidad[]
  contadores: Contador[]
  registros: Registro[]
  tarifas: Tarifa[]
  rutas: Ruta[]
  clientes: Cliente[]
  projectScope: ProjectScope
}

/**
 * Acota las colecciones de Manejo Agua a los proyectos que operan en Agua, con
 * los mismos filtros (y las mismas reglas de ambigüedad) que el alcance por
 * proyecto. Si todos los proyectos visibles tienen Agua devuelve `datos` tal
 * cual: para la empresa que no usa los interruptores no cambia nada.
 *
 * Las rutas sin proyecto sellado se conservan (son anteriores al sellado y no
 * se puede afirmar a qué proyecto pertenecen).
 */
export function acotarAguaAlModulo<T extends ColeccionesAgua>(datos: T): T {
  const proyectos = proyectosConModulo(datos.proyectos, 'agua')
  if (proyectos === datos.proyectos) return datos
  const conAgua = new Set(proyectos.map(p => p.id))
  const scope: ProjectScope = {
    accessibleProjectIds: conAgua,
    exempt: false,
    clienteProjects: datos.projectScope.clienteProjects,
  }
  return {
    ...datos,
    proyectos,
    unidades: filterUnidadesByProjectAccess(datos.unidades, scope),
    contadores: filterContadoresByProjectAccess(datos.contadores, scope),
    // Los contadores sin acotar resuelven el proyecto de las lecturas sin sellar.
    registros: filterRegistrosByProjectAccess({ registros: datos.registros, contadores: datos.contadores, scope }),
    tarifas: filterTarifasByProjectAccess(datos.tarifas, scope),
    rutas: datos.rutas.filter(r => !r.project_id || conAgua.has(r.project_id)),
    clientes: filterClientesByProjectAccess(datos.clientes, scope),
  }
}
