// serv:S11 — STUB del provider de FEL (Guatemala). NO integra ningún PAC real.
//
// Guatemala (FEL — Factura Electrónica en Línea):
//   - Se arma un DTE (Documento Tributario Electrónico) en el XML del SAT GT.
//   - Se FIRMA digitalmente (certificado del emisor) y se envía a un
//     CERTIFICADOR autorizado (GFACE/PAC, ej. Infile, GuateFactura, Megaprint).
//   - El certificador valida ante SAT y devuelve: número de AUTORIZACIÓN (UUID),
//     serie y número del comprobante, y el XML certificado.
//
// CONTRATO A IMPLEMENTAR (follow-up, cuando el dueño elija PAC + cargue creds):
//   timbrar(dte):
//     1. Mapear DteCanonico → XML DTE del SAT GT (estructura GTDocumento).
//     2. Firmar el XML con el certificado del emisor (desde Vault).
//     3. POST al endpoint del certificador con sus credenciales (desde Vault).
//     4. Parsear la respuesta → ResultadoTimbrado { uuidFiscal=nº autorización,
//        serie, numero, numeroAutorizacion, fechaCertificacion }.
//   cancelar(uuid, motivo): anulación del DTE ante el certificador.
//   consultarEstado(uuid): consulta de estado del DTE.
//
// CREDENCIALES: NUNCA en código. Van en Vault / tabla de secretos service-role-
// only (patrón company_payment_secrets), buscadas por companyId.

import type { FiscalProvider, FiscalProviderConfig } from './provider.ts'
import { PacNoConfiguradoError } from './provider.ts'
import type { DteCanonico, ResultadoTimbrado } from './types.ts'

export class FelGtProvider implements FiscalProvider {
  readonly nombre: string

  constructor(private readonly config: FiscalProviderConfig) {
    this.nombre = config.proveedor ?? 'fel_gt'
  }

  // deno-lint-ignore require-await
  async timbrar(_dte: DteCanonico): Promise<ResultadoTimbrado> {
    // TODO(serv:S11 follow-up): integrar certificador GFACE/PAC real (ver contrato arriba).
    throw new PacNoConfiguradoError('fel_gt', this.config.proveedor)
  }

  // deno-lint-ignore require-await
  async cancelar(_uuidFiscal: string, _motivo?: string): Promise<ResultadoTimbrado> {
    throw new PacNoConfiguradoError('fel_gt', this.config.proveedor)
  }

  // deno-lint-ignore require-await
  async consultarEstado(_uuidFiscal: string): Promise<ResultadoTimbrado> {
    throw new PacNoConfiguradoError('fel_gt', this.config.proveedor)
  }
}
