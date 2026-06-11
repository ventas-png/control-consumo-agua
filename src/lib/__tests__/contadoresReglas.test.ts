import { describe, it, expect } from 'vitest'
import {
  construirPayloadContador,
  filtrarContadores,
  resumenPorTipo,
  tarifasParaTipo,
  validarContador,
  type ContadorForm,
} from '../contadoresReglas'
import type { Contador, Tarifa, TipoAgua } from '../../types'

function form(partial: Partial<ContadorForm>): ContadorForm {
  return {
    numero_serie: 'CTR-1', tipo_agua: 'potable', descripcion: '', marca: '', modelo: '',
    fecha_instalacion: '', lectura_inicial: '0', activo: true, tarifa_id: '', unidad_id: '',
    medida: '', material: '', tipo_contador: '', valvula_cheque: '', tipo_llave: '',
    llave_antifraude: '', valvula_aire: '', fecha_reemplazo_sugerida: '',
    numero_derecho_servicio: '', cantidad_derecho_servicio_m3: '', periodicidad_lectura_dias: '',
    contratista_instalador: '', garantia_instalacion_vence: '',
    ...partial,
  }
}

function contador(partial: Partial<Contador>): Contador {
  return {
    id: 'c1', numero_serie: 'CTR-1', tipo_agua: 'potable' as TipoAgua,
    lectura_inicial: 0, activo: true,
    ...partial,
  } as Contador
}

describe('validarContador', () => {
  it('acepta serie válida y lectura >= 0', () => {
    expect(validarContador('CTR-1', 0)).toEqual([])
    expect(validarContador('AB', 12.5)).toEqual([])
  })

  it('rechaza serie corta y lectura inválida', () => {
    expect(validarContador('A', 0)).toHaveLength(1)
    expect(validarContador('', NaN)).toHaveLength(2)
    expect(validarContador('CTR-1', -1)).toHaveLength(1)
  })
})

describe('construirPayloadContador', () => {
  it('normaliza vacíos a null y parsea numéricos', () => {
    const p = construirPayloadContador(form({
      cantidad_derecho_servicio_m3: '15.5', periodicidad_lectura_dias: '30',
    }), 'CTR-1', 2.5)
    expect(p.numero_serie).toBe('CTR-1')
    expect(p.lectura_inicial).toBe(2.5)
    expect(p.descripcion).toBeNull()
    expect(p.tarifa_id).toBeNull()
    expect(p.cantidad_derecho_servicio_m3).toBe(15.5)
    expect(p.periodicidad_lectura_dias).toBe(30)
  })

  it('numéricos vacíos quedan en null', () => {
    const p = construirPayloadContador(form({}), 'CTR-1', 0)
    expect(p.cantidad_derecho_servicio_m3).toBeNull()
    expect(p.periodicidad_lectura_dias).toBeNull()
  })
})

describe('filtrarContadores / resumenPorTipo / tarifasParaTipo', () => {
  const lista = [
    contador({ id: 'a', numero_serie: 'CTR-001', marca: 'Sensus', tarifa_id: 't1' }),
    contador({ id: 'b', numero_serie: 'CTR-002', tipo_agua: 'riego' as TipoAgua, unidad_id: 'u1', descripcion: 'jardín norte' }),
  ]

  it('filtra por texto (serie/marca/descripción), tipo y unidad', () => {
    expect(filtrarContadores(lista, 'sensus', '', '').map(c => c.id)).toEqual(['a'])
    expect(filtrarContadores(lista, 'jardín', '', '').map(c => c.id)).toEqual(['b'])
    expect(filtrarContadores(lista, '', 'riego', '').map(c => c.id)).toEqual(['b'])
    expect(filtrarContadores(lista, '', '', 'u1').map(c => c.id)).toEqual(['b'])
    expect(filtrarContadores(lista, 'ctr', 'riego', 'u1').map(c => c.id)).toEqual(['b'])
  })

  it('resumen solo incluye tipos con contadores y cuenta los que tienen tarifa', () => {
    const tipos: { value: TipoAgua; label: string }[] = [
      { value: 'potable', label: 'Potable' }, { value: 'riego', label: 'Riego' }, { value: 'piscina', label: 'Piscina' },
    ]
    expect(resumenPorTipo(lista, tipos)).toEqual([
      { value: 'potable', label: 'Potable', total: 1, conTarifa: 1 },
      { value: 'riego', label: 'Riego', total: 1, conTarifa: 0 },
    ])
  })

  it('tarifasParaTipo exige tipo y activa', () => {
    const tarifas = [
      { id: 't1', tipo_agua: 'potable', activa: true } as Tarifa,
      { id: 't2', tipo_agua: 'potable', activa: false } as Tarifa,
      { id: 't3', tipo_agua: 'riego', activa: true } as Tarifa,
    ]
    expect(tarifasParaTipo(tarifas, 'potable').map(t => t.id)).toEqual(['t1'])
  })
})
