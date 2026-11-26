import { describe, it, expect } from 'vitest'
import { portalDelCliente, proyectosSinServicio, serviciosDelResidente, unidadConServicio } from '../portalServicios'

// Qué portal ve el residente: los servicios que su empresa contrata Y el
// proyecto de su unidad tiene encendidos (portal_mis_unidades ya los cruza).

const u = (project_id: string, agua: boolean, condominios: boolean) =>
  ({ id: `u-${project_id}-${agua}-${condominios}`, project_id, servicio_agua: agua, servicio_condominios: condominios })

describe('serviciosDelResidente', () => {
  it('un servicio que ninguna unidad tiene queda en false (no undefined)', () => {
    // El caso reportado: condominio sin Agua. Antes servicio_agua quedaba
    // undefined y App lo leía como «tiene Agua».
    expect(serviciosDelResidente([u('p1', false, true)])).toEqual({ servicio_agua: false, servicio_condominios: true })
  })

  it('basta una unidad con el servicio para tenerlo', () => {
    expect(serviciosDelResidente([u('p1', false, true), u('p2', true, false)]))
      .toEqual({ servicio_agua: true, servicio_condominios: true })
  })

  it('sin unidades: ningún servicio', () => {
    expect(serviciosDelResidente([])).toEqual({ servicio_agua: false, servicio_condominios: false })
  })

  it('sólo `true` enciende (un dato raro no cuenta como servicio)', () => {
    expect(serviciosDelResidente([{ servicio_agua: 'true', servicio_condominios: 1 }, null, 'x']))
      .toEqual({ servicio_agua: false, servicio_condominios: false })
  })

  it('lectura fallida → null (la sesión no inventa flags)', () => {
    expect(serviciosDelResidente(null)).toBeNull()
    expect(serviciosDelResidente(undefined)).toBeNull()
    expect(serviciosDelResidente({})).toBeNull()
  })
})

describe('portalDelCliente', () => {
  it('los dos servicios → selector Condominios / Agua', () => {
    expect(portalDelCliente({ servicio_agua: true, servicio_condominios: true })).toBe('dual')
  })

  it('Agua apagado en su proyecto o no contratado → sólo Condominios, sin botón Agua', () => {
    expect(portalDelCliente({ servicio_agua: false, servicio_condominios: true })).toBe('condominios')
  })

  it('Condominios apagado → sólo Agua', () => {
    expect(portalDelCliente({ servicio_agua: true, servicio_condominios: false })).toBe('agua')
  })

  it('flags sin resolver (lectura fallida) → respaldo histórico: Agua', () => {
    expect(portalDelCliente({})).toBe('agua')
    expect(portalDelCliente({ servicio_condominios: undefined, servicio_agua: undefined })).toBe('agua')
  })

  it('el flujo completo: residente de un condominio sin Agua no recibe el selector', () => {
    const flags = serviciosDelResidente([u('p1', false, true)])!
    expect(portalDelCliente(flags)).toBe('condominios')
  })
})

describe('unidadConServicio', () => {
  it('sólo un false explícito saca la unidad', () => {
    expect(unidadConServicio(u('p1', false, true), 'agua')).toBe(false)
    expect(unidadConServicio(u('p1', false, true), 'condominios')).toBe(true)
    expect(unidadConServicio({ id: 'legacy' }, 'condominios')).toBe(true)
  })
})

describe('proyectosSinServicio', () => {
  it('devuelve los proyectos con el servicio apagado', () => {
    const filas = [u('p1', false, true), u('p2', true, true), u('p3', false, false)]
    expect(proyectosSinServicio(filas, 'agua')).toEqual(new Set(['p1', 'p3']))
    expect(proyectosSinServicio(filas, 'condominios')).toEqual(new Set(['p3']))
  })

  it('un proyecto con alguna unidad encendida no se apaga', () => {
    expect(proyectosSinServicio([u('p1', false, true), u('p1', true, true)], 'agua')).toEqual(new Set())
  })

  it('ignora unidades sin proyecto y lecturas fallidas', () => {
    expect(proyectosSinServicio([{ servicio_agua: false }], 'agua')).toEqual(new Set())
    expect(proyectosSinServicio(null, 'agua')).toBeNull()
  })
})
