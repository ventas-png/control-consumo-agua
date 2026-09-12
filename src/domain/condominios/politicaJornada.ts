// domain/condominios/politicaJornada.ts — La vara de la jornada (fase 1).
//
// QUÉ ES. Lo que cada jornada ESPERA, más allá de las horas: cuánto descanso da
// por tipo, cuánta demora tolera, desde cuándo irse antes cuenta como salida
// temprana, y si la hora extra necesita autorización previa.
//
// LO QUE TODAVÍA NO HACE. Nada. La fase 1 solo DECLARA. Ninguna función de
// cómputo lee esto: `calcular_horas_personal` devuelve exactamente los mismos
// números que devolvía antes. Medir contra la vara es la fase 2, y aplicarla la
// fase 4 — en ese orden, porque antes de que un número cambie lo que se paga hay
// que poder mirar un mes real de comparaciones.
//
// LOS TRES TRAMOS DE LA DEMORA, y por qué el primero no es nuevo:
//
//   [0, tolerancia]              no pasa nada   ← `tolerancia_entrada_min`, la
//                                                 MISMA que ya decide la tardanza
//   (tolerancia, compensable]    se compensa
//   (compensable, ∞)             se debita
//
// Un segundo umbral de «gracia» habría dejado dos varas para lo mismo y, tarde o
// temprano, divergiendo. La base rechaza declararlos al revés.
import { supabase } from '../../lib/supabase'
import { reportDegradedQuery } from '../queryFetch'
import type { CupoPausa, TipoPausa } from '../../types'

/** Los tres tramos, en palabras, para que el formulario diga lo que declara. */
export interface TramosDemora {
  sinConsecuencia: string
  compensable: string | null
  debitada: string
}

/**
 * Cómo se leerá una demora con estos dos umbrales.
 *
 * Existe para que quien configura la jornada vea la política en la frase que va
 * a regir, no en dos números sueltos: «hasta 10 min no pasa nada» se entiende;
 * `tolerancia_entrada_min = 10` hay que traducirlo mentalmente cada vez.
 */
export function tramosDemora(toleranciaMin: number, compensableHastaMin: number): TramosDemora {
  const tol = Math.max(0, Math.trunc(toleranciaMin) || 0)
  const comp = Math.max(0, Math.trunc(compensableHastaMin) || 0)
  const hayTramo = comp > tol
  return {
    sinConsecuencia: tol > 0
      ? `Hasta ${tol} min tarde: no pasa nada`
      : 'Cualquier minuto tarde ya cuenta',
    compensable: hayTramo ? `De ${tol} a ${comp} min: se compensa` : null,
    debitada: hayTramo
      ? `Más de ${comp} min: se debita`
      : `Más de ${tol} min: se debita`,
  }
}

/** Cupos de un puñado de jornadas, para pintarlas todas sin una consulta por fila. */
export async function fetchCuposDePlantillas(
  plantillaIds: string[],
): Promise<{ cupos: CupoPausa[]; error: string | null }> {
  if (plantillaIds.length === 0) return { cupos: [], error: null }
  const { data, error } = await supabase
    .from('plantilla_cupos_pausa')
    .select('*')
    .in('plantilla_horario_id', plantillaIds)
  reportDegradedQuery('condominios.fetchCuposDePlantillas', error)
  if (error) return { cupos: [], error: error.message }
  return { cupos: (data as CupoPausa[] | null) ?? [], error: null }
}

/** Lo que el formulario de la jornada declara, tal cual se teclea. */
export interface DatosJornada {
  nombre: string
  codigo: string | null
  turno: string
  hora_inicio: string
  hora_fin: string
  cruza_medianoche: boolean
  minutos_descanso: number
  tolerancia_entrada_min: number
  tolerancia_salida_min: number
  demora_compensable_hasta_min: number
  extra_requiere_autorizacion: boolean
  color: string | null
  notas: string | null
}

/**
 * Guarda la jornada y deja sus cupos EXACTAMENTE como dice `cupos` — las dos
 * cosas, o ninguna.
 *
 * ANTES ERAN TRES VIAJES: crear/actualizar la jornada, borrar los cupos viejos,
 * insertar los nuevos. Entre el segundo y el tercero caben una pestaña que se
 * cierra y una red que se corta, y lo que quedaba entonces no era «lo de antes»
 * ni «lo nuevo» sino una jornada SIN cupos — que es la peor de las tres, porque
 * «sin cupo declarado» significa justamente que ese descanso no se juzga. Un
 * guardado a medias acá no deja un formulario incompleto: deja la política
 * apagada en silencio.
 *
 * Ahora es una sola llamada y una sola transacción (`turnos_guardar_jornada`,
 * 20260912020300). La autorización no cambia: la RPC es SECURITY INVOKER y la
 * siguen decidiendo las policies de las dos tablas.
 *
 * Se manda el estado completo deseado, no un delta, por lo mismo que en
 * `presencia_corregir`: así «esta jornada ya no da cena» se expresa quitando el
 * número, sin necesitar un centinela para distinguirlo de «no cambies».
 */
export async function guardarJornadaConCupos(params: {
  companyId: string
  projectId: string
  /** `null` = jornada nueva. */
  plantillaId: string | null
  datos: DatosJornada
  /** Código de tipo → minutos. Un 0, un vacío o un NaN significan «sin cupo». */
  cupos: Record<string, number | null>
}): Promise<{ id: string | null; error: string | null }> {
  const { companyId, projectId, plantillaId, datos, cupos } = params
  // Se limpia acá lo que no es un cupo para no mandarle basura a la base: la
  // RPC lo descarta igual, pero un `NaN` viajando como texto es ruido que
  // aparece en los logs de PostgREST y confunde a quien los lee después.
  const limpios: Record<string, number> = {}
  for (const [tipo, valor] of Object.entries(cupos)) {
    const n = Number(valor)
    if (Number.isFinite(n) && n > 0) limpios[tipo] = n
  }
  const { data, error } = await supabase.rpc('turnos_guardar_jornada', {
    p_company_id: companyId,
    p_project_id: projectId,
    p_plantilla_id: plantillaId,
    p_datos: datos,
    p_cupos: limpios,
  })
  if (error) return { id: null, error: error.message }
  return { id: (data as string | null) ?? null, error: null }
}

/**
 * Minutos de cupo que DESCUENTAN de la jornada, según el catálogo de la empresa.
 *
 * Sirve para contrastarlos con `minutos_descanso`, que es el número que hoy ya
 * resta de `horas_planificadas`. Si no cuadran, la jornada está diciendo dos
 * cosas distintas sobre el mismo descanso — y eso hay que enseñarlo, no
 * arreglarlo solo: cambiar `minutos_descanso` por detrás movería las horas
 * planificadas de todos los bloques futuros sin que nadie lo pidiera.
 */
export function minutosCupoQueDescuentan(
  minutos: Record<string, number | null>,
  tipos: TipoPausa[],
): number {
  const descuenta = new Map(tipos.map(t => [t.codigo, t.descuenta]))
  return Object.entries(minutos).reduce((acc, [tipo, valor]) => {
    const n = Number(valor)
    if (!Number.isFinite(n) || n <= 0) return acc
    return descuenta.get(tipo) ? acc + n : acc
  }, 0)
}
