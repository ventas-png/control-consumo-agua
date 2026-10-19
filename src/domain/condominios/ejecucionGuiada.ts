// Ejecución guiada de un turno, sin React: qué hay que preparar antes de
// iniciarlo, en qué paradas (áreas) se recorre y cuál es la siguiente tarea.
//
// La pantalla de «Tareas por turno» mostraba las 19 tareas de golpe, cada una
// con su panel de evidencia. Para quien ejecuta, eso es una lista para leer, no
// un recorrido para seguir. Estas funciones son la parte decidible de pasar a
// una tarjeta por vez: lo que se arma antes (herramientas, insumos,
// indicaciones, cámara), el agrupamiento por parada y a dónde se avanza.
import type {
  AreaCondominio, EstadoTareaBloque, PlantillaTareaHerramienta, TareaBloque, TareaBloqueSuministro,
} from '../../types'

/** Una tarea ya no se ejecuta: se cerró (bien o con observación) o se omitió. */
export const tareaResuelta = (estado: EstadoTareaBloque) => estado !== 'pendiente'

/**
 * Una parada del recorrido: tareas CONSECUTIVAS de la misma área. Es la forma
 * en que las rutinas materializan su recorrido (área por área, en orden), y la
 * que tiene sentido caminando: si el turno vuelve más tarde a un área ya
 * visitada, es otra parada, no la misma.
 */
export interface ParadaGuiada {
  clave: string
  area_id: string | null
  nombre: string
  icono: string
  tareas: TareaBloque[]
  /** Suma de lo que declaran las tareas; las que no declaran van en `sinDuracion`. */
  minutos: number
  sinDuracion: number
}

export function paradasDelTurno(tareas: TareaBloque[], areas: AreaCondominio[]): ParadaGuiada[] {
  const ordenadas = [...tareas].sort((a, b) => a.orden - b.orden)
  const paradas: ParadaGuiada[] = []
  for (const t of ordenadas) {
    const area = t.area_id ? areas.find(a => a.id === t.area_id) : undefined
    const ultima = paradas[paradas.length - 1]
    if (ultima && ultima.area_id === (t.area_id ?? null)) {
      ultima.tareas.push(t)
    } else {
      paradas.push({
        clave: `${paradas.length}:${t.area_id ?? '—'}`,
        area_id: t.area_id ?? null,
        nombre: t.area_nombre ?? area?.nombre ?? (t.area_id ? 'Área' : 'Sin área asignada'),
        icono: t.area_icono ?? area?.icono ?? '📍',
        tareas: [t],
        minutos: 0,
        sinDuracion: 0,
      })
    }
    const p = paradas[paradas.length - 1]
    if (t.duracion_estimada_min != null) p.minutos += t.duracion_estimada_min
    else p.sinDuracion += 1
  }
  return paradas
}

/** La parada en la que cae una tarea. */
export function paradaDe(paradas: ParadaGuiada[], tareaId: string): ParadaGuiada | undefined {
  return paradas.find(p => p.tareas.some(t => t.id === tareaId))
}

/**
 * A dónde se avanza desde `desdeId`: la próxima pendiente DETRÁS de ella en el
 * orden del recorrido y, si no queda ninguna detrás, la primera pendiente que
 * se haya dejado atrás. `null` = no queda nada por hacer.
 */
export function siguientePendiente(tareas: TareaBloque[], desdeId: string | null): string | null {
  const ordenadas = [...tareas].sort((a, b) => a.orden - b.orden)
  const i = desdeId ? ordenadas.findIndex(t => t.id === desdeId) : -1
  const despues = ordenadas.slice(i + 1).find(t => !tareaResuelta(t.estado))
  if (despues) return despues.id
  const antes = ordenadas.slice(0, Math.max(i, 0)).find(t => !tareaResuelta(t.estado))
  return antes?.id ?? null
}

// ── Preparación ─────────────────────────────────────────────────────────────

export interface HerramientaAPreparar {
  inventario_id: string
  nombre: string
  /** La mayor cantidad que pide UNA tarea: la escoba se reusa, no se suma. */
  cantidad: number
  obligatoria: boolean
  tareas: string[]
}

export interface InsumoAPreparar {
  suministro_id: string
  nombre: string
  /** Lo que se gasta: SÍ se suma entre tareas. */
  cantidad: number
  unidad: string
  tareas: string[]
}

export interface IndicacionAPreparar {
  texto: string
  tareas: string[]
}

