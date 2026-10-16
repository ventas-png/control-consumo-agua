// Reglas del registro de mascotas/vehículos en el portal (20261031000500). El
// servidor (portal_enviar_*) es quien manda; esto solo debe ESPEJARLO para que el
// residente vea el error antes de enviar. Lo que la BD exige se prueba en
// supabase/tests/padron_autorizacion.
import { describe, it, expect } from 'vitest'
import { armarVacunas, exigeVacunas, normalizarPlaca, placaValida, VACUNAS_POR_ESPECIE } from '../padronMascotas'

const HOY = '2026-10-16'

describe('armarVacunas', () => {
  it('perros y gatos exigen al menos una vacuna; aves y otros no', () => {
    expect(exigeVacunas('perro')).toBe(true)
    expect(exigeVacunas('gato')).toBe(true)
    expect(armarVacunas('perro', {}, [], HOY).error).toMatch(/al menos una vacuna/)
    expect(armarVacunas('ave', {}, [], HOY)).toEqual({ vacunas: [], error: null })
  })

  it('arma catálogo + otras en orden, con la próxima dosis opcional', () => {
    const rabia = VACUNAS_POR_ESPECIE.perro[0]
    const r = armarVacunas('perro',
      { [rabia]: { fecha: '2026-01-10', proxima: '2027-01-10' } },
      [{ tipo: ' Giardia ', fecha: '2026-02-01', proxima: '' }, { tipo: '', fecha: '', proxima: '' }],
      HOY)
    expect(r.error).toBeNull()
    expect(r.vacunas).toEqual([
      { tipo: rabia, fecha: '2026-01-10', proxima: '2027-01-10' },
      { tipo: 'Giardia', fecha: '2026-02-01', proxima: null },
    ])
  })

  it('una vacuna marcada sin fecha, sin nombre o con fecha futura es un error', () => {
    const rabia = VACUNAS_POR_ESPECIE.gato[0]
    expect(armarVacunas('gato', { [rabia]: { fecha: '', proxima: '' } }, [], HOY).error).toMatch(/fecha/)
    expect(armarVacunas('gato', {}, [{ tipo: '', fecha: '2026-01-01', proxima: '' }], HOY).error).toMatch(/nombre/)
    expect(armarVacunas('gato', { [rabia]: { fecha: '2027-01-01', proxima: '' } }, [], HOY).error).toMatch(/futura/)
  })

  it('las marcas de otra especie no se cuelan', () => {
    const delGato = VACUNAS_POR_ESPECIE.gato[1]
    expect(armarVacunas('perro', { [delGato]: { fecha: '2026-01-01', proxima: '' } }, [], HOY).error)
      .toMatch(/al menos una vacuna/)
  })
})

describe('placa', () => {
  it('se normaliza como el servidor: mayúsculas y un solo espacio', () => {
    expect(normalizarPlaca('  p  123   abc ')).toBe('P 123 ABC')
  })

  it('acepta letras, números, espacio y guion; rechaza lo demás', () => {
    expect(placaValida('P-123ABC')).toBe(true)
    expect(placaValida('m 456 xyz')).toBe(true)
    expect(placaValida('<script>')).toBe(false)
    expect(placaValida('-123')).toBe(false)
    expect(placaValida('A')).toBe(false)
  })
})
