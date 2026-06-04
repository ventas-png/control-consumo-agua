// serv:S11 — Interfaz del adapter PLUGGABLE de certificación fiscal + resolver.
//
// Provider-agnostic: el resto del sistema (la edge function timbrar-documento)
// habla SOLO con esta interfaz. Cambiar de PAC = cambiar la implementación que
// devuelve getFiscalProvider(), sin tocar el caller.
//
// Hoy getFiscalProvider() devuelve el SandboxProvider (timbrado SIMULADO,
// determinista) para CUALQUIER régimen. Cuando el dueño decida el PAC real (GT:
// Infile/GuateFactura…, MX: Facturama/Finkok…) y cargue credenciales en Vault,
// se enchufan FelGtProvider / CfdiMxProvider aquí. NO se integra ningún PAC en
// este PR.

import type { DteCanonico, RegimenFiscal, ResultadoTimbrado } from './types.ts'

/**
 * Contrato que cualquier certificador (PAC/GFACE) debe cumplir. Métodos
 * normalizados a la forma neutral del repo (ResultadoTimbrado), no a la del PAC.
 */
export interface FiscalProvider {
  /** Identificador del proveedor (ej. 'sandbox', 'infile', 'facturama'). */
  readonly nombre: string

  /**
   * Timbra/certifica un DTE canónico. Devuelve UUID/sello normalizados (ok:true)
   * o un error normalizado (ok:false). NUNCA lanza por un rechazo de negocio —
   * solo por fallos de infraestructura irrecuperables.
   */
  timbrar(dte: DteCanonico): Promise<ResultadoTimbrado>

  /**
   * Cancela un comprobante ya timbrado por su UUID fiscal. `motivo` opcional
   * (algunos PAC lo exigen — ej. catálogo c_MotivoCancelacion en MX).
   */
  cancelar(uuidFiscal: string, motivo?: string): Promise<ResultadoTimbrado>

  /**
   * Consulta el estado de un comprobante en el PAC/autoridad por su UUID.
   * Útil para reconciliar timbrados que quedaron en limbo.
   */
  consultarEstado(uuidFiscal: string): Promise<ResultadoTimbrado>
}

/** Ambiente del PAC: 'sandbox' (pruebas) o 'prod' (timbrado con valor fiscal). */
export type AmbientePac = 'sandbox' | 'prod'

/**
 * Credenciales del PAC resueltas desde la bóveda `fiscal_pac_secrets`, separadas
 * por ambiente. Objeto OPACO: cada provider interpreta las llaves que su PAC
 * exige (usuario/clave/token/NIT/certificado…). NUNCA se loguea ni se devuelve al
 * cliente. El SandboxProvider y los stubs lo ignoran.
 */
export interface CredencialesPacPorAmbiente {
  sandbox?: Record<string, unknown> | null
  prod?: Record<string, unknown> | null
}

/**
 * Config que el resolver pasa al provider. Las CREDENCIALES del PAC NO se leen
 * aquí dentro: el CALLER (edge con service_role) las carga de la bóveda
 * `fiscal_pac_secrets` (deny-all bajo RLS) y las inyecta en `credenciales`,
 * manteniendo este módulo libre de supabase-js (puro/testeable, `deno check`
 * limpio). El provider lee SOLO el ambiente activo (`credenciales[ambiente]`).
 */
export interface FiscalProviderConfig {
  /** Tenant dueño del comprobante (llave con la que el caller buscó las creds). */
  companyId?: string | null
  /** Nombre del proveedor configurado en companies/projects.proveedor_timbrado. */
  proveedor?: string | null
  /** Régimen del tenant (companies/projects.regimen_fiscal). */
  regimen?: RegimenFiscal
  /** Ambiente a usar (endpoint + credenciales). Default 'sandbox'. */
  ambiente?: AmbientePac
  /**
   * Credenciales del PAC YA RESUELTAS por el caller desde la bóveda (por ambiente).
   * `null`/ausente = el caller no las cargó (provider real → error claro).
   */
  credenciales?: CredencialesPacPorAmbiente | null
}

/** Error tipado cuando el régimen real no tiene PAC configurado todavía. */
export class PacNoConfiguradoError extends Error {
  constructor(regimen: string, proveedor?: string | null) {
    super(
      `PAC no configurado para régimen "${regimen}"` +
        (proveedor ? ` (proveedor "${proveedor}")` : '') +
        '. Configure el certificador real y sus credenciales en Vault (follow-up serv:S11).',
    )
    this.name = 'PacNoConfiguradoError'
  }
}
