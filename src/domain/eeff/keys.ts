// Estados financieros — Query keys del dominio.
export const eeffKeys = {
  all: ['eeff'] as const,
  estadoResultados: (companyId?: string, projectId?: string | null, desde?: string, hasta?: string) =>
    [...eeffKeys.all, 'pyg', companyId ?? null, projectId ?? null, desde ?? null, hasta ?? null] as const,
  balance: (companyId?: string, projectId?: string | null, periodo?: string) =>
    [...eeffKeys.all, 'balance', companyId ?? null, projectId ?? null, periodo ?? null] as const,
  flujo: (companyId?: string, projectId?: string | null, periodo?: string) =>
    [...eeffKeys.all, 'flujo', companyId ?? null, projectId ?? null, periodo ?? null] as const,
  consolidado: (companyId?: string, desde?: string, hasta?: string) =>
    [...eeffKeys.all, 'consolidado', companyId ?? null, desde ?? null, hasta ?? null] as const,
  cierres: (companyId?: string) =>
    [...eeffKeys.all, 'cierres', companyId ?? null] as const,
} as const
