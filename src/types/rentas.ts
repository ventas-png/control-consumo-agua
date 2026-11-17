// Manejo de Rentas (20261125000000): catálogo de propiedades en renta a nivel
// empresa, sus reservas por noche, contratos mensuales e inventario.

export type TipoPropiedadRenta = 'corto_plazo' | 'largo_plazo' | 'local_comercial' | 'otro'
/** Estado OPERATIVO que se guarda. «Ocupada» se deriva (ver ocupacionDePropiedad). */
export type EstadoPropiedadRenta = 'activa' | 'mantenimiento' | 'inactiva'

export interface PropiedadRenta {
  id: string
  company_id: string
  /** Proyecto y unidad a los que está enlazada; null = propiedad independiente. */
  project_id: string | null
  unidad_id: string | null
  nombre: string
  codigo: string | null
  tipo_renta: TipoPropiedadRenta
  /** Para tipo «otro»: bodega, parqueo, salón… */
  tipo_detalle: string | null
  estado: EstadoPropiedadRenta
  direccion: string | null
  ciudad: string | null
  propietario_nombre: string | null
  propietario_telefono: string | null
  propietario_email: string | null
  habitaciones: number | null
  banos: number | null
  capacidad: number | null
  area_m2: number | null
  /** Por noche en corto plazo; por mes en el resto. */
  tarifa_base: number | null
  comision_pct: number | null
  notas: string | null
  creado_por?: string | null
  created_at: string
  updated_at: string
}

export type EstadoReservaRenta = 'confirmada' | 'en_curso' | 'completada' | 'cancelada'
export type PlataformaRenta = 'airbnb' | 'booking' | 'vrbo' | 'directo' | 'otro'
/** El mismo catálogo de la pestaña STR de Condominios. */
export type PoliticaCancelacionRenta = 'flexible' | 'moderada' | 'estricta' | 'no_reembolsable' | 'na' | 'otra'

/** Reserva por noche de una propiedad INDEPENDIENTE (tabla rentas_reservas). */
export interface ReservaRenta {
  id: string
  company_id: string
  propiedad_id: string
  huesped_nombre: string
  huesped_email: string | null
  huesped_telefono: string | null
  fecha_entrada: string
  fecha_salida: string
  num_huespedes: number
  plataforma: PlataformaRenta
  codigo_confirmacion: string | null
  monto_noche: number | null
  monto_total: number | null
  estado: EstadoReservaRenta
  notas: string | null
  politica_cancelacion: PoliticaCancelacionRenta | null
  num_mascotas: number
  created_at: string
  updated_at: string
}

/**
 * Una reserva tal como la muestra Manejo de Rentas, venga de `rentas_reservas`
 * (propiedad independiente) o de `reservas_str` (propiedad enlazada a una
 * unidad de un condominio). `origen` decide a qué tabla se escribe.
 */
export interface ReservaUnificada {
  id: string
  origen: 'rentas' | 'condominio'
  propiedad_id: string
  huesped_nombre: string
  huesped_email: string | null
  huesped_telefono: string | null
  fecha_entrada: string
  fecha_salida: string
  num_huespedes: number
  plataforma: PlataformaRenta
  codigo_confirmacion: string | null
  monto_noche: number | null
  monto_total: number | null
  estado: EstadoReservaRenta
  notas: string | null
  politica_cancelacion: PoliticaCancelacionRenta | null
  num_mascotas: number
}

export type EstadoContratoRenta = 'vigente' | 'finalizado' | 'cancelado'

export interface ContratoRenta {
  id: string
  company_id: string
  propiedad_id: string
  inquilino_nombre: string
  inquilino_identificacion: string | null
  inquilino_telefono: string | null
  inquilino_email: string | null
  fecha_inicio: string
  /** null = plazo indefinido. */
  fecha_fin: string | null
  renta_mensual: number
  deposito: number | null
  /** Moneda de la renta y el depósito (ISO 4217, mayúsculas). */
  moneda: string
  dia_pago: number | null
  estado: EstadoContratoRenta
  notas: string | null
  created_at: string
  updated_at: string
}

export type CategoriaInventarioRenta =
  | 'mobiliario' | 'electrodomestico' | 'electronica' | 'blancos' | 'menaje' | 'decoracion' | 'otro'
export type EstadoArticuloRenta = 'bueno' | 'regular' | 'danado' | 'faltante'

export interface ArticuloInventarioRenta {
  id: string
  company_id: string
  propiedad_id: string
  nombre: string
  categoria: CategoriaInventarioRenta
  /** Sala, cocina, habitación 1… */
  ambiente: string | null
  cantidad: number
  estado: EstadoArticuloRenta
  valor_unitario: number | null
  numero_serie: string | null
  fecha_revision: string | null
  notas: string | null
  created_at: string
  updated_at: string
}

// ── Finanzas (20261128000000) ────────────────────────────────────────────────

/** huesped = lo que la plataforma le cobró al huésped; anfitrion = lo que recibió el anfitrión. */
export type BloqueConceptoRenta = 'huesped' | 'anfitrion'

/** Una columna del desglose de cobro de una reserva, configurable por empresa. */
export interface ConceptoRenta {
  id: string
  company_id: string
  codigo: string
  nombre: string
  bloque: BloqueConceptoRenta
  /** 1 suma al total del bloque; -1 resta (descuentos, comisión de la plataforma). */
  signo: 1 | -1
  /** Sólo bloque anfitrión: entra en la base de la comisión de administración. */
  comisionable: boolean
  orden: number
  activo: boolean
  created_at: string
  updated_at: string
}

/** Concepto → monto (siempre ≥ 0; el signo lo pone el concepto). */
export type ImportesRenta = Record<string, number>

/** Desglose de una reserva: de `rentas_reservas` o de `reservas_str`, nunca de las dos. */
export interface LiquidacionRenta {
  id: string
  company_id: string
  propiedad_id: string
  reserva_id: string | null
  reserva_str_id: string | null
  importes: ImportesRenta
  /** Moneda de la reserva (ISO 4217, mayúsculas): aplica al total y a todo el desglose. */
  moneda: string
  created_at: string
  updated_at: string
}

export type CategoriaGastoRenta = 'limpieza' | 'mantenimiento' | 'servicios' | 'suministros' | 'impuestos' | 'otro'
export type CargoGastoRenta = 'propietario' | 'administradora'

export interface GastoRenta {
  id: string
  company_id: string
  propiedad_id: string
  fecha: string
  categoria: CategoriaGastoRenta
  descripcion: string
  proveedor: string | null
  monto: number
  /** ISO 4217, mayúsculas. */
  moneda: string
  /** propietario: se le descuenta en su estado mensual; administradora: lo absorbe la empresa. */
  a_cargo_de: CargoGastoRenta
  notas: string | null
  created_at: string
  updated_at: string
}
