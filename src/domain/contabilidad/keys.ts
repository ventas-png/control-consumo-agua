// Contabilidad (partida doble) — Query keys del dominio.
//
// Convención (igual que src/domain/cobros/keys.ts): `all` como raíz para
// invalidar todo el dominio; cada entidad añade su scope normalizando los
// parámetros ausentes a `null` para que la key sea estable entre renders.
export const contabilidadKeys = {
  all: ['contabilidad'] as const,
  cuentas: (companyId?: string, projectId?: string | null) =>
    [...contabilidadKeys.all, 'cuentas', companyId ?? null, projectId ?? null] as const,
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
  cuentasEspeciales: (companyId?: string, projectId?: string | null) =>
    [...contabilidadKeys.all, 'cuentas-especiales', companyId ?? null, projectId ?? null] as const,
  // Prefijos SIN el ledger, para invalidar TODOS los ledgers de la empresa de
  // una vez. `invalidateQueries` hace match por prefijo, así que la key
  // completa (que termina en el projectId) sólo invalida ESE ledger: guardar el
  // mapeo de un proyecto dejaba la pantalla de la empresa con datos viejos.
  mapeoDeEmpresa: (companyId?: string) =>
    [...contabilidadKeys.all, 'mapeo', companyId ?? null] as const,
  cuentasEspecialesDeEmpresa: (companyId?: string) =>
    [...contabilidadKeys.all, 'cuentas-especiales', companyId ?? null] as const,
  tiposCambio: (companyId?: string) =>
    [...contabilidadKeys.all, 'tipos-cambio', companyId ?? null] as const,
  reglasProveedor: (companyId?: string, projectId?: string | null) =>
    [...contabilidadKeys.all, 'reglas-proveedor', companyId ?? null, projectId ?? null] as const,
  // La previsualización depende de TODAS las dimensiones: si alguna cambia, la
  // respuesta puede cambiar de escalón. Van todas en la key.
  resolucion: (
    companyId?: string,
    projectId?: string | null,
    destino?: string | null,
    proveedorId?: string | null,
    clienteId?: string | null,
    unidadId?: string | null,
    categoria?: string | null,
  ) =>
    [...contabilidadKeys.all, 'resolucion', companyId ?? null, projectId ?? null,
      destino ?? null, proveedorId ?? null, clienteId ?? null,
      unidadId ?? null, categoria ?? null] as const,
  // Prefijos sin ledger, por la misma razón que `mapeoDeEmpresa`: guardar una
  // regla de un proyecto dejaba la pantalla de la empresa con datos viejos.
  reglasProveedorDeEmpresa: (companyId?: string) =>
    [...contabilidadKeys.all, 'reglas-proveedor', companyId ?? null] as const,
  // Bandeja de facturas aprobadas sin asiento. El filtro y la página van en la
  // key porque se resuelven en SERVIDOR: cada combinación es otra consulta.
  pendientes: (
    companyId?: string,
    projectId?: string | null,
    codigo?: string | null,
    busqueda?: string | null,
    pagina?: number,
  ) =>
    [...contabilidadKeys.all, 'pendientes', companyId ?? null, projectId ?? null,
      codigo ?? null, busqueda ?? null, pagina ?? 0] as const,
  // Prefijo sin filtros: un reproceso invalida TODAS las páginas y filtros.
  pendientesDeEmpresa: (companyId?: string) =>
    [...contabilidadKeys.all, 'pendientes', companyId ?? null] as const,
  intentos: (facturaId?: string | null) =>
    [...contabilidadKeys.all, 'intentos', facturaId ?? null] as const,
  // Configuración por tipo de cargo: por ledger, con prefijo de empresa para
  // invalidar los dos ledgers a la vez (misma razón que `mapeoDeEmpresa`).
  configTiposCargo: (companyId?: string, projectId?: string | null) =>
    [...contabilidadKeys.all, 'config-tipos-cargo', companyId ?? null, projectId ?? null] as const,
  configTiposCargoDeEmpresa: (companyId?: string) =>
    [...contabilidadKeys.all, 'config-tipos-cargo', companyId ?? null] as const,
  // La nomenclatura de auxiliares es de la EMPRESA, no del ledger.
  auxiliares: (companyId?: string, busqueda?: string | null) =>
    [...contabilidadKeys.all, 'auxiliares', companyId ?? null, busqueda ?? null] as const,
  auxiliaresDeEmpresa: (companyId?: string) =>
    [...contabilidadKeys.all, 'auxiliares', companyId ?? null] as const,
} as const
