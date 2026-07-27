import { describe, it, expect } from 'vitest'
import {
  cuotaInputSchema,
  visitanteInputSchema,
  amenidadInputSchema,
} from '../schemas'

const UUID = '00000000-0000-4000-8000-000000000001'
const UUID2 = '00000000-0000-4000-8000-000000000002'
const UUID3 = '00000000-0000-4000-8000-000000000003'

describe('cuotaInputSchema', () => {
  const base = {
    company_id: UUID,
    project_id: UUID2,
    unidad_id: UUID3,
    concepto: 'mantenimiento' as const,
    monto: 100,
    periodo: '2026-06',
    estado: 'pendiente' as const,
  }

  it('acepta una cuota mínima válida', () => {
    expect(cuotaInputSchema.safeParse(base).success).toBe(true)
  })

  it('rechaza monto cero o negativo', () => {
    expect(cuotaInputSchema.safeParse({ ...base, monto: 0 }).success).toBe(false)
    expect(cuotaInputSchema.safeParse({ ...base, monto: -10 }).success).toBe(false)
  })

  it('coerce de string a number en monto', () => {
    const r = cuotaInputSchema.safeParse({ ...base, monto: '250.50' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.monto).toBe(250.5)
  })

  it('rechaza periodo con formato distinto a YYYY-MM', () => {
    expect(cuotaInputSchema.safeParse({ ...base, periodo: '06/2026' }).success).toBe(false)
    expect(cuotaInputSchema.safeParse({ ...base, periodo: '2026-6' }).success).toBe(false)
    expect(cuotaInputSchema.safeParse({ ...base, periodo: '2026-13' }).success).toBe(false)
  })

  it('CAM es la única que puede ir sin unidad_id', () => {
    const camOk = cuotaInputSchema.safeParse({ ...base, concepto: 'CAM', unidad_id: null })
    expect(camOk.success).toBe(true)
  })

  it('otros conceptos requieren unidad_id', () => {
    const r = cuotaInputSchema.safeParse({ ...base, concepto: 'mantenimiento', unidad_id: null })
    expect(r.success).toBe(false)
    if (!r.success) {
      const path = r.error.issues[0].path
      expect(path).toContain('unidad_id')
    }
  })

  it('rechaza concepto fuera del enum', () => {
    const r = cuotaInputSchema.safeParse({ ...base, concepto: 'inventado' })
    expect(r.success).toBe(false)
  })

  it('fecha_vencimiento opcional pero si viene debe ser YYYY-MM-DD', () => {
    expect(cuotaInputSchema.safeParse({ ...base, fecha_vencimiento: '2026-06-30' }).success).toBe(true)
    expect(cuotaInputSchema.safeParse({ ...base, fecha_vencimiento: '30/06/2026' }).success).toBe(false)
  })

  it('rol_responsable es opcional (omitido o null = sin diferenciar)', () => {
    expect(cuotaInputSchema.safeParse(base).success).toBe(true)
    expect(cuotaInputSchema.safeParse({ ...base, rol_responsable: null }).success).toBe(true)
  })

  it('rol_responsable acepta el dominio de unidad_residentes.tipo', () => {
    for (const rol of ['propietario', 'arrendatario', 'familiar', 'otro'] as const) {
      expect(cuotaInputSchema.safeParse({ ...base, rol_responsable: rol }).success).toBe(true)
    }
  })

  it('rechaza rol_responsable fuera del enum', () => {
    expect(cuotaInputSchema.safeParse({ ...base, rol_responsable: 'inquilino' }).success).toBe(false)
    expect(cuotaInputSchema.safeParse({ ...base, rol_responsable: '' }).success).toBe(false)
  })
})

describe('visitanteInputSchema', () => {
  const base = {
    company_id: UUID,
    project_id: UUID2,
    unidad_id: UUID3,
    nombre: 'María González',
    hora_entrada: '2026-06-02T14:30:00Z',
  }

  it('acepta un visitante mínimo válido', () => {
    expect(visitanteInputSchema.safeParse(base).success).toBe(true)
  })

  it('rechaza nombre vacío', () => {
    expect(visitanteInputSchema.safeParse({ ...base, nombre: '   ' }).success).toBe(false)
  })

  it('rechaza unidad_id que no es UUID', () => {
    expect(visitanteInputSchema.safeParse({ ...base, unidad_id: 'X' }).success).toBe(false)
  })

  it('hora_salida >= hora_entrada cuando ambas vienen', () => {
    const ok = visitanteInputSchema.safeParse({
      ...base,
      hora_entrada: '2026-06-02T14:00:00Z',
      hora_salida: '2026-06-02T16:00:00Z',
    })
    expect(ok.success).toBe(true)

    const bad = visitanteInputSchema.safeParse({
      ...base,
      hora_entrada: '2026-06-02T14:00:00Z',
      hora_salida: '2026-06-02T12:00:00Z',
    })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.error.issues[0].path).toContain('hora_salida')
    }
  })

  it('menor de edad requiere fecha_nacimiento', () => {
    const bad = visitanteInputSchema.safeParse({ ...base, es_menor: true })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.error.issues[0].path).toContain('fecha_nacimiento')
    }

    const ok = visitanteInputSchema.safeParse({
      ...base,
      es_menor: true,
      fecha_nacimiento: '2015-03-20',
    })
    expect(ok.success).toBe(true)
  })

  // Regresión: `valido_hasta` exigía timestamp ISO, pero los DOS formularios que
  // lo escriben (portal del residente y pase QR del guardia) usan
  // <input type="date"> → 'YYYY-MM-DD'. `validatedInsert` rechazaba la fila antes
  // de tocar la DB y el botón "Pre-autorizar visita" parecía no hacer nada.
  it('acepta valido_hasta como fecha de <input type="date">', () => {
    const r = visitanteInputSchema.safeParse({ ...base, valido_hasta: '2026-07-28' })
    expect(r.success ? 'OK' : JSON.stringify(r.error.flatten().fieldErrors)).toBe('OK')
  })

  it('acepta valido_hasta como timestamp (columna timestamptz leída de vuelta)', () => {
    expect(
      visitanteInputSchema.safeParse({ ...base, valido_hasta: '2026-07-28T00:00:00+00:00' }).success,
    ).toBe(true)
  })

  it('acepta valido_hasta nulo o ausente (visita de hoy únicamente)', () => {
    expect(visitanteInputSchema.safeParse({ ...base, valido_hasta: null }).success).toBe(true)
    expect(visitanteInputSchema.safeParse(base).success).toBe(true)
  })

  it('sigue rechazando un valido_hasta que no es fecha ni timestamp', () => {
    expect(visitanteInputSchema.safeParse({ ...base, valido_hasta: '28/07/2026' }).success).toBe(false)
    expect(visitanteInputSchema.safeParse({ ...base, valido_hasta: 'mañana' }).success).toBe(false)
  })

  // El payload exacto que arma PortalVisitantesTab.preAutorizar() para el caso
  // reportado: menor de edad, foto de vehículo y autorización con fecha.
  it('acepta el payload completo del portal del residente', () => {
    const r = visitanteInputSchema.safeParse({
      ...base,
      identificacion: null,
      placa_vehiculo: null,
      motivo: 'test',
      notas: 'test',
      foto_url: null,
      foto_documento_url: null,
      foto_vehiculo_url: 'https://ejemplo/foto.jpg',
      valido_hasta: '2026-07-28',
      es_menor: true,
      fecha_nacimiento: '2015-07-14',
    })
    expect(r.success ? 'OK' : JSON.stringify(r.error.flatten().fieldErrors)).toBe('OK')
  })

  it('acepta timestamp en formato Postgres "YYYY-MM-DD HH:MM:SS"', () => {
    const r = visitanteInputSchema.safeParse({
      ...base,
      hora_entrada: '2026-06-02 14:30:00',
    })
    expect(r.success).toBe(true)
  })
})

