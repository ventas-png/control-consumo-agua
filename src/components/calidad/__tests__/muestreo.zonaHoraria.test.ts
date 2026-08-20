// serv:S26 — Programa de muestreo: regresión por zona horaria.
//
// El defecto: `estadoMuestreo` sumaba la frecuencia sobre una fecha de
// calendario parseada como medianoche **UTC** y después formateaba ese instante
// como día **LOCAL**. En cualquier huso negativo el resultado retrocedía un día:
//
//   TZ=America/Guatemala
//   estadoMuestreo('2026-05-01', 30, '2026-05-10').proximaFecha
//     → '2026-05-30'   (incorrecto; se adelanta el muestreo un día)
//     → '2026-05-31'   (correcto: 1 de mayo + 30 días de calendario)
//
// Igual que en `src/lib/__tests__/fechaCalendario.test.ts`, la MISMA batería se
// ejecuta bajo cuatro husos —UTC, uno negativo cercano (GT), uno negativo lejano
// con horario de verano (LA) y uno positivo (Tokio)— reasignando `process.env.TZ`,
// que Node reevalúa en la siguiente operación de fecha. Y como el cálculo es de
// calendario puro, se exige además que las cuatro zonas devuelvan lo MISMO.

import { describe, it, expect, afterAll } from 'vitest'
import { estadoMuestreo, type EstadoMuestreo, type MuestreoInfo } from '../muestreo'

const TZ_ORIGINAL = process.env.TZ

/** Husos exigidos: UTC, GMT-6 sin DST, GMT-8 con DST y GMT+9. */
const ZONAS = ['UTC', 'America/Guatemala', 'America/Los_Angeles', 'Asia/Tokyo'] as const

function conZona<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz
  try {
    return fn()
  } finally {
    process.env.TZ = TZ_ORIGINAL
  }
}

afterAll(() => {
  process.env.TZ = TZ_ORIGINAL
})

interface Caso {
  nombre: string
  ultima: string | null
  freq: number | null
  hoy: string
  estado: EstadoMuestreo
  proximaFecha: string | null
  dias: number | null
}

/**
 * Batería completa: el caso reproducible del reporte, los cinco estados, los
 * bordes de calendario (fin de mes, cambio de año, bisiesto, DST) y las
 * frecuencias extremas del rango real (`smallint > 0`), con días restantes y
 * días vencidos en ambos signos.
 */
