// Contabilidad (partida doble) — Fase 1 ERP. Ver ROADMAP_ERP_FINANZAS.md.
// Espeja las tablas conta_* (migraciones 20260611000000/100/200).

export type TipoCuenta = 'activo' | 'pasivo' | 'capital' | 'ingreso' | 'gasto'
export type NaturalezaCuenta = 'deudora' | 'acreedora'
export type TipoAsiento = 'diario' | 'ingreso' | 'egreso' | 'apertura' | 'cierre'
export type EstadoAsiento = 'borrador' | 'publicado' | 'anulado'
export type OrigenAsiento = 'manual' | 'automatico'

export interface CuentaContable {
  id: string
  company_id: string
  /** Ledger dueño: null = contabilidad de la empresa; uuid = la del proyecto. */
  project_id: string | null
  codigo: string
  nombre: string
  tipo: TipoCuenta
  naturaleza: NaturalezaCuenta
  padre_id: string | null
  /** 1=clase · 2=grupo · 3=mayor · 4=sub-cuenta · 5=auxiliar */
  nivel: number
  es_detalle: boolean
  activa: boolean
  es_sistema: boolean
  /** NULL = moneda base de la empresa; ISO 4217 para bancos en otra moneda. */
  moneda: string | null
  descripcion: string | null
  created_at: string
  updated_at: string
}

export interface AsientoContable {
  id: string
  company_id: string
  project_id: string | null
  /** Folio correlativo por empresa; null mientras es borrador. */
  numero: number | null
  fecha: string
  /** 'YYYY-MM' (generado en BD desde fecha). */
  periodo: string
  tipo: TipoAsiento
  concepto: string
  estado: EstadoAsiento
  origen: OrigenAsiento
  origen_tabla: string | null
  origen_id: string | null
  origen_evento: string | null
  moneda_base: string
  total_debe: number
  total_haber: number
  reversa_de_id: string | null
  anulado_por_id: string | null
  created_by: string | null
  publicado_at: string | null
  created_at: string
  updated_at: string
}

export interface AsientoLinea {
  id: string
  asiento_id: string
  company_id: string
  cuenta_id: string
  orden: number
  descripcion: string | null
  /** Siempre en moneda base. */
  debe: number
  haber: number
  /** Snapshot multimoneda (van juntas o ninguna). */
  moneda_origen: string | null
  monto_origen: number | null
  tipo_cambio: number | null
}

/** Línea con su cuenta embebida (detalle de póliza). */
export interface AsientoLineaConCuenta extends AsientoLinea {
  conta_cuentas: Pick<CuentaContable, 'codigo' | 'nombre'> | null
}

export interface AsientoConLineas extends AsientoContable {
  conta_asiento_lineas: AsientoLineaConCuenta[]
}

export interface MapeoCuenta {
  id: string
  company_id: string
  /** NULL = default de la empresa; con valor = override de esa locación. */
  project_id: string | null
  evento: string
  cuenta_id: string
  created_at: string
  updated_at: string
}

export interface TipoCambio {
  id: string
  company_id: string
  /** ISO 4217 de la moneda extranjera. */
  moneda: string
  fecha: string
  /** Unidades de moneda base por 1 unidad de la moneda extranjera. */
  tasa: number
  created_at: string
}

/** Fila de conta_balanza_comprobacion (RPC). */
export interface BalanzaFila {
  cuenta_id: string
  codigo: string
  nombre: string
  tipo: TipoCuenta
  naturaleza: NaturalezaCuenta
  moneda: string | null
  saldo_inicial: number
  cargos: number
  abonos: number
  saldo_final: number
  saldo_final_origen: number | null
}

/** Fila de conta_libro_mayor (RPC). */
export interface MovimientoMayor {
  linea_id: string
  asiento_id: string
  numero: number | null
  fecha: string
  concepto: string
  descripcion: string | null
  debe: number
  haber: number
  saldo: number
}

/**
 * Eventos de negocio mapeables a cuentas (conta_mapeo_cuentas). Debe espejarse
 * con los eventos que usan los triggers de la migración 20260611000200.
 */
