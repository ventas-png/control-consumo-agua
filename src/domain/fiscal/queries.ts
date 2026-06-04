// serv:S11 · Núcleo fiscal FEL/CFDI — Hooks de LECTURA de documentos_fiscales.
//
// Foundation: SOLO lado lectura. Siguiendo el orden de adopción de
// src/domain/README.md, estos hooks AÚN NO se cablean a componentes en este PR
// (zero blast radius). La UI que los consuma (badge de estatus de timbrado,
// historial de comprobantes) es follow-up.
//
// RLS scopea por tenant (company_id directo en documentos_fiscales); replicamos
// el filtro .eq('company_id', …) como defense-in-depth donde aplica.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { fiscalKeys } from './keys'
import { resolverConfigFiscalEfectiva } from '../../lib/businessFiscal'
import type {
  ConfigFiscalEfectiva,
  ConfigFiscalEmpresa,
  ConfigFiscalLocacion,
  DocumentoFiscal,
  EstatusCredencialesPac,
} from '../../types/fiscal'

// Columnas a proyectar. Debe ser UN string literal (no concatenación) para que
// supabase-js infiera el select sin caer al fallback GenericStringError (igual
// que REGISTROS_LIST_COLS / FACTURA_COLS). Traemos los payloads jsonb porque la
// UI de detalle los necesita; si pesaran, separar en una query de detalle.
const DOC_COLS =
  'id,company_id,registro_id,regimen,tipo,estado,proveedor,request_payload,response_payload,uuid_fiscal,serie,numero,numero_autorizacion,fecha_certificacion,error,created_at,updated_at'

/**
 * Documentos fiscales del tenant (scope company). RLS + filtro defensivo por
 * company_id. Orden por created_at desc. Limit 5000 para no exceder el
 * statement_timeout en históricos grandes.
 */
export function useDocumentosFiscalesQuery(companyId?: string) {
  return useQuery({
    queryKey: fiscalKeys.documentos(companyId),
    queryFn: async () =>
      (await runQuery<DocumentoFiscal[]>((signal) => {
        let q = supabase
          .from('documentos_fiscales')
          .select(DOC_COLS)
          .order('created_at', { ascending: false })
          .limit(5000)
        if (companyId) q = q.eq('company_id', companyId)
        return q.abortSignal(signal)
      })) ?? [],
    enabled: !!companyId,
  })
}

/**
 * Documentos fiscales de una Factura concreta (scope registro). Útil para el
 * badge/historial de timbrado de un recibo. Orden por created_at desc.
 */
export function useDocumentosFiscalesPorRegistroQuery(registroId?: string) {
  return useQuery({
    queryKey: fiscalKeys.documentosPorRegistro(registroId),
    queryFn: async () =>
      (await runQuery<DocumentoFiscal[]>((signal) =>
        supabase
          .from('documentos_fiscales')
          .select(DOC_COLS)
          .eq('registro_id', registroId!)
          .order('created_at', { ascending: false })
          .abortSignal(signal),
      )) ?? [],
    enabled: !!registroId,
  })
}

/** Un documento fiscal por id (detalle). */
export function useDocumentoFiscalQuery(id?: string) {
  return useQuery({
    queryKey: fiscalKeys.documento(id),
    queryFn: async () =>
      (await runQuery<DocumentoFiscal[]>((signal) =>
        supabase
          .from('documentos_fiscales')
          .select(DOC_COLS)
          .eq('id', id!)
          .limit(1)
          .abortSignal(signal),
      ))?.[0] ?? null,
    enabled: !!id,
  })
}

// ── serv:S11 — Config fiscal EFECTIVA por locación + estatus de credenciales ──
// Habilitación "selecciona y conecta". Lectura SOLA: estos hooks aún NO se
// cablean a componentes en este PR (la UI selector es follow-up del agente de
// UI). El SECRETO de la bóveda NUNCA se lee desde el cliente: la config efectiva
// usa solo columnas NO sensibles de companies/projects; el estatus viene de la
// RPC fiscal_pac_estatus (proveedor + estado_conexion + flags, sin credenciales).

// Columnas fiscales NO sensibles de companies (emisor a nivel empresa).
const COMPANY_FISCAL_COLS =
  'id,nombre,nombre_fiscal,nit,tax_id,rfc,regimen_fiscal,proveedor_timbrado,address_postal_code'
// Columnas fiscales (override por locación) de projects.
const PROJECT_FISCAL_COLS =
  'id,company_id,nombre,nombre_fiscal,nit,rfc,regimen_fiscal,proveedor_timbrado,establecimiento,lugar_expedicion,serie_fiscal'

