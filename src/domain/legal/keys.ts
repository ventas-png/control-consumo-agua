// plat:P33 — Query keys del dominio "legal" (aceptación de documentos legales).
// Sigue la convención de src/domain/README.md.

export const legalKeys = {
  all: ['legal'] as const,
  /** Estado legal del usuario actual (documentos vigentes + si los aceptó). */
  status: () => [...legalKeys.all, 'status'] as const,
}
