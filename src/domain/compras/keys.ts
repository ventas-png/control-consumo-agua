// Compras (Fase 6) — Query keys del dominio.
// Convención del repo: raíz para invalidación masiva; scope normalizado a null.
// `projectId` es la IDENTIDAD de la contabilidad, no un filtro: null = empresa.
export const comprasKeys = {
  all: ['compras'] as const,
  ordenes: (companyId?: string, projectId?: string | null, estado?: string) =>
    [...comprasKeys.all, 'ordenes', companyId ?? null, projectId ?? null, estado ?? null] as const,
  ordenLineas: (ordenId?: string) =>
    [...comprasKeys.all, 'orden-lineas', ordenId ?? null] as const,
  recepciones: (companyId?: string, projectId?: string | null, estado?: string) =>
    [...comprasKeys.all, 'recepciones', companyId ?? null, projectId ?? null, estado ?? null] as const,
  recepcionLineas: (recepcionId?: string) =>
    [...comprasKeys.all, 'recepcion-lineas', recepcionId ?? null] as const,
  activos: (companyId?: string, projectId?: string | null, estado?: string) =>
    [...comprasKeys.all, 'activos', companyId ?? null, projectId ?? null, estado ?? null] as const,
  contrasenas: (companyId?: string, projectId?: string | null, estado?: string) =>
    [...comprasKeys.all, 'contrasenas', companyId ?? null, projectId ?? null, estado ?? null] as const,
  contrasenaFacturas: (contrasenaId?: string) =>
    [...comprasKeys.all, 'contrasena-facturas', contrasenaId ?? null] as const,
  compromisos: (companyId?: string, projectId?: string | null) =>
    [...comprasKeys.all, 'compromisos', companyId ?? null, projectId ?? null] as const,
  cuadre: (facturaId?: string) =>
    [...comprasKeys.all, 'cuadre', facturaId ?? null] as const,
  facturaLineas: (facturaId?: string) =>
    [...comprasKeys.all, 'factura-lineas', facturaId ?? null] as const,
  documentosProveedor: (proveedorId?: string) =>
    [...comprasKeys.all, 'documentos-proveedor', proveedorId ?? null] as const,
  config: (companyId?: string) =>
    [...comprasKeys.all, 'config', companyId ?? null] as const,
} as const
