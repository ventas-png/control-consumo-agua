import { describe, it, expect, vi } from 'vitest'
import type { PropiedadRenta } from '../../../types'

vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
const { resolverPropiedad, errorDePropiedad } = await import('../finanzas/ImportarReservasModal')

const p = (id: string, nombre: string, codigo: string | null = null, project_id: string | null = null) =>
  ({ id, nombre, codigo, project_id }) as PropiedadRenta
const LISTA = [p('1', 'Apto 1A', 'SQ-1A'), p('2', 'Apto. 3C'), p('3', 'Casa Lago'), p('4', 'Casa Lago', 'CL-2')]

describe('resolverPropiedad (carga masiva de varias propiedades)', () => {
  it('por nombre o por código, sin distinguir acentos, puntos ni mayúsculas', () => {
    expect(resolverPropiedad('apto 1a', LISTA)).toBe(LISTA[0])
    expect(resolverPropiedad('sq-1a', LISTA)).toBe(LISTA[0])
    expect(resolverPropiedad(' APTO 3C ', LISTA)).toBe(LISTA[1])
  })
  it('nombre repetido → «varias» (se resuelve con el código); desconocido o vacío → «ninguna»', () => {
    expect(resolverPropiedad('Casa Lago', LISTA)).toEqual({ varias: [LISTA[2], LISTA[3]] })
    expect(resolverPropiedad('CL-2', LISTA)).toBe(LISTA[3])
    expect(resolverPropiedad('Apto 9Z', LISTA)).toBe('ninguna')
    expect(resolverPropiedad('', LISTA)).toBe('ninguna')
  })

  describe('con la columna «Proyecto»', () => {
    const PROYECTOS = new Map([['sq', 'Edificio SQ'], ['b21', '21B+']])
    const DOS = [p('a', 'Apto 1A', null, 'sq'), p('b', 'Apto 1A', null, 'b21'), p('c', 'Apto 1A'), p('d', 'Apto 5B', null, 'b21')]
    const res = (prop: string, proy = '') => resolverPropiedad(prop, DOS, proy, PROYECTOS)

    it('el mismo nombre en dos proyectos se distingue por el proyecto', () => {
      expect(res('Apto 1A', 'edificio sq')).toBe(DOS[0])
      expect(res('apto 1a', ' 21b+ ')).toBe(DOS[1])
      expect(res('Apto 1A', 'Independiente')).toBe(DOS[2])
    })
    it('sin proyecto, un nombre repetido no se adivina y el error dice dónde está', () => {
      const r = res('Apto 1A')
      expect(r).toEqual({ varias: [DOS[0], DOS[1], DOS[2]] })
      expect(errorDePropiedad(r, 'Apto 1A', '', PROYECTOS))
        .toBe('Propiedad «Apto 1A»: está en Edificio SQ, 21B+, Independiente; indica cuál en la columna Proyecto o usa su código')
    })
    it('un nombre único no necesita proyecto, pero si se da tiene que coincidir', () => {
      expect(res('Apto 5B')).toBe(DOS[3])
      expect(res('Apto 5B', '21B+')).toBe(DOS[3])
      expect(res('Apto 5B', 'Edificio SQ')).toBe('no_en_proyecto')
      expect(errorDePropiedad('no_en_proyecto', 'Apto 5B', 'Edificio SQ', PROYECTOS)).toBe('Propiedad «Apto 5B»: no está en «Edificio SQ»')
    })
    it('proyecto que no existe → error propio, nunca cae en otra propiedad', () => {
      expect(res('Apto 1A', 'Torre Norte')).toBe('proyecto_desconocido')
      expect(errorDePropiedad('proyecto_desconocido', 'Apto 1A', 'Torre Norte', PROYECTOS))
        .toBe('Proyecto «Torre Norte»: no hay propiedades de corto plazo en un proyecto con ese nombre')
    })
  })
})
