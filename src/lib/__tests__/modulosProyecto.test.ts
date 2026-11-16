// Módulos por proyecto (migración 20261127000000): la lógica pura que decide en
// qué módulos opera cada proyecto y qué ve cada módulo. Quién mueve los
// interruptores y el «al menos uno» los ejecuta supabase/tests/modulos_por_proyecto.
import { describe, it, expect } from 'vitest'
import type { Cliente, Contador, Proyecto, Registro, Ruta, Tarifa, Unidad } from '../../types'
import {
  acotarAguaAlModulo, modulosActivosDeProyecto, modulosContratados, moduloSinProyectos,
  proyectoTieneModulo, proyectosConModulo, validarSeleccionModulos, type ColeccionesAgua,
} from '../modulosProyecto'
import { buildClienteProjectIndex } from '../projectScope'

const proy = (id: string, extra: Partial<Proyecto> = {}) => ({ id, nombre: id, estado: 'activo', ...extra }) as Proyecto
// El caso del pedido: uno con los tres, otro con Agua + Condominios, otro sólo Agua.
const TORRE = proy('torre')
const RESIDENCIAL = proy('residencial', { modulo_rentas: false })
const LOTES = proy('lotes', { modulo_condominios: false, modulo_rentas: false })
const SOLO_CONDO = proy('condo', { modulo_agua: false })

describe('modulosContratados', () => {
  it('Agua y Condominios salvo false explícito; Rentas sólo con true', () => {
    expect(modulosContratados({})).toEqual(['agua', 'condominios'])
    expect(modulosContratados({ servicio_agua: true, servicio_condominios: true, servicio_rentas: true })).toEqual(['agua', 'condominios', 'rentas'])
    expect(modulosContratados({ servicio_agua: false, servicio_rentas: true })).toEqual(['condominios', 'rentas'])
    expect(modulosContratados(null)).toEqual([])
  })
})

describe('módulos de un proyecto', () => {
  it('sólo false apaga: un proyecto leído sin la columna tiene todo encendido', () => {
    expect(proyectoTieneModulo(TORRE, 'agua')).toBe(true)
    expect(proyectoTieneModulo(LOTES, 'condominios')).toBe(false)
  })

  it('los activos son los contratados que el proyecto no apagó', () => {
    const tres = ['agua', 'condominios', 'rentas'] as const
    expect(modulosActivosDeProyecto(TORRE, tres)).toEqual(['agua', 'condominios', 'rentas'])
    expect(modulosActivosDeProyecto(RESIDENCIAL, tres)).toEqual(['agua', 'condominios'])
    expect(modulosActivosDeProyecto(LOTES, tres)).toEqual(['agua'])
    // El proyecto no enciende lo que la empresa no contrató.
    expect(modulosActivosDeProyecto(TORRE, ['agua'])).toEqual(['agua'])
  })

  it('proyectosConModulo filtra por módulo y devuelve la misma lista si nadie lo apagó', () => {
    const todos = [TORRE, RESIDENCIAL, LOTES]
    expect(proyectosConModulo(todos, 'agua')).toBe(todos)
    expect(proyectosConModulo(todos, 'condominios').map(p => p.id)).toEqual(['torre', 'residencial'])
    expect(proyectosConModulo(todos, 'rentas').map(p => p.id)).toEqual(['torre'])
  })

  it('validarSeleccionModulos exige al menos uno de los CONTRATADOS', () => {
    const sel = (agua: boolean, condominios: boolean, rentas: boolean) => ({ agua, condominios, rentas })
    expect(validarSeleccionModulos(sel(true, false, false), ['agua', 'condominios'])).toBeNull()
    expect(validarSeleccionModulos(sel(false, false, false), ['agua', 'condominios'])).toMatch(/al menos un módulo/)
    // Rentas marcado no cuenta si la empresa no lo contrató.
    expect(validarSeleccionModulos(sel(false, false, true), ['agua', 'condominios'])).toMatch(/al menos un módulo/)
  })
})

describe('moduloSinProyectos (ocultar el menú de un módulo)', () => {
  it('sólo cuando hay proyectos y ninguno opera en el módulo', () => {
    expect(moduloSinProyectos([], 'agua')).toBe(false)
    expect(moduloSinProyectos([TORRE, LOTES], 'condominios')).toBe(false)
    expect(moduloSinProyectos([LOTES], 'condominios')).toBe(true)
    expect(moduloSinProyectos([SOLO_CONDO], 'agua')).toBe(true)
    expect(moduloSinProyectos([LOTES], 'agua')).toBe(false)
  })
})

describe('acotarAguaAlModulo', () => {
  function datos(proyectos: Proyecto[]): ColeccionesAgua & { moneda: string } {
    const unidades = [
      { id: 'u-t', project_id: 'torre', cliente_id: 'c-t' },
      { id: 'u-c', project_id: 'condo', cliente_id: 'c-c' },
    ] as Unidad[]
    const registros = [
      { id: 'r-t', project_id: 'torre', cliente_id: 'c-t' },
      { id: 'r-c', project_id: 'condo', cliente_id: 'c-c' },
      { id: 'r-contador', project_id: null, contador_id: 'm-c', cliente_id: 'c-c' },
    ] as unknown as Registro[]
    return {
      moneda: 'Q',
      proyectos,
      unidades,
      contadores: [{ id: 'm-t', project_id: 'torre' }, { id: 'm-c', project_id: 'condo' }] as Contador[],
      registros,
      tarifas: [{ id: 't-t', project_id: 'torre' }, { id: 't-c', project_id: 'condo' }] as Tarifa[],
      rutas: [{ id: 'ru-t', project_id: 'torre' }, { id: 'ru-c', project_id: 'condo' }, { id: 'ru-legada', project_id: null }] as Ruta[],
      clientes: [{ id: 'c-t' }, { id: 'c-c' }, { id: 'c-nuevo' }] as Cliente[],
      // Rol exento: ve la empresa entera. El módulo acota igual.
      projectScope: {
        accessibleProjectIds: new Set(proyectos.map(p => p.id)),
        exempt: true,
        clienteProjects: buildClienteProjectIndex({ unidades, registros }),
      },
    }
  }
  const ids = (xs: { id: string }[]) => xs.map(x => x.id)

  it('si todos los proyectos tienen Agua devuelve los mismos datos', () => {
    const d = datos([TORRE, LOTES])
    expect(acotarAguaAlModulo(d)).toBe(d)
  })

  it('saca de Manejo Agua todo lo del proyecto que no opera en Agua, también para un rol exento', () => {
    const r = acotarAguaAlModulo(datos([TORRE, SOLO_CONDO]))
    expect(ids(r.proyectos)).toEqual(['torre'])
    expect(ids(r.unidades)).toEqual(['u-t'])
    expect(ids(r.contadores)).toEqual(['m-t'])
    expect(ids(r.tarifas)).toEqual(['t-t'])
    // La lectura sin proyecto sellado se resuelve por su contador (del proyecto sin Agua).
    expect(ids(r.registros)).toEqual(['r-t'])
    // La ruta sin proyecto y el cliente que aún no ocupa nada se conservan.
    expect(ids(r.rutas)).toEqual(['ru-t', 'ru-legada'])
    expect(ids(r.clientes)).toEqual(['c-t', 'c-nuevo'])
    expect(r.moneda).toBe('Q')
  })
})
