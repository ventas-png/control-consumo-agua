// domain/condominios/rrhhCatalogos.ts — reglas puras de los catálogos de
// cargos y tipos de turno POR CONDOMINIO (rrhh_cargos / rrhh_tipos_turno,
// 20261031000300).
//
// El código (`codigo`) es la clave que guardan personal_condominio.cargo/turno,
// plantillas_tarea_cargo.cargo, programacion_limpieza.cargo/turno y
// ejecuciones_limpieza.turno. Las pantallas NO tienen mapas literales de
// etiquetas: resuelven contra el catálogo que les llega por props y, si el
// código no está (fila histórica, o un entorno sin la migración), caen a los
// valores de siempre y por último al código crudo.
import type { CatalogoRrhhItem } from '../../types'
import { normalizarNombreArea } from './areas'

export const TABLA_CARGOS = 'rrhh_cargos'
export const TABLA_TURNOS = 'rrhh_tipos_turno'

/** Espejo del CHECK `rrhh_cargos_codigo_check` / `rrhh_turnos_codigo_check`. */
export const RE_CODIGO_CATALOGO = /^[a-z0-9][a-z0-9_]{0,39}$/
export const NOMBRE_MIN = 2
export const NOMBRE_MAX = 60

export interface DefaultCatalogo { codigo: string; nombre: string; icono: string; orden: number }

/** Los seis de siempre, en el orden y con los íconos que siembra la migración. */
export const CARGOS_DEFAULT: readonly DefaultCatalogo[] = [
  { codigo: 'conserje',      nombre: 'Conserje',      icono: '🧹', orden: 10 },
  { codigo: 'guardia',       nombre: 'Guardia',       icono: '💂', orden: 20 },
  { codigo: 'jardinero',     nombre: 'Jardinero',     icono: '🌿', orden: 30 },
  { codigo: 'mantenimiento', nombre: 'Mantenimiento', icono: '🔧', orden: 40 },
  { codigo: 'administrador', nombre: 'Administrador', icono: '👔', orden: 50 },
  { codigo: 'otro',          nombre: 'Otro',          icono: '👤', orden: 60 },
]
/** Los tres turnos del expediente de siempre. */
export const TURNOS_DEFAULT: readonly DefaultCatalogo[] = [
  { codigo: 'diurno',   nombre: 'Diurno',   icono: '☀️', orden: 10 },
  { codigo: 'nocturno', nombre: 'Nocturno', icono: '🌙', orden: 20 },
  { codigo: 'rotativo', nombre: 'Rotativo', icono: '🔄', orden: 30 },
]

export const ICONOS_CARGO = ['🧹', '💂', '🌿', '🔧', '👔', '👤', '🏊', '🚗', '🛗', '⚡', '💧', '🔐', '📋', '🛠', '🧑‍🍳', '🧑‍⚕️', '📦', '🎓']
export const ICONOS_TURNO = ['☀️', '🌙', '🔄', '🌅', '🌇', '🕐', '📅', '🏖️']

const ACENTOS = 'áàäâãéèëêíìïîóòöôõúùüûñç'
const PLANOS = 'aaaaaeeeeiiiiooooouuuunc'

/** Normaliza un código para comparar: minúsculas y sin espacios (como `lower(btrim())`). */
export function normalizarCodigo(codigo: string | null | undefined): string {
  return (codigo ?? '').trim().toLowerCase()
}

/**
 * Código propuesto a partir del nombre de pantalla: «Supervisor de piscina» →
 * `supervisor_de_piscina`. Sin acentos, sólo [a-z0-9_], hasta 40 caracteres,
 * nunca empieza por guion bajo. Es una propuesta: quien crea puede cambiarla.
 */
export function slugDesdeNombre(nombre: string): string {
  let s = (nombre ?? '').trim().toLowerCase()
  for (let i = 0; i < ACENTOS.length; i++) s = s.split(ACENTOS[i]).join(PLANOS[i])
  s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_')
  return s.slice(0, 40).replace(/_+$/g, '')
}

/** Orden de catálogo: `orden` y luego nombre. */
export function ordenarCatalogo<T extends CatalogoRrhhItem>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
}

