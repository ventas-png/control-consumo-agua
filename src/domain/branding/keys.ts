// plat:P20 — Query keys del dominio "branding" (marca por empresa).

export const brandingKeys = {
  all: ['branding'] as const,
  /** Branding de la empresa indicada. */
  company: (companyId?: string) => [...brandingKeys.all, 'company', companyId ?? null] as const,
}