export const EVENTOS_MAPEO = [
  { evento: 'metodo_efectivo',      grupo: 'Métodos de cobro/pago', label: 'Efectivo' },
  { evento: 'metodo_transferencia', grupo: 'Métodos de cobro/pago', label: 'Transferencia' },
  { evento: 'metodo_deposito',      grupo: 'Métodos de cobro/pago', label: 'Depósito' },
  { evento: 'metodo_cheque',        grupo: 'Métodos de cobro/pago', label: 'Cheque' },
  { evento: 'metodo_tarjeta',       grupo: 'Métodos de cobro/pago', label: 'Tarjeta' },
  { evento: 'metodo_pasarela',      grupo: 'Métodos de cobro/pago', label: 'Pasarela (Stripe/PayPal)' },
  { evento: 'metodo_otro',          grupo: 'Métodos de cobro/pago', label: 'Otro método' },
  { evento: 'ingreso_agua',         grupo: 'Ingresos',              label: 'Servicio de agua' },
  { evento: 'ingreso_cuota',        grupo: 'Ingresos',              label: 'Cuotas de condominio' },
  { evento: 'ingreso_mora',         grupo: 'Ingresos',              label: 'Mora y recargos' },
  { evento: 'ingreso_otros',        grupo: 'Ingresos',              label: 'Otros ingresos' },
  { evento: 'cxc_agua',             grupo: 'Cuentas por cobrar',    label: 'CxC servicio de agua' },
  { evento: 'cxc_cuotas',           grupo: 'Cuentas por cobrar',    label: 'CxC cuotas de condominio' },
  { evento: 'iva_por_pagar',        grupo: 'Impuestos',             label: 'IVA por pagar' },
  { evento: 'gasto_mantenimiento',  grupo: 'Gastos',                label: 'Mantenimiento' },
  { evento: 'gasto_servicios',      grupo: 'Gastos',                label: 'Servicios' },
  { evento: 'gasto_administrativo', grupo: 'Gastos',                label: 'Administrativo' },
  { evento: 'gasto_seguridad',      grupo: 'Gastos',                label: 'Seguridad' },
  { evento: 'gasto_limpieza',       grupo: 'Gastos',                label: 'Limpieza' },
  { evento: 'gasto_obras',          grupo: 'Gastos',                label: 'Obras y mejoras' },
  { evento: 'gasto_otros',          grupo: 'Gastos',                label: 'Otros gastos' },
] as const

export type EventoMapeo = (typeof EVENTOS_MAPEO)[number]['evento']

export const TIPO_CUENTA_LABELS: Record<TipoCuenta, string> = {
  activo: 'Activo',
  pasivo: 'Pasivo',
  capital: 'Capital',
  ingreso: 'Ingresos',
  gasto: 'Gastos',
}

export const TIPO_ASIENTO_LABELS: Record<TipoAsiento, string> = {
  diario: 'Diario',
  ingreso: 'Ingreso',
  egreso: 'Egreso',
  apertura: 'Apertura',
  cierre: 'Cierre',
}

/** Naturaleza default por tipo de cuenta (editable cuenta a cuenta). */
export const NATURALEZA_POR_TIPO: Record<TipoCuenta, NaturalezaCuenta> = {
  activo: 'deudora',
  gasto: 'deudora',
  pasivo: 'acreedora',
  capital: 'acreedora',
  ingreso: 'acreedora',
}

// ── Revaluación FX (RPC conta_revaluar_fx) ──────────────────────────────────

export type RevaluacionFxResultado =
  | 'previsualizacion'
  | 'ajustado'
  | 'ya_revaluado'
  | 'sin_cambio'
  | 'sin_tasa'

export interface RevaluacionFxFila {
  cuenta_id: string
  codigo: string
  nombre: string
  moneda: string
  saldo_origen: number
  tasa: number | null
  saldo_libro: number
  saldo_revaluado: number | null
  ajuste: number | null
  resultado: RevaluacionFxResultado
  asiento_id: string | null
}

export const REVALUACION_RESULTADO_LABELS: Record<RevaluacionFxResultado, string> = {
  previsualizacion: 'Por ajustar',
  ajustado: 'Ajustado',
  ya_revaluado: 'Ya revaluado hoy',
  sin_cambio: 'Sin cambio',
  sin_tasa: 'Sin tipo de cambio',
}
