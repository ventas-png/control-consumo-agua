// Compras — Fase 6 ERP. Ver ROADMAP_ERP_FINANZAS.md.
// Espeja las tablas ordenes_compra / orden_compra_lineas / recepciones /
// recepcion_lineas / activos_fijos / contrasenas_pago (migraciones 20260820*).
//
// Todo documento del riel lleva company_id + project_id, donde project_id NULL
// = contabilidad de la EMPRESA, igual que el resto del módulo contable.

export type EstadoOrdenCompra =
  | 'borrador'
  | 'aprobada'
  | 'emitida'
  | 'recibida_parcial'
  | 'recibida'
  | 'cerrada'
  | 'cancelada'

export type EstadoProveedor =
  | 'borrador'
  | 'en_revision'
  | 'autorizado'
  | 'suspendido'
  | 'vetado'

/** Qué se hace con lo que llega: decide el asiento y el destino operativo. */
export type DestinoLinea = 'inventario' | 'activo_fijo' | 'servicio' | 'gasto'

export type EstadoRecepcion = 'borrador' | 'registrada' | 'anulada'

export type EstadoContrasena = 'emitida' | 'pagada' | 'anulada'

export type EstadoActivoFijo = 'activo' | 'en_reparacion' | 'dado_de_baja'

export type CategoriaActivoFijo = 'mobiliario' | 'computo' | 'maquinaria' | 'vehiculo' | 'otro'

export type TipoDocumentoProveedor =
  | 'rtu'
  | 'patente_comercio'
  | 'patente_sociedad'
  | 'dpi_representante'
  | 'constancia_iva'
  | 'referencia_bancaria'
  | 'contrato'
  | 'otro'

export interface ProveedorDocumento {
  id: string
  company_id: string
  proveedor_id: string
  tipo: TipoDocumentoProveedor
  numero: string | null
  archivo_url: string | null
  emitido_el: string | null
  vence_el: string | null
  verificado_por: string | null
  verificado_at: string | null
  notas: string | null
  created_at: string
  updated_at: string
}

export interface OrdenCompra {
  id: string
  company_id: string
  /** NULL = contabilidad de la empresa. */
  project_id: string | null
  proveedor_id: string | null
  /** Texto libre heredado; se conserva para no perder el histórico. */
  proveedor_nombre: string
  numero: string | null
  correlativo: number | null
  concepto: string
  descripcion: string | null
  moneda: string | null
  subtotal: number
  iva_monto: number
  total: number
  condiciones_pago: string | null
  dias_credito: number
  fecha_requerida: string | null
  fecha_entrega_esperada: string | null
  obra_id: string | null
  estado: EstadoOrdenCompra
  aprobada_por: string | null
  aprobada_at: string | null
  emitida_at: string | null
  cerrada_at: string | null
  motivo_anulacion: string | null
  notas: string | null
  created_at: string
  updated_at: string
}

export interface OrdenCompraLinea {
  id: string
  company_id: string
  orden_compra_id: string
  linea: number
  descripcion: string
  destino_tipo: DestinoLinea
  suministro_id: string | null
  cuenta_id: string | null
  categoria: string
  cantidad: number
  unidad: string
  precio_unitario: number
  iva_monto: number
  total: number
  cantidad_recibida: number
  cantidad_facturada: number
  notas: string | null
}

export interface OrdenCompraConRelaciones extends OrdenCompra {
  proveedores: { nombre: string; estado: EstadoProveedor } | null
}

export interface Recepcion {
  id: string
  company_id: string
  project_id: string | null
  orden_compra_id: string
  numero: string | null
  fecha: string
  documento_referencia: string | null
  recibido_por: string | null
  estado: EstadoRecepcion
  registrada_at: string | null
  anulada_at: string | null
  motivo_anulacion: string | null
  notas: string | null
  created_at: string
  updated_at: string
}

export interface RecepcionLinea {
  id: string
  company_id: string
  recepcion_id: string
  orden_compra_linea_id: string
  cantidad: number
  costo_unitario: number
  total: number
  observacion: string | null
}

export interface RecepcionConRelaciones extends Recepcion {
  ordenes_compra: Pick<OrdenCompra, 'numero' | 'concepto' | 'proveedor_id'> | null
}

export interface ActivoFijo {
  id: string
  company_id: string
  project_id: string | null
  codigo: string
  nombre: string
  categoria: CategoriaActivoFijo
  numero_serie: string | null
  ubicacion: string | null
  fecha_alta: string
  costo: number
  valor_residual: number
  vida_util_meses: number
  cuenta_activo_id: string | null
  cuenta_dep_acum_id: string | null
  cuenta_gasto_dep_id: string | null
  estado: EstadoActivoFijo
  proveedor_id: string | null
  recepcion_linea_id: string | null
  motivo_baja: string | null
  notas: string | null
  created_at: string
  updated_at: string
}

