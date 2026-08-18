// Fechas de calendario (columnas SQL `date`) — regresión por zona horaria.
//
// El bug original: `new Date('2026-01-01')` se interpreta como medianoche UTC,
// así que en America/Guatemala (GMT-6) la UI mostraba "31 dic 2025" para el
// periodo_inicio de una factura fechada el 1 de enero.
//
// Estas pruebas ejecutan la MISMA batería bajo cuatro husos —UTC, uno negativo
// cercano (GT), uno negativo lejano (LA) y uno positivo (Tokio)— reasignando
// `process.env.TZ`, que Node reevalúa en la siguiente operación de fecha.

import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import {
  parseFechaCalendario,
  esFechaCalendario,
  formatFechaCalendario,
  hoyCalendario,
  diasEntreFechasCalendario,
  diasHastaFechaCalendario,
  esFechaCalendarioVencida,
  sumarDiasCalendario,
  parseFecha,
  formatDate,
  formatDateShort,
  setDefaultLocale,
} from '../format'

const TZ_ORIGINAL = process.env.TZ

/** Husos exigidos por el PR: UTC, GMT-6, GMT-8 y GMT+9. */
const ZONAS = ['UTC', 'America/Guatemala', 'America/Los_Angeles', 'Asia/Tokyo'] as const

function conZona(tz: string, fn: () => void): void {
  process.env.TZ = tz
  try {
    fn()
  } finally {
    process.env.TZ = TZ_ORIGINAL
  }
}

afterAll(() => {
  process.env.TZ = TZ_ORIGINAL
})

beforeEach(() => {
  setDefaultLocale('es-GT')
})

describe.each(ZONAS)('fechas de calendario bajo %s', (tz) => {
  it('2026-01-01 es SIEMPRE el 1 de enero de 2026', () => {
    conZona(tz, () => {
      const d = parseFechaCalendario('2026-01-01')!
      expect(d).not.toBeNull()
      expect(d.getFullYear()).toBe(2026)
      expect(d.getMonth()).toBe(0)
      expect(d.getDate()).toBe(1)
    })
  })

  it('2026-01-01 se formatea como 1 de enero de 2026', () => {
    conZona(tz, () => {
      const largo = formatFechaCalendario(
        '2026-01-01',
        { day: 'numeric', month: 'long', year: 'numeric' },
        'es-GT',
      )
      expect(largo).toMatch(/1 de enero de 2026/i)
      expect(formatFechaCalendario('2026-01-01')).toBe('01/01/2026')
    })
  })

  it('formatDate/formatDateShort del módulo comparten la corrección', () => {
    conZona(tz, () => {
      expect(formatDate('2026-01-01')).toMatch(/1 de enero de 2026/i)
      expect(formatDateShort('2026-01-01')).toBe('1/1/2026')
    })
  })

  it('periodo_inicio/periodo_fin de una factura conservan su día', () => {
    conZona(tz, () => {
      // Caso real reportado: FacturasTab mostraba "31 dic – 31 ene" en GT.
      const inicio = formatFechaCalendario('2026-01-01', { month: 'short', day: 'numeric' }, 'es-MX')
      const fin = formatFechaCalendario('2026-01-31', { month: 'short', day: 'numeric', year: 'numeric' }, 'es-MX')
      expect(inicio).toMatch(/^1 /)
      expect(fin).toMatch(/^31 /)
      expect(fin).toMatch(/2026/)
    })
  })

  it('conserva el día en los bordes de mes y de año', () => {
    conZona(tz, () => {
      for (const iso of ['2026-01-31', '2026-02-01', '2026-04-30', '2026-05-01', '2026-12-31', '2027-01-01']) {
        const d = parseFechaCalendario(iso)!
        const [y, m, dd] = iso.split('-').map(Number)
        expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([y, m, dd])
      }
    })
  })

  it('año bisiesto: 2024-02-29 existe y 2026-02-29 no', () => {
    conZona(tz, () => {
      const bisiesto = parseFechaCalendario('2024-02-29')!
      expect(bisiesto.getMonth()).toBe(1)
      expect(bisiesto.getDate()).toBe(29)
      expect(parseFechaCalendario('2026-02-29')).toBeNull()
      expect(parseFechaCalendario('2100-02-29')).toBeNull() // 2100 no es bisiesto
      expect(parseFechaCalendario('2000-02-29')).not.toBeNull() // 2000 sí lo es
    })
  })

  it('la aritmética de días no se desplaza', () => {
    conZona(tz, () => {
      expect(diasEntreFechasCalendario('2026-01-01', '2026-01-31')).toBe(30)
      expect(diasEntreFechasCalendario('2026-02-28', '2026-03-01')).toBe(1)
      expect(diasEntreFechasCalendario('2024-02-28', '2024-03-01')).toBe(2) // bisiesto
      expect(diasEntreFechasCalendario('2026-12-31', '2027-01-01')).toBe(1)
      expect(diasEntreFechasCalendario('2026-01-31', '2026-01-01')).toBe(-30)
      expect(diasEntreFechasCalendario('2026-01-01', '2026-01-01')).toBe(0)
    })
  })

  it('los días restantes se cuentan contra el día LOCAL de la referencia', () => {
    conZona(tz, () => {
      // 23:30 hora local del 1 de enero: en husos negativos el instante ya es
      // 2 de enero UTC, y el patrón viejo restaba un día de más.
      const ref = new Date(2026, 0, 1, 23, 30, 0)
      expect(diasHastaFechaCalendario('2026-01-01', ref)).toBe(0)
      expect(diasHastaFechaCalendario('2026-01-02', ref)).toBe(1)
      expect(diasHastaFechaCalendario('2025-12-31', ref)).toBe(-1)
      expect(esFechaCalendarioVencida('2025-12-31', ref)).toBe(true)
      expect(esFechaCalendarioVencida('2026-01-01', ref)).toBe(false)
      expect(esFechaCalendarioVencida('2026-06-01', ref)).toBe(false)
    })
  })

  it('sumarDiasCalendario cruza meses, años y bisiestos sin desplazarse', () => {
    conZona(tz, () => {
      expect(sumarDiasCalendario('2026-01-01', 30)).toBe('2026-01-31')
      expect(sumarDiasCalendario('2026-01-31', 1)).toBe('2026-02-01')
      expect(sumarDiasCalendario('2026-12-31', 1)).toBe('2027-01-01')
      expect(sumarDiasCalendario('2024-02-28', 1)).toBe('2024-02-29')
      expect(sumarDiasCalendario('2026-02-28', 1)).toBe('2026-03-01')
      expect(sumarDiasCalendario('2026-03-01', -1)).toBe('2026-02-28')
      expect(sumarDiasCalendario('2026-01-01', 0)).toBe('2026-01-01')
    })
  })

  it('hoyCalendario cae en el día LOCAL', () => {
    conZona(tz, () => {
      const ahora = new Date()
      const hoy = hoyCalendario()
      expect(hoy.getFullYear()).toBe(ahora.getFullYear())
      expect(hoy.getMonth()).toBe(ahora.getMonth())
      expect(hoy.getDate()).toBe(ahora.getDate())
      expect(diasHastaFechaCalendario(hoy)).toBe(0)
    })
  })

  it('los timestamps ISO con hora conservan su conversión por zona', () => {
    conZona(tz, () => {
      // 2026-01-01T03:00:00Z es todavía 31/dic en GT y LA, y ya 1/ene en Tokio:
      // ese comportamiento NO debe cambiar.
      const iso = '2026-01-01T03:00:00Z'
      const d = parseFecha(iso)
      expect(d.toISOString()).toBe('2026-01-01T03:00:00.000Z')
      const diaLocalEsperado: Record<string, number> = {
        'UTC': 1,
        'America/Guatemala': 31,
        'America/Los_Angeles': 31,
        'Asia/Tokyo': 1,
      }
      expect(d.getDate()).toBe(diaLocalEsperado[tz])
      // Y un timestamp NO es una fecha de calendario: no debe colarse por el
      // parser de calendario perdiendo su hora.
      expect(parseFecha('2026-05-16T18:00:00Z').toISOString()).toBe('2026-05-16T18:00:00.000Z')
    })
  })
})

