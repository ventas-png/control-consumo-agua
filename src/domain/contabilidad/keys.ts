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
  cargosPendientes: (
    companyId?: string,
    projectId?: string | null,
    codigo?: string | null,
    busqueda?: string | null,
    pagina?: number,
  ) =>
    [...contabilidadKeys.all, 'cargosPendientes', companyId ?? null, projectId ?? null,
      codigo ?? null, busqueda ?? null, pagina ?? 0] as const,
  cargosPendientesDeEmpresa: (companyId?: string) =>
    [...contabilidadKeys.all, 'cargosPendientes', companyId ?? null] as const,
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
  // Estado de cuenta: prefijo por empresa para invalidar TODO (cualquier
  // sujeto, rango o página) cuando se contabiliza o reprocesa algo.
  estadoCuentaDeEmpresa: (companyId?: string) =>
    [...contabilidadKeys.all, 'estadoCuenta', companyId ?? null] as const,
  estadoCuenta: (
    companyId?: string,
    projectId?: string | null,
    sujeto?: string | null,
    desde?: string | null,
    hasta?: string | null,
    pagina?: number,
  ) =>
    [...contabilidadKeys.all, 'estadoCuenta', companyId ?? null, 'movimientos', projectId ?? null,
      sujeto ?? null, desde ?? null, hasta ?? null, pagina ?? 0] as const,
  estadoCuentaFuera: (
    companyId?: string,
    projectId?: string | null,
    sujeto?: string | null,
    hasta?: string | null,
    pagina?: number,
  ) =>
    [...contabilidadKeys.all, 'estadoCuenta', companyId ?? null, 'fuera', projectId ?? null,
      sujeto ?? null, hasta ?? null, pagina ?? 0] as const,
  estadoCuentaConciliacion: (
    companyId?: string,
    projectId?: string | null,
    sujeto?: string | null,
    corte?: string | null,
  ) =>
    [...contabilidadKeys.all, 'estadoCuenta', companyId ?? null, 'conciliacion', projectId ?? null,
      sujeto ?? null, corte ?? null] as const,
  // Cobros de cargos adicionales: prefijo por empresa para invalidar el
  // resumen del proyecto y el detalle de cada cargo a la vez.
  cobrosCargoDeEmpresa: (companyId?: string) =>
    [...contabilidadKeys.all, 'cobrosCargo', companyId ?? null] as const,
  cobrosCargoResumen: (companyId?: string, projectId?: string | null) =>
    [...contabilidadKeys.all, 'cobrosCargo', companyId ?? null, 'resumen', projectId ?? null] as const,
  cobrosDeCargo: (companyId?: string, cargoId?: string | null) =>
    [...contabilidadKeys.all, 'cobrosCargo', companyId ?? null, 'cargo', cargoId ?? null] as const,
  // Saldos a favor (20261007000000): prefijo por empresa para invalidar la
  // lista de cualquier sujeto y los candidatos de cualquier origen a la vez.
  saldosFavorDeEmpresa: (companyId?: string) =>
    [...contabilidadKeys.all, 'saldosFavor', companyId ?? null] as const,
  saldosFavor: (companyId?: string, projectId?: string | null, clienteId?: string | null, unidadId?: string | null) =>
    [...contabilidadKeys.all, 'saldosFavor', companyId ?? null, 'lista', projectId ?? null,
      clienteId ?? null, unidadId ?? null] as const,
  saldoFavorDocumentos: (companyId?: string, origenId?: string | null) =>
    [...contabilidadKeys.all, 'saldosFavor', companyId ?? null, 'documentos', origenId ?? null] as const,
  unidadesLedger: (companyId?: string, projectId?: string | null) =>
    [...contabilidadKeys.all, 'unidadesLedger', companyId ?? null, projectId ?? null] as const,
} as const
