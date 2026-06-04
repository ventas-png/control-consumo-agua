// plat:P20 — Query keys del dominio "branding" (marca por empresa).

export const brandingKeys = {
  all: ['branding'] as const,
  /** Branding de la empresa indicada. */
  company: (companyId?: string) => [...brandingKeys.all, 'company', companyId ?? null] as const,
  /** Identidad de la empresa (logo + nombre) para el shell. */
  logo: (companyId?: string) => [...brandingKeys.all, 'logo', companyId ?? null] as const,
}
