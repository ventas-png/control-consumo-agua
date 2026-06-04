// serv:S11 — STUB del provider de CFDI 4.0 (México). NO integra ningún PAC real.
//
// México (CFDI 4.0 — Comprobante Fiscal Digital por Internet):
//   - Se arma el XML CFDI 4.0 (catálogos c_UsoCFDI, c_RegimenFiscal,
//     c_FormaPago, c_MetodoPago, etc.).
//   - Se TIMBRA por un PAC autorizado (ej. Facturama, Finkok, SW Sapien),
//     que sella, asigna folio fiscal (UUID), agrega el Timbre Fiscal Digital y
//     devuelve el XML timbrado.
//
// CONTRATO A IMPLEMENTAR (follow-up, cuando el dueño elija PAC + cargue creds):
//   timbrar(dte):
//     1. Mapear DteCanonico → XML CFDI 4.0 (Comprobante/Emisor/Receptor/
//        Conceptos/Impuestos). Requiere RFC válidos, RegimenFiscalReceptor,
//        UsoCFDI, DomicilioFiscalReceptor (CP), ObjetoImp, etc.
//     2. POST al PAC con credenciales (desde Vault).
//     3. Parsear → ResultadoTimbrado { uuidFiscal=folio fiscal (UUID),
//        fechaCertificacion=FechaTimbrado, raw=selloCFD/selloSAT }.
//   cancelar(uuid, motivo): cancelación con c_MotivoCancelacion (01/02/03/04).
//   consultarEstado(uuid): consulta de estatus SAT (vigente/cancelado).
//
// CREDENCIALES: NUNCA en código. Van en Vault / tabla de secretos service-role-
// only (patrón company_payment_secrets), buscadas por companyId.

import type { FiscalProvider, FiscalProviderConfig } from './provider.ts'
import { PacNoConfiguradoError } from './provider.ts'
import type { DteCanonico, ResultadoTimbrado } from './types.ts'

export class CfdiMxProvider implements FiscalProvider {
  readonly nombre: string

  constructor(private readonly config: FiscalProviderConfig) {
    this.nombre = config.proveedor ?? 'cfdi_mx'
  }

  // deno-lint-ignore require-await
  async timbrar(_dte: DteCanonico): Promise<ResultadoTimbrado> {
    // TODO(serv:S11 follow-up): integrar PAC real de CFDI (ver contrato arriba).
    throw new PacNoConfiguradoError('cfdi_mx', this.config.proveedor)
  }

  // deno-lint-ignore require-await
  async cancelar(_uuidFiscal: string, _motivo?: string): Promise<ResultadoTimbrado> {
    throw new PacNoConfiguradoError('cfdi_mx', this.config.proveedor)
  }

  // deno-lint-ignore require-await
  async consultarEstado(_uuidFiscal: string): Promise<ResultadoTimbrado> {
    throw new PacNoConfiguradoError('cfdi_mx', this.config.proveedor)
  }
}
