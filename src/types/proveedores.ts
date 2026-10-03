// Proveedores compartidos · contratos · carga masiva (PR A).
// Espeja las migraciones 20261020000000…20261020000400.
//
// Un solo proveedor por empresa (`proveedores`), usado por Contabilidad y por
// Operaciones. Estos tipos AMPLÍAN los de CxP (`types/cxp.ts`) y Compras
// (`types/compras.ts`) en vez de duplicarlos: el catálogo ya existía.
import type { Proveedor } from './cxp'
import type { EstadoProveedor } from './compras'

// ── Proveedor ───────────────────────────────────────────────────────────────

export type TipoAbastecimiento = 'servicios' | 'suministros' | 'equipos'
export const TIPOS_ABASTECIMIENTO: readonly TipoAbastecimiento[] = ['servicios', 'suministros', 'equipos']
export const ABASTECIMIENTO_LABELS: Record<TipoAbastecimiento, string> = {
  servicios: 'Servicios',
  suministros: 'Suministros',
  equipos: 'Equipos',
}

/** `empresa` = sirve a todas las contabilidades de la empresa (lo legado). */
export type AlcanceProveedor = 'empresa' | 'proyectos'
export const ALCANCE_LABELS: Record<AlcanceProveedor, string> = {
  empresa: 'Toda la empresa',
  proyectos: 'Solo proyectos habilitados',
}

/**
 * El proveedor tal como lo devuelve `select('*')`. Los campos de la Fase 6
 * (estado…) y de este PR (código, país…) son opcionales: un entorno al que aún
 * no le llegó la migración no los trae y la pantalla no debe romperse.
 */
export type ProveedorCatalogo = Proveedor & {
  estado?: EstadoProveedor
  autorizacion_vence?: string | null
  motivo_estado?: string | null
  codigo?: string | null
  pais?: string | null
  abastece?: TipoAbastecimiento[]
  alcance?: AlcanceProveedor
  identificacion_norm?: string | null
}

export interface ProveedorContacto {
  id: string
  company_id: string
  proveedor_id: string
  nombre: string
  cargo: string | null
  email: string | null
  telefono: string | null
  es_principal: boolean
  activo: boolean
  notas: string | null
}

// ── Habilitación por proyecto ───────────────────────────────────────────────

export type EstadoHabilitacionProyecto = 'pendiente' | 'habilitado' | 'suspendido' | 'retirado'
export const HABILITACION_LABELS: Record<EstadoHabilitacionProyecto, string> = {
  pendiente: 'Pendiente',
  habilitado: 'Habilitado',
  suspendido: 'Suspendido',
  retirado: 'Retirado',
}

export interface ProveedorProyecto {
  id: string
  company_id: string
  proveedor_id: string
  project_id: string
  estado: EstadoHabilitacionProyecto
  motivo_estado: string | null
  habilitado_por: string | null
  habilitado_at: string | null
  vigente_hasta: string | null
  dias_credito: number | null
  condiciones_pago: string | null
  notas: string | null
}

// ── Contratos ───────────────────────────────────────────────────────────────

export type EstadoContratoProveedor =
  | 'borrador'
  | 'activo'
  | 'suspendido'
  | 'vencido'
  | 'terminado'
  | 'cancelado'

export const ESTADO_CONTRATO_LABELS: Record<EstadoContratoProveedor, string> = {
  borrador: 'Borrador',
  activo: 'Activo',
  suspendido: 'Suspendido',
  vencido: 'Vencido',
  terminado: 'Terminado',
  cancelado: 'Cancelado',
}

/**
 * Transiciones permitidas. ESPEJO de `contratos_proveedores_tg()` (la BD es la
 * autoridad; esto solo decide qué botones ofrecer). Terminado y cancelado son
 * finales.
 */
export const TRANSICIONES_CONTRATO: Record<EstadoContratoProveedor, readonly EstadoContratoProveedor[]> = {
  borrador: ['activo', 'cancelado'],
  activo: ['suspendido', 'vencido', 'terminado', 'cancelado'],
  suspendido: ['activo', 'terminado', 'cancelado'],
  vencido: ['activo', 'terminado', 'cancelado'],
  terminado: [],
  cancelado: [],
}