const CASOS: readonly Caso[] = [
  // --- el caso reproducible del reporte -------------------------------------
  { nombre: 'caso del reporte: 2026-05-01 + 30 d', ultima: '2026-05-01', freq: 30, hoy: '2026-05-10', estado: 'al_dia', proximaFecha: '2026-05-31', dias: 21 },

  // --- los cinco estados ----------------------------------------------------
  { nombre: 'sin_programa: frecuencia null', ultima: '2026-05-01', freq: null, hoy: '2026-05-10', estado: 'sin_programa', proximaFecha: null, dias: null },
  { nombre: 'sin_programa: frecuencia 0', ultima: '2026-05-01', freq: 0, hoy: '2026-05-10', estado: 'sin_programa', proximaFecha: null, dias: null },
  { nombre: 'sin_programa: frecuencia negativa', ultima: '2026-05-01', freq: -7, hoy: '2026-05-10', estado: 'sin_programa', proximaFecha: null, dias: null },
  { nombre: 'sin_muestras: sin última fecha', ultima: null, freq: 30, hoy: '2026-05-10', estado: 'sin_muestras', proximaFecha: null, dias: null },
  { nombre: 'al_dia: faltan más días que la ventana', ultima: '2026-05-01', freq: 30, hoy: '2026-05-10', estado: 'al_dia', proximaFecha: '2026-05-31', dias: 21 },
  { nombre: 'proximo: dentro de la ventana (≈20 %)', ultima: '2026-05-01', freq: 30, hoy: '2026-05-28', estado: 'proximo', proximaFecha: '2026-05-31', dias: 3 },
  { nombre: 'vencido: hoy pasó la próxima fecha', ultima: '2026-05-01', freq: 30, hoy: '2026-06-05', estado: 'vencido', proximaFecha: '2026-05-31', dias: -5 },

  // --- fin de mes -----------------------------------------------------------
  { nombre: 'fin de mes: 31 ene + 1 d → 1 feb', ultima: '2026-01-31', freq: 1, hoy: '2026-01-31', estado: 'proximo', proximaFecha: '2026-02-01', dias: 1 },
  { nombre: 'fin de mes: 30 abr + 1 d → 1 may', ultima: '2026-04-30', freq: 1, hoy: '2026-04-30', estado: 'proximo', proximaFecha: '2026-05-01', dias: 1 },
  { nombre: 'fin de mes: 31 may + 1 d → 1 jun (hoy = próxima)', ultima: '2026-05-31', freq: 1, hoy: '2026-06-01', estado: 'proximo', proximaFecha: '2026-06-01', dias: 0 },
  { nombre: 'fin de mes: 31 ene + 30 d cruza febrero', ultima: '2026-01-31', freq: 30, hoy: '2026-02-15', estado: 'al_dia', proximaFecha: '2026-03-02', dias: 15 },

  // --- cambio de año --------------------------------------------------------
  { nombre: 'cambio de año: 31 dic + 1 d', ultima: '2026-12-31', freq: 1, hoy: '2026-12-31', estado: 'proximo', proximaFecha: '2027-01-01', dias: 1 },
  { nombre: 'cambio de año: 15 dic + 30 d', ultima: '2026-12-15', freq: 30, hoy: '2026-12-30', estado: 'al_dia', proximaFecha: '2027-01-14', dias: 15 },
  { nombre: 'cambio de año: hoy en el año siguiente', ultima: '2027-12-31', freq: 30, hoy: '2028-01-05', estado: 'al_dia', proximaFecha: '2028-01-30', dias: 25 },

  // --- año bisiesto ---------------------------------------------------------
  { nombre: 'bisiesto: 28 feb 2028 + 1 d → 29 feb', ultima: '2028-02-28', freq: 1, hoy: '2028-02-28', estado: 'proximo', proximaFecha: '2028-02-29', dias: 1 },
  { nombre: 'no bisiesto: 28 feb 2026 + 1 d → 1 mar', ultima: '2026-02-28', freq: 1, hoy: '2026-02-28', estado: 'proximo', proximaFecha: '2026-03-01', dias: 1 },
  { nombre: 'bisiesto: 1 feb 2028 + 30 d cuenta el 29', ultima: '2028-02-01', freq: 30, hoy: '2028-02-20', estado: 'al_dia', proximaFecha: '2028-03-02', dias: 11 },
  { nombre: 'bisiesto: última muestra el 29 de febrero', ultima: '2028-02-29', freq: 30, hoy: '2028-03-01', estado: 'al_dia', proximaFecha: '2028-03-30', dias: 29 },

  // --- horario de verano (sólo America/Los_Angeles) -------------------------
  { nombre: 'DST: el tramo cruza el adelanto de marzo', ultima: '2026-03-01', freq: 30, hoy: '2026-03-15', estado: 'al_dia', proximaFecha: '2026-03-31', dias: 16 },
  { nombre: 'DST: el tramo cruza el atraso de noviembre', ultima: '2026-10-25', freq: 30, hoy: '2026-11-10', estado: 'al_dia', proximaFecha: '2026-11-24', dias: 14 },

  // --- frecuencias extremas: 1 y 30 días ------------------------------------
  { nombre: 'frecuencia 1: mañana → proximo (ventana mínima 2)', ultima: '2026-05-10', freq: 1, hoy: '2026-05-10', estado: 'proximo', proximaFecha: '2026-05-11', dias: 1 },
  { nombre: 'frecuencia 1: hoy es el día → proximo con 0 días', ultima: '2026-05-10', freq: 1, hoy: '2026-05-11', estado: 'proximo', proximaFecha: '2026-05-11', dias: 0 },
  { nombre: 'frecuencia 1: un día tarde → vencido', ultima: '2026-05-10', freq: 1, hoy: '2026-05-12', estado: 'vencido', proximaFecha: '2026-05-11', dias: -1 },
  { nombre: 'frecuencia 30: borde exacto de la ventana (6 d)', ultima: '2026-05-01', freq: 30, hoy: '2026-05-25', estado: 'proximo', proximaFecha: '2026-05-31', dias: 6 },
  { nombre: 'frecuencia 30: un día antes de la ventana', ultima: '2026-05-01', freq: 30, hoy: '2026-05-24', estado: 'al_dia', proximaFecha: '2026-05-31', dias: 7 },

  // --- días vencidos / días restantes con magnitud --------------------------
  { nombre: 'días vencidos: 45 días de atraso', ultima: '2026-05-01', freq: 30, hoy: '2026-07-15', estado: 'vencido', proximaFecha: '2026-05-31', dias: -45 },
  { nombre: 'días restantes: 29 de 30', ultima: '2026-05-01', freq: 30, hoy: '2026-05-02', estado: 'al_dia', proximaFecha: '2026-05-31', dias: 29 },
  { nombre: 'días vencidos cruzando el año', ultima: '2026-12-01', freq: 30, hoy: '2027-01-10', estado: 'vencido', proximaFecha: '2026-12-31', dias: -10 },

  // --- última muestra con hora (se toma el día) -----------------------------
  { nombre: 'la última muestra puede traer hora', ultima: '2026-05-01T23:45', freq: 30, hoy: '2026-05-10', estado: 'al_dia', proximaFecha: '2026-05-31', dias: 21 },
]

