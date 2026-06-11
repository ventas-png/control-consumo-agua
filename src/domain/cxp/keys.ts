// Cuentas por pagar / Proveedores — Query keys del dominio.
// Convención del repo: raíz para invalidación masiva; scope normalizado a null.
export const cxpKeys = {
  all: ['cxp'] as const,
  proveedores: (companyId?: string) =>
    [...cxpKeys.all, 'proveedores', companyId ?? null] as const,
  facturas: (companyId?: string, projectId?: string | null, estado?: string) =>
    [...cxpKeys.all, 'facturas', companyId ?? null, projectId ?? null, estado ?? null] as const,
  ordenes: (companyId?: string, projectId?: string | null, estado?: string) =>
    [...cxpKeys.all, 'ordenes', companyId ?? null, projectId ?? null, estado ?? null] as const,
  proyeccion: (companyId?: string, projectId?: string | null) =>
    [...cxpKeys.all, 'proyeccion', companyId ?? null, projectId ?? null] as const,
  aging: (companyId?: string, projectId?: string | null) =>
    [...cxpKeys.all, 'aging', companyId ?? null, projectId ?? null] as const,
} as const
