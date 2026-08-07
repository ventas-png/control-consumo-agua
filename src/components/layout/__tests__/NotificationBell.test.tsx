import { describe, it, expect } from 'vitest'
import { calcularPosicion } from '../NotificationBell'

// La campana vive en la cabecera del portal, no pegada al borde derecho.
function ancla(right: number, bottom = 100): DOMRect {
  return { right, bottom, left: right - 34, top: bottom - 34, width: 34, height: 34, x: right - 34, y: bottom - 34, toJSON: () => ({}) } as DOMRect
}

describe('calcularPosicion', () => {
  // El fallo reportado: en un teléfono de 393px la campana está a ~200px del
  // borde, así que un panel de 340px anclado a su derecha empezaba en -140.
  it('no deja que el panel se salga por la izquierda en un teléfono', () => {
    const p = calcularPosicion(ancla(200), 393, 852)
    expect(p.left).toBeGreaterThanOrEqual(0)
    expect(p.left + p.width).toBeLessThanOrEqual(393)
  })

  // Cuando hay sitio, se conserva la alineación a la derecha del icono de siempre.
  it('alinea el panel con el borde derecho de la campana cuando cabe', () => {
    const p = calcularPosicion(ancla(1200), 1440, 900)
    expect(p.left + p.width).toBe(1200)
    expect(p.width).toBe(340)
  })

  it('tampoco se sale por la derecha', () => {
    const p = calcularPosicion(ancla(1440), 1440, 900)
    expect(p.left + p.width).toBeLessThanOrEqual(1440)
  })

  it('encoge el panel en pantallas más angostas que él', () => {
    const p = calcularPosicion(ancla(300), 320, 568)
    expect(p.width).toBe(320 - 16)
    expect(p.left).toBe(8)
  })

  // Con `fixed` el panel ya no alarga la página: hay que acotarlo por abajo.
  it('acota el alto al espacio que queda bajo la campana', () => {
    const p = calcularPosicion(ancla(200, 700), 393, 852)
    expect(p.top).toBe(708)
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(852)
  })

  it('nunca devuelve un alto negativo', () => {
    expect(calcularPosicion(ancla(200, 900), 393, 852).maxHeight).toBe(0)
  })
})
