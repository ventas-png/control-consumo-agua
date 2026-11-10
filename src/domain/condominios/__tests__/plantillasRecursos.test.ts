// Recursos en bloque — lado del navegador: la celda se parte como en el servidor, la RPC recibe
// ids con cantidad y obligatoria normalizadas, y los conteos se leen en una frase.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: m.rpc }, warmUpSupabase: vi.fn() }))

import {
  aplicarRecursosEnBloque, herramientaDeBaja, herramientaId, herramientaNombre, mensajeErrorBloque, parsearRecursoTexto, resumenBloque,
} from '../plantillasRecursos'

beforeEach(() => { m.rpc.mockReset() })

describe('parsearRecursoTexto (espejo de plantillas_import_partir_recursos)', () => {
  it('parte por «;», lee « x n» y «!» final', () => {
    expect(parsearRecursoTexto('Escoba; Bolsa x 3; Trapeador x2!; Hidrolavadora!')).toEqual([
      { nombre: 'Escoba', cantidad: null, obligatoria: false },
      { nombre: 'Bolsa', cantidad: 3, obligatoria: false },
      { nombre: 'Trapeador', cantidad: 2, obligatoria: true },
      { nombre: 'Hidrolavadora', cantidad: null, obligatoria: true },
    ])
  })
  it('admite coma o punto decimal, «×» y espacios de más; ignora vacíos', () => {
    expect(parsearRecursoTexto('  Cloro x 1,5 ;; Jabón × 2.25 ; ')).toEqual([
      { nombre: 'Cloro', cantidad: 1.5, obligatoria: false },
      { nombre: 'Jabón', cantidad: 2.25, obligatoria: false },
    ])
    expect(parsearRecursoTexto('')).toEqual([])
    expect(parsearRecursoTexto(null)).toEqual([])
  })
  it('una «x» dentro del nombre no es cantidad (solo « x n» al final)', () => {
    expect(parsearRecursoTexto('Extintor x10; Cajax2')).toEqual([
      { nombre: 'Extintor', cantidad: 10, obligatoria: false },
      { nombre: 'Cajax2', cantidad: null, obligatoria: false },
    ])
  })
})

describe('aplicarRecursosEnBloque', () => {
  it('manda ids, cantidad (1 por omisión) y obligatoria (false por omisión) a la RPC', async () => {
    m.rpc.mockResolvedValueOnce({ data: { accion: 'agregar', plantillas: 2, recursos: 2, pares: 4, agregados: 3, ya_estaban: 1, quitados: 0, no_estaban: 0 }, error: null })
    const r = await aplicarRecursosEnBloque('p1', ['a', 'b'], 'agregar', { suministros: [{ id: 's1', cantidad: 2.5 }], equipos: [{ id: 'e1' }] })
    expect(m.rpc).toHaveBeenCalledWith('plantillas_recursos_en_bloque', {
      p_project_id: 'p1', p_plantilla_ids: ['a', 'b'], p_accion: 'agregar',
      p_suministros: [{ id: 's1', cantidad: 2.5 }], p_equipos: [{ id: 'e1', cantidad: 1, obligatoria: false }],
    })
    expect(r.agregados).toBe(3)
  })
  it('el error del servidor llega sin el prefijo técnico', async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { message: 'PLANTILLAS_BLOQUE_ALCANCE: 1 de las actividades no existen en este proyecto.' } })
    await expect(aplicarRecursosEnBloque('p1', ['a'], 'quitar', { suministros: [{ id: 's1' }], equipos: [] })).rejects.toThrow('1 de las actividades no existen en este proyecto.')
    expect(mensajeErrorBloque('sin prefijo')).toBe('sin prefijo')
  })
})

describe('herramienta planificada: equipo hoy, inventario en el legado', () => {
  it('id, nombre y baja salen del equipo cuando lo hay, y del artículo de inventario en las filas viejas', () => {
    const nueva = { equipo_id: 'eq1', inventario_id: null, equipo_nombre: 'Hidrolavadora', equipo_estado: 'operativo' }
    const legada = { equipo_id: null, inventario_id: 'inv1', inventario_nombre: 'Trapeador', inventario_estado: 'dado_de_baja' }
    expect([herramientaId(nueva), herramientaNombre(nueva), herramientaDeBaja(nueva)]).toEqual(['eq1', 'Hidrolavadora', false])
    expect([herramientaId(legada), herramientaNombre(legada), herramientaDeBaja(legada)]).toEqual(['inv1', 'Trapeador', true])
    expect(herramientaDeBaja({ equipo_id: 'eq2', inventario_id: null, equipo_estado: 'baja' })).toBe(true)
    expect(herramientaDeBaja({ equipo_id: null, inventario_id: 'inv2', inventario_estado: 'disponible' })).toBe(false)
  })
})

describe('resumenBloque', () => {
  it('cuenta agregados y los que ya estaban', () => {
    expect(resumenBloque({ accion: 'agregar', plantillas: 3, recursos: 3, pares: 9, agregados: 7, ya_estaban: 2, quitados: 0, no_estaban: 0 }))
      .toBe('7 vínculos agregados en 3 actividades · 2 ya estaban (sin cambios)')
    expect(resumenBloque({ accion: 'agregar', plantillas: 1, recursos: 1, pares: 1, agregados: 1, ya_estaban: 0, quitados: 0, no_estaban: 0 }))
      .toBe('1 vínculo agregado en 1 actividad')
  })
  it('cuenta quitados y los que no estaban', () => {
    expect(resumenBloque({ accion: 'quitar', plantillas: 2, recursos: 1, pares: 2, agregados: 0, ya_estaban: 0, quitados: 1, no_estaban: 1 }))
      .toBe('1 vínculo quitado de 2 actividades · 1 no estaba')
  })
})
