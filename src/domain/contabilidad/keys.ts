// Contabilidad (partida doble) — Query keys del dominio.
//
// Convención (igual que src/domain/cobros/keys.ts): `all` como raíz para
// invalidar todo el dominio; cada entidad añade su scope normalizando los
// parámetros ausentes a `null` para que la key sea estable entre renders.
export const contabilidadKeys = {
  all: ['contabilidad'] as const,
  cuentas: (companyId?: string) =>
    [...contabilidadKeys.all, 'cuentas', companyId ?? null] as const,
  asientos: (companyId?: string, projectId?: string | null, periodo?: string, estado?: string) =>
    [...contabilidadKeys.all, 'asientos',
      companyId ?? null, projectId ?? null, periodo ?? null, estado ?? null] as const,
  asiento: (asientoId?: string) =>
    [...contabilidadKeys.all, 'asiento', asientoId ?? null] as const,
  balanza: (companyId?: string, projectId?: string | null, periodo?: string) =>
    [...contabilidadKeys.all, 'balanza', companyId ?? null, projectId ?? null, periodo ?? null] as const,
  mayor: (cuentaId?: string, desde?: string, hasta?: string) =>
    [...contabilidadKeys.all, 'mayor', cuentaId ?? null, desde ?? null, hasta ?? null] as const,
  mapeo: (companyId?: string, projectId?: string | null) =>
    [...contabilidadKeys.all, 'mapeo', companyId ?? null, projectId ?? null] as const,
  tiposCambio: (companyId?: string) =>
    [...contabilidadKeys.all, 'tipos-cambio', companyId ?? null] as const,
} as const
