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

/**
 * Config mínima que el resolver pasa al provider. Las CREDENCIALES del PAC NO
 * van aquí en texto plano: cuando se integre un PAC real, el provider las leerá
 * de Vault / una tabla de secretos con RLS service-role-only (igual que
 * company_payment_secrets), tomando solo el `companyId` como llave de búsqueda.
 */
export interface FiscalProviderConfig {
  /** Tenant dueño del comprobante (llave para buscar credenciales en Vault). */
  companyId?: string | null
  /** Nombre del proveedor configurado en companies.proveedor_timbrado. */
  proveedor?: string | null
  /** Régimen del tenant (companies.regimen_fiscal). */
  regimen?: RegimenFiscal
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
