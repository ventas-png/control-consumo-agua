// Lógica pura de fiscal-test-connection, extraída del handler para poder
// testearla en aislamiento (infra:I22 · Track T8/T5). Sin Deno ni supabase-js →
// corre directo en vitest (los tipos vienen de _shared/fiscal, que ya corre
// bajo vitest). El handler (index.ts) importa estos símbolos: el comportamiento
// no cambia, solo se mueve la definición a un archivo importable.
//
// Aquí vive SOLO la decisión pura: normalización del ambiente, mapeo de rows
// (companies/projects) a config fiscal por nivel, resolución del tenant, gate
// de autorización por tenant y el "¿hay credenciales utilizables?" del override
// locación→empresa. La resolución de config efectiva y el provider YA están
// testeados en _shared/fiscal (no se duplica aquí). El I/O queda en index.ts.

import type {
  AmbientePac,
  ConfigFiscalEmpresa,
  ConfigFiscalLocacion,
  CredencialesPacPorAmbiente,
} from '../_shared/fiscal/index.ts'

export interface CompanyRow {
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

export interface ProjectRow {
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

/** Ambiente a reportar en el estatus: solo 'prod' explícito; todo lo demás → 'sandbox'. */
export function normalizarAmbiente(raw: string | undefined): AmbientePac {
  return raw === 'prod' ? 'prod' : 'sandbox'
}

/** Row de companies → config fiscal nivel EMPRESA (snake_case → camelCase). */
export function empresaConfigDeRow(c: CompanyRow): ConfigFiscalEmpresa {
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

/** Row de projects → config fiscal nivel LOCACIÓN (snake_case → camelCase). */
export function locacionConfigDeRow(p: ProjectRow): ConfigFiscalLocacion {
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
 * Resuelve el tenant a probar con la precedencia del handler: la empresa del
 * proyecto (autoritativa si vino project_id) → company_id del body → company_id
 * del JWT del llamante → null (el handler responde 400).
 */
export function resolverCompanyId(
  projectCompanyId: string | null | undefined,
  bodyCompanyId: string | null | undefined,
  callerCompanyId: string | null,
): string | null {
  return (projectCompanyId ?? null) ?? bodyCompanyId ?? callerCompanyId ?? null
}

/**
 * Gate de tenant: interno (service_role) y super_admin pasan siempre; un
 * admin/owner solo puede probar la conexión de SU propia empresa.
 */
export function autorizadoParaTenant(
  auth: { internal: boolean; callerIsSuperAdmin: boolean; callerCompanyId: string | null },
  companyId: string,
): boolean {
  return auth.internal || auth.callerIsSuperAdmin || auth.callerCompanyId === companyId
}
