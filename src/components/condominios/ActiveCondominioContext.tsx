import {
  createContext, useContext, useState, useCallback, useMemo, useEffect,
  type ReactNode,
} from 'react'
import type { Proyecto } from '../../types'

// cond:B5/B6 — Estado global del CONDOMINIO ACTIVO para la sección de condominios.
//
// Una empresa puede gestionar varios condominios (cada uno ≈ un `project`). Antes
// el proyecto activo vivía como `useState` local en CondominiosSection y se
// derivaba siempre de `proyectosActivos[0]`, sin persistencia ni indicador. Este
// contexto centraliza el proyecto activo para que:
//   * el switcher del header lo cambie SIN recarga (solo set de estado → las
//     queries scopeadas por `activeProjectId` re-fetchean porque dependen de él),
//   * el banner de contexto (cond:B6) muestre el condominio activo,
//   * cualquier tab pueda leer el proyecto activo desde un único sitio.
//
// FILTRADO POR ROL: la lista `proyectos` que recibe el provider YA viene acotada
// por `filterProyectosByAssignment` en App.tsx (RLS + asignaciones). El contexto
// no re-filtra; sí garantiza que el id activo persistido sea uno de los
// accesibles (si un usuario pierde acceso a un condominio, el id guardado se
// descarta y caemos al primer proyecto activo accesible — fail-closed).
//
// PERSISTENCIA: el id activo se guarda en localStorage POR EMPRESA
// (`at:condominio-activo:<company_id>`) para no filtrar selección entre tenants
// distintos en el mismo navegador. Se lee de forma síncrona en el inicializador
// del useState para evitar parpadeo al refrescar (no hay un primer render con el
// proyecto equivocado seguido de un salto).

const STORAGE_PREFIX = 'at:condominio-activo:'

function storageKey(companyId: string): string {
  return `${STORAGE_PREFIX}${companyId}`
}

function readPersisted(companyId: string): string | null {
  if (!companyId || typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(storageKey(companyId))
  } catch {
    // Modo privado / storage deshabilitado → degradar a sin-persistencia.
    return null
  }
}

function writePersisted(companyId: string, projectId: string): void {
  if (!companyId || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(companyId), projectId)
  } catch {
    // no-op: la selección sigue viva en memoria durante la sesión.
  }
}

/**
 * Resuelve el id activo inicial: el persistido SI sigue siendo accesible, si no
 * el primer proyecto activo accesible. Pura para poder testearla aislada.
 */
export function resolveActiveProjectId(
  proyectosActivos: Proyecto[],
  persistedId: string | null,
): string {
  if (persistedId && proyectosActivos.some(p => p.id === persistedId)) {
    return persistedId
  }
  return proyectosActivos[0]?.id ?? ''
}

interface ActiveCondominioValue {
  /** Proyectos activos accesibles (ya filtrados por rol aguas arriba). */
  proyectosActivos: Proyecto[]
  /** id del condominio activo ('' si el usuario no tiene proyectos activos). */
  activeProjectId: string
  /** Proyecto activo resuelto, o undefined si no hay ninguno. */
  activeProyecto: Proyecto | undefined
  /** Cambia el condominio activo (sin recarga). Ignora ids no accesibles. */
  setActiveProjectId: (id: string) => void
}

const ActiveCondominioContext = createContext<ActiveCondominioValue | null>(null)

interface ProviderProps {
  /** Lista de proyectos accesibles (cualquier estado), ya filtrada por rol. */
  proyectos: Proyecto[]
  /** Empresa del usuario; clave de la persistencia por-tenant. */
  companyId: string
  children: ReactNode
}

export function ActiveCondominioProvider({ proyectos, companyId, children }: ProviderProps) {
  // El switcher y el scoping operan solo sobre condominios ACTIVOS.
  const proyectosActivos = useMemo(
    () => proyectos.filter(p => p.estado === 'activo'),
    [proyectos],
  )

  // Inicialización síncrona desde localStorage → sin parpadeo en el refresh.
  const [activeProjectId, setActiveProjectIdState] = useState<string>(
    () => resolveActiveProjectId(proyectosActivos, readPersisted(companyId)),
  )

  // Si la lista accesible cambia (carga diferida, cambio de permisos, o el
  // condominio activo se desactiva) y el id actual deja de ser válido,
  // re-resolvemos contra lo persistido / primer activo. No pisa una selección
  // válida del usuario.
  useEffect(() => {
    setActiveProjectIdState(prev => {
      if (prev && proyectosActivos.some(p => p.id === prev)) return prev
      return resolveActiveProjectId(proyectosActivos, readPersisted(companyId))
    })
  }, [proyectosActivos, companyId])

  const setActiveProjectId = useCallback((id: string) => {
    // Guard: solo aceptamos ids de condominios accesibles (fail-closed ante un
    // deep-link/estado manipulado a un proyecto fuera del alcance del usuario).
    if (!proyectosActivos.some(p => p.id === id)) return
    setActiveProjectIdState(id)
    writePersisted(companyId, id)
  }, [proyectosActivos, companyId])

  const value = useMemo<ActiveCondominioValue>(() => ({
    proyectosActivos,
    activeProjectId,
    activeProyecto: proyectosActivos.find(p => p.id === activeProjectId),
    setActiveProjectId,
  }), [proyectosActivos, activeProjectId, setActiveProjectId])

  return (
    <ActiveCondominioContext.Provider value={value}>
      {children}
    </ActiveCondominioContext.Provider>
  )
}

/** Condominio activo de la sección. Lanza si se usa fuera del provider. */
export function useActiveCondominio(): ActiveCondominioValue {
  const ctx = useContext(ActiveCondominioContext)
  if (!ctx) {
    throw new Error('useActiveCondominio debe usarse dentro de <ActiveCondominioProvider>.')
  }
  return ctx
}