/** Los cambios de estado que exigen motivo (también espejo del trigger). */
export const ESTADOS_CON_MOTIVO: readonly EstadoContratoProveedor[] = ['suspendido', 'terminado', 'cancelado']

export type ModalidadContrato = 'recurrente' | 'por_demanda'
export const MODALIDAD_LABELS: Record<ModalidadContrato, string> = {
  recurrente: 'Servicio recurrente',
  por_demanda: 'Compra por demanda',
}

export type PeriodicidadContrato =
  | 'semanal' | 'quincenal' | 'mensual' | 'bimestral' | 'trimestral' | 'semestral' | 'anual' | 'unica'
export const PERIODICIDADES: readonly PeriodicidadContrato[] = [
  'semanal', 'quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual', 'unica',
]
export const PERIODICIDAD_LABELS: Record<PeriodicidadContrato, string> = {
  semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual', bimestral: 'Bimestral',
  trimestral: 'Trimestral', semestral: 'Semestral', anual: 'Anual', unica: 'Única vez',
}

/** Fila de `contratos_proveedores` con las columnas nuevas (todas opcionales: lo histórico no las tiene). */
export interface ContratoProveedorCatalogo {
  id: string
  company_id: string
  project_id: string
  proveedor_id?: string | null
  contacto_id?: string | null
  referencia?: string | null
  proveedor_nombre: string
  proveedor_contacto?: string | null
  proveedor_telefono?: string | null
  proveedor_email?: string | null
  servicio: string
  descripcion?: string | null
  alcance?: string | null
  modalidad?: ModalidadContrato | null
  periodicidad?: PeriodicidadContrato | null
  moneda?: string | null
  importe_periodico?: number | null
  monto_maximo?: number | null
  monto_mensual?: number | null
  fecha_inicio: string
  fecha_fin?: string | null
  estado: EstadoContratoProveedor
  motivo_estado?: string | null
  responsable_id?: string | null
  respaldo_path?: string | null
  documento_url?: string | null
  proveedor_snapshot?: Record<string, unknown> | null
  /** Contrato al que renueva este (cadena de renovaciones); el anterior conserva todo. */
  renovado_de?: string | null
  activado_at?: string | null
  terminado_at?: string | null
  notas?: string | null
  created_at: string
}

export type TipoEventoContrato =
  | 'alta' | 'estado' | 'vinculo_proveedor' | 'vinculo_revertido' | 'prorroga'
  | 'renovacion' | 'renovado_por' | 'ampliacion_monto'

export interface EventoContrato {
  id: string
  contrato_id: string
  tipo: TipoEventoContrato
  estado_anterior: string | null
  estado_nuevo: string | null
  motivo: string | null
  detalle: Record<string, unknown> | null
  actor_id: string | null
  created_at: string
}

// ── Históricos sin proveedor vinculado ──────────────────────────────────────

export type ClasificacionHistorico = 'inequivoca' | 'ambigua' | 'sin_coincidencia'

export interface CandidatoProveedor {
  id: string
  codigo: string | null
  nombre: string
  estado: string
  criterio: 'nombre_exacto' | 'forma_societaria' | 'mismo_correo'
}

export interface ContratoHistoricoVistaPrevia {
  contrato_id: string
  project_id: string
  proyecto_nombre: string
  proveedor_nombre_texto: string
  estado: string
  servicio: string
  fecha_inicio: string
  clasificacion: ClasificacionHistorico
  motivo: string
  candidatos: CandidatoProveedor[]
}

export interface ResumenVinculacion {
  antes: { total_contratos: number; vinculados: number; sin_proveedor: number }
  propuesta: { inequivocos: number; ambiguos: number; sin_coincidencia: number }
  despues_de_aplicar_inequivocos: { total_contratos: number; vinculados: number; sin_proveedor: number }
}

export interface ResultadoVincularInequivocos {
  simulacion: boolean
  lote: string | null
  vinculados: number
  propuestos: number
  detalle: { contrato_id: string; texto_original: string; proveedor_id: string; proveedor_nombre: string }[]
}

export interface ResultadoRevertirVinculos {
  lote: string
  revertidos: number
  omitidos: { contrato_id: string; motivo: string }[]
  motivo: string
}

