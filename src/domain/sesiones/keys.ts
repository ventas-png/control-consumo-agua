// plat:P9 — Query keys del dominio "sesiones activas". Sigue la convención de
// src/domain/README.md (objeto con `all` + funciones por entidad).

export const sesionesKeys = {
  all: ['sesiones'] as const,
  /** Sesiones del usuario autenticado actual. */
  mine: () => [...sesionesKeys.all, 'mine'] as const,
}
