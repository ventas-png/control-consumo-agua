// ════════════════════════════════════════════════════════════════════════════
// Paridad entre el cálculo del importe en TypeScript y el AUTORITATIVO en SQL.
//
// Desde 20260910000001 el importe de una lectura lo calcula la base
// (`agua_costo_tarifa`), no el navegador. `calcularCostoTarifa` sigue viva —
// alimenta la previsualización mientras el lecturista teclea— y por eso las dos
// tienen que dar EXACTAMENTE lo mismo: si la pantalla dijera un número y el
// recibo guardara otro, el operador no tendría forma de saber cuál es el bueno,
// y la diferencia aparecería en la factura del residente.
//
// LOS CASOS SON UN FICHERO COMPARTIDO, no una copia. Este test y
// supabase/tests/registrar_lectura/assert.sql leen el MISMO
// `paridad-casos.json`, y los valores esperados están escritos a mano ahí: si
// las dos implementaciones se equivocaran de la misma manera, seguiría
// fallando. Un caso nuevo se agrega una vez y las dos lo ejercen.
//
// EL REDONDEO ES PARTE DEL CONTRATO. `calcularCostoTarifa` NO redondea (devuelve
// el flotante crudo); la RPC redondea a 2 con «half away from zero», que es lo
// que hace `numeric` en Postgres y lo que implementa `redondear2`. Por eso la
// comparación aplica `redondear2` al lado de TypeScript: es exactamente la
// diferencia que este PR corrige, y dejarla implícita sería perderla.
// ════════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest'
import { calcularCostoTarifa, redondear2 } from '../business'
import type { TarifaTramo } from '../../types'
import casos from '../../../supabase/tests/registrar_lectura/paridad-casos.json'

interface CasoParidad {
  nombre: string
  consumo: number
  precio_m3: number
  precio_m3_exceso: number
  canon_fijo: number
  consumo_minimo: number
  tramos: TarifaTramo[] | null
  derecho_m3: number | null
  esperado: { total: number; tipo_cobro: string }
}

const listaCasos = casos.casos as unknown as CasoParidad[]

describe('paridad TypeScript ↔ agua_costo_tarifa (SQL)', () => {
  it('el fichero compartido tiene casos de los dos modelos de tarifa', () => {
    expect(listaCasos.length).toBeGreaterThanOrEqual(17)
    expect(listaCasos.some((c) => c.tramos === null)).toBe(true)
    expect(listaCasos.some((c) => Array.isArray(c.tramos))).toBe(true)
  })

  it.each(listaCasos.map((c) => [c.nombre, c] as const))('%s', (_nombre, caso) => {
    const r = calcularCostoTarifa(
      caso.consumo,
      {
        precio_m3: caso.precio_m3,
        precio_m3_exceso: caso.precio_m3_exceso,
        canon_fijo: caso.canon_fijo,
        consumo_minimo: caso.consumo_minimo,
        tramos: caso.tramos,
      },
      caso.derecho_m3,
    )
    expect(redondear2(r.total)).toBe(caso.esperado.total)
    expect(r.tipo_cobro).toBe(caso.esperado.tipo_cobro)
  })
})
