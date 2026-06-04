// T7 / plat:P12 — Contenedor delgado de la pantalla de administración de empresa.
//
// Antes era un god-component de ~1259 LOC que mezclaba fetch directo a Supabase,
// mutaciones y todo el JSX. Ahora:
//   - La lectura vive en la capa de datos: useEmpresaSectionDataQuery
//     (src/domain/empresa), siguiendo la convención TanStack Query del repo.
//   - El JSX se reparte en sub-componentes cohesivos que poseen sus propias
//     mutaciones y refrescan invalidando la query del dominio (onReload):
//       · EmpresaHeaderCard        — datos de empresa + datos fiscales
//       · EmpresaProyectosSection  — uso del plan + grilla de proyectos
//       · EmpresaUsuariosSection   — usuarios + roles + modales de administración
//   - Las configuraciones de pagos/correo (StripePayPalConfig, GoogleEmailConfig)
//     ya eran componentes propios; el contenedor solo los compone.
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { UserSession } from '../../types'
import { StripePayPalConfig } from './StripePayPalConfig'
import { GoogleEmailConfig } from './GoogleEmailConfig'
import { usePlanLimits } from '../../hooks/usePlanLimits'
import { EmpresaHeaderCard } from './EmpresaHeaderCard'
import { EmpresaProyectosSection } from './EmpresaProyectosSection'
import { EmpresaUsuariosSection } from './EmpresaUsuariosSection'
import { empresaKeys } from '../../domain/empresa/keys'
import { useEmpresaSectionDataQuery } from '../../domain/empresa/queries'

interface Props {
  currentUser: UserSession
}

export function EmpresaSection({ currentUser }: Props) {
  const companyId = currentUser.company_id
  const queryClient = useQueryClient()
  const { data, isLoading } = useEmpresaSectionDataQuery(companyId, currentUser.user_id)
  const empresa = data?.empresa ?? null
  const proyectos = data?.proyectos ?? []
  const usuarios = data?.usuarios ?? []

  // Refresco de la vista tras cualquier mutación: invalida la query compuesta
  // del dominio (reemplaza el `void cargar()` imperativo previo).
  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: empresaKeys.seccion(companyId) })
  }, [queryClient, companyId])

  // Limites efectivos del plan (F2.13). Sobrescriben empresa.max_projects
  // legacy con el resultado de get_company_effective_limits que respeta
  // grandfathered overrides via GREATEST(plan, companies.max_X).
  const planLimits = usePlanLimits(companyId ?? null)
  const effectiveMaxProjects = planLimits.max_projects ?? empresa?.max_projects ?? Infinity
  const maxProjectsDisplay = planLimits.max_projects ?? empresa?.max_projects ?? 5

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px' }}>
        <span style={{ color: 'var(--at-ink-3)', fontSize: '16px' }}>Cargando...</span>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <EmpresaHeaderCard
        empresa={empresa}
        proyectosCount={proyectos.length}
        maxProjectsDisplay={maxProjectsDisplay}
        onReload={reload}
      />

      <EmpresaProyectosSection
        empresa={empresa}
        proyectos={proyectos}
        companyId={companyId}
        effectiveMaxProjects={effectiveMaxProjects}
        onReload={reload}
      />

      <EmpresaUsuariosSection
        currentUser={currentUser}
        usuarios={usuarios}
        proyectos={proyectos}
        onReload={reload}
      />

      {/* Configuración de Pagos Online */}
      {companyId && (
        <div style={{
          background: 'var(--at-surface)',
          borderRadius: '16px', padding: '24px',
          border: '1px solid var(--at-line)',
          marginTop: '24px',
        }}>
          <StripePayPalConfig
            companyId={companyId}
            onConfigUpdated={reload}
          />
        </div>
      )}

      {/* Configuración de Correo Google */}
      {companyId && (
        <div style={{
          background: 'var(--at-surface)',
          borderRadius: '16px', padding: '28px',
          border: '1px solid var(--at-line)',
          marginTop: '24px',
          boxShadow: '0 2px 12px rgba(0,0,0,.04)',
        }}>
          <GoogleEmailConfig companyId={companyId} />
        </div>
      )}
    </div>
  )
}