export interface PreparacionTurno {
  herramientas: HerramientaAPreparar[]
  insumos: InsumoAPreparar[]
  indicaciones: IndicacionAPreparar[]
  /** Tareas pendientes que exigen foto: hace falta un teléfono con cámara y batería. */
  conFoto: number
  paradas: ParadaGuiada[]
  minutos: number
  sinDuracion: number
  pendientes: number
}

/**
 * Lo que hay que tener a mano antes de iniciar, sacado de las tareas
 * PENDIENTES del turno:
 *   · herramientas y equipo: los de la plantilla de cada tarea
 *     (`plantilla_tarea_herramientas`), por la mayor cantidad pedida;
 *   · insumos: el plan congelado de cada tarea (`tareas_bloque_suministros`)
 *     que aún no se consumió ni se declaró no usado, sumado;
 *   · indicaciones de seguridad: las de cada tarea, sin repetir.
 */
export function preparacionDelTurno(
  tareas: TareaBloque[],
  insumos: TareaBloqueSuministro[],
  herramientas: PlantillaTareaHerramienta[],
  areas: AreaCondominio[],
): PreparacionTurno {
  const pendientes = [...tareas].filter(t => !tareaResuelta(t.estado)).sort((a, b) => a.orden - b.orden)

  const porHerramienta = new Map<string, HerramientaAPreparar>()
  for (const t of pendientes) {
    if (!t.plantilla_id) continue
    for (const h of herramientas.filter(x => x.plantilla_tarea_id === t.plantilla_id)) {
      const actual = porHerramienta.get(h.inventario_id)
      if (actual) {
        actual.cantidad = Math.max(actual.cantidad, h.cantidad)
        actual.obligatoria = actual.obligatoria || h.obligatoria
        if (!actual.tareas.includes(t.titulo)) actual.tareas.push(t.titulo)
      } else {
        porHerramienta.set(h.inventario_id, {
          inventario_id: h.inventario_id,
          nombre: h.inventario_nombre ?? 'Herramienta',
          cantidad: h.cantidad,
          obligatoria: h.obligatoria,
          tareas: [t.titulo],
        })
      }
    }
  }

  const porInsumo = new Map<string, InsumoAPreparar>()
  for (const t of pendientes) {
    for (const i of insumos.filter(x => x.tarea_id === t.id && !x.movimiento_id && !x.no_usado_en)) {
      const actual = porInsumo.get(i.suministro_id)
      if (actual) {
        actual.cantidad = Math.round((actual.cantidad + i.cantidad_planificada) * 1000) / 1000
        if (!actual.tareas.includes(t.titulo)) actual.tareas.push(t.titulo)
      } else {
        porInsumo.set(i.suministro_id, {
          suministro_id: i.suministro_id,
          nombre: i.nombre_suministro,
          cantidad: i.cantidad_planificada,
          unidad: i.unidad_medida,
          tareas: [t.titulo],
        })
      }
    }
  }

  const porIndicacion = new Map<string, IndicacionAPreparar>()
  for (const t of pendientes) {
    const texto = (t.instrucciones_seguridad ?? '').trim()
    if (!texto) continue
    const actual = porIndicacion.get(texto)
    if (actual) { if (!actual.tareas.includes(t.titulo)) actual.tareas.push(t.titulo) }
    else porIndicacion.set(texto, { texto, tareas: [t.titulo] })
  }

  const paradas = paradasDelTurno(pendientes, areas)
  const porNombre = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre)
  return {
    // Lo obligatorio primero: es lo que no puede faltar.
    herramientas: [...porHerramienta.values()].sort((a, b) => Number(b.obligatoria) - Number(a.obligatoria) || porNombre(a, b)),
    insumos: [...porInsumo.values()].sort(porNombre),
    indicaciones: [...porIndicacion.values()],
    conFoto: pendientes.filter(t => t.requiere_foto).length,
    paradas,
    minutos: paradas.reduce((s, p) => s + p.minutos, 0),
    sinDuracion: paradas.reduce((s, p) => s + p.sinDuracion, 0),
    pendientes: pendientes.length,
  }
}

/**
 * Lo que la persona confirma tener, uno por uno, antes de iniciar. El recorrido
 * se muestra pero no se «confirma»: es información, no algo que se lleva.
 */
export function itemsPorConfirmar(p: PreparacionTurno): string[] {
  return [
    ...p.herramientas.map(h => `herramienta:${h.inventario_id}`),
    ...p.insumos.map(i => `insumo:${i.suministro_id}`),
    ...p.indicaciones.map((_, n) => `indicacion:${n}`),
    ...(p.conFoto > 0 ? ['camara'] : []),
  ]
}

/** «1 h 25 min», «40 min». */
export function duracionLegible(minutos: number): string {
  if (minutos < 60) return `${minutos} min`
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}
