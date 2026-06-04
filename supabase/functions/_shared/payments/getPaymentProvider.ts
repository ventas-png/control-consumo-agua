// Cobros pluggable — Resolver del adapter de payfac. Decide QUÉ PaymentProvider
// usar según la config del tenant (proveedor_pago efectivo). Espeja
// getFiscalProvider.
//
// COMPORTAMIENTO:
//   - 'sandbox' (o vacío)  → SandboxPaymentProvider (cobro simulado determinista).
//                            Default: dev/test funciona out of the box.
//   - 'qpaypro'            → QPayProProvider REAL (lee credenciales inyectadas).
//   - 'visanet' / 'paypal' → stub (lanza PayfacNoConfiguradoError hasta integrar).
//   - 'stripe'             → stub que apunta al flujo dedicado create-payment-intent.
//   - desconocido          → PayfacNoConfiguradoError.
//
// El caller (create-charge / payfac-test-connection) NO cambia al integrar un
// payfac nuevo: solo se completa/añade el adapter aquí.

import type { PaymentProvider, PaymentProviderConfig } from './provider.ts'
import { PayfacNoConfiguradoError, normalizarProveedorPago } from './provider.ts'
import { SandboxPaymentProvider } from './sandboxProvider.ts'
import { QPayProProvider } from './qpayproProvider.ts'
import { makeStubPaymentProvider, makeStripeStubProvider } from './stubProvider.ts'

/**
 * Resuelve el PaymentProvider para la config de un tenant.
 *
 * @param config  proveedor (proveedor_pago efectivo) + ambiente + moneda +
 *                credenciales (inyectadas desde la bóveda por el edge).
 */
export function getPaymentProvider(config: PaymentProviderConfig = {}): PaymentProvider {
  const proveedor = normalizarProveedorPago(config.proveedor)

  if (proveedor === 'sandbox') {
    return new SandboxPaymentProvider()
  }
  if (proveedor === 'qpaypro') {
    return new QPayProProvider(config)
  }
  if (proveedor === 'visanet') {
    return makeStubPaymentProvider('visanet', 'integración de Visanet pendiente (follow-up)')
  }
  if (proveedor === 'paypal') {
    return makeStubPaymentProvider('paypal', 'integración de PayPal pendiente (follow-up)')
  }
  if (proveedor === 'stripe') {
    return makeStripeStubProvider()
  }

  throw new PayfacNoConfiguradoError(proveedor)
}
