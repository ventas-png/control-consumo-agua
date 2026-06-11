// Presupuesto avanzado — Query keys del dominio.
// Convención del repo: raíz para invalidación masiva; scope normalizado a null.
export const presupuestoKeys = {
  all: ['presupuesto-erp'] as const,
  lista: (companyId?: string, anio?: number) =>
    [...presupuestoKeys.all, 'lista', companyId ?? null, anio ?? null] as const,
  partidas: (presupuestoId?: string) =>
    [...presupuestoKeys.all, 'partidas', presupuestoId ?? null] as const,
  vsReal: (presupuestoId?: string) =>
    [...presupuestoKeys.all, 'vs-real', presupuestoId ?? null] as const,
  partidaEstado: (projectId?: string, categoria?: string, fecha?: string) =>
    [...presupuestoKeys.all, 'partida-estado', projectId ?? null, categoria ?? null, fecha ?? null] as const,
} as const
