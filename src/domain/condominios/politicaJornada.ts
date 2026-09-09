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

/**
 * Deja los cupos de una jornada EXACTAMENTE como dice `minutos`: da de alta los
 * nuevos, actualiza los que cambiaron y borra los que quedaron en cero o vacíos.
 *
 * Se manda el estado completo deseado, no un delta, por lo mismo que en
 * `presencia_corregir`: así «esta jornada ya no da cena» se expresa quitando el
 * número, sin necesitar un centinela para distinguirlo de «no cambies».
 */
export async function guardarCupos(params: {
  companyId: string
  plantillaId: string
  /** Código de tipo → minutos. Un 0, un vacío o un NaN significan «sin cupo». */
  minutos: Record<string, number | null>
  /** Los que ya existen, para saber qué borrar y qué actualizar. */
  existentes: CupoPausa[]
}): Promise<{ error: string | null }> {
  const { companyId, plantillaId, minutos, existentes } = params
  const previos = new Map(existentes.map(c => [c.tipo, c]))
  const aInsertar: Array<{ company_id: string; plantilla_horario_id: string; tipo: string; minutos: number }> = []
  const aBorrar: string[] = []

  for (const [tipo, valor] of Object.entries(minutos)) {
    const n = Number(valor)
    const vale = Number.isFinite(n) && n > 0
    const previo = previos.get(tipo)
    if (vale && previo?.minutos === n) continue          // sin cambios
    if (vale) aInsertar.push({ company_id: companyId, plantilla_horario_id: plantillaId, tipo, minutos: n })
    else if (previo) aBorrar.push(previo.id)
  }

  if (aBorrar.length > 0) {
    const { error } = await supabase.from('plantilla_cupos_pausa').delete().in('id', aBorrar)
    if (error) return { error: error.message }
  }
  if (aInsertar.length > 0) {
    // `upsert` sobre la llave natural: la jornada no puede tener dos cupos del
    // mismo tipo (lo impide un UNIQUE), así que reescribir es lo correcto.
    const { error } = await supabase
      .from('plantilla_cupos_pausa')
      .upsert(aInsertar, { onConflict: 'plantilla_horario_id,tipo' })
    if (error) return { error: error.message }
  }
  return { error: null }
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
