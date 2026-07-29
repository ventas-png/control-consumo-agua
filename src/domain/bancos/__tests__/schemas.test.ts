import { describe, it, expect } from 'vitest'
import {
  cuentaBancariaFormSchema,
  parseFechaExtracto,
  parseMontoExtracto,
  validarFilaExtracto,
} from '../schemas'

describe('parseMontoExtracto', () => {
  it('acepta números y strings con separadores de miles', () => {
    expect(parseMontoExtracto(1234.56)).toBe(1234.56)
    expect(parseMontoExtracto('1,234.56')).toBe(1234.56)
    expect(parseMontoExtracto('-150')).toBe(-150)
  })

  it('quita símbolos de moneda', () => {
    expect(parseMontoExtracto('Q1,500.00')).toBe(1500)
    expect(parseMontoExtracto('$ -75.25')).toBe(-75.25)
  })

  it('paréntesis = negativo (convención bancaria)', () => {
    expect(parseMontoExtracto('(150.00)')).toBe(-150)
    expect(parseMontoExtracto('(Q1,000.50)')).toBe(-1000.5)
  })

  it('formato europeo 1.234,56', () => {
    expect(parseMontoExtracto('1.234,56')).toBe(1234.56)
  })

  it('rechaza vacío, cero y basura', () => {
    expect(parseMontoExtracto('')).toBeNull()
    expect(parseMontoExtracto('0')).toBeNull()
    expect(parseMontoExtracto('abc')).toBeNull()
    expect(parseMontoExtracto(null)).toBeNull()
  })

  // La rama NUMÉRICA (celdas de XLSX, que llegan como number y no como string)
  // solo estaba ejercitada por el camino feliz. Sin esto, un extracto con una
  // celda vacía o rota entraba al import como si fuera un movimiento válido.
  it('rechaza números no interpretables sin pasar por el parser de strings', () => {
    expect(parseMontoExtracto(0)).toBeNull()
    expect(parseMontoExtracto(-0)).toBeNull()
    expect(parseMontoExtracto(NaN)).toBeNull()
    expect(parseMontoExtracto(Infinity)).toBeNull()
    expect(parseMontoExtracto(-Infinity)).toBeNull()
  })

  it('redondea a 2 decimales los números crudos de XLSX', () => {
    // XLSX arrastra error binario al leer celdas de moneda; sin el redondeo el
    // movimiento entra con 6+ decimales y nunca concilia contra el asiento.
    expect(parseMontoExtracto(1234.5649)).toBe(1234.56)
    expect(parseMontoExtracto(-75.256)).toBe(-75.26)
  })
})

describe('parseFechaExtracto', () => {
  it('acepta YYYY-MM-DD e ISO completo', () => {
    expect(parseFechaExtracto('2026-06-10')).toBe('2026-06-10')
    expect(parseFechaExtracto('2026-06-10T08:00:00Z')).toBe('2026-06-10')
  })

  it('acepta DD/MM/YYYY y DD-MM-YYYY', () => {
    expect(parseFechaExtracto('10/06/2026')).toBe('2026-06-10')
    expect(parseFechaExtracto('5-1-2026')).toBe('2026-01-05')
  })

  it('acepta Date (celdas de XLSX)', () => {
    expect(parseFechaExtracto(new Date('2026-06-10T12:00:00Z'))).toBe('2026-06-10')
  })

  it('rechaza fechas imposibles o basura', () => {
    expect(parseFechaExtracto('32/13/2026')).toBeNull()
    expect(parseFechaExtracto('ayer')).toBeNull()
    expect(parseFechaExtracto(42)).toBeNull()
  })
})

describe('validarFilaExtracto', () => {
  it('fila válida → MovimientoImportado normalizado', () => {
    const r = validarFilaExtracto({ fecha: '10/06/2026', monto: '(15.00)', descripcion: ' COMISION ', referencia: '' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toEqual({ fecha: '2026-06-10', monto: -15, descripcion: 'COMISION', referencia: null })
    }
  })

  it('acumula errores de fecha y monto', () => {
    const r = validarFilaExtracto({ fecha: 'x', monto: '0' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toHaveLength(2)
  })

  it('columnas descripcion/referencia AUSENTES → null, no la cadena "undefined"', () => {
    // `String(row.descripcion ?? '')` sin el `??` produciría literalmente
    // "undefined" como descripción del movimiento en el extracto importado.
    const r = validarFilaExtracto({ fecha: '2026-06-10', monto: 100 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.descripcion).toBeNull()
      expect(r.data.referencia).toBeNull()
    }
  })
})

describe('cuentaBancariaFormSchema', () => {
  it('normaliza moneda a mayúsculas y exige cuenta contable', () => {
    const r = cuentaBancariaFormSchema.parse({
      nombre: 'BI USD', banco: 'Banco Industrial', numero_mascara: '4321',
      moneda: 'usd', cuenta_contable_id: '11111111-1111-1111-1111-111111111111', notas: null,
    })
    expect(r.moneda).toBe('USD')
    expect(cuentaBancariaFormSchema.safeParse({
      nombre: 'X1', banco: 'B1', numero_mascara: null, moneda: null,
      cuenta_contable_id: 'no-uuid', notas: null,
    }).success).toBe(false)
  })
})