describe('valores nulos, vacíos e inválidos', () => {
  const BASURA: unknown[] = [
    null, undefined, '', '   ', 'null', 'undefined', 'no-es-fecha',
    '2026-13-01', '2026-00-10', '2026-01-32', '2026-01-00', '2026-02-30',
    '01/01/2026', '2026/01/01', '26-01-01', '2026-1-1', 'NaN', '2026-01-0a',
  ]

  it('parseFechaCalendario devuelve null (nunca Invalid Date)', () => {
    for (const v of BASURA) {
      expect(parseFechaCalendario(v as string)).toBeNull()
    }
    expect(parseFechaCalendario(new Date(NaN))).toBeNull()
  })

  it('esFechaCalendario discrimina correctamente', () => {
    expect(esFechaCalendario('2026-01-01')).toBe(true)
    for (const v of BASURA) expect(esFechaCalendario(v)).toBe(false)
  })

  it('formatFechaCalendario no imprime "Invalid Date"', () => {
    for (const v of BASURA) {
      expect(formatFechaCalendario(v as string)).toBe('')
      expect(formatFechaCalendario(v as string, {}, 'es-GT', '—')).toBe('—')
    }
  })

  it('la aritmética devuelve null en vez de NaN', () => {
    expect(diasEntreFechasCalendario(null, '2026-01-01')).toBeNull()
    expect(diasEntreFechasCalendario('2026-01-01', '')).toBeNull()
    expect(diasHastaFechaCalendario('basura')).toBeNull()
    expect(sumarDiasCalendario(null, 3)).toBeNull()
    expect(sumarDiasCalendario('2026-01-01', NaN)).toBeNull()
    expect(esFechaCalendarioVencida(null)).toBe(false)
    expect(esFechaCalendarioVencida('')).toBe(false)
  })

  it('parseFecha sigue devolviendo Invalid Date para lo no parseable (contrato previo)', () => {
    expect(Number.isNaN(parseFecha(null).getTime())).toBe(true)
    expect(Number.isNaN(parseFecha('').getTime())).toBe(true)
    expect(Number.isNaN(parseFecha('no-es-fecha').getTime())).toBe(true)
  })

  it('tolera un sufijo de hora en una columna date (por si el backend lo agrega)', () => {
    const d = parseFechaCalendario('2026-01-01T00:00:00')!
    expect(d.getDate()).toBe(1)
    expect(parseFechaCalendario('2026-01-01 00:00:00')!.getDate()).toBe(1)
  })
})
