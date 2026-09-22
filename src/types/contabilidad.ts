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
  /** 1=clase · 2=grupo · 3=mayor · 4=sub-cuenta · 5..8=auxiliares */
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

/**
 * Cuentas ESPECIALES del sistema: las que el motor contable necesita resolver
 * por SIGNIFICADO para poder operar (cierre anual, revaluación cambiaria,
 * apertura de saldos, puente de compras…). Antes se buscaban por su código del
 * catálogo sembrado ('3101', '3201', '3301', '1401'…), lo que ataba la
 * contabilidad a ese plan de cuentas; ahora se resuelven contra
 * `conta_mapeo_cuentas`, acotadas al ledger activo.
 *
 * Espeja `public.conta_eventos_especiales()` (migración 20260918121413). El
 * orden de esta lista es el de la sección de Configuración; el estado real
 * (qué falta y por qué) lo da `conta_cuentas_especiales_estado`.
 */
export const CUENTAS_ESPECIALES = [
  { evento: 'resultados_acumulados',  label: 'Resultados acumulados',            proceso: 'Apertura de saldos' },
  { evento: 'resultado_ejercicio',    label: 'Resultado del ejercicio',          proceso: 'Cierre anual' },
  { evento: 'diferencial_cambiario',  label: 'Diferencial cambiario',            proceso: 'Revaluación cambiaria' },
  { evento: 'cxp_proveedores',        label: 'Proveedores por pagar',            proceso: 'Cuentas por pagar' },
  { evento: 'compras_por_facturar',   label: 'Bienes y servicios por facturar',  proceso: 'Recepción de compras' },
  { evento: 'iva_credito',            label: 'IVA crédito fiscal',               proceso: 'IVA de compras' },
  { evento: 'iva_por_pagar',          label: 'IVA por pagar',                    proceso: 'IVA de cobros' },
  { evento: 'inventario',             label: 'Inventario de insumos',            proceso: 'Recepción a bodega' },
  { evento: 'activo_fijo',            label: 'Activo fijo',                      proceso: 'Alta de activos' },
  { evento: 'depreciacion_acumulada', label: 'Depreciación acumulada',           proceso: 'Alta de activos' },
  { evento: 'gasto_depreciacion',     label: 'Gasto por depreciación',           proceso: 'Alta de activos' },
] as const

export type EventoEspecial = (typeof CUENTAS_ESPECIALES)[number]['evento']

/**
 * Por qué una cuenta especial no está disponible. Distinguirlos importa:
 * `sin_mapeo` se arregla eligiendo una cuenta aquí mismo, mientras que
 * `inactiva`, `agrupadora` y `otro_ledger` se arreglan en el catálogo.
 */
export type EstadoCuentaEspecial =
  | 'ok'
  | 'sin_mapeo'
  | 'inactiva'
  | 'agrupadora'
  | 'otro_ledger'

/** Fila de `conta_cuentas_especiales_estado(p_project_id)`. */
export interface CuentaEspecialEstado {
  evento: string
  etiqueta: string
  proceso: string
  /** true = el proceso se detiene con "Configuración contable incompleta". */
  bloqueante: boolean
  /** Sólo viene con valor cuando la cuenta es USABLE (activa, detalle, del ledger). */
  cuenta_id: string | null
  codigo: string | null
  nombre: string | null
  estado: EstadoCuentaEspecial
}

export const ESTADO_CUENTA_ESPECIAL_LABELS: Record<EstadoCuentaEspecial, string> = {
  ok: 'Configurada',
  sin_mapeo: 'Sin asignar',
  inactiva: 'La cuenta está inactiva',
  agrupadora: 'La cuenta es agrupadora, no de detalle',
  otro_ledger: 'La cuenta es de otra contabilidad',
}

/** Mensaje único de configuración incompleta (espeja CONTA_CONFIG_INCOMPLETA). */
export const MSG_CONFIG_CONTABLE_INCOMPLETA = 'Configuración contable incompleta'

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

// ── Reglas de imputación contable ───────────────────────────────────────────
// Espejo de 20260926000000. Los destinos NO son códigos contables: son
// etiquetas semánticas que la BD declara en `conta_destinos_imputacion()` y
// que cada una resuelve a un evento de `conta_mapeo_cuentas`.

export const DESTINOS_IMPUTACION = [
  { destino: 'gasto',                etiqueta: 'Gasto',                descripcion: 'Consumo del período: servicios, mantenimiento, administración' },
  { destino: 'costo',                etiqueta: 'Costo',                descripcion: 'Costo directo imputable a un proyecto u obra' },
  { destino: 'inventario',           etiqueta: 'Inventario',           descripcion: 'Insumos que entran a bodega y se consumen después' },
  { destino: 'activo_fijo',          etiqueta: 'Activo fijo',          descripcion: 'Bienes capitalizables que se deprecian' },
  { destino: 'compras_por_facturar', etiqueta: 'Compras por facturar', descripcion: 'Puente GR/IR entre la recepción y la factura' },
] as const

export type DestinoImputacion = (typeof DESTINOS_IMPUTACION)[number]['destino']

/**
 * De dónde salió la cuenta. El orden de la unión ES la prioridad, y
 * `sin_resolver` es un resultado legítimo: significa que falta configuración y
 * que NO se inventó una cuenta.
 */
export type OrigenResolucion =
  | 'linea_explicita'
  | 'regla_proveedor'
  | 'regla_cargo'
  | 'mapeo_evento'
  | 'sin_resolver'

export interface ReglaProveedor {
  id: string
  company_id: string
  /** NULL = ledger de empresa; con valor = ledger de ese proyecto. */
  project_id: string | null
  proveedor_id: string
  destino: DestinoImputacion
  cuenta_id: string
  activa: boolean
  notas: string | null
  created_at: string
  updated_at: string
}

export interface ReglaCargo {
  id: string
  company_id: string
  project_id: string | null
  cliente_id: string | null
  unidad_id: string | null
  categoria: string | null
  cuenta_id: string
  activa: boolean
  notas: string | null
  /**
   * GENERADA en la BD, nunca se escribe: 4 unidad+categoría, 3 unidad,
   * 2 cliente+categoría, 1 cliente, 0 sólo categoría. Es lo que ordena el
   * desempate entre reglas aplicables.
   */
  especificidad: number
  created_at: string
  updated_at: string
}

/** Lo que devuelve `conta_resolver_imputacion`: la decisión y su porqué. */
export interface ResolucionImputacion {
  cuenta_id: string | null
  origen_resolucion: OrigenResolucion
  regla_tabla: string | null
  regla_id: string | null
  evento_usado: string | null
  /** Sólo viene cuando NO se pudo resolver. Dice qué falta configurar. */
  motivo: string | null
}

/** Etiqueta legible del escalón que resolvió, para la previsualización. */
export const ETIQUETA_ORIGEN: Record<OrigenResolucion, string> = {
  linea_explicita: 'Cuenta elegida en el documento',
  regla_proveedor: 'Regla del proveedor',
  regla_cargo: 'Regla de cliente/unidad',
  mapeo_evento: 'Mapeo general del evento',
  sin_resolver: 'Sin resolver',
}
