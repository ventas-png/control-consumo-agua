// Proyección del próximo recibo del residente (auditoría 2026-07-16, O5).
// El portal muestra el consumo histórico pero no anticipa cuánto pagará el
// próximo período. Esta estimación proyecta el consumo por medidor (promedio de
// los últimos meses con datos) y lo valora con la ÚLTIMA tarifa conocida de ese
// medidor — el snapshot que ya viaja en cada lectura (tarifa_aplicada,
// canon_aplicado, tarifa_exceso_aplicada). No hace falta bajar la config de
// tarifas ni tocar la BD: se reutiliza calcularCostoTarifa() de business.ts.
//
// Es una ESTIMACIÓN (la UI debe rotularlo así): asume que el próximo consumo se
// parece al promedio reciente y que la tarifa no cambia.
import { calcularCostoTarifa } from './business'
import { parseFecha } from './format'

/** Lectura mínima para proyectar: consumo + snapshot de la tarifa aplicada. */
export interface LecturaProyeccion {
  contador_id: string | null
  fecha: string
  consumo: number | null
  /** Precio por m³ aplicado en esa lectura (snapshot). */
  tarifa_aplicada?: number | null
  /** Precio por m³ de exceso aplicado (snapshot), si la tarifa lo tenía. */
  tarifa_exceso_aplicada?: number | null
  /** Canon fijo aplicado (snapshot). */
  canon_aplicado?: number | null
}

export interface ProyeccionRecibo {
  /** m³ estimados para el próximo período (suma de todos los medidores). */
  consumoProyectado: number
  /** Costo estimado del próximo recibo (misma moneda que el proyecto). */
  montoProyectado: number
  /** 'promedio' si hubo historia; 'sin_datos' si no se pudo estimar. */
  base: 'promedio' | 'sin_datos'
  /** Cuántos meses distintos con datos se promediaron (el máximo entre medidores). */
  mesesUsados: number
}

const VENTANA_MESES_DEFAULT = 3

function ym(fecha: string): string {
  const d = parseFecha(fecha)
  return `${d.getFullYear()}-${d.getMonth()}`
}

/**
 * Proyecta el próximo recibo a partir del historial de lecturas del residente.
 * Por cada medidor: agrega el consumo por mes, promedia los últimos
 * `ventanaMeses` meses con datos y valora ese consumo con la tarifa de la lectura
 * más reciente del medidor (vía calcularCostoTarifa). Suma sobre los medidores.
 */
export function proyectarProximoRecibo(
  lecturas: LecturaProyeccion[],
  opts: { ventanaMeses?: number } = {},
): ProyeccionRecibo {
  const ventana = Math.max(1, opts.ventanaMeses ?? VENTANA_MESES_DEFAULT)

  // Agrupar por medidor.
  const porContador = new Map<string, LecturaProyeccion[]>()
  for (const l of lecturas) {
    if (l.contador_id == null) continue
    const arr = porContador.get(l.contador_id)
    if (arr) arr.push(l)
    else porContador.set(l.contador_id, [l])
  }

  let consumoProyectado = 0
  let montoProyectado = 0
  let mesesUsados = 0
  let huboDatos = false

  for (const lecs of porContador.values()) {
    // Consumo mensual del medidor (suma por mes, por si hay varias lecturas/mes).
    const porMes = new Map<string, number>()
    for (const l of lecs) {
      const key = ym(l.fecha)
      porMes.set(key, (porMes.get(key) ?? 0) + (l.consumo ?? 0))
    }
    if (porMes.size === 0) continue

    // Promediar los últimos `ventana` meses con datos (orden cronológico desc).
    const mesesOrden = [...porMes.entries()].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    const usados = mesesOrden.slice(0, ventana)
    const consumoMedidor = usados.reduce((s, [, v]) => s + v, 0) / usados.length
    mesesUsados = Math.max(mesesUsados, usados.length)

    // Tarifa: snapshot de la lectura más reciente del medidor.
    const ultima = [...lecs].sort(
      (a, b) => parseFecha(b.fecha).getTime() - parseFecha(a.fecha).getTime(),
    )[0]
    const costo = calcularCostoTarifa(consumoMedidor, {
      precio_m3: Number(ultima?.tarifa_aplicada ?? 0),
      precio_m3_exceso: Number(ultima?.tarifa_exceso_aplicada ?? 0),
      canon_fijo: Number(ultima?.canon_aplicado ?? 0),
    })

    consumoProyectado += consumoMedidor
    montoProyectado += costo.total
    huboDatos = true
  }

  return {
    consumoProyectado: parseFloat(consumoProyectado.toFixed(2)),
    montoProyectado: parseFloat(montoProyectado.toFixed(2)),
    base: huboDatos ? 'promedio' : 'sin_datos',
    mesesUsados,
  }
}