/** Sólo los activos, ordenados. */
export function activos<T extends CatalogoRrhhItem>(items: readonly T[]): T[] {
  return ordenarCatalogo(items.filter(i => i.activo))
}

function buscar<T extends CatalogoRrhhItem>(items: readonly T[], codigo: string | null | undefined): T | undefined {
  const c = normalizarCodigo(codigo)
  if (!c) return undefined
  return items.find(i => i.codigo === c)
}

function etiqueta(codigo: string | null | undefined, items: readonly CatalogoRrhhItem[], defaults: readonly DefaultCatalogo[]): string {
  const item = buscar(items, codigo)
  if (item) return item.nombre
  const c = normalizarCodigo(codigo)
  return defaults.find(d => d.codigo === c)?.nombre ?? (codigo ?? '')
}
function icono(codigo: string | null | undefined, items: readonly CatalogoRrhhItem[], defaults: readonly DefaultCatalogo[], fallback: string): string {
  const item = buscar(items, codigo)
  if (item) return item.icono
  const c = normalizarCodigo(codigo)
  return defaults.find(d => d.codigo === c)?.icono ?? fallback
}

/** Nombre de pantalla de un cargo: catálogo → valor de siempre → código crudo. */
export function etiquetaCargo(codigo: string | null | undefined, cargos: readonly CatalogoRrhhItem[] = []): string {
  return etiqueta(codigo, cargos, CARGOS_DEFAULT)
}
export function iconoCargo(codigo: string | null | undefined, cargos: readonly CatalogoRrhhItem[] = []): string {
  return icono(codigo, cargos, CARGOS_DEFAULT, '👤')
}
/** Nombre de pantalla de un tipo de turno: catálogo → valor de siempre → código crudo. */
export function etiquetaTurno(codigo: string | null | undefined, turnos: readonly CatalogoRrhhItem[] = []): string {
  return etiqueta(codigo, turnos, TURNOS_DEFAULT)
}
export function iconoTurno(codigo: string | null | undefined, turnos: readonly CatalogoRrhhItem[] = []): string {
  return icono(codigo, turnos, TURNOS_DEFAULT, '🕐')
}

export interface OpcionCatalogo {
  value: string
  /** Texto del <option>: «🧹 Conserje», «🌿 Jardinero (inactivo)», «Polivalente (histórico)». */
  label: string
  icono: string
  inactivo: boolean
  historico: boolean
}

/**
 * Opciones de un <select>: los ACTIVOS del catálogo (en su orden) y, si el valor
 * actual no está entre ellos, ese valor al final marcado «(inactivo)» (está en el
 * catálogo pero apagado) o «(histórico)» (no está en el catálogo: fila legada).
 * Así una ficha con un cargo apagado se sigue pudiendo editar sin que el select
 * la cambie a escondidas, y lo que ya no se ofrece queda a la vista.
 *
 * Sin catálogo (entorno sin la migración), ofrece los valores de siempre.
 */
export function opcionesSelect(
  items: readonly CatalogoRrhhItem[],
  valorActual?: string | null,
  defaults: readonly DefaultCatalogo[] = CARGOS_DEFAULT,
): OpcionCatalogo[] {
  const base: OpcionCatalogo[] = items.length > 0
    ? activos(items).map(i => ({ value: i.codigo, label: `${i.icono} ${i.nombre}`, icono: i.icono, inactivo: false, historico: false }))
    : defaults.map(d => ({ value: d.codigo, label: `${d.icono} ${d.nombre}`, icono: d.icono, inactivo: false, historico: false }))
  const actual = (valorActual ?? '').trim()
  if (!actual || base.some(o => o.value === actual)) return base
  const enCatalogo = buscar(items, actual)
  if (enCatalogo) {
    return [...base, { value: actual, label: `${enCatalogo.icono} ${enCatalogo.nombre} (inactivo)`, icono: enCatalogo.icono, inactivo: true, historico: false }]
  }
  const def = defaults.find(d => d.codigo === normalizarCodigo(actual))
  return [...base, {
    value: actual, label: `${def ? def.nombre : actual} (histórico)`, icono: def?.icono ?? '', inactivo: false, historico: true,
  }]
}

