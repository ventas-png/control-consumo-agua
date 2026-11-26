// lib/portalServicios.ts — Qué portal (Agua, Condominios o los dos) ve un
// residente y qué unidades entran en cada uno. Módulo puro: la regla se prueba
// sin montar los portales ni la sesión.
//
// La fuente es portal_mis_unidades() (20261127000000): una fila por unidad con
// `servicio_agua` y `servicio_condominios` ya cruzados — la empresa lo contrató
// (companies.servicio_*) Y el proyecto de la unidad lo tiene encendido
// (projects.modulo_*). Siempre trae los dos flags como booleanos.
//
// Antes la sesión sólo ponía `true` cuando alguna unidad tenía el servicio y lo
// dejaba `undefined` en los demás casos; App leía `servicio_agua !== false`, así
// que un residente de un condominio sin Agua (o de una empresa que no la
// contrata) seguía viendo el botón «Agua» y entraba a un portal vacío.

export type ServicioPortal = 'agua' | 'condominios'

export interface ServiciosResidente {
  servicio_agua: boolean
  servicio_condominios: boolean
}

type FilaServicios = { servicio_agua?: unknown; servicio_condominios?: unknown }

function filasDe(raw: unknown): FilaServicios[] | null {
  if (!Array.isArray(raw)) return null
  return raw.filter((x): x is FilaServicios => typeof x === 'object' && x !== null)
}

/**
 * Servicios del residente según sus unidades: un servicio está activo si al
 * menos una unidad lo tiene. Devuelve `null` si la lectura no llegó (error o
 * dato que no es una lista): la sesión no inventa flags y el portal conserva su
 * comportamiento de respaldo.
 */
export function serviciosDelResidente(raw: unknown): ServiciosResidente | null {
  const filas = filasDe(raw)
  if (!filas) return null
  return {
    servicio_agua: filas.some(u => u.servicio_agua === true),
    servicio_condominios: filas.some(u => u.servicio_condominios === true),
  }
}

/**
 * Portal al que entra un cliente según sus flags de servicio.
 *   · los dos activos            → 'dual' (selector Condominios / Agua)
 *   · sólo Condominios           → 'condominios'
 *   · cualquier otro caso        → 'agua'
 * Agua es el respaldo histórico: sin flags (lectura fallida) o sin ningún
 * servicio activo (sin unidades) se entra al portal de Agua, como antes. Lo que
 * cambia es que un `false` explícito de Agua ya no se lee como «tiene Agua».
 */
export function portalDelCliente(flags: { servicio_agua?: boolean; servicio_condominios?: boolean }): 'dual' | 'condominios' | 'agua' {
  const condominios = flags.servicio_condominios === true
  const agua = flags.servicio_agua !== false
  if (condominios && agua) return 'dual'
  if (condominios) return 'condominios'
  return 'agua'
}

/**
 * ¿La unidad entra al portal de este servicio? Sólo un `false` explícito la
 * saca: una fila sin el flag (dato viejo o degradado) se queda, para que el
 * portal nunca pierda unidades por un dato que no entiende.
 */
export function unidadConServicio(unidad: object, servicio: ServicioPortal): boolean {
  const flag = (unidad as FilaServicios)[servicio === 'agua' ? 'servicio_agua' : 'servicio_condominios']
  return flag !== false
}

/**
 * Proyectos de las unidades del residente en los que el servicio está apagado
 * (lo apagó el proyecto o la empresa no lo contrata). `null` si la lectura no
 * llegó: quien lo use no filtra nada.
 *
 * Un proyecto cuenta como apagado sólo si NINGUNA de sus unidades trae el
 * servicio (el flag es del proyecto y de la empresa, así que en la práctica
 * todas coinciden).
 */
export function proyectosSinServicio(raw: unknown, servicio: ServicioPortal): Set<string> | null {
  const filas = filasDe(raw)
  if (!filas) return null
  const apagados = new Set<string>()
  const encendidos = new Set<string>()
  for (const u of filas) {
    const pid = (u as { project_id?: unknown }).project_id
    if (typeof pid !== 'string' || !pid) continue
    if (unidadConServicio(u, servicio)) encendidos.add(pid)
    else apagados.add(pid)
  }
  for (const pid of encendidos) apagados.delete(pid)
  return apagados
}
