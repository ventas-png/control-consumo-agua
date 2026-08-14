// Cuentas por pagar / Proveedores — Fase 2 ERP. Ver ROADMAP_ERP_FINANZAS.md.
// Espeja las tablas proveedores / facturas_proveedor / ordenes_pago
// (migraciones 20260611010000/010100).

export type EstadoFacturaProveedor =
  | 'registrada'
  | 'aprobada'
  | 'pagada_parcial'
  | 'pagada'
  | 'anulada'

export type EstadoOrdenPago = 'borrador' | 'aprobada' | 'pagada' | 'anulada'

export type MetodoPagoCxP =
  | 'efectivo'
  | 'transferencia'
  | 'deposito'
  | 'cheque'
  | 'tarjeta'
  | 'otro'

export interface Proveedor {
  id: string
  company_id: string
  nombre: string
  nit: string | null
  rfc: string | null
  email: string | null
  telefono: string | null
  direccion: string | null
  contacto_nombre: string | null
  dias_credito: number
  categoria_default: string | null
  activo: boolean
  notas: string | null
  created_at: string
  updated_at: string
}

export interface FacturaProveedor {
  id: string
  company_id: string
  project_id: string | null
  proveedor_id: string
  numero_factura: string | null
  fecha_emision: string
  fecha_vencimiento: string | null
  concepto: string
  categoria: string
  /** Moneda del documento; NULL = moneda del proyecto/empresa. */
  moneda: string | null
  monto_total: number
  iva_monto: number
  monto_pagado: number
  estado: EstadoFacturaProveedor
  aprobada_por: string | null
  aprobada_at: string | null
  notas: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // ── Fase 6 (compras) ──────────────────────────────────────────────────────
  /** Orden que origina la factura. Con orden + recepción el devengo va a 2105. */
  orden_compra_id?: string | null
  /** Quién autorizó aprobarla pese a no cuadrar con la orden. */
  match_forzado_por?: string | null
  match_justificacion?: string | null
}

export interface FacturaProveedorConProveedor extends FacturaProveedor {
  proveedores: Pick<Proveedor, 'nombre'> | null
}

export interface OrdenPago {
  id: string
  company_id: string
  project_id: string | null
  proveedor_id: string
  /**
   * Fase 6: una orden liquida UNA factura o UNA contraseña de pago (que a su
   * vez cubre varias facturas), nunca las dos cosas — lo garantiza un CHECK.
   */
  factura_id: string | null
  contrasena_pago_id?: string | null
  monto: number
  fecha_pago: string | null
  metodo_pago: MetodoPagoCxP
  referencia: string | null
  estado: EstadoOrdenPago
  solicitada_por: string | null
  aprobada_por: string | null
  aprobada_at: string | null
  pagada_at: string | null
  notas: string | null
  created_at: string
  updated_at: string
}

export interface OrdenPagoConRelaciones extends OrdenPago {
  proveedores: Pick<Proveedor, 'nombre'> | null
  facturas_proveedor: Pick<FacturaProveedor, 'numero_factura' | 'concepto' | 'monto_total' | 'monto_pagado'> | null
}

/** Fila de cxp_antiguedad_saldos (RPC, aging 30/60/90). */
export interface AgingProveedor {
  proveedor_id: string
  proveedor: string
  total: number
  corriente: number
  d1_30: number
  d31_60: number
  d61_90: number
  d90_mas: number
}

export const ESTADO_FACTURA_PROV_LABELS: Record<EstadoFacturaProveedor, string> = {
  registrada: 'Registrada',
  aprobada: 'Aprobada',
  pagada_parcial: 'Pagada parcial',
  pagada: 'Pagada',
  anulada: 'Anulada',
}

export const ESTADO_ORDEN_PAGO_LABELS: Record<EstadoOrdenPago, string> = {
  borrador: 'Borrador',
  aprobada: 'Aprobada',
  pagada: 'Pagada',
  anulada: 'Anulada',
}

export const METODOS_PAGO_CXP: { value: MetodoPagoCxP; label: string }[] = [
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'deposito', label: 'Depósito' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'otro', label: 'Otro' },
]

export const CATEGORIAS_GASTO_CXP = [
  'mantenimiento', 'servicios', 'administrativo', 'seguridad', 'limpieza', 'obras', 'otros',
] as const

/** Fila de cxp_proyeccion_pagos: flujo de pagos por proveedor según vencimientos. */
export interface ProyeccionPagosFila {
  proveedor_id: string
  proveedor: string
  total: number
  vencido: number
  d0_7: number
  d8_14: number
  d15_30: number
  d31_mas: number
  sin_fecha: number
}
