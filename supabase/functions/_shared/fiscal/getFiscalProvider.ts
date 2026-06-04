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

  // Proveedores reales: hoy stubs que lanzan PacNoConfiguradoError al timbrar.
  if (regimen === 'fel_gt') {
    return new FelGtProvider(cfg)
  }
  if (regimen === 'cfdi_mx') {
    return new CfdiMxProvider(cfg)
  }

  // Régimen no soportado (no debería llegar: el caller filtra 'ninguno').
  throw new PacNoConfiguradoError(regimen, config.proveedor)
}
