export const energiaKeys = {
  all: ['energia'] as const,
  proveedores: (companyId?: string) => [...energiaKeys.all, 'proveedores', companyId ?? null] as const,
  tarifas: (companyId?: string) => [...energiaKeys.all, 'tarifas', companyId ?? null] as const,
  fuentes: (companyId?: string) => [...energiaKeys.all, 'fuentes', companyId ?? null] as const,
  facturas: (companyId?: string) => [...energiaKeys.all, 'facturas', companyId ?? null] as const,
} as const