/** Entradas ilegibles: nunca deben producir Invalid Date, 'NaN-NaN-NaN' ni NaN. */
const CASOS_INVALIDOS: readonly Caso[] = [
  { nombre: 'última fecha sin formato', ultima: 'no-es-fecha', freq: 30, hoy: '2026-05-10', estado: 'sin_muestras', proximaFecha: null, dias: null },
  { nombre: 'última fecha con día inexistente', ultima: '2026-02-30', freq: 30, hoy: '2026-05-10', estado: 'sin_muestras', proximaFecha: null, dias: null },
  { nombre: 'última fecha con mes inexistente', ultima: '2026-13-01', freq: 30, hoy: '2026-05-10', estado: 'sin_muestras', proximaFecha: null, dias: null },
  { nombre: 'última fecha en formato local dd/mm/aaaa', ultima: '01/05/2026', freq: 30, hoy: '2026-05-10', estado: 'sin_muestras', proximaFecha: null, dias: null },
  { nombre: 'hoy sin formato', ultima: '2026-05-01', freq: 30, hoy: 'no-es-fecha', estado: 'sin_muestras', proximaFecha: null, dias: null },
  { nombre: 'hoy con día inexistente', ultima: '2026-05-01', freq: 30, hoy: '2026-02-30', estado: 'sin_muestras', proximaFecha: null, dias: null },
  { nombre: 'frecuencia NaN', ultima: '2026-05-01', freq: NaN, hoy: '2026-05-10', estado: 'sin_programa', proximaFecha: null, dias: null },
  { nombre: 'frecuencia Infinity', ultima: '2026-05-01', freq: Infinity, hoy: '2026-05-10', estado: 'sin_programa', proximaFecha: null, dias: null },
  { nombre: 'frecuencia que desborda el calendario', ultima: '2026-05-01', freq: 1e12, hoy: '2026-05-10', estado: 'sin_muestras', proximaFecha: null, dias: null },
  { nombre: 'última fecha vacía', ultima: '', freq: 30, hoy: '2026-05-10', estado: 'sin_muestras', proximaFecha: null, dias: null },
]

const TODOS: readonly Caso[] = [...CASOS, ...CASOS_INVALIDOS]

