import { describe, it, expect } from 'vitest'
import {
  asientoFormSchema,
  asientoLineaFormSchema,
  convertirMontoBase,
  cuentaFormSchema,
  normalizarMoneda,
  round2,
  tipoCambioFormSchema,
  totalesLineas,
} from '../schemas'

const lineaDebe = { cuenta_id: '11111111-1111-1111-1111-111111111111', debe: 100, haber: 0 }
const lineaHaber = { cuenta_id: '22222222-2222-2222-2222-222222222222', debe: 0, haber: 100 }

describe('asientoLineaFormSchema', () => {
  it('acepta una línea con monto en un solo lado', () => {
    expect(asientoLineaFormSchema.safeParse(lineaDebe).success).toBe(true)
    expect(asientoLineaFormSchema.safeParse(lineaHaber).success).toBe(true)
  })

  it('rechaza una línea con debe Y haber simultáneos', () => {
    const r = asientoLineaFormSchema.safeParse({ ...lineaDebe, haber: 50 })
    expect(r.success).toBe(false)
  })

  it('rechaza una línea sin monto', () => {
    const r = asientoLineaFormSchema.safeParse({ ...lineaDebe, debe: 0 })
    expect(r.success).toBe(false)
  })
})

describe('asientoFormSchema', () => {
  const base = {
    fecha: '2026-06-10',
    tipo: 'diario' as const,
    concepto: 'Póliza de prueba',
    project_id: null,
  }

  it('acepta una póliza cuadrada', () => {
    const r = asientoFormSchema.safeParse({ ...base, lineas: [lineaDebe, lineaHaber] })
    expect(r.success).toBe(true)
  })

  it('rechaza una póliza descuadrada', () => {
    const r = asientoFormSchema.safeParse({
      ...base,
      lineas: [lineaDebe, { ...lineaHaber, haber: 90 }],
    })
    expect(r.success).toBe(false)
  })

  it('rechaza una póliza con una sola línea', () => {
    const r = asientoFormSchema.safeParse({ ...base, lineas: [lineaDebe] })
    expect(r.success).toBe(false)
  })

  it('cuadra con centavos (redondeo a 2 decimales)', () => {
    const r = asientoFormSchema.safeParse({
      ...base,
      lineas: [
        { ...lineaDebe, debe: 33.33 },
        { ...lineaDebe, cuenta_id: lineaHaber.cuenta_id, debe: 66.67 },
        { ...lineaHaber, cuenta_id: lineaDebe.cuenta_id, haber: 100 },
      ],
    })
    expect(r.success).toBe(true)
  })
})

describe('multimoneda', () => {
  it('convertirMontoBase aplica round half-up a 2 decimales', () => {
    expect(convertirMontoBase(100, 7.85)).toBe(785)
    expect(convertirMontoBase(13.33, 7.7777)).toBe(103.68)
    expect(convertirMontoBase(0.005, 1)).toBe(0.01)
  })

  it('round2 es estable con flotantes problemáticos', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(round2(1.005)).toBe(1.01)
  })

  it('tipoCambioFormSchema exige ISO-3 y tasa positiva', () => {
    expect(tipoCambioFormSchema.safeParse({ moneda: 'usd', fecha: '2026-06-10', tasa: 7.8 }).success).toBe(true)
    expect(tipoCambioFormSchema.safeParse({ moneda: 'US', fecha: '2026-06-10', tasa: 7.8 }).success).toBe(false)
    expect(tipoCambioFormSchema.safeParse({ moneda: 'USD', fecha: '2026-06-10', tasa: 0 }).success).toBe(false)
  })
})

describe('totalesLineas', () => {
  it('reporta el descuadre vivo del editor', () => {
    const t = totalesLineas([
      { debe: 100.1, haber: 0 },
      { debe: 0, haber: 50 },
    ])
    expect(t.debe).toBe(100.1)
    expect(t.haber).toBe(50)
    expect(t.diferencia).toBe(50.1)
  })
})

