export const rentasKeys = {
  all: ['rentas'] as const,
  propiedades: (companyId?: string) => [...rentasKeys.all, 'propiedades', companyId ?? null] as const,
  reservas: (companyId?: string) => [...rentasKeys.all, 'reservas', companyId ?? null] as const,
  reservasStr: (companyId?: string, unidades: string[] = []) =>
    [...rentasKeys.all, 'reservas_str', companyId ?? null, unidades.join(',')] as const,
  contratos: (companyId?: string) => [...rentasKeys.all, 'contratos', companyId ?? null] as const,
  inventario: (companyId?: string) => [...rentasKeys.all, 'inventario', companyId ?? null] as const,
  conceptos: (companyId?: string) => [...rentasKeys.all, 'conceptos', companyId ?? null] as const,
  liquidaciones: (companyId?: string) => [...rentasKeys.all, 'liquidaciones', companyId ?? null] as const,
  gastos: (companyId?: string) => [...rentasKeys.all, 'gastos', companyId ?? null] as const,
} as const
