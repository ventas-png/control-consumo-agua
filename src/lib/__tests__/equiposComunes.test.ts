// Catálogo de equipos: alerta de mantenimiento y categorías, puro.
import { describe, it, expect } from 'vitest'
import {
  CATEGORIAS_EQUIPO, DIAS_AVISO_MANTO, ESTADOS_EQUIPO, alertaManto, categoriaEquipo, diasParaManto, estadoEquipo, requiereAtencion,
} from '../equiposComunes'

const HOY = '2026-11-10'

describe('diasParaManto', () => {
  it('cuenta días de calendario hacia la fecha, negativos si ya pasó, sin depender del huso horario', () => {
    expect(diasParaManto('2026-11-20', HOY)).toBe(10)
    expect(diasParaManto('2026-11-10', HOY)).toBe(0)
    expect(diasParaManto('2026-11-01', HOY)).toBe(-9)
    expect(diasParaManto('2027-01-01', HOY)).toBe(52)
  })
  it('sin fecha (o con basura) → null', () => {
    expect(diasParaManto(null, HOY)).toBeNull()
    expect(diasParaManto(undefined, HOY)).toBeNull()
    expect(diasParaManto('', HOY)).toBeNull()
    expect(diasParaManto('mañana', HOY)).toBeNull()
  })
})

describe('alertaManto / requiereAtencion', () => {
  const eq = (proximo: string | null, estado = 'operativo') => ({ proximo_mantenimiento: proximo, estado }) as Parameters<typeof alertaManto>[0]
  it('vencido si ya pasó, próximo hasta el plazo de aviso, ok después, sin_fecha si no hay', () => {
    expect(alertaManto(eq('2026-11-09'), HOY)).toBe('vencido')
    expect(alertaManto(eq('2026-11-10'), HOY)).toBe('proximo')
    expect(alertaManto(eq('2026-12-10'), HOY)).toBe('proximo')   // justo a DIAS_AVISO_MANTO
    expect(alertaManto(eq('2026-12-11'), HOY)).toBe('ok')
    expect(alertaManto(eq(null), HOY)).toBe('sin_fecha')
    expect(DIAS_AVISO_MANTO).toBe(30)
  })
  it('un equipo de baja no avisa aunque tenga la fecha vencida', () => {
    expect(alertaManto(eq('2020-01-01', 'baja'), HOY)).toBe('sin_fecha')
    expect(requiereAtencion(eq('2020-01-01', 'baja'), HOY)).toBe(false)
    expect(requiereAtencion(eq('2020-01-01', 'fuera_servicio'), HOY)).toBe(true)
    expect(requiereAtencion(eq('2026-11-25'), HOY)).toBe(true)
    expect(requiereAtencion(eq('2027-06-01'), HOY)).toBe(false)
  })
})

describe('catálogos', () => {
  it('las categorías incluyen las herramientas y los rubros operativos, y lo desconocido cae en «Otro»', () => {
    const valores = CATEGORIAS_EQUIPO.map(c => c.value)
    expect(valores).toEqual(expect.arrayContaining(['bomba', 'generador', 'herramienta', 'limpieza', 'jardineria', 'seguridad', 'otro']))
    expect(new Set(valores).size).toBe(valores.length)
    expect(categoriaEquipo('herramienta')).toMatchObject({ label: 'Herramienta', icon: '🔧' })
    expect(categoriaEquipo('lo que sea').value).toBe('otro')
  })
  it('los estados son los cuatro de la tabla y lo desconocido se lee como operativo', () => {
    expect(ESTADOS_EQUIPO.map(s => s.value)).toEqual(['operativo', 'mantenimiento', 'fuera_servicio', 'baja'])
    expect(estadoEquipo('baja').label).toBe('De baja')
    expect(estadoEquipo('???').value).toBe('operativo')
  })
})
