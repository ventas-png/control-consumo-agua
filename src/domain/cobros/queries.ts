// Cobros pluggable (payfac) — Hooks de LECTURA.
//
// El SECRETO de la bóveda payfac_secrets NUNCA se lee desde el cliente: la config
// efectiva usa solo columnas NO sensibles de companies/projects; el estatus viene
// de la RPC payfac_estatus (proveedor + estado_conexion + flags, sin credenciales).
// Espeja src/domain/fiscal/queries.ts.
import { useQuery } from '@tanstack/react-query'
import { db } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { payfacKeys } from './keys'
import { resolverConfigPagoEfectiva } from '../../lib/businessPagos'
import type { ConfigPagoEfectiva, PayfacEstatus } from '../../types/pagos'
import type {
  Pago,
  ConvenioPago,
  ConvenioCuota,
  EstadoPago,
  EstadoConvenio,
  FormaPago,
  TipoAplicacion,
} from '../../types'
import type { Tables } from '../../types/database.types'

/** Pagos (no borrados) + convenios del tenant, más recientes primero. */
export interface PagosYConvenios {
  pagos: Pago[]
  convenios: ConvenioPago[]
}

/** Frontera fila generada → dominio: acota los CHECK (string→unión). */
function mapPago(row: Tables<'pagos'>): Pago {
  return {
    ...row,
    metodo: row.metodo as FormaPago, // CHECK en BD; la generada es string
    estado: row.estado as EstadoPago, // CHECK en BD; la generada es string
    comprobante_tipo: row.comprobante_tipo as Pago['comprobante_tipo'], // CHECK imagen|pdf; generada string
    // Nullables en BD que el dominio modela como opcionales sin null:
    tipo_aplicacion: (row.tipo_aplicacion ?? undefined) as TipoAplicacion | undefined,
    verification_status: (row.verification_status ?? undefined) as EstadoPago | undefined,
    // Generada nullable; el dominio asume NOT NULL — cast (bug latente reportado).
    created_at: row.created_at as string,
  }
}

/** Frontera fila generada → dominio: acota el CHECK y castea los jsonb. */
function mapConvenio(row: Tables<'convenios_pago'>): ConvenioPago {
  return {
    ...row,
    estado: row.estado as EstadoConvenio, // CHECK en BD; la generada es string
    cuotas: row.cuotas as unknown as ConvenioCuota[] | null, // jsonb (Json) → calendario del dominio
    registro_ids: (row.registro_ids ?? []) as string[], // jsonb nullable → ids; [] neutro seguro
    // Generada nullable; el dominio asume NOT NULL — cast (bug latente reportado).
    created_at: row.created_at as string,
  }
}

/**
 * Carga pagos manuales (con deleted_at null) y convenios del tenant para la
 * pantalla de cobros. Lectura imperativa (no-hook) para usarse desde un
 * `useCallback` que llena estado local. Defaultea a `[]` ante datos ausentes.
 */
export async function fetchPagosYConvenios(): Promise<PagosYConvenios> {
  const [pagosRes, conveniosRes] = await Promise.all([
    db
      .from('pagos')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    db
      .from('convenios_pago')
      .select('*')
      .order('created_at', { ascending: false }),
  ])
  return {
    pagos: (pagosRes.data ?? []).map(mapPago),
    convenios: (conveniosRes.data ?? []).map(mapConvenio),
  }
}

interface CompanyPagoRow {
  id: string
  proveedor_pago?: string | null
  default_currency?: string | null
  ambiente_pago?: string | null
}
interface ProjectPagoRow {
  id: string
  proveedor_pago?: string | null
  ambiente_pago?: string | null
}

/**
 * Config de pago EFECTIVA de una locación: lee proveedor_pago/default_currency de
 * companies (empresa) y proveedor_pago de projects (override) y los resuelve con
 * resolverConfigPagoEfectiva. Si projectId es undefined, resuelve a NIVEL EMPRESA.
 */
export function useConfigPagoEfectivaQuery(companyId?: string, projectId?: string) {
  return useQuery<ConfigPagoEfectiva | null>({
    queryKey: payfacKeys.configEfectiva(companyId, projectId),
    queryFn: async () => {
      const company = (await runQuery<CompanyPagoRow[]>((signal) =>
        db
          .from('companies')
          .select('id,proveedor_pago,default_currency,ambiente_pago')
          .eq('id', companyId!)
          .limit(1)
          .abortSignal(signal),
      ))?.[0]
      if (!company) return null

      let project: ProjectPagoRow | undefined
      if (projectId) {
        project = (await runQuery<ProjectPagoRow[]>((signal) =>
          db
            .from('projects')
            .select('id,proveedor_pago,ambiente_pago')
            .eq('id', projectId)
            .limit(1)
            .abortSignal(signal),
        ))?.[0]
      }

      return resolverConfigPagoEfectiva(
        {
          proveedorPago: company.proveedor_pago ?? null,
          monedaDefault: company.default_currency ?? null,
          ambientePago: company.ambiente_pago ?? null,
        },
        project
          ? { proveedorPago: project.proveedor_pago ?? null, ambientePago: project.ambiente_pago ?? null }
          : null,
      )
    },
    enabled: !!companyId,
  })
}

/**
 * Estatus (NO sensible) de las credenciales del payfac de un tenant. Lee la RPC
 * payfac_estatus (SECURITY DEFINER acotada a admin/owner), que devuelve proveedor
 * + estado_conexion + flags tiene_sandbox/tiene_prod — NUNCA `credenciales`.
 */
export function useEstatusPayfacQuery(companyId?: string) {
  return useQuery<PayfacEstatus[]>({
    queryKey: payfacKeys.estatus(companyId),
    queryFn: async () => {
      const rows =
        (await runQuery((signal) =>
          db.rpc('payfac_estatus', { p_company_id: companyId! }).abortSignal(signal),
        )) ?? []
      return rows.map((r) => ({
        ...r,
        // CHECK ('desconocido'|'ok'|'error'); la RPC lo genera como string.
        estado_conexion: r.estado_conexion as PayfacEstatus['estado_conexion'],
      }))
    },
    enabled: !!companyId,
  })
}
