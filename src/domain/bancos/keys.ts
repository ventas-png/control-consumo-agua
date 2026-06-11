// Bancos y conciliación — Query keys del dominio.
// Convención del repo: raíz para invalidación masiva; scope normalizado a null.
export const bancosKeys = {
  all: ['bancos'] as const,
  cuentas: (companyId?: string, projectId?: string | null) =>
    [...bancosKeys.all, 'cuentas', companyId ?? null, projectId ?? null] as const,
  movimientos: (cuentaBancariaId?: string, estado?: string) =>
    [...bancosKeys.all, 'movimientos', cuentaBancariaId ?? null, estado ?? null] as const,
  sugerencias: (cuentaBancariaId?: string) =>
    [...bancosKeys.all, 'sugerencias', cuentaBancariaId ?? null] as const,
  estadoConciliacion: (cuentaBancariaId?: string, periodo?: string) =>
    [...bancosKeys.all, 'estado-conciliacion', cuentaBancariaId ?? null, periodo ?? null] as const,
} as const
