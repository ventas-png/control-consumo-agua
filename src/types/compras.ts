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

export type TipoRecepcion = 'bienes' | 'servicio'

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
  /** Sube cada vez que una orden aprobada se devuelve a borrador (Bloque B). */
  revision?: number
  motivo_devolucion?: string | null
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
  /** `servicio` = conformidad de servicio: no mueve inventario ni da de alta activos. */
  tipo?: TipoRecepcion
  destino_fisico?: string | null
  respaldo_path?: string | null
  clave_idempotencia?: string | null
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
  /** ACEPTADA: lo que entra al inventario / se devenga. */
  cantidad: number
  cantidad_rechazada?: number
  motivo_rechazo?: string | null
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
  /** IVA (prorrateado a la cantidad facturada) de la orden vs el de la factura. */
  iva_orden?: number
  iva_factura?: number
  diferencia_iva?: number
  moneda_orden?: string | null
  moneda_factura?: string | null
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

/**
 * Fila de `conta_gastos_duplicados`: un gasto y una factura del mismo ledger
 * que probablemente son el MISMO desembolso capturado dos veces.
 * `razones` viene armada en el servidor y es lo que de verdad se lee — el
 * puntaje solo ordena.
 */
export interface FilaDuplicado {
  gasto_id: string
  gasto_concepto: string
  gasto_fecha: string
  gasto_monto: number
  gasto_estado: string
  /** Si ya tiene asiento vivo, enlazarlo exige anularlo (lo hace la BD). */
  gasto_contabilizado: boolean
  factura_id: string
  factura_numero: string | null
  factura_fecha: string
  factura_monto: number
  proveedor: string | null
  mismo_comprobante: boolean
  mismo_proveedor: boolean
  diferencia_monto: number
  dias_diferencia: number
  puntaje: number
  razones: string
}

/** Fila de `conta_gasto_duplicado_probable`: aviso al capturar un gasto. */
export interface FacturaCandidata {
  factura_id: string
  factura_numero: string | null
  factura_fecha: string
  factura_monto: number
  saldo: number
  proveedor: string | null
  razones: string
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

// ── Seguimiento compartido de la orden (Bloque B) ───────────────────────────
// Espeja lo que devuelve la RPC `compras_seguimiento_orden` (solo lectura).
// Las secciones de facturas y los importes de facturación/pago vienen ausentes
// o nulos para quien no puede ver Contabilidad.

export interface SeguimientoIndicadores {
  comprometido: number
  comprometido_neto: number
  recibido: number
  facturado: number | null
  facturado_neto: number | null
  pagado: number | null
  pendiente_por_recibir: number
  pendiente_por_facturar: number | null
}

export interface SeguimientoLinea {
  id: string
  linea: number
  descripcion: string
  destino: DestinoLinea
  unidad: string | null
  precio_unitario: number
  cantidad_ordenada: number
  cantidad_aceptada: number
  cantidad_rechazada: number
  cantidad_pendiente: number
  cantidad_facturada: number | null
  cantidad_pendiente_facturar: number | null
  cuenta: { id: string; codigo: string; nombre: string } | null
  cuenta_origen: string | null
}

export interface SeguimientoRecepcion {
  id: string
  numero: string | null
  fecha: string
  tipo: TipoRecepcion
  estado: EstadoRecepcion
  recibido_por: string | null
  destino_fisico: string | null
  documento_referencia: string | null
  tiene_respaldo: boolean
  motivo_anulacion: string | null
  aceptado: number
  rechazado: number
}

export interface SeguimientoDiferencia {
  linea: number
  descripcion: string
  motivo: string
  dif_precio: number | null
  dif_iva: number | null
  moneda_orden: string | null
  moneda_factura: string | null
  cantidad_factura: number
}

export interface SeguimientoFactura {
  id: string
  numero_factura: string | null
  fecha_emision: string
  estado: string
  moneda: string | null
  monto_total: number
  iva_monto: number | null
  monto_pagado: number
  saldo: number
  contabilizada: boolean
  match_forzado: boolean
  justificacion: string | null
  diferencias: SeguimientoDiferencia[]
}

export interface SeguimientoEvento {
  tipo: 'estado' | 'devolucion'
  estado_anterior: EstadoOrdenCompra | null
  estado_nuevo: EstadoOrdenCompra
  motivo: string | null
  revision: number
  origen: 'usuario' | 'sistema'
  actor_id: string | null
  created_at: string
}

export interface SeguimientoOrden {
  orden: {
    id: string
    numero: string | null
    concepto: string
    estado: EstadoOrdenCompra
    revision: number
    project_id: string | null
    moneda: string | null
    fecha_requerida: string | null
    aprobada_at: string | null
    emitida_at: string | null
    cerrada_at: string | null
    solicitada_por: string | null
    aprobada_por: string | null
    motivo_devolucion: string | null
    motivo_anulacion: string | null
    proveedor: {
      id: string
      codigo: string | null
      nombre: string
      identificacion: string | null
      pais: string | null
      estado: EstadoProveedor | null
    }
    contrato: { id: string; referencia: string | null; estado: string } | null
  }
  contabilidad_visible: boolean
  indicadores: SeguimientoIndicadores
  lineas: SeguimientoLinea[]
  recepciones: SeguimientoRecepcion[]
  movimientos_inventario: { id: string; tipo: string; cantidad: number; fecha: string; suministro_id: string; origen: string }[]
  activos: { id: string; codigo: string; nombre: string; estado: string; costo: number }[]
  eventos: SeguimientoEvento[]
  /** Ausente si el usuario no puede ver Contabilidad. */
  facturas?: SeguimientoFactura[]
}

/** Fila de `compras_seguimiento_lista`. facturado/pagado son null sin acceso a Contabilidad. */
export interface FilaSeguimiento {
  orden_id: string
  numero: string | null
  concepto: string
  estado: EstadoOrdenCompra
  project_id: string | null
  proveedor_id: string | null
  proveedor: string
  moneda: string | null
  fecha: string
  comprometido: number
  comprometido_neto: number
  recibido: number
  facturado: number | null
  pagado: number | null
}
