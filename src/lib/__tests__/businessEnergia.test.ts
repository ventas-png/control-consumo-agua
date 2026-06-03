import { describe, it, expect } from 'vitest'
import { validarFacturaEnergia, type FacturaValidable } from '../businessEnergia'
import type { FacturaEnergia } from '../../types'

// Las facturas existentes solo se leen por id/fuente_energia_id/periodo_fin.
const fact = (o: { id?: string; fuente_energia_id?: string; periodo_fin: string }): FacturaEnergia =>
  ({ id: o.id ?? 'x', fuente_energia_id: o.fuente_energia_id ?? 'F1', periodo_fin: o.periodo_fin } as unknown as FacturaEnergia)

const base: FacturaValidable = {
  fuente_energia_id: 'F1',
  periodo_inicio: '2026-05-01',
  periodo_fin: '2026-05-31',
  kwh_consumidos: 100,
}

describe('validarFacturaEnergia (serv:S6)', () => {
  it('factura válida sin previas → ok', () => {
    expect(validarFacturaEnergia(base, []).valido).toBe(true)
  })

  it('rechaza kWh consumidos negativos', () => {
    const r = validarFacturaEnergia({ ...base, kwh_consumidos: -1 }, [])
    expect(r.valido).toBe(false)
    expect(r.motivo).toMatch(/consumidos/i)
  })

  it('rechaza demanda máxima negativa', () => {
    expect(validarFacturaEnergia({ ...base, kw_demanda_max: -5 }, []).valido).toBe(false)
  })

  it('rechaza período con inicio posterior al fin', () => {
    const r = validarFacturaEnergia({ ...base, periodo_inicio: '2026-06-10', periodo_fin: '2026-06-01' }, [])
    expect(r.valido).toBe(false)
    expect(r.motivo).toMatch(/inicio/i)
  })

  it('rechaza período anterior al último registrado de la fuente', () => {
    const previas = [fact({ id: 'a', fuente_energia_id: 'F1', periodo_fin: '2026-05-31' })]
    const r = validarFacturaEnergia({ ...base, periodo_inicio: '2026-05-15', periodo_fin: '2026-06-15' }, previas)
    expect(r.valido).toBe(false)
    expect(r.motivo).toMatch(/último registrado/i)
  })

  it('acepta período que inicia en/después del último fin', () => {
    const previas = [fact({ id: 'a', fuente_energia_id: 'F1', periodo_fin: '2026-04-30' })]
    expect(validarFacturaEnergia({ ...base, periodo_inicio: '2026-05-01' }, previas).valido).toBe(true)
  })

  it('al editar, no se compara contra sí misma (mismo id)', () => {
    const self = fact({ id: 'self', fuente_energia_id: 'F1', periodo_fin: '2026-05-31' })
    const r = validarFacturaEnergia({ ...base, id: 'self', periodo_inicio: '2026-05-01' }, [self])
    expect(r.valido).toBe(true)
  })

  it('una factura de otra fuente no bloquea', () => {
    const otra = [fact({ id: 'b', fuente_energia_id: 'F2', periodo_fin: '2027-01-31' })]
    expect(validarFacturaEnergia(base, otra).valido).toBe(true)
  })
})
