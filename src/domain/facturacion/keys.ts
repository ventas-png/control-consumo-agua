// T4 · Facturación de dominio (agua:C4) — Query keys.
//
// Convención (igual que src/domain/agua/keys.ts):
//   - `all`: raíz del dominio para invalidar todo de una vez.
//   - cada entidad es una función que añade el scope (companyId/projectId) para
//     que cada tenant tenga su propia entrada en caché (sin cross-leak).
//   - un scope ausente se normaliza a `null` para que la key sea estable entre
//     renders (`undefined` rompería la igualdad estructural de react-query).
//
// La Factura de agua vive como columnas de estado/IVA/mora sobre `registros`
// (ver migración 20260604160000), así que la entidad "facturas" lee `registros`
// proyectando los campos de facturación.
export const facturacionKeys = {
  all: ['facturacion'] as const,
  // Facturas (registros con campos de facturación) del tenant, scope company.
  facturas: (companyId?: string) =>
    [...facturacionKeys.all, 'facturas', companyId ?? null] as const,
  // Facturas de un proyecto concreto (scope company + proyecto).
  facturasPorProyecto: (companyId?: string, projectId?: string) =>
    [...facturacionKeys.all, 'facturas', 'por-proyecto', companyId ?? null, projectId ?? null] as const,
  // Reglas de mora configuradas (reglas_mora_config), scope company.
  reglasMora: (companyId?: string) =>
    [...facturacionKeys.all, 'reglas-mora', companyId ?? null] as const,
  // TODAS las reglas de mora (incl. inactivas) para el editor de configuración.
  reglasMoraConfig: (companyId?: string) =>
    [...facturacionKeys.all, 'reglas-mora', 'config', companyId ?? null] as const,
  // Tasa de IVA por defecto del tenant (companies.iva_tasa_default), scope company.
  ivaTasaDefault: (companyId?: string) =>
    [...facturacionKeys.all, 'iva-tasa-default', companyId ?? null] as const,
} as const