// ── Reglas de compra (cuentas sugeridas) ────────────────────────────────────

export type DestinoCompra = 'gasto' | 'costo' | 'inventario' | 'activo_fijo'
export const DESTINOS_COMPRA: readonly { destino: DestinoCompra; etiqueta: string }[] = [
  { destino: 'gasto', etiqueta: 'Gasto' },
  { destino: 'costo', etiqueta: 'Costo' },
  { destino: 'inventario', etiqueta: 'Inventario' },
  { destino: 'activo_fijo', etiqueta: 'Activo fijo' },
]

/** Qué tipo de cuenta admite cada destino. ESPEJO de `compras_destinos_linea()`. */
export const TIPO_CUENTA_POR_DESTINO: Record<DestinoCompra, 'gasto' | 'activo'> = {
  gasto: 'gasto',
  costo: 'gasto',
  inventario: 'activo',
  activo_fijo: 'activo',
}

export interface ReglaCompra {
  id: string
  company_id: string
  project_id: string | null
  destino: DestinoCompra
  categoria: string | null
  suministro_id: string | null
  proveedor_id: string | null
  cuenta_id: string
  vigente_desde: string
  vigente_hasta: string | null
  activa: boolean
  especificidad: number
  notas: string | null
}

export type OrigenCuentaCompra =
  | 'linea_explicita'
  | 'regla_compra'
  | 'regla_proveedor'
  | 'mapeo_evento'
  | 'sin_resolver'

export const ORIGEN_CUENTA_LABELS: Record<OrigenCuentaCompra, string> = {
  linea_explicita: 'Elegida en la línea',
  regla_compra: 'Regla de compra',
  regla_proveedor: 'Regla del proveedor',
  mapeo_evento: 'Mapeo general del evento',
  sin_resolver: 'Sin resolver',
}

export interface SugerenciaCuenta {
  cuenta_id: string | null
  cuenta_codigo: string | null
  cuenta_nombre: string | null
  origen: OrigenCuentaCompra
  regla_id: string | null
  motivo: string | null
}

export interface FilaConfigCompra {
  concepto: 'cuenta_por_pagar' | 'destino'
  destino: DestinoCompra | null
  categoria: string | null
  cuenta_id: string | null
  cuenta_codigo: string | null
  origen: OrigenCuentaCompra
  completa: boolean
  motivo: string | null
}

// ── Carga masiva ────────────────────────────────────────────────────────────

export type TipoImportacion = 'proveedores' | 'asignaciones' | 'contratos'
export type AccionImportacion = 'crear' | 'actualizar' | 'sin_cambios' | 'omitir' | 'error'
export type EstadoFilaImportacion = 'pendiente' | 'aplicada' | 'sin_cambios' | 'omitida' | 'error'
export type EstadoLoteImportacion =
  | 'previsualizado' | 'aplicando' | 'aplicado' | 'aplicado_parcial' | 'fallido' | 'descartado'
export type ModoAplicacion = 'todo_o_nada' | 'filas_validas'

export interface OpcionesImportacion {
  actualizar_existentes: boolean
  vaciar_vacios: boolean
}

export interface MensajeFila {
  campo: string
  mensaje: string
}

export interface FilaImportacion {
  id: string
  lote_id: string
  fila: number
  accion: AccionImportacion
  estado: EstadoFilaImportacion
  entidad_id: string | null
  origen: Record<string, unknown>
  datos: Record<string, unknown> | null
  cambios: Record<string, { antes: unknown; despues: unknown }>
  errores: MensajeFila[]
  advertencias: MensajeFila[]
  resultado: string | null
}

export interface ResumenLote {
  filas: number
  crear: number
  actualizar: number
  sin_cambios: number
  omitir: number
  con_error: number
  con_advertencia: number
  contenido_ya_aplicado?: { lote_id: string; aplicado_at: string | null; estado: string }
}

export interface ResultadoAplicacion {
  estado: EstadoLoteImportacion
  modo: ModoAplicacion
  lote_id: string
  aplicadas: number
  sin_cambios?: number
  omitidas?: number
  con_error?: number
  cambiaron_desde_vista_previa?: number
  parcial?: boolean
  repetido?: boolean
  desactualizado?: boolean
  error?: string
  nota?: string
}


