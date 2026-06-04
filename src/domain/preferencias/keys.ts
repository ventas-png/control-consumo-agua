// plat:P18 — Query keys del dominio "preferencias" (regionales del usuario).
// Convención de src/domain/README.md.

export const preferenciasKeys = {
  all: ['preferencias'] as const,
  /** Preferencias del usuario indicado. */
  mine: (userId?: string) => [...preferenciasKeys.all, 'mine', userId ?? null] as const,
}