describe('amenidadInputSchema', () => {
  const base = {
    company_id: UUID,
    project_id: UUID2,
    nombre: 'Piscina',
    requiere_deposito: false,
    requiere_tarifa: false,
    requiere_aprobacion: false,
    activo: true,
  }

  it('acepta una amenidad mínima válida', () => {
    expect(amenidadInputSchema.safeParse(base).success).toBe(true)
  })

  it('rechaza nombre vacío', () => {
    expect(amenidadInputSchema.safeParse({ ...base, nombre: '' }).success).toBe(false)
  })

  it('si requiere_deposito → monto_deposito > 0', () => {
    const bad = amenidadInputSchema.safeParse({ ...base, requiere_deposito: true })
    expect(bad.success).toBe(false)

    const bad2 = amenidadInputSchema.safeParse({
      ...base,
      requiere_deposito: true,
      monto_deposito: 0,
    })
    expect(bad2.success).toBe(false)

    const ok = amenidadInputSchema.safeParse({
      ...base,
      requiere_deposito: true,
      monto_deposito: 100,
    })
    expect(ok.success).toBe(true)
  })

  it('si requiere_tarifa → tarifa_uso > 0', () => {
    const bad = amenidadInputSchema.safeParse({ ...base, requiere_tarifa: true })
    expect(bad.success).toBe(false)

    const ok = amenidadInputSchema.safeParse({
      ...base,
      requiere_tarifa: true,
      tarifa_uso: 50,
    })
    expect(ok.success).toBe(true)
  })

  it('horario_fin debe ser posterior a horario_inicio', () => {
    const ok = amenidadInputSchema.safeParse({
      ...base,
      horario_inicio: '08:00',
      horario_fin: '20:00',
    })
    expect(ok.success).toBe(true)

    const bad = amenidadInputSchema.safeParse({
      ...base,
      horario_inicio: '20:00',
      horario_fin: '08:00',
    })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(bad.error.issues[0].path).toContain('horario_fin')
    }
  })

  it('rechaza horario en formato inválido', () => {
    expect(
      amenidadInputSchema.safeParse({ ...base, horario_inicio: '8:00', horario_fin: '20:00' }).success,
    ).toBe(false)
    expect(
      amenidadInputSchema.safeParse({ ...base, horario_inicio: '25:00', horario_fin: '26:00' }).success,
    ).toBe(false)
  })

  it('coerce de strings a number en montos', () => {
    const r = amenidadInputSchema.safeParse({
      ...base,
      requiere_tarifa: true,
      tarifa_uso: '50',
      tarifa_uso_finde: '75',
      capacidad_max: '20',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.tarifa_uso).toBe(50)
      expect(r.data.capacidad_max).toBe(20)
    }
  })

  it('rechaza capacidad_max no-entera o negativa', () => {
    expect(amenidadInputSchema.safeParse({ ...base, capacidad_max: -1 }).success).toBe(false)
    expect(amenidadInputSchema.safeParse({ ...base, capacidad_max: 1.5 }).success).toBe(false)
  })
})
