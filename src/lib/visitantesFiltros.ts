// Lógica pura de la bitácora de visitantes (P1 #3, refactor de VisitantesTab):
// rangos de fecha, KPIs, sugerencias con dedup, filtrado y agrupación por
// reserva STR / autorización de mudanza. Antes vivía inline en el componente
// de ~1.5k líneas sin ningún test.
import type { ReservaSTR, SolicitudMudanzaUnidad, Visitante } from '../types'

export type FiltroFechaVisitas = 'hoy' | 'semana' | 'mes' | 'todos'

export interface RangosFecha {
  hoy: string
  inicioSemana: string
  inicioMes: string
}

/** 'YYYY-MM-DD' de hoy, del lunes de esta semana y del día 1 del mes. */
export function rangosDeFecha(ahora: Date = new Date()): RangosFecha {
  const hoy = ahora.toISOString().slice(0, 10)
  const d = new Date(ahora)
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay()
  d.setDate(d.getDate() + diff)
  return {
    hoy,
    inicioSemana: d.toISOString().slice(0, 10),
    inicioMes: hoy.slice(0, 7) + '-01',
  }
}

export interface KpisVisitantes {
  visitasHoy: number
  enPremisas: number
  estaSemana: number
  totalHistorico: number
}

/** KPIs del header — los acompañantes no cuentan dos veces. */
export function kpisVisitantes(visitantes: Visitante[], rangos: RangosFecha): KpisVisitantes {
  const principales = visitantes.filter(v => !v.visitante_principal_id)
  return {
    visitasHoy: principales.filter(v => v.hora_entrada.startsWith(rangos.hoy)).length,
    enPremisas: visitantes.filter(v => !v.hora_salida).length,
    estaSemana: principales.filter(v => v.hora_entrada.slice(0, 10) >= rangos.inicioSemana).length,
    totalHistorico: principales.length,
  }
}

/**
 * Sugerencias de autocompletado: visitantes principales previos cuyo nombre o
 * identificación coincide (mínimo 3 caracteres), más recientes primero,
 * deduplicados por (nombre, identificación) y limitados a 5. `excluirNombres`
 * omite a quienes ya están en la lista de acompañantes.
 */
export function sugerenciasVisitantes(
  visitantes: Visitante[],
  nombre: string,
  identificacion: string,
  excluirNombres: string[] = [],
): Visitante[] {
  if (nombre.length < 3 && identificacion.length < 3) return []
  return [...visitantes]
    .filter(v => !v.visitante_principal_id)
    .sort((a, b) => b.hora_entrada.localeCompare(a.hora_entrada))
    .filter(v =>
      (nombre.length >= 3 && v.nombre.toLowerCase().includes(nombre.toLowerCase())) ||
      (identificacion.length >= 3 && (v.identificacion ?? '').includes(identificacion))
    )
    .reduce<Visitante[]>((acc, v) => {
      if (!acc.some(a => a.nombre === v.nombre && a.identificacion === v.identificacion)) acc.push(v)
      return acc
    }, [])
    .filter(v => !excluirNombres.includes(v.nombre))
    .slice(0, 5)
}

export interface FiltrosVisitantes {
  busqueda: string
  soloActivos: boolean
  filtroFecha: FiltroFechaVisitas
  rangos: RangosFecha
}

/** Filtro combinado de la lista: búsqueda + en premisas + periodo. */
export function filtrarVisitantes(visitantes: Visitante[], f: FiltrosVisitantes): Visitante[] {
  return visitantes.filter(v => {
    const matchBusqueda = !f.busqueda
      || v.nombre.toLowerCase().includes(f.busqueda.toLowerCase())
      || (v.identificacion ?? '').includes(f.busqueda)
    const matchActivo = !f.soloActivos || !v.hora_salida
    const fecha = v.hora_entrada.slice(0, 10)
    const matchFecha = f.filtroFecha === 'todos' ? true
      : f.filtroFecha === 'hoy' ? fecha === f.rangos.hoy
      : f.filtroFecha === 'semana' ? fecha >= f.rangos.inicioSemana
      : fecha >= f.rangos.inicioMes
    return matchBusqueda && matchActivo && matchFecha
  })
}

export interface GruposVisitantes {
  strGruposMap: Map<string, { reserva: ReservaSTR; miembros: Visitante[] }>
  mudanzaGruposMap: Map<string, { solicitud: SolicitudMudanzaUnidad; miembros: Visitante[] }>
  regulares: Visitante[]
}

/**
 * Agrupa los visitantes filtrados bajo su reserva STR o su autorización de
 * mudanza; los que no pertenecen a ninguna (o cuya referencia ya no existe)
 * quedan como regulares.
 */
export function agruparVisitantes(
  filtrados: Visitante[],
  reservasSTR: ReservaSTR[],
  solicitudesMudanza: SolicitudMudanzaUnidad[],
): GruposVisitantes {
  const strGruposMap = new Map<string, { reserva: ReservaSTR; miembros: Visitante[] }>()
  const mudanzaGruposMap = new Map<string, { solicitud: SolicitudMudanzaUnidad; miembros: Visitante[] }>()
  const regulares: Visitante[] = []
  for (const v of filtrados) {
    if (v.reserva_str_id) {
      const reserva = reservasSTR.find(r => r.id === v.reserva_str_id)
      if (reserva) {
        if (!strGruposMap.has(v.reserva_str_id)) strGruposMap.set(v.reserva_str_id, { reserva, miembros: [] })
        strGruposMap.get(v.reserva_str_id)!.miembros.push(v)
      } else {
        regulares.push(v)
      }
    } else if (v.solicitud_mudanza_id) {
      const solicitud = solicitudesMudanza.find(s => s.id === v.solicitud_mudanza_id)
      if (solicitud) {
        if (!mudanzaGruposMap.has(v.solicitud_mudanza_id)) mudanzaGruposMap.set(v.solicitud_mudanza_id, { solicitud, miembros: [] })
        mudanzaGruposMap.get(v.solicitud_mudanza_id)!.miembros.push(v)
      } else {
        regulares.push(v)
      }
    } else {
      regulares.push(v)
    }
  }
  return { strGruposMap, mudanzaGruposMap, regulares }
}
