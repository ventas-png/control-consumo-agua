import { describe, it, expect } from 'vitest'
import {
  clienteInputSchema,
  contadorInputSchema,
  lecturaInputSchema,
  safeValidate,
} from '../schemas'

const UUID = '00000000-0000-4000-8000-000000000001'
const UUID2 = '00000000-0000-4000-8000-000000000002'

describe('clienteInputSchema', () => {
  it('acepta un cliente mínimo válido', () => {
    const result = clienteInputSchema.safeParse({
      nombre: 'Juan Pérez',
      codigo: 'CLI-001',
    })
    expect(result.success).toBe(true)
  })

  it('rechaza nombre vacío o solo espacios', () => {
    expect(clienteInputSchema.safeParse({ nombre: '', codigo: 'X' }).success).toBe(false)
    expect(clienteInputSchema.safeParse({ nombre: '   ', codigo: 'X' }).success).toBe(false)
  })

  it('trim normaliza el nombre antes de validar', () => {
    const r = clienteInputSchema.safeParse({ nombre: '  Juan  ', codigo: 'X' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.nombre).toBe('Juan')
  })

  it('email se normaliza a lowercase', () => {
    const r = clienteInputSchema.safeParse({
      nombre: 'Juan',
      codigo: 'X',
      email: 'Juan@Example.COM',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.email).toBe('juan@example.com')
  })

  it('rechaza email con formato inválido', () => {
    const r = clienteInputSchema.safeParse({
      nombre: 'Juan',
      codigo: 'X',
      email: 'noesemail',
    })
    expect(r.success).toBe(false)
  })

  it('acepta string vacío como email ausente (formularios HTML)', () => {
    const r = clienteInputSchema.safeParse({
      nombre: 'Juan',
      codigo: 'X',
      email: '',
    })
    expect(r.success).toBe(true)
  })

  it('telefono local de 8 dígitos pasa; 7 dígitos no', () => {
    expect(
      clienteInputSchema.safeParse({ nombre: 'X', codigo: 'X', telefono: '12345678' }).success,
    ).toBe(true)
    expect(
      clienteInputSchema.safeParse({ nombre: 'X', codigo: 'X', telefono: '1234567' }).success,
    ).toBe(false)
  })

  it('telefono E.164 con + acepta entre 7 y 15 dígitos', () => {
    expect(
      clienteInputSchema.safeParse({ nombre: 'X', codigo: 'X', telefono: '+50212345678' }).success,
    ).toBe(true)
    expect(
      clienteInputSchema.safeParse({ nombre: 'X', codigo: 'X', telefono: '+1' }).success,
    ).toBe(false)
  })

  it('lectura_inicial coerce de string a number, rechaza negativos', () => {
    const ok = clienteInputSchema.safeParse({
      nombre: 'X', codigo: 'X', lectura_inicial: '42',
    })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.lectura_inicial).toBe(42)

    const bad = clienteInputSchema.safeParse({
      nombre: 'X', codigo: 'X', lectura_inicial: -1,
    })
    expect(bad.success).toBe(false)
  })
})

describe('contadorInputSchema', () => {
  const base = {
    project_id: UUID,
    company_id: UUID2,
    numero_serie: 'SN-12345',
    tipo_agua: 'potable' as const,
    lectura_inicial: 0,
    activo: true,
  }

  it('acepta un contador válido mínimo', () => {
    expect(contadorInputSchema.safeParse(base).success).toBe(true)
  })

  it('rechaza tipo_agua fuera del enum', () => {
    const r = contadorInputSchema.safeParse({ ...base, tipo_agua: 'inventado' })
    expect(r.success).toBe(false)
  })

  it('rechaza project_id que no es UUID', () => {
    const r = contadorInputSchema.safeParse({ ...base, project_id: 'not-a-uuid' })
    expect(r.success).toBe(false)
  })

  it('rechaza numero_serie vacío', () => {
    const r = contadorInputSchema.safeParse({ ...base, numero_serie: '   ' })
    expect(r.success).toBe(false)
  })
})

describe('lecturaInputSchema', () => {
  const base = {
    cliente_id: UUID,
    fecha: '2026-06-02',
    lectura_anterior: 100,
    lectura_actual: 120,
  }

  it('acepta una lectura válida', () => {
    expect(lecturaInputSchema.safeParse(base).success).toBe(true)
  })

  it('rechaza fecha con formato distinto a YYYY-MM-DD', () => {
    expect(lecturaInputSchema.safeParse({ ...base, fecha: '02/06/2026' }).success).toBe(false)
    expect(lecturaInputSchema.safeParse({ ...base, fecha: '2026-6-2' }).success).toBe(false)
  })

  it('NO valida lectura_actual >= lectura_anterior — eso lo hace validarLectura()', () => {
    // Recordatorio explícito: la regla "lectura_actual >= lectura_anterior"
    // depende de estado (reset del medidor) y no es una validación de SHAPE.
    const r = lecturaInputSchema.safeParse({ ...base, lectura_anterior: 200, lectura_actual: 100 })
    expect(r.success).toBe(true)
  })

  it('acepta GPS con lat/lng dentro de rango y rechaza fuera', () => {
    expect(
      lecturaInputSchema.safeParse({ ...base, gps: { lat: 14.6, lng: -90.5 } }).success,
    ).toBe(true)
    expect(
      lecturaInputSchema.safeParse({ ...base, gps: { lat: 95, lng: 0 } }).success,
    ).toBe(false)
  })

  it('coerce de strings a number en lecturas (inputs HTML)', () => {
    const r = lecturaInputSchema.safeParse({
      ...base,
      lectura_anterior: '100',
      lectura_actual: '120',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.lectura_anterior).toBe(100)
      expect(r.data.lectura_actual).toBe(120)
    }
  })
})

describe('safeValidate helper', () => {
  it('caso éxito devuelve { ok: true, data }', () => {
    const r = safeValidate(clienteInputSchema, { nombre: 'Juan', codigo: 'X' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.nombre).toBe('Juan')
  })

  it('caso falla devuelve fieldErrors por campo', () => {
    const r = safeValidate(clienteInputSchema, {
      nombre: '',
      codigo: '',
      email: 'noesemail',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.fieldErrors.nombre).toBeDefined()
      expect(r.fieldErrors.codigo).toBeDefined()
      expect(r.fieldErrors.email).toBeDefined()
    }
  })

  it('formErrors aparece cuando el error no es de un campo (e.g. input no es objeto)', () => {
    const r = safeValidate(clienteInputSchema, null)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.formErrors.length).toBeGreaterThan(0)
    }
  })
})
