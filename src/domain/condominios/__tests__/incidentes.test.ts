import { describe, it, expect } from 'vitest'
import { agregarSeguimiento, diasAbierto, estaAbierto, masRecientePrimero, reportanteDe } from '../incidentes'
import type { IncidenteSeguridad, PersonalCondominio } from '../../../types'

const HOY = new Date(2026, 9, 26, 22, 0) // 26 oct, 10 de la noche (local)

describe('agregarSeguimiento', () => {
  const cuando = new Date(2026, 9, 26, 9, 5)

  it('la primera nota lleva fecha, hora y autor', () => {
    expect(agregarSeguimiento(null, 'Se revisaron las cámaras.', cuando, 'Ana López'))
      .toBe('[2026-10-26 09:05 · Ana López] Se revisaron las cámaras.')
  })

  it('las siguientes van debajo y lo anterior queda igual', () => {
    expect(agregarSeguimiento('Primera nota escrita a mano.\n', '  Denuncia presentada.  ', cuando, 'Ana López'))
      .toBe('Primera nota escrita a mano.\n[2026-10-26 09:05 · Ana López] Denuncia presentada.')
  })

  it('sin autor no deja el separador colgando; una nota vacía no cambia nada', () => {
    expect(agregarSeguimiento('', 'Ok', cuando, '  ')).toBe('[2026-10-26 09:05] Ok')
    expect(agregarSeguimiento('Anterior', '   ', cuando, 'Ana')).toBe('Anterior')
  })
})

describe('diasAbierto', () => {
  it('cuenta días de calendario desde la fecha mientras está abierto', () => {
    expect(diasAbierto({ estado: 'reportado', fecha: '2026-10-26' }, HOY)).toBe(0)
    expect(diasAbierto({ estado: 'investigando', fecha: '2026-10-10' }, HOY)).toBe(16)
  })

  it('resuelto o cerrado ya no cuenta; una fecha futura no da negativos', () => {
    expect(diasAbierto({ estado: 'resuelto', fecha: '2026-10-10' }, HOY)).toBeNull()
    expect(diasAbierto({ estado: 'cerrado', fecha: '2026-10-10' }, HOY)).toBeNull()
    expect(diasAbierto({ estado: 'reportado', fecha: '2026-10-28' }, HOY)).toBe(0)
    expect(estaAbierto({ estado: 'resuelto' })).toBe(false)
  })
})

describe('masRecientePrimero', () => {
  const inc = (id: string, fecha: string, hora: string | null, created_at = '2026-10-01T00:00:00Z') =>
    ({ id, fecha, hora, created_at }) as IncidenteSeguridad

  it('ordena por fecha, luego hora y luego hora de captura', () => {
    const lista = [inc('a', '2026-10-20', '08:00'), inc('b', '2026-10-21', null), inc('c', '2026-10-20', '22:00'),
      inc('d', '2026-10-20', '22:00', '2026-10-20T23:00:00Z')]
    expect(lista.sort(masRecientePrimero).map(i => i.id)).toEqual(['b', 'd', 'c', 'a'])
  })
})

describe('reportanteDe — «Reportado por» propuesto con el usuario que registra', () => {
  const ficha = (o: Partial<PersonalCondominio>) => ({
    id: 'pe1', company_id: 'co1', project_id: 'p1', nombre: 'Ana López', cargo: 'guardia', turno: 'nocturno',
    estado: 'activo', created_at: '2026-01-01T00:00:00Z', user_id: 'u-ana', ...o,
  }) as PersonalCondominio

  it('con ficha activa: nombre y cargo (del catálogo del condominio si lo renombró)', () => {
    expect(reportanteDe('u-ana', 'ana@x.com', [ficha({})])).toBe('Ana López — Guardia')
    expect(reportanteDe('u-ana', 'ana@x.com', [ficha({})], [{ id: 'c1', company_id: 'co1', project_id: 'p1', codigo: 'guardia', nombre: 'Agente de seguridad', icono: '💂', orden: 1, activo: true, created_at: '', updated_at: '' }]))
      .toBe('Ana López — Agente de seguridad')
  })

  it('sin ficha, o con la ficha inactiva, el nombre del usuario', () => {
    expect(reportanteDe('u-admin', ' Prestadora ', [ficha({})])).toBe('Prestadora')
    expect(reportanteDe('u-ana', 'Ana', [ficha({ estado: 'inactivo' })])).toBe('Ana')
    expect(reportanteDe(undefined, undefined, [ficha({})])).toBe('')
  })
})
