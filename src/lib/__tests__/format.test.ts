import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseFecha,
  dateLocalISO,
  hoyLocalISO,
  mesLocalISO,
  datetimeLocalISO,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatBytes,
  setDefaultLocale,
} from '../format'

beforeEach(() => {
  setDefaultLocale('es-GT')
})

describe('parseFecha', () => {
  it('parsea YYYY-MM-DD agregando T12:00:00 para evitar TZ shift', () => {
    const d = parseFecha('2026-05-16')
    // En cualquier zona horaria, getDate debería ser 16 (no 15)
    expect(d.getDate()).toBe(16)
  })
  it('parsea ISO completo sin modificar', () => {
    const d = parseFecha('2026-05-16T18:00:00Z')
    expect(d.toISOString()).toBe('2026-05-16T18:00:00.000Z')
  })
  it('devuelve Invalid Date para null/undefined/empty', () => {
    expect(Number.isNaN(parseFecha(null).getTime())).toBe(true)
    expect(Number.isNaN(parseFecha(undefined).getTime())).toBe(true)
    expect(Number.isNaN(parseFecha('').getTime())).toBe(true)
  })
  it('pasa Date sin tocar', () => {
    const date = new Date(2026, 4, 16)
    expect(parseFecha(date)).toBe(date)
  })
})

describe('dateLocalISO / hoyLocalISO (E4/D5)', () => {
  it('usa los componentes LOCALES de la fecha (no la fecha UTC)', () => {
    // 23:30 local: toISOString() daría la fecha UTC (posible "mañana");
    // dateLocalISO debe conservar el día local.
    const d = new Date(2026, 6, 31, 23, 30, 0) // 31 jul local, 23:30
    expect(dateLocalISO(d)).toBe('2026-07-31')
  })

  it('con padding de mes y día', () => {
    expect(dateLocalISO(new Date(2026, 0, 5, 8, 0, 0))).toBe('2026-01-05')
  })

  it('hoyLocalISO coincide con dateLocalISO(new Date())', () => {
    expect(hoyLocalISO()).toBe(dateLocalISO(new Date()))
  })

  it('round-trip con parseFecha: conserva el mismo día local', () => {
    const iso = dateLocalISO(new Date(2026, 11, 31, 22, 0, 0))
    expect(parseFecha(iso).getDate()).toBe(31)
    expect(parseFecha(iso).getMonth()).toBe(11)
  })
})

// ── Helpers añadidos por el barrido de PR-24 (auditoría 2026-07-28) ─────────
describe('mesLocalISO', () => {
  it('usa el mes LOCAL, no el UTC', () => {
    // La noche del último día del mes es donde se rompe: `toISOString()` de una
    // fecha local tardía cae ya en el mes siguiente en husos negativos, así que
    // un cierre contable o una emisión de cuotas lanzada a las 19:00 del 31 se
    // etiquetaba con el período equivocado.
    expect(mesLocalISO(new Date(2026, 6, 31, 23, 30, 0))).toBe('2026-07')
    expect(mesLocalISO(new Date(2026, 0, 1, 0, 15, 0))).toBe('2026-01')
  })

  it('padea el mes a dos dígitos', () => {
    expect(mesLocalISO(new Date(2026, 8, 15, 12, 0, 0))).toBe('2026-09')
  })

  it('sin argumento usa el instante actual', () => {
    expect(mesLocalISO()).toBe(dateLocalISO(new Date()).slice(0, 7))
  })
})

describe('datetimeLocalISO', () => {
  it('devuelve el formato que espera <input type="datetime-local">', () => {
    expect(datetimeLocalISO(new Date(2026, 6, 31, 9, 5, 0))).toBe('2026-07-31T09:05')
  })

  it('conserva la hora LOCAL (toISOString la habría desplazado)', () => {
    // En GMT-6 el patrón anterior prellenaba el control seis horas en el futuro.
    const d = new Date(2026, 6, 31, 23, 45, 0)
    expect(datetimeLocalISO(d)).toBe('2026-07-31T23:45')
  })

  it('padea horas y minutos', () => {
    expect(datetimeLocalISO(new Date(2026, 0, 2, 3, 7, 0))).toBe('2026-01-02T03:07')
  })
})

describe('formatDate', () => {
  it('formato largo en español', () => {
    expect(formatDate('2026-05-16')).toMatch(/16.+may.+2026/i)
  })
  it('vacío para valores inválidos', () => {
    expect(formatDate(null)).toBe('')
    expect(formatDate('')).toBe('')
  })
})

describe('formatDateShort', () => {
  it('formato corto numérico', () => {
    const out = formatDateShort('2026-05-16')
    // Varía según locale: dd/mm/yyyy, dd-mm-yyyy, m/d/yyyy, etc.
    expect(out).toMatch(/^(16[/-]0?5[/-]2026|0?5[/-]16[/-]2026)$/)
  })
})

describe('formatDateTime', () => {
  it('incluye hora', () => {
    const out = formatDateTime('2026-05-16T14:32:00')
    expect(out).toMatch(/14:32|2:32/)
  })
})

describe('formatCurrency', () => {
  it('formato default Q con 2 decimales', () => {
    expect(formatCurrency(1234.5)).toBe('Q 1,234.50')
  })
  it('respeta moneda personalizada', () => {
    expect(formatCurrency(50, '$')).toBe('$ 50.00')
    expect(formatCurrency(50, 'USD')).toBe('USD 50.00')
  })
  it('null/undefined → "Q 0.00"', () => {
    expect(formatCurrency(null)).toBe('Q 0.00')
    expect(formatCurrency(undefined, '$')).toBe('$ 0.00')
  })
  it('NaN → "Q 0.00"', () => {
    expect(formatCurrency(NaN)).toBe('Q 0.00')
  })
})

describe('formatNumber', () => {
  it('default 2 decimales', () => {
    expect(formatNumber(1234.567)).toBe('1,234.57')
  })
  it('respeta decimales custom', () => {
    expect(formatNumber(1234.5, 0)).toBe('1,235')
    expect(formatNumber(1234, 0)).toBe('1,234')
  })
  it('null/undefined → "0"', () => {
    expect(formatNumber(null)).toBe('0')
    expect(formatNumber(undefined)).toBe('0')
  })
})

describe('formatPercent', () => {
  it('multiplica por 100 y agrega %', () => {
    expect(formatPercent(0.873)).toBe('87%')
    expect(formatPercent(0.873, 1)).toBe('87.3%')
  })
  it('1.0 → "100%"', () => {
    expect(formatPercent(1)).toBe('100%')
  })
})

describe('formatBytes', () => {
  it('escala a unidades legibles', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(1024 * 1024 * 1.5)).toBe('1.5 MB')
    expect(formatBytes(1024 * 1024 * 1024 * 2.3)).toBe('2.3 GB')
  })
})
