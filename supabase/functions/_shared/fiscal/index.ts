// serv:S11 — Barrel del adapter fiscal PROVIDER-AGNOSTIC (lado edge/Deno).
//
// Importa desde aquí en las edge functions:
//   import { getFiscalProvider, construirDteCanonico, ... } from '../_shared/fiscal/index.ts'
//
// Frontera Deno/Vite: este módulo es el ESPEJO Deno de src/lib/businessFiscal.ts
// + src/types/fiscal.ts. No importa src/.

export * from './types.ts'
export * from './stateMachine.ts'
export * from './provider.ts'
export * from './felGtDte.ts'
export { SandboxProvider } from './sandboxProvider.ts'
export { FelGtProvider } from './felGtProvider.ts'
export { CfdiMxProvider } from './cfdiMxProvider.ts'
export {
  AinnovaProvider,
  AINNOVA,
  AINNOVA_ENDPOINTS,
  AinnovaCredencialesError,
  AinnovaContratoNoConfirmadoError,
} from './ainnovaProvider.ts'
export { getFiscalProvider } from './getFiscalProvider.ts'
