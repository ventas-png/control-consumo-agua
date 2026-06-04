// Cobros pluggable — Barrel del adapter de payfac PROVIDER-AGNOSTIC (lado edge/Deno).
//
// Importa desde aquí en las edge functions:
//   import { getPaymentProvider, resolverConfigPagoEfectiva, ... } from '../_shared/payments/index.ts'
//
// Frontera Deno/Vite: este módulo es el ESPEJO Deno de src/lib/businessPagos.ts
// + src/types/pagos.ts (parte payfac). No importa src/.

export * from './types.ts'
export * from './provider.ts'
export * from './resolverConfigPago.ts'
export { SandboxPaymentProvider } from './sandboxProvider.ts'
export { QPayProProvider } from './qpayproProvider.ts'
export { makeStubPaymentProvider, makeStripeStubProvider } from './stubProvider.ts'
export { getPaymentProvider } from './getPaymentProvider.ts'
