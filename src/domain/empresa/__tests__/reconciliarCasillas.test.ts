// reconciliarCasillas (domain/empresa/usuarios): la fusión de TRES vías de las casillas tras un guardado parcial o incierto (H1 de la ronda 4).
//
//   casillas nuevas = (inicial NUEVO \ lo que la persona QUITÓ) ∪ (lo que la persona AÑADIÓ), limitada a los proyectos editables
//   quitó = inicial ANTERIOR \ casillas      añadió = casillas \ inicial ANTERIOR
//
// Sin esta fusión la relectura renovaba `inicial` pero dejaba las casillas como estaban: si otro administrador había cambiado a la misma persona entre la apertura y la
// relectura, el siguiente «Guardar» sin tocar nada borraba una asignación ajena que la persona nunca vio, o REINSERTABA una que el otro acababa de revocar.
import { describe, it, expect, vi } from 'vitest'

// el módulo importa el cliente de supabase; la función es pura y no lo usa
vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}), auth: {} } }))

import { reconciliarCasillas } from '../usuarios'

const EDIT = ['p1', 'p2', 'p3', 'p4']
const orden = (s: Set<string>) => [...s].sort()

describe('reconciliarCasillas · tres vías', () => {
  it('sin cambios propios ni ajenos las casillas quedan como estaban', () => {
    expect(orden(reconciliarCasillas(['p1', 'p2'], ['p1', 'p2'], new Set(['p1', 'p2']), EDIT))).toEqual(['p1', 'p2'])
  })

  it('ALTA ajena sin cambio propio: la casilla aparece marcada (no se borrará al reintentar)', () => {
    expect(orden(reconciliarCasillas(['p1', 'p2'], ['p1', 'p2', 'p4'], new Set(['p1', 'p2']), EDIT))).toEqual(['p1', 'p2', 'p4'])
  })

  it('BAJA ajena sin cambio propio: la casilla aparece desmarcada (no se reinsertará al reintentar)', () => {
    expect(orden(reconciliarCasillas(['p1', 'p2'], ['p1'], new Set(['p1', 'p2']), EDIT))).toEqual(['p1'])
  })

  it('ALTA propia que NO se aplicó (no está en el inicial nuevo): sigue marcada, es lo que la persona quiere', () => {
    expect(orden(reconciliarCasillas(['p1'], ['p1'], new Set(['p1', 'p3']), EDIT))).toEqual(['p1', 'p3'])
  })

  it('ALTA propia que SÍ se aplicó (está en el inicial nuevo): sigue marcada', () => {
    expect(orden(reconciliarCasillas(['p1'], ['p1', 'p3'], new Set(['p1', 'p3']), EDIT))).toEqual(['p1', 'p3'])
  })

  it('BAJA propia pendiente (el inicial nuevo todavía la tiene): sigue desmarcada, es lo que la persona quiere', () => {
    expect(orden(reconciliarCasillas(['p1', 'p2'], ['p1', 'p2'], new Set(['p1']), EDIT))).toEqual(['p1'])
  })

  it('BAJA propia ya aplicada (el inicial nuevo ya no la tiene): sigue desmarcada', () => {
    expect(orden(reconciliarCasillas(['p1', 'p2'], ['p1'], new Set(['p1']), EDIT))).toEqual(['p1'])
  })

  it('cambio propio y ajeno a la vez: cada proyecto sigue su regla (p2 lo quitó ella, p4 lo añadió otro, p1 lo quitó otro)', () => {
    // la persona tenía {p1,p2}, quitó p2 y añadió p3; otro administrador quitó p1 y añadió p4; el servidor guardó p3 (el DELETE de p2 no llegó a correr)
    // p1: no la tocó y el otro la quitó → fuera; p2: la quitó ella (y el servidor aún la tiene) → fuera; p3: la añadió ella → dentro; p4: la añadió el otro → dentro
    expect(orden(reconciliarCasillas(['p1', 'p2'], ['p2', 'p3', 'p4'], new Set(['p1', 'p3']), EDIT))).toEqual(['p3', 'p4'])
  })

  it('un proyecto que la persona quitó y marcó otra vez cuenta como NO tocado (casilla igual que el inicial anterior)', () => {
    expect(orden(reconciliarCasillas(['p1', 'p2'], ['p1'], new Set(['p1', 'p2']), EDIT))).toEqual(['p1'])
  })

  it('queda LIMITADA a los proyectos editables: lo que el inicial nuevo trae de un proyecto que la pantalla no muestra no entra', () => {
    expect(orden(reconciliarCasillas(['p1'], ['p1', 'p9'], new Set(['p1']), EDIT))).toEqual(['p1'])
  })

  it('y lo que las casillas traían de un proyecto que ya no se muestra tampoco', () => {
    expect(orden(reconciliarCasillas(['p1'], ['p1'], new Set(['p1', 'p9']), EDIT))).toEqual(['p1'])
  })

  it('acepta las casillas como arreglo o como conjunto y no muta ninguna entrada', () => {
    const anterior = ['p1', 'p2'], nuevo = ['p1', 'p4'], casillas = new Set(['p2', 'p3']), edit = [...EDIT]
    const r1 = reconciliarCasillas(anterior, nuevo, casillas, edit)
    const r2 = reconciliarCasillas(anterior, nuevo, ['p2', 'p3'], edit)
    expect(orden(r1)).toEqual(['p3', 'p4'])
    expect(orden(r2)).toEqual(orden(r1))
    expect(anterior).toEqual(['p1', 'p2']); expect(nuevo).toEqual(['p1', 'p4']); expect([...casillas]).toEqual(['p2', 'p3']); expect(edit).toEqual(EDIT)
  })
})
