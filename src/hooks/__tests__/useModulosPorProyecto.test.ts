// Módulos por proyecto → lo que ven el menú y las rutas (migración 20261127000000).
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Proyecto, UserSession } from '../../types'
import type { AguaData } from '../useAguaData'
import { useModulosPorProyecto } from '../useModulosPorProyecto'

const SESION = { user_id: 'u1', role: 'company_owner', company_id: 'c1', servicio_agua: true, servicio_condominios: true } as UserSession
const proy = (id: string, extra: Partial<Proyecto> = {}) => ({ id, nombre: id, estado: 'activo', ...extra }) as Proyecto
function agua(proyectos: Proyecto[]): AguaData {
  return {
    proyectos, unidades: [], contadores: [], registros: [], tarifas: [], rutas: [], clientes: [],
    projectScope: { accessibleProjectIds: new Set(proyectos.map(p => p.id)), exempt: true, clienteProjects: new Map() },
  } as unknown as AguaData
}

describe('useModulosPorProyecto', () => {
  it('sin interruptores apagados no cambia nada: mismas referencias', () => {
    const datos = agua([proy('a'), proy('b')])
    const { result } = renderHook(() => useModulosPorProyecto(SESION, datos))
    expect(result.current.aguaModulo).toBe(datos)
    expect(result.current.proyectosCondominios).toBe(datos.proyectos)
    expect(result.current.sesionMenu).toBe(SESION)
  })

  it('cada módulo recibe sólo sus proyectos y el menú conserva ambos mientras alguno opere en cada uno', () => {
    const datos = agua([proy('torre'), proy('lotes', { modulo_condominios: false }), proy('club', { modulo_agua: false })])
    const { result } = renderHook(() => useModulosPorProyecto(SESION, datos))
    expect(result.current.aguaModulo.proyectos.map(p => p.id)).toEqual(['torre', 'lotes'])
    expect(result.current.proyectosCondominios.map(p => p.id)).toEqual(['torre', 'club'])
    expect(result.current.sesionMenu).toBe(SESION)
  })

  it('quien sólo ve proyectos de Agua pierde el menú de Condominios (y al revés)', () => {
    const soloAgua = renderHook(() => useModulosPorProyecto(SESION, agua([proy('lotes', { modulo_condominios: false })])))
    expect(soloAgua.result.current.sesionMenu).toMatchObject({ servicio_agua: true, servicio_condominios: false })
    const soloCondo = renderHook(() => useModulosPorProyecto(SESION, agua([proy('club', { modulo_agua: false })])))
    expect(soloCondo.result.current.sesionMenu).toMatchObject({ servicio_agua: false, servicio_condominios: true })
  })

  it('sin proyectos (cargando, empresa nueva) y sin sesión no decide nada', () => {
    expect(renderHook(() => useModulosPorProyecto(SESION, agua([]))).result.current.sesionMenu).toBe(SESION)
    expect(renderHook(() => useModulosPorProyecto(null, agua([]))).result.current.sesionMenu).toBeNull()
  })
})
