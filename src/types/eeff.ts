// Estados financieros — Fase 5 ERP. Ver ROADMAP_ERP_FINANZAS.md.
// Espeja las RPCs conta_estado_resultados / conta_balance_general /
// conta_flujo_efectivo y la tabla conta_cierres_anuales (migración
// 20260611040000).

/** Fila de conta_estado_resultados (P&L). */
export interface EstadoResultadosFila {
  cuenta_id: string
  codigo: string
  nombre: string
  tipo: 'ingreso' | 'gasto'
  monto: number
}

/** Fila de conta_balance_general. cuenta_id null = fila sintética RESULTADO. */
export interface BalanceFila {
  cuenta_id: string | null
  codigo: string
  nombre: string
  tipo: 'activo' | 'pasivo' | 'capital'
  saldo: number
}

/** Fila de conta_flujo_efectivo (por cuenta de dinero). */
export interface FlujoEfectivoFila {
  cuenta_id: string
  codigo: string
  nombre: string
  saldo_inicial: number
  entradas: number
  salidas: number
  saldo_final: number
}

export interface CierreEjercicio {
  id: string
  company_id: string
  anio: number
  asiento_id: string
  cerrado_por: string | null
  created_at: string
}

/** Fila de conta_consolidado: una entidad contable (empresa o proyecto). */
export interface ConsolidadoFila {
  /** null = empresa */
  ledger_project_id: string | null
  ledger_nombre: string
  /** Moneda base del ledger. */
  moneda: string
  /** Tasa ledger → moneda de la empresa; null = sin tasa registrada. */
  tasa: number | null
  ingresos_origen: number
  gastos_origen: number
  resultado_origen: number
  activo_origen: number
  pasivo_origen: number
  capital_origen: number
  /** Convertidos a la moneda de la empresa; null cuando falta la tasa. */
  ingresos: number | null
  gastos: number | null
  resultado: number | null
  activo: number | null
  pasivo: number | null
  capital: number | null
}
