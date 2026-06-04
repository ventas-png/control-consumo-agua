import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Proyecto } from '../../../types'
import {
  ActiveCondominioProvider,
  useActiveCondominio,
  resolveActiveProjectId,
} from '../ActiveCondominioContext'
import { CondominioContextBar } from '../CondominioContextBar'

function proyecto(id: string, nombre: string, estado: Proyecto['estado'] = 'activo'): Proyecto {
  return {
    id, nombre, company_id: 'c1', logo_url: null, descripcion: null, direccion: null,
    latitud: null, longitud: null, moneda: 'Q', moneda_condominios: null, estado,
    max_unidades_apartamento: null, max_unidades_casa: null, max_unidades_bodega: null,
    max_unidades_local_comercial: null, max_unidades_oficina: null,
    max_unidades_parqueadero: null, max_unidades_otro: null,
  }
}

const A = proyecto('p-a', 'Torre A')
const B = proyecto('p-b', 'Torre B')
const C = proyecto('p-c', 'Torre C')
const KEY = 'at:condominio-activo:c1'

function wrapper(proyectos: Proyecto[], companyId = 'c1') {
  return ({ children }: { children: ReactNode }) => (
    <ActiveCondominioProvider proyectos={proyectos} companyId={companyId}>
      {children}
    </ActiveCondominioProvider>
  )
}

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('resolveActiveProjectId (pura)', () => {
  it('usa el id persistido cuando sigue accesible', () => {
    expect(resolveActiveProjectId([A, B], 'p-b')).toBe('p-b')
  })
  it('cae al primer activo cuando el persistido ya no es accesible (fail-closed)', () => {
    // p-x no está en la lista accesible (p.ej. perdió la asignación) → no se respeta.
    expect(resolveActiveProjectId([A, B], 'p-x')).toBe('p-a')
  })
  it('cae al primer activo cuando no hay persistido', () => {
    expect(resolveActiveProjectId([A, B], null)).toBe('p-a')
  })
  it('devuelve "" cuando no hay proyectos accesibles', () => {
    expect(resolveActiveProjectId([], 'p-a')).toBe('')
  })
})

describe('ActiveCondominioContext', () => {
  it('lanza si se usa fuera del provider (fail loud)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useActiveCondominio())).toThrow(/ActiveCondominioProvider/)
  })

  it('por defecto activa el primer proyecto activo accesible', () => {
    const { result } = renderHook(() => useActiveCondominio(), { wrapper: wrapper([A, B]) })
    expect(result.current.activeProjectId).toBe('p-a')
    expect(result.current.activeProyecto?.nombre).toBe('Torre A')
  })

  it('solo expone proyectos ACTIVOS (filtra inactivos/suspendidos)', () => {
    const inactivo = proyecto('p-off', 'Apagada', 'inactivo')
    const { result } = renderHook(() => useActiveCondominio(), { wrapper: wrapper([A, inactivo, B]) })
    expect(result.current.proyectosActivos.map(p => p.id)).toEqual(['p-a', 'p-b'])
  })

  it('persiste la selección en localStorage por empresa y la restaura sin parpadeo', () => {
    const { result, unmount } = renderHook(() => useActiveCondominio(), { wrapper: wrapper([A, B, C]) })
    act(() => result.current.setActiveProjectId('p-c'))
    expect(result.current.activeProjectId).toBe('p-c')
    expect(window.localStorage.getItem(KEY)).toBe('p-c')
    unmount()

    // Nuevo montaje (≈ refresh): arranca directamente en p-c, sin pasar por p-a.
    const second = renderHook(() => useActiveCondominio(), { wrapper: wrapper([A, B, C]) })
    expect(second.result.current.activeProjectId).toBe('p-c')
  })

  it('no aplica una selección persistida de OTRA empresa (aislamiento por tenant)', () => {
    window.localStorage.setItem('at:condominio-activo:c1', 'p-b')
    // Empresa distinta (c2) no debe heredar la selección de c1.
    const { result } = renderHook(
      () => useActiveCondominio(),
      { wrapper: wrapper([proyecto('p-z', 'Otra empresa')], 'c2') },
    )
    expect(result.current.activeProjectId).toBe('p-z')
  })

  it('ignora setActiveProjectId a un proyecto no accesible (filtrado por rol, fail-closed)', () => {
    const { result } = renderHook(() => useActiveCondominio(), { wrapper: wrapper([A, B]) })
    act(() => result.current.setActiveProjectId('p-fuera'))
    expect(result.current.activeProjectId).toBe('p-a')
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('re-resuelve si el condominio activo deja de ser accesible (revocación de acceso)', () => {
    // Pre-persistimos p-b como activo; al re-montar con una lista accesible que
    // ya no incluye p-b (acceso revocado), el provider debe caer a p-a.
    window.localStorage.setItem(KEY, 'p-b')

    function Probe() {
      const { activeProjectId } = useActiveCondominio()
      return <div data-testid="active-id">{activeProjectId}</div>
    }
    const { rerender } = render(
      <ActiveCondominioProvider proyectos={[A, B]} companyId="c1"><Probe /></ActiveCondominioProvider>,
    )
    expect(screen.getByTestId('active-id').textContent).toBe('p-b')

    // El usuario pierde acceso a Torre B → la lista accesible ya no la incluye.
    rerender(
      <ActiveCondominioProvider proyectos={[A]} companyId="c1"><Probe /></ActiveCondominioProvider>,
    )
    expect(screen.getByTestId('active-id').textContent).toBe('p-a')
  })
})

describe('CondominioContextBar (cond:B5 switcher + cond:B6 banner)', () => {
  it('muestra el banner del condominio activo y NO muestra switcher con un solo condominio', () => {
    render(
      <ActiveCondominioProvider proyectos={[A]} companyId="c1">
        <CondominioContextBar />
      </ActiveCondominioProvider>,
    )
    expect(screen.getByTestId('condominio-banner').textContent).toContain('Torre A')
    expect(screen.queryByLabelText('Cambiar de condominio activo')).toBeNull()
  })

  it('muestra el switcher con varios condominios y cambia el activo sin recarga', () => {
    function Probe() {
      const { activeProyecto } = useActiveCondominio()
      return <div data-testid="active">{activeProyecto?.nombre}</div>
    }
    render(
      <ActiveCondominioProvider proyectos={[A, B, C]} companyId="c1">
        <CondominioContextBar />
        <Probe />
      </ActiveCondominioProvider>,
    )
    const select = screen.getByLabelText('Cambiar de condominio activo') as HTMLSelectElement
    expect(select.value).toBe('p-a')
    expect(screen.getByTestId('active').textContent).toBe('Torre A')

    fireEvent.change(select, { target: { value: 'p-b' } })

    // El banner y los consumidores reaccionan en el mismo render (sin recarga).
    expect(screen.getByTestId('condominio-banner').textContent).toContain('Torre B')
    expect(screen.getByTestId('active').textContent).toBe('Torre B')
    expect(window.localStorage.getItem(KEY)).toBe('p-b')
  })
})