export interface ContrasenaPago {
  id: string
  company_id: string
  project_id: string | null
  proveedor_id: string
  numero: string | null
  fecha_emision: string
  fecha_pago_programada: string
  moneda: string | null
  total: number
  estado: EstadoContrasena
  entregada_por: string | null
  recibida_por: string | null
  observaciones: string | null
  motivo_anulacion: string | null
  created_by: string | null
  pagada_at: string | null
  created_at: string
  updated_at: string
}

export interface ContrasenaPagoFactura {
  id: string
  company_id: string
  contrasena_id: string
  factura_id: string
  monto: number
}

export interface ContrasenaConRelaciones extends ContrasenaPago {
  proveedores: { nombre: string } | null
}

/** Fila de compras_validar_match: el cuadre de 3 vías, renglón por renglón. */
export interface FilaCuadre {
  linea: number
  descripcion: string
  cantidad_ordenada: number
  cantidad_recibida: number
  /** Lo facturado por las DEMÁS facturas (excluye la que se está mirando). */
  cantidad_facturada: number
  cantidad_factura: number
  precio_orden: number
  precio_factura: number
  diferencia_precio: number
  diferencia_pct: number | null
  dentro_tolerancia: boolean
  motivo: string
}

/** Fila de compras_compromisos: comprometido vs recibido por proveedor. */
export interface FilaCompromiso {
  proveedor_id: string
  proveedor: string
  ordenes: number
  comprometido: number
  recibido: number
  pendiente: number
}

export interface ComprasConfig {
  company_id: string
  tolerancia_cantidad_pct: number
  tolerancia_precio_pct: number
  monto_minimo_oc: number
  requiere_recepcion: boolean
}

export const ESTADO_PROVEEDOR_LABELS: Record<EstadoProveedor, string> = {
  borrador: 'Borrador',
  en_revision: 'En revisión',
  autorizado: 'Autorizado',
  suspendido: 'Suspendido',
  vetado: 'Vetado',
}

export const ESTADO_OC_LABELS: Record<EstadoOrdenCompra, string> = {
  borrador: 'Borrador',
  aprobada: 'Aprobada',
  emitida: 'Emitida',
  recibida_parcial: 'Recibida parcial',
  recibida: 'Recibida',
  cerrada: 'Cerrada',
  cancelada: 'Cancelada',
}

export const ESTADO_RECEPCION_LABELS: Record<EstadoRecepcion, string> = {
  borrador: 'Borrador',
  registrada: 'Registrada',
  anulada: 'Anulada',
}

export const ESTADO_CONTRASENA_LABELS: Record<EstadoContrasena, string> = {
  emitida: 'Emitida',
  pagada: 'Pagada',
  anulada: 'Anulada',
}

export const DESTINO_LINEA_LABELS: Record<DestinoLinea, string> = {
  inventario: 'Inventario',
  activo_fijo: 'Activo fijo',
  servicio: 'Servicio',
  gasto: 'Gasto',
}

export const TIPO_DOC_PROVEEDOR_LABELS: Record<TipoDocumentoProveedor, string> = {
  rtu: 'RTU',
  patente_comercio: 'Patente de comercio',
  patente_sociedad: 'Patente de sociedad',
  dpi_representante: 'DPI del representante',
  constancia_iva: 'Constancia de IVA',
  referencia_bancaria: 'Referencia bancaria',
  contrato: 'Contrato',
  otro: 'Otro',
}

export const CATEGORIA_ACTIVO_LABELS: Record<CategoriaActivoFijo, string> = {
  mobiliario: 'Mobiliario y equipo',
  computo: 'Equipo de cómputo',
  maquinaria: 'Maquinaria y herramienta',
  vehiculo: 'Vehículos',
  otro: 'Otro',
}

/**
 * Solo un proveedor autorizado Y vigente recibe órdenes de compra. Espeja
 * `proveedor_habilitado()` en la BD, que es quien manda: esto solo evita
 * ofrecer en el selector a quien el trigger va a rechazar.
 */
export function proveedorHabilitado(
  p: { estado?: EstadoProveedor | null; autorizacion_vence?: string | null; activo?: boolean },
  hoyISO: string,
): boolean {
  // Proveedores capturados antes de la Fase 6 pueden no traer `estado` si la
  // consulta es vieja; en ese caso se cae al booleano de siempre.
  const estado = p.estado ?? (p.activo ? 'autorizado' : 'suspendido')
  if (estado !== 'autorizado') return false
  return !p.autorizacion_vence || p.autorizacion_vence >= hoyISO
}
