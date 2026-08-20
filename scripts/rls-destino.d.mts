// Tipos para que `src/test/rls/rlsHarness.test.ts` (TypeScript) pueda importar
// la MISMA validación que usan el seed y el preflight, en vez de reimplementarla.
export interface PartesUrl {
  ref: string
  dominio: string
}

export function refDeUrl(url: string | null | undefined): PartesUrl | null

export interface CoberturaDestino {
  dominiosSandboxPermitidos?: readonly string[]
  refProduccionProhibido?: string
}

export type ResultadoDestino =
  | { ok: true; ref: string }
  | { ok: false; clave: string; motivo: string }

export function validarDestino(opciones: {
  url: string | null | undefined
  esperado: string | null | undefined
  cobertura: CoberturaDestino
  variable?: string
}): ResultadoDestino