function esperado(c: Caso): MuestreoInfo {
  return { estado: c.estado, proximaFecha: c.proximaFecha, dias: c.dias }
}

describe('estadoMuestreo — el caso reproducible del reporte (serv:S26)', () => {
  it.each(ZONAS)('bajo %s, 2026-05-01 + 30 d es el 31 de mayo', (tz) => {
    const r = conZona(tz, () => estadoMuestreo('2026-05-01', 30, '2026-05-10'))
    expect(r.proximaFecha).toBe('2026-05-31')
    expect(r.proximaFecha).not.toBe('2026-05-30')
    expect(r.dias).toBe(21)
    expect(r.estado).toBe('al_dia')
  })

  it('UTC y America/Guatemala coinciden exactamente', () => {
    const utc = conZona('UTC', () => estadoMuestreo('2026-05-01', 30, '2026-05-10'))
    const gt = conZona('America/Guatemala', () => estadoMuestreo('2026-05-01', 30, '2026-05-10'))
    expect(gt).toEqual(utc)
    expect(gt).toEqual({ estado: 'al_dia', proximaFecha: '2026-05-31', dias: 21 })
  })
})

describe.each(ZONAS)('estadoMuestreo bajo %s (serv:S26)', (tz) => {
  it.each(TODOS.map((c) => [c.nombre, c] as const))('%s', (_nombre, caso) => {
    const r = conZona(tz, () => estadoMuestreo(caso.ultima, caso.freq, caso.hoy))
    expect(r).toEqual(esperado(caso))
  })

  it('nunca devuelve Invalid Date ni NaN', () => {
    conZona(tz, () => {
      for (const caso of TODOS) {
        const r = estadoMuestreo(caso.ultima, caso.freq, caso.hoy)
        if (r.proximaFecha !== null) {
          expect(r.proximaFecha).toMatch(/^\d{4}-\d{2}-\d{2}$/)
          expect(r.proximaFecha).not.toContain('NaN')
          expect(r.proximaFecha).not.toContain('Invalid')
        }
        if (r.dias !== null) {
          expect(Number.isFinite(r.dias)).toBe(true)
          expect(Number.isInteger(r.dias)).toBe(true)
        }
      }
    })
  })
})

describe('estadoMuestreo es independiente de la zona horaria (serv:S26)', () => {
  it.each(TODOS.map((c) => [c.nombre, c] as const))(
    'las cuatro zonas devuelven lo mismo: %s',
    (_nombre, caso) => {
      const [utc, ...resto] = ZONAS.map((tz) =>
        conZona(tz, () => estadoMuestreo(caso.ultima, caso.freq, caso.hoy)),
      )
      for (const r of resto) expect(r).toEqual(utc)
      expect(utc).toEqual(esperado(caso))
    },
  )

  it('ninguna fecha del año se desplaza en ningún huso', () => {
    // Barrido de los 365 días de 2026 con frecuencia 1 y 30: si quedara algún
    // round-trip por UTC, alguna de estas 730 fechas caería un día antes.
    const porZona = ZONAS.map((tz) =>
      conZona(tz, () => {
        const salida: string[] = []
        for (const freq of [1, 30]) {
          const d = new Date(2026, 0, 1)
          for (let i = 0; i < 365; i++) {
            const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
            salida.push(`${iso}+${freq}=${estadoMuestreo(iso, freq, iso).proximaFecha}`)
            d.setDate(d.getDate() + 1)
          }
        }
        return salida
      }),
    )
    for (const salida of porZona) {
      expect(salida).toHaveLength(730)
      expect(salida).toEqual(porZona[0])
    }
    // Anclas explícitas del barrido, por si la igualdad entre zonas se
    // cumpliera sobre un valor equivocado en las cuatro.
    expect(porZona[0]).toContain('2026-05-01+30=2026-05-31')
    expect(porZona[0]).toContain('2026-12-31+1=2027-01-01')
    expect(porZona[0]).toContain('2026-02-28+1=2026-03-01')
  })
})
