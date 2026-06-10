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
