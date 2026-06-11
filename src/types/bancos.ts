// Bancos y conciliación — Fase 4 ERP. Ver ROADMAP_ERP_FINANZAS.md.
// Espeja cuentas_bancarias / banco_movimientos (migraciones 20260611030000/100).

export type EstadoMovimientoBanco = 'pendiente' | 'conciliado' | 'descartado'
export type MatchTipoBanco = 'pago' | 'orden_pago' | 'ajuste'

export interface CuentaBancaria {
  id: string
  company_id: string
  nombre: string
  banco: string
  /** Solo los últimos dígitos; nunca el número completo. */
  numero_mascara: string | null
  /** ISO 4217; NULL = moneda base de la empresa. */
  moneda: string | null
  cuenta_contable_id: string
  activa: boolean
  notas: string | null
  created_at: string
  updated_at: string
}

export interface BancoMovimiento {
  id: string
  company_id: string
  cuenta_bancaria_id: string
  fecha: string
  descripcion: string | null
  referencia: string | null
  /** Con signo, en la moneda de la cuenta: > 0 deposita, < 0 retira. */
  monto: number
  lote_id: string | null
  estado: EstadoMovimientoBanco
  match_tipo: MatchTipoBanco | null
  match_id: string | null
  conciliado_por: string | null
  conciliado_at: string | null
  created_at: string
}

/** Fila de banco_sugerencias_conciliacion (RPC). */
export interface SugerenciaConciliacion {
  movimiento_id: string
  candidato_tipo: 'pago' | 'orden_pago'
  candidato_id: string
  candidato_fecha: string
  candidato_monto: number
  candidato_descripcion: string | null
  /** 'exacta' = mismo monto ±3d; 'aproximada' = mismo monto 4-7d o diferencia ≤ max(1, 0.5%) ±3d. */
  confianza: 'exacta' | 'aproximada'
}

/** Fila de banco_estado_conciliacion (RPC). */
export interface EstadoConciliacion {
  saldo_libro: number
  saldo_libro_origen: number | null
  saldo_banco: number
  pendientes: number
  monto_pendiente: number
}

export const ESTADO_MOVIMIENTO_LABELS: Record<EstadoMovimientoBanco, string> = {
  pendiente: 'Pendiente',
  conciliado: 'Conciliado',
  descartado: 'Descartado',
}

export const MATCH_TIPO_LABELS: Record<MatchTipoBanco, string> = {
  pago: 'Pago de cliente',
  orden_pago: 'Pago a proveedor',
  ajuste: 'Ajuste contable',
}
