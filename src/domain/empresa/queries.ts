// T7 / plat:P12 — Hooks de query del dominio Empresa.
//
// Encapsula el fetch que antes vivía inline en EmpresaSection (`cargar()`):
// datos de la company + sus proyectos + sus usuarios (con los roles asignados
// para los chips). Es una lectura DEPENDIENTE (igual que useMedidoresAgua…):
// primero company/proyectos/usuarios en paralelo y, si hay usuarios, sus
// user_roles para derivar los chips.
//
// El scope es company-level y se invalida en bloque tras cualquier mutación de
// la sección (alta/edición de empresa, proyecto o usuario), reemplazando el
// `void cargar()` imperativo por queryClient.invalidateQueries(empresaKeys…).
import { useQuery } from '@tanstack/react-query'
import type { Proyecto } from '../../types'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { empresaKeys } from './keys'

/** Datos de la company del tenant para la pantalla de administración. */
export interface EmpresaInfo {
  id: string
  nombre: string
  nit: string | null
  email: string | null
  telefono: string | null
  max_projects: number
  logo_url: string | null
  country: string | null
  tax_id: string | null
  tax_id_type: string | null
  address_line1: string | null
  address_city: string | null
  address_state: string | null
  address_postal_code: string | null
}

/** Usuario de la empresa con los roles asignados (derivados para los chips). */
export interface Usuario {
  id: string
  full_name: string
  role: string
  activo: boolean
  // Chips derivados en el fetch a partir de user_roles + join a roles.
  assigned_roles?: Array<{ id: string; name: string; color: string; service: string | null }>
}

/** Columnas de la company que consume la sección (evita `select('*')`). */
const COMPANY_COLS =
  'id, nombre, nit, email, telefono, max_projects, logo_url, country, tax_id, tax_id_type, address_line1, address_city, address_state, address_postal_code'

// Columnas de proyecto que la sección necesita para sus tarjetas y edición.
// Incluye `company_id` (que el fetch inline omitía y casteaba) para que el tipo
// inferido satisfaga `Proyecto` sin cast y como filtro defensivo por tenant.
const PROJECT_COLS =
  'id, nombre, company_id, logo_url, descripcion, direccion, latitud, longitud, moneda, moneda_condominios, estado, max_unidades_apartamento, max_unidades_casa, max_unidades_bodega, max_unidades_local_comercial, max_unidades_oficina, max_unidades_parqueadero, max_unidades_otro'

export interface EmpresaSectionData {
  empresa: EmpresaInfo | null
  proyectos: Proyecto[]
  usuarios: Usuario[]
}

/**
 * Lectura compuesta de la pantalla de administración de empresa. Excluye al
 * usuario actual de la lista (`neq` user_id) igual que el fetch original, y
 * adjunta a cada usuario sus roles asignados (chips). `enabled` espera a tener
 * companyId/userId; mientras tanto react-query mantiene la vista en `isLoading`.
 */
export function useEmpresaSectionDataQuery(companyId?: string, currentUserId?: string) {
  return useQuery({
    queryKey: empresaKeys.seccion(companyId),
    queryFn: async (): Promise<EmpresaSectionData> => {
      const [empresa, proyectos, baseUsers] = await Promise.all([
        runQuery<EmpresaInfo>((signal) =>
          supabase.from('companies').select(COMPANY_COLS).eq('id', companyId!).abortSignal(signal).single(),
        ),
        runQuery<Proyecto[]>((signal) =>
          supabase
            .from('projects')
            .select(PROJECT_COLS)
            .eq('company_id', companyId!)
            .order('nombre')
            .abortSignal(signal),
        ),
        runQuery<Usuario[]>((signal) =>
          supabase
            .from('app_users')
            .select('id, full_name, role, activo')
            .eq('company_id', companyId!)
            .neq('id', currentUserId!)
            .order('full_name')
            .abortSignal(signal),
        ),
      ])

      const usuarios = baseUsers ?? []
      const userIds = usuarios.map((u) => u.id)
      if (userIds.length > 0) {
        const userRolesData =
          (await runQuery((signal) =>
            supabase
              .from('user_roles')
              .select('user_id, role:roles(id, name, color, service)')
              .in('user_id', userIds)
              .abortSignal(signal),
          )) ?? []
        type Row = { user_id: string; role: { id: string; name: string; color: string; service: string | null } | null }
        const byUser = new Map<string, NonNullable<Row['role']>[]>()
        for (const r of userRolesData as unknown as Row[]) {
          if (!r.role) continue
          const arr = byUser.get(r.user_id) ?? []
          arr.push(r.role)
          byUser.set(r.user_id, arr)
        }
        for (const u of usuarios) {
          u.assigned_roles = byUser.get(u.id) ?? []
        }
      }

      return { empresa: empresa ?? null, proyectos: proyectos ?? [], usuarios }
    },
    enabled: !!companyId && !!currentUserId,
  })
}

// ── Límites de plan y uso (plat:P1/F2.13) — T7 follow-up ───────────────────
// Lecturas imperativas (no-hook) usadas por usePlanLimits. Envuelven las RPCs
// SECURITY DEFINER get_company_effective_limits / get_company_usage (guardadas
// por empresa propia / service_role). Devuelven la PRIMERA fila o null.

/** Límites efectivos del plan (GREATEST(plan, override legacy)); null = ilimitado. */
export async function fetchCompanyEffectiveLimits(
  companyId: string,
): Promise<{ data: { max_projects: number | null; max_units: number | null } | null; error: string | null }> {
  const { data, error } = await supabase.rpc('get_company_effective_limits', { p_company_id: companyId })
  return {
    data: (data as Array<{ max_projects: number | null; max_units: number | null }> | null)?.[0] ?? null,
    error: error?.message ?? null,
  }
}

/** Uso actual de la empresa (conteo de proyectos/unidades). */
export async function fetchCompanyUsage(
  companyId: string,
): Promise<{ data: { projects_count: number; units_count: number } | null; error: string | null }> {
  const { data, error } = await supabase.rpc('get_company_usage', { p_company_id: companyId })
  return {
    data: (data as Array<{ projects_count: number; units_count: number }> | null)?.[0] ?? null,
    error: error?.message ?? null,
  }
}
