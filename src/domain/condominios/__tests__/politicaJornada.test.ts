// La vara de la jornada: los tres tramos y el diff de cupos.
//
// QUÉ SE CUBRE. Lo que el sandbox SQL no puede ver: cómo se LEE la política, que
// es lo que decide si quien la configura entiende lo que está declarando. Un
// tramo compensable mal descrito no rompe ninguna prueba de base de datos y sí
// hace que alguien fije una política distinta de la que cree.
import { describe, it, expect, vi } from 'vitest'
vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
import { minutosCupoQueDescuentan, tramosDemora } from '../politicaJornada'
import type { TipoPausa } from '../../../types'

const TIPOS: TipoPausa[] = [
  { codigo: 'refaccion', etiqueta: 'Refacción', descuenta: false, minutos_max: 30, orden: 1, configurado: true },
  { codigo: 'almuerzo', etiqueta: 'Almuerzo', descuenta: true, minutos_max: 60, orden: 2, configurado: true },
  { codigo: 'cena', etiqueta: 'Cena', descuenta: true, minutos_max: 60, orden: 3, configurado: true },
]

describe('los tres tramos de la demora', () => {
  it('con tramo compensable dice las tres cosas, en orden', () => {
    expect(tramosDemora(10, 30)).toEqual({
      sinConsecuencia: 'Hasta 10 min tarde: no pasa nada',
      compensable: 'De 10 a 30 min: se compensa',
      debitada: 'Más de 30 min: se debita',
    })
  })

  it('sin tramo compensable (0) la demora pasa directo a débito', () => {
    const t = tramosDemora(10, 0)
    expect(t.compensable).toBeNull()
    expect(t.debitada).toBe('Más de 10 min: se debita')
  })

  it('un tope por debajo de la tolerancia NO inventa un tramo imposible', () => {
    // La base lo rechaza con un CHECK; aquí se comprueba que, si llegara a
    // pantalla mientras se teclea, no se describa un tramo que no existe.
    const t = tramosDemora(45, 30)
    expect(t.compensable).toBeNull()
    expect(t.debitada).toBe('Más de 45 min: se debita')
  })

  it('sin tolerancia lo dice sin rodeos', () => {
    expect(tramosDemora(0, 0).sinConsecuencia).toBe('Cualquier minuto tarde ya cuenta')
  })

  it('tolera basura del formulario sin romperse', () => {
    // Los inputs son texto: `Number('')` es 0 y `Number('abc')` es NaN.
    expect(tramosDemora(NaN, NaN).sinConsecuencia).toBe('Cualquier minuto tarde ya cuenta')
    expect(tramosDemora(-5, -1).debitada).toBe('Más de 0 min: se debita')
  })
})

describe('la suma de cupos que descuentan', () => {
  it('suma solo los que descuentan', () => {
    expect(minutosCupoQueDescuentan({ refaccion: 15, almuerzo: 45 }, TIPOS)).toBe(45)
  })

  it('ignora vacíos, ceros y basura', () => {
    expect(minutosCupoQueDescuentan(
      { almuerzo: 45, cena: null, refaccion: 0, inventado: 99 }, TIPOS,
    )).toBe(45)
  })

  it('un tipo que no está en el catálogo no suma', () => {
    // Un cupo puede quedar huérfano si la empresa retira un tipo. Es inerte, y
    // esta es la mitad de por qué: nada lo cuenta.
    expect(minutosCupoQueDescuentan({ siesta: 120 }, TIPOS)).toBe(0)
  })
})