interface CompanyFiscalRow {
  id: string
  nombre?: string | null
  nombre_fiscal?: string | null
  nit?: string | null
  tax_id?: string | null
  rfc?: string | null
  regimen_fiscal?: string | null
  proveedor_timbrado?: string | null
  address_postal_code?: string | null
}

interface ProjectFiscalRow {
  id: string
  company_id?: string | null
  nombre?: string | null
  nombre_fiscal?: string | null
  nit?: string | null
  rfc?: string | null
  regimen_fiscal?: string | null
  proveedor_timbrado?: string | null
  establecimiento?: string | null
  lugar_expedicion?: string | null
  serie_fiscal?: string | null
}

function empresaConfigDeRow(c: CompanyFiscalRow): ConfigFiscalEmpresa {
  return {
    regimenFiscal: (c.regimen_fiscal as ConfigFiscalEmpresa['regimenFiscal']) ?? null,
    nombre: c.nombre ?? null,
    nombreFiscal: c.nombre_fiscal ?? null,
    nit: c.nit ?? null,
    taxId: c.tax_id ?? null,
    rfc: c.rfc ?? null,
    proveedorTimbrado: c.proveedor_timbrado ?? null,
    codigoPostal: c.address_postal_code ?? null,
  }
}

function locacionConfigDeRow(p: ProjectFiscalRow): ConfigFiscalLocacion {
  return {
    regimenFiscal: (p.regimen_fiscal as ConfigFiscalLocacion['regimenFiscal']) ?? null,
    nombre: p.nombre ?? null,
    nombreFiscal: p.nombre_fiscal ?? null,
    nit: p.nit ?? null,
    rfc: p.rfc ?? null,
    proveedorTimbrado: p.proveedor_timbrado ?? null,
    establecimiento: p.establecimiento ?? null,
    lugarExpedicion: p.lugar_expedicion ?? null,
    serieFiscal: p.serie_fiscal ?? null,
  }
}

/**
 * Config fiscal EFECTIVA de una locación: lee las columnas fiscales NO sensibles
 * de companies (emisor empresa) y projects (override locación) y las resuelve con
 * resolverConfigFiscalEfectiva (override locación↔empresa). Si projectId es
 * undefined, resuelve la config a NIVEL EMPRESA (sin override). RLS de
 * companies/projects scopea por tenant; no hay secretos en juego aquí.
 */
export function useConfigFiscalEfectivaQuery(
  companyId?: string,
  projectId?: string,
) {
  return useQuery<ConfigFiscalEfectiva | null>({
    queryKey: fiscalKeys.configEfectiva(companyId, projectId),
    queryFn: async () => {
      const company = (await runQuery<CompanyFiscalRow[]>((signal) =>
        supabase
          .from('companies')
          .select(COMPANY_FISCAL_COLS)
          .eq('id', companyId!)
          .limit(1)
          .abortSignal(signal),
      ))?.[0]
      if (!company) return null

      let project: ProjectFiscalRow | undefined
      if (projectId) {
        project = (await runQuery<ProjectFiscalRow[]>((signal) =>
          supabase
            .from('projects')
            .select(PROJECT_FISCAL_COLS)
            .eq('id', projectId)
            .limit(1)
            .abortSignal(signal),
        ))?.[0]
      }

      return resolverConfigFiscalEfectiva(
        empresaConfigDeRow(company),
        project ? locacionConfigDeRow(project) : null,
      )
    },
    enabled: !!companyId,
  })
}

/**
 * Estatus (NO sensible) de las credenciales del PAC de un tenant. Lee la RPC
 * fiscal_pac_estatus (SECURITY DEFINER acotada a admin/owner del tenant), que
 * devuelve proveedor + estado_conexion + flags tiene_sandbox/tiene_prod —
 * NUNCA el jsonb `credenciales`. La bóveda fiscal_pac_secrets es deny-all bajo
 * RLS, así que el cliente jamás la lee directo.
 */
export function useEstatusCredencialesPacQuery(companyId?: string) {
  return useQuery<EstatusCredencialesPac[]>({
    queryKey: fiscalKeys.credenciales(companyId),
    queryFn: async () =>
      (await runQuery<EstatusCredencialesPac[]>((signal) =>
        supabase
          .rpc('fiscal_pac_estatus', { p_company_id: companyId! })
          .abortSignal(signal),
      )) ?? [],
    enabled: !!companyId,
  })
}