describe('cuentaFormSchema', () => {
  it('normaliza la moneda a mayúsculas', () => {
    const r = cuentaFormSchema.parse({
      codigo: '1102-02',
      nombre: 'Banco USD',
      tipo: 'activo',
      naturaleza: 'deudora',
      padre_id: null,
      nivel: 4,
      es_detalle: true,
      moneda: 'usd',
      descripcion: null,
    })
    expect(r.moneda).toBe('USD')
  })

  it('rechaza monedas que no son ISO-3', () => {
    const r = cuentaFormSchema.safeParse({
      codigo: '1102-02',
      nombre: 'Banco USD',
      tipo: 'activo',
      naturaleza: 'deudora',
      padre_id: null,
      nivel: 4,
      es_detalle: true,
      moneda: 'dólares',
      descripcion: null,
    })
    expect(r.success).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// `normalizarMoneda` es un ESPEJO de la función SQL `conta_normalizar_moneda`
// (migración 20260611000100_contabilidad_fase1_rpcs.sql:21-32), y hasta la
// auditoría 2026-07-28 no tenía ningún test. Un espejo TS↔SQL sin test es la
// misma forma del bug de PR-23 (mora del UI divergiendo del cron que cobra):
// nada avisa cuando un lado cambia. Aquí importa de verdad porque la moneda
// decide la conversión a moneda base — que la UI muestre 'US$' como una moneda
// distinta de 'USD' parte el consolidado en dos ledgers.
//
// Cada caso está pareado con la rama del CASE de SQL que replica:
//
//   SELECT CASE upper(trim(COALESCE(p_moneda, '')))
//     WHEN ''    THEN NULL     WHEN 'Q'   THEN 'GTQ'
//     WHEN '$'   THEN 'USD'    WHEN 'US$' THEN 'USD'
//     WHEN 'MX$' THEN 'MXN'    ELSE upper(trim(p_moneda))
//   END
// ════════════════════════════════════════════════════════════════════════════
describe('normalizarMoneda (espejo de conta_normalizar_moneda)', () => {
  it('mapea los símbolos legacy a ISO 4217', () => {
    expect(normalizarMoneda('Q')).toBe('GTQ')
    expect(normalizarMoneda('$')).toBe('USD')
    expect(normalizarMoneda('US$')).toBe('USD')
    expect(normalizarMoneda('MX$')).toBe('MXN')
  })

  it('normaliza caja y espacios ANTES de mapear (upper(trim(...)) en SQL)', () => {
    // El SQL aplica upper+trim dentro del CASE, así que ' q ' entra por la rama
    // 'Q'. Si el TS mapeara sobre el valor crudo, esto devolvería ' q '.
    expect(normalizarMoneda(' q ')).toBe('GTQ')
    expect(normalizarMoneda(' usd ')).toBe('USD')
    expect(normalizarMoneda('gtq')).toBe('GTQ')
  })

  it('deja pasar cualquier otro código ya normalizado (rama ELSE)', () => {
    expect(normalizarMoneda('USD')).toBe('USD')
    expect(normalizarMoneda('EUR')).toBe('EUR')
  })

  it('vacío, blancos, null y undefined → null (rama WHEN ..)', () => {
    // COALESCE(p_moneda,'') + trim: los cuatro colapsan al mismo caso en SQL.
    expect(normalizarMoneda('')).toBeNull()
    expect(normalizarMoneda('   ')).toBeNull()
    expect(normalizarMoneda(null)).toBeNull()
    expect(normalizarMoneda(undefined)).toBeNull()
  })

  it('es idempotente: normalizar dos veces no cambia el resultado', () => {
    // Los valores ya normalizados vuelven a pasar por aquí al releer de la BD.
    for (const m of ['Q', '$', 'US$', 'MX$', 'eur', ' q ']) {
      expect(normalizarMoneda(normalizarMoneda(m))).toBe(normalizarMoneda(m))
    }
  })
})
