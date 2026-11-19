// El historial importado (tabla agua_historial_lecturas) visto como filas del
// Historial de Lecturas. Es referencia, NO un cobro: la fila lleva la marca
// `historico` y quien la muestre no le pone monto, estado de pago ni acciones,
// y no la suma en los totales.
// Puro: sin React ni Supabase.
import type { Registro, Contador, Unidad, Cliente } from '../types'
import type { HistorialLectura } from '../domain/agua/historialLecturas'

/** Valor de `estado` de las filas importadas (filtro «Histórico»). */
export const ESTADO_HISTORICO = 'historico'

export interface DatosHistorico {
  /** Lectura del medidor en esa fecha; null si sólo se anotó el consumo. */
  lectura: number | null
  /** Lectura de la fila anterior del mismo contador; null si no hay. */
  anterior: number | null
  /** Consumo anotado, o deducido de las dos lecturas; null si no se puede. */
  consumo: number | null
}

/** Una fila del Historial: lectura del sistema o, con `historico`, importada. */
export type FilaLectura = Registro & { historico?: DatosHistorico }

/**
 * Convierte el historial importado en filas del Historial. `lectura anterior`
 * y el consumo que no venga anotado salen de la fila previa del mismo contador
 * (una lectura menor que la previa —medidor cambiado— no da consumo).
 */
export function filasDeHistorial(
  historial: HistorialLectura[],
  contadoresById: Map<string, Contador>,
  unidades: Unidad[],
  clientes: Cliente[],
): FilaLectura[] {
  const unidadesById = new Map(unidades.map(u => [u.id, u]))
  const clientesById = new Map(clientes.map(c => [c.id, c]))
  const ordenado = [...historial].sort((a, b) =>
    a.contador_id === b.contador_id ? a.fecha.localeCompare(b.fecha) : a.contador_id.localeCompare(b.contador_id))
  const previa = new Map<string, number>()
  return ordenado.map(h => {
    const anterior = previa.get(h.contador_id) ?? null
    if (h.lectura !== null) previa.set(h.contador_id, h.lectura)
    const consumo = h.consumo
      ?? (h.lectura !== null && anterior !== null && h.lectura >= anterior ? h.lectura - anterior : null)
    const unidad = unidadesById.get(contadoresById.get(h.contador_id)?.unidad_id ?? '')
    const cliente = clientesById.get(unidad?.cliente_id ?? '')
    return {
      id: `hist:${h.id}`,
      cliente_id: cliente?.id ?? '',
      cliente_nombre: cliente?.nombre ?? unidad?.nombre ?? '—',
      contador_id: h.contador_id,
      project_id: h.project_id,
      // Mediodía local: una fecha sola se leería como medianoche UTC y los
      // filtros «Desde/Hasta» (límites locales) la correrían un día.
      fecha: `${h.fecha}T12:00:00`,
      lectura_anterior: anterior ?? 0,
      lectura_actual: h.lectura ?? 0,
      consumo: consumo ?? 0,
      tarifa_aplicada: 0,
      canon_aplicado: 0,
      monto_calculado: 0,
      tipo_cobro: '',
      estado: ESTADO_HISTORICO as Registro['estado'],
      notas: h.notas ?? undefined,
      historico: { lectura: h.lectura, anterior, consumo },
    }
  })
}
