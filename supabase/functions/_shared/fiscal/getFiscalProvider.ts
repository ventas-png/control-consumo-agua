// serv:S11 — Resolver del adapter fiscal. Decide QUÉ FiscalProvider usar según
// la config del tenant (companies.regimen_fiscal + companies.proveedor_timbrado).
//
// COMPORTAMIENTO HOY (foundation, sin PAC real):
//   - proveedor 'sandbox' (o sin configurar) → SandboxProvider (timbrado
//     simulado determinista). Es el default, así que dev/test funciona out of
//     the box.
//   - cualquier otro proveedor con régimen real → el stub correspondiente
//     (FelGtProvider / CfdiMxProvider), cuyos métodos lanzan
//     PacNoConfiguradoError hasta que se integre el certificador real.
//   - régimen 'ninguno'/desconocido → error claro (el tenant no factura).
//
// Cuando el dueño elija el PAC real y cargue credenciales en Vault, basta
// completar el stub correspondiente: el caller (timbrar-documento) no cambia.

import type { FiscalProvider, FiscalProviderConfig } from './provider.ts'
import { PacNoConfiguradoError } from './provider.ts'
import { SandboxProvider } from './sandboxProvider.ts'
import { FelGtProvider } from './felGtProvider.ts'
import { CfdiMxProvider } from './cfdiMxProvider.ts'
import { AinnovaProvider, AINNOVA } from './ainnovaProvider.ts'
import type { RegimenFiscal } from './types.ts'

/**
 * Resuelve el provider para un régimen + config de tenant.
 *
 * @param regimen  'fel_gt' | 'cfdi_mx' (de companies.regimen_fiscal; 'ninguno'
 *                 no llega aquí — el caller filtra antes).
 * @param config   companyId (para futuras creds en Vault) + proveedor configurado.
 */
export function getFiscalProvider(
  regimen: RegimenFiscal,
  config: FiscalProviderConfig = {},
): FiscalProvider {
  const proveedor = (config.proveedor ?? 'sandbox').trim().toLowerCase()
  const cfg: FiscalProviderConfig = { ...config, regimen }

  // Sandbox: timbrado simulado determinista. Default mientras no haya PAC real.
  if (proveedor === '' || proveedor === 'sandbox') {
    return new SandboxProvider()
  }

  // FEL (Guatemala).
  if (regimen === 'fel_gt') {
    // Ainnova: PAC REAL elegido por el dueño (carga credenciales + mapea DTE FEL;
    // el transporte se habilita al confirmar el contrato — ver ainnovaProvider).
    if (proveedor === AINNOVA) {
      return new AinnovaProvider(cfg)
    }
    // Otros certificadores GT: aún stubs que lanzan PacNoConfiguradoError.
    return new FelGtProvider(cfg)
  }
  // CFDI (México): aún stub.
  if (regimen === 'cfdi_mx') {
    return new CfdiMxProvider(cfg)
  }

  // Régimen no soportado (no debería llegar: el caller filtra 'ninguno').
  throw new PacNoConfiguradoError(regimen, config.proveedor)
}
