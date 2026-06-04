// Cobros pluggable — Fábrica de payfacs STUB (aún sin integrar de punta a punta).
//
// Espeja FelGtProvider/CfdiMxProvider de fiscal: el adapter existe y es elegible,
// pero sus operaciones reales lanzan PayfacNoConfiguradoError hasta integrar el
// payfac. La PRUEBA DE CONEXIÓN (`ping:`) NO lanza: devuelve un ResultadoCobro
// ok:false legible para que payfac-test-connection muestre "sin conectar".
//
// Se usa para visanet/paypal (pendientes de integrar) y para stripe (que usa su
// flujo DEDICADO create-payment-intent; no pasa por el adapter genérico).

import type { PaymentProvider } from './provider.ts'
import { PayfacNoConfiguradoError } from './provider.ts'
import type { ResultadoCobro } from './types.ts'

/**
 * Crea un PaymentProvider stub con el nombre dado. `detalle` explica por qué no
 * está disponible (se incluye en el error y en el ping).
 */
export function makeStubPaymentProvider(nombre: string, detalle: string): PaymentProvider {
  return {
    nombre,
    // deno-lint-ignore require-await
    async crearCobro(): Promise<ResultadoCobro> {
      throw new PayfacNoConfiguradoError(nombre, detalle)
    },
    // deno-lint-ignore require-await
    async consultarEstado(referencia: string): Promise<ResultadoCobro> {
      if (referencia.startsWith('ping:')) {
        // Ping: reporta "no configurado" sin lanzar (resultado válido de prueba).
        return { ok: false, estado: 'error', error: `Payfac "${nombre}" no disponible: ${detalle}` }
      }
      throw new PayfacNoConfiguradoError(nombre, detalle)
    },
    // deno-lint-ignore require-await
    async reembolsar(): Promise<ResultadoCobro> {
      throw new PayfacNoConfiguradoError(nombre, detalle)
    },
  }
}

/** Stripe: usa su flujo dedicado (create-payment-intent / stripe-webhook). */
export function makeStripeStubProvider(): PaymentProvider {
  return makeStubPaymentProvider(
    'stripe',
    'Stripe se cobra por su flujo dedicado (create-payment-intent) y se configura en su pantalla de Stripe; no pasa por el adapter genérico de payfac',
  )
}