/** Primer código activo del catálogo (valor inicial de un alta); sin catálogo, el primero de siempre. */
export function primerActivo(items: readonly CatalogoRrhhItem[], defaults: readonly DefaultCatalogo[] = CARGOS_DEFAULT): string {
  return activos(items)[0]?.codigo ?? defaults[0].codigo
}

/**
 * Valida en pantalla lo que la BD va a exigir (forma del código, largo del
 * nombre, código y nombre únicos en el condominio). Devuelve el mensaje del
 * primer problema, o null. `excluirId` permite renombrar sin chocar consigo.
 */
export function validarEntradaCatalogo(
  entrada: { codigo: string; nombre: string; orden?: number },
  items: readonly CatalogoRrhhItem[],
  excluirId?: string,
): string | null {
  const codigo = normalizarCodigo(entrada.codigo)
  const nombre = (entrada.nombre ?? '').trim()
  if (nombre.length < NOMBRE_MIN || nombre.length > NOMBRE_MAX) {
    return `El nombre debe tener entre ${NOMBRE_MIN} y ${NOMBRE_MAX} caracteres.`
  }
  if (!RE_CODIGO_CATALOGO.test(codigo)) {
    return 'El código sólo admite minúsculas, números y guion bajo (hasta 40 caracteres) y debe empezar por una letra o número.'
  }
  if (entrada.orden != null && (!Number.isInteger(entrada.orden) || entrada.orden < 0)) {
    return 'El orden debe ser un entero mayor o igual a 0.'
  }
  const otroCodigo = items.find(i => i.id !== excluirId && i.codigo === codigo)
  if (otroCodigo) return `Ya existe el código «${codigo}» (${otroCodigo.nombre}${otroCodigo.activo ? '' : ', inactivo'}). Reactívalo o elige otro.`
  const norm = normalizarNombreArea(nombre)
  const otroNombre = items.find(i => i.id !== excluirId && normalizarNombreArea(i.nombre) === norm)
  if (otroNombre) return `Ya existe «${otroNombre.nombre}»${otroNombre.activo ? '' : ' (inactivo)'} en este condominio. Edítalo o reactívalo en lugar de crearlo de nuevo.`
  return null
}

/**
 * Traduce el error de supabase a lo que pasó. Los SQLSTATE y prefijos los fija
 * la migración: 23505 duplicado, 23503 en uso (RRHH_*_EN_USO), 23514 forma o
 * código inmutable (RRHH_CATALOGO_INMUTABLE) o valor fuera del catálogo
 * (RRHH_CARGO: / RRHH_TURNO: / PLANTILLAS_CARGO:), 42501 sin permiso.
 */
export function mensajeErrorCatalogo(
  error: { message: string; code?: string },
  tipo: 'cargo' | 'turno' = 'cargo',
): string {
  const msg = error.message ?? ''
  const que = tipo === 'cargo' ? 'cargo' : 'tipo de turno'
  const prefijo = msg.match(/(?:RRHH_(?:CARGO|TURNO)(?:_EN_USO)?|RRHH_CATALOGO_INMUTABLE|PLANTILLAS_CARGO):\s*(.+)$/)
  if (/RRHH_CATALOGO_INMUTABLE/.test(msg)) {
    return 'El código y el condominio de un cargo o turno no se cambian: crea otro y desactiva este.'
  }
  if (error.code === '23503' || /_EN_USO/.test(msg)) {
    return prefijo ? `Está en uso: ${prefijo[1]}` : `Este ${que} está en uso: desactívalo en vez de borrarlo.`
  }
  if (error.code === '23505') {
    return `Ya existe un ${que} con ese código o nombre en este condominio.`
  }
  if (prefijo) return prefijo[1]
  if (error.code === '23514') {
    return 'Revisa el código (minúsculas, números y guion bajo) y el nombre (2–60 caracteres).'
  }
  if (error.code === '42501') {
    return `No tienes permiso para cambiar los ${tipo === 'cargo' ? 'cargos' : 'tipos de turno'} de este condominio.`
  }
  return msg
}
