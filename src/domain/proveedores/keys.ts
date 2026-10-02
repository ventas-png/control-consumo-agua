// Proveedores compartidos (PR A) — Query keys.
// Convención del repo: raíz para invalidación masiva; scope normalizado a null.
export const proveedoresKeys = {
  all: ['proveedores-compartidos'] as const,
  contactos: (proveedorId?: string) =>
    [...proveedoresKeys.all, 'contactos', proveedorId ?? null] as const,
  /** Vínculos proveedor↔proyecto. `projectId` undefined = todos los que el usuario puede ver. */
  asignaciones: (companyId?: string, projectId?: string | null) =>
    [...proveedoresKeys.all, 'asignaciones', companyId ?? null, projectId ?? null] as const,
  asignacionesDeProveedor: (proveedorId?: string) =>
    [...proveedoresKeys.all, 'asignaciones-de-proveedor', proveedorId ?? null] as const,
  contratosDeProveedor: (proveedorId?: string) =>
    [...proveedoresKeys.all, 'contratos-de-proveedor', proveedorId ?? null] as const,
  eventosContrato: (contratoId?: string) =>
    [...proveedoresKeys.all, 'eventos-contrato', contratoId ?? null] as const,
  historicosVistaPrevia: (companyId?: string) =>
    [...proveedoresKeys.all, 'historicos-vista-previa', companyId ?? null] as const,
  historicosResumen: (companyId?: string) =>
    [...proveedoresKeys.all, 'historicos-resumen', companyId ?? null] as const,
  operacionesLegado: (companyId?: string) =>
    [...proveedoresKeys.all, 'operaciones-legado', companyId ?? null] as const,
  responsables: (companyId?: string) =>
    [...proveedoresKeys.all, 'responsables', companyId ?? null] as const,
  suministros: (projectId?: string | null) =>
    [...proveedoresKeys.all, 'suministros', projectId ?? null] as const,
  duplicados: (companyId?: string) =>
    [...proveedoresKeys.all, 'duplicados', companyId ?? null] as const,
  reglasCompra: (companyId?: string, projectId?: string | null) =>
    [...proveedoresKeys.all, 'reglas-compra', companyId ?? null, projectId ?? null] as const,
  configCompra: (companyId?: string, projectId?: string | null) =>
    [...proveedoresKeys.all, 'config-compra', companyId ?? null, projectId ?? null] as const,
  // La sugerencia depende de los datos de la línea, no de un id: la key los lleva.
  sugerencia: (
    projectId: string | null,
    destino: string,
    categoria: string | null,
    suministroId: string | null,
    proveedorId: string | null,
    fecha: string,
  ) =>
    [...proveedoresKeys.all, 'sugerencia', projectId, destino, categoria, suministroId, proveedorId, fecha] as const,
  lotes: (companyId?: string, tipo?: string) =>
    [...proveedoresKeys.all, 'lotes', companyId ?? null, tipo ?? null] as const,
  filasLote: (loteId?: string) =>
    [...proveedoresKeys.all, 'filas-lote', loteId ?? null] as const,
} as const