// ── Contratos conectados a las compras ──────────────────────────────────────

/** Etapa de la orden en la que se autoriza una excepción de contrato. */
export type EtapaExcepcionContrato = 'aprobar' | 'emitir'

/**
 * Un contrato está VIGENTE si está activo y hoy cae dentro de sus fechas (sin fecha final = indefinido).
 * La pantalla lo usa solo para OFRECER; el servidor decide al ligar, aprobar y emitir.
 */
export function contratoVigente(
  c: { estado: string; fecha_inicio: string; fecha_fin?: string | null },
  hoy: string,
): boolean {
  return c.estado === 'activo' && c.fecha_inicio <= hoy && (c.fecha_fin == null || c.fecha_fin >= hoy)
}

/** Indicadores de UNA moneda del contrato. Lo financiero llega NULL si el usuario no ve Contabilidad. */
export interface IndicadoresContratoMoneda {
  moneda: string
  ordenes: number
  comprometido: number
  recibido: number
  facturado: number | null
  pagado: number | null
  pendiente_por_recibir: number
  pendiente_por_facturar: number | null
  diferencia_precio_facturada: number | null
  /** Solo en la moneda del contrato y si el contrato tiene monto máximo. */
  monto_maximo_vigente: number | null
  disponible: number | null
}

export interface OrdenSeguimientoContrato {
  id: string
  numero: string | null
  concepto: string
  estado: string
  moneda: string
  revision: number
  created_at: string
  valor_orden: number
  /** false = borrador o cancelada: no compromete monto. */
  compromete: boolean
  comprometido: number
  recibido: number
  facturado: number | null
  pagado: number | null
  pendiente_por_recibir: number
  pendiente_por_facturar: number | null
  diferencia_precio_facturada: number | null
  con_excepcion: boolean
}

export interface SeguimientoContrato {
  contrato: {
    id: string
    referencia: string | null
    estado: EstadoContratoProveedor
    vigente: boolean
    modalidad: ModalidadContrato | null
    periodicidad: PeriodicidadContrato | null
    moneda: string | null
    importe_periodico: number | null
    fecha_inicio: string
    fecha_fin: string | null
    indefinido: boolean
    monto_maximo_original: number | null
    ampliaciones_total: number | null
    monto_maximo_vigente: number | null
    /** true = el contrato no tiene monto máximo: no hay límite total (y no se inventa uno). */
    sin_limite_total: boolean
    renovado_de: string | null
    proveedor: { id: string | null; codigo: string | null; nombre: string; estado: string | null }
  }
  contabilidad_visible: boolean
  por_moneda: IndicadoresContratoMoneda[]
  ordenes: OrdenSeguimientoContrato[]
  recepciones: Array<{
    id: string; numero: string | null; fecha: string; tipo: string; estado: string
    orden_id: string; orden_numero: string | null; aceptado: number; rechazado: number
  }>
  facturas: Array<{
    id: string; numero_factura: string; fecha_emision: string | null; estado: string; moneda: string | null
    monto_total: number; monto_pagado: number; saldo: number; orden_id: string; orden_numero: string | null
  }>
  pagos: Array<{
    id: string; numero_factura: string | null; monto_pago: number; monto_aplicado: number | null
    estado: string; metodo_pago: string | null; referencia: string | null; fecha_pago: string | null
    orden_id: string; orden_numero: string | null
  }>
  excepciones: Array<{
    id: string; orden_id: string; orden_numero: string | null; etapa: EtapaExcepcionContrato
    causas: string; motivo: string; autorizado_por: string; revision: number; created_at: string
  }>
  ampliaciones: Array<{
    id: string; monto_anterior: number; incremento: number; monto_nuevo: number; moneda: string | null
    motivo: string; referencia_documento: string | null; autorizado_por: string; created_at: string
  }>
  renovaciones: Array<{ id: string; referencia: string | null; estado: string; fecha_inicio: string; fecha_fin: string | null }>
  eventos: Array<{
    tipo: TipoEventoContrato; estado_anterior: string | null; estado_nuevo: string | null
    motivo: string | null; detalle: Record<string, unknown> | null; actor_id: string | null; created_at: string
  }>
}
