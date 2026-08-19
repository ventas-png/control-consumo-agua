// Tipos del módulo Condominios — sub-dominio: seguridad.
// Particionado de types/condominios.ts (auditoría P1); el barrel
// ./index.ts re-exporta todo, así que la superficie pública no cambia.

// ━━ Fase 2: parqueo, mascotas, paquetes, infracciones, rondas ━━
// ── Módulo Condominios Fase 2 ─────────────────────────────────────────────────

export type TipoParqueo = 'asignado' | 'visita' | 'discapacitado'
export type EspecieMascota = 'perro' | 'gato' | 'ave' | 'otro'
export type EstadoPaquete = 'pendiente' | 'entregado' | 'devuelto'
export type TipoPaquete = 'paquete' | 'documento' | 'sobre' | 'otro'
// 'saliente'         = la administración despacha correspondencia hacia afuera.
// 'saliente_tercero' = el residente deja algo para que un tercero lo retire con código.
export type DireccionPaquete = 'entrante' | 'saliente' | 'saliente_tercero'
// ── Motor único de recepción (migración 20260829000000) ──────────────────────
export type ClasePieza = 'paquete' | 'correspondencia'
export type DestinatarioPieza = 'unidad' | 'administracion' | 'junta' | 'proveedor'
export type PrioridadPieza = 'normal' | 'urgente'
export type CategoriaCorrespondencia = 'carta' | 'notificacion_legal' | 'factura' | 'circular' | 'otro'
// 'devuelto' se añadió en 20260830000000: una carta que vuelve al remitente no
// es "atendida" (nadie la atendió) ni "archivada" (eso no dice que volvió).
export type EstadoCorrespondencia = 'pendiente' | 'atendido' | 'archivado' | 'devuelto'
/** Subtipo de la pieza: el vocabulario aplicable depende de `clase`. */
export type SubtipoPieza = TipoPaquete | CategoriaCorrespondencia
/** Estado de la pieza: el vocabulario aplicable depende de `clase`. */
export type EstadoPieza = EstadoPaquete | EstadoCorrespondencia
export type TipoInfraccion = 'ruido' | 'basura' | 'estacionamiento' | 'mascota' | 'daños' | 'otro'
export type EstadoInfraccion = 'emitida' | 'notificada' | 'en_descargo' | 'resuelta' | 'anulada'
export type EstadoRonda = 'en_curso' | 'completada' | 'incompleta'
export type TipoNovedad = 'incidente' | 'observacion' | 'alarma' | 'acceso' | 'otro'
export type PrioridadNovedad = 'normal' | 'alta' | 'critica'
export type EstadoContrato = 'activo' | 'vencido' | 'terminado'

export interface ParqueoCondominio {
  id: string
  company_id: string
  project_id: string
  numero: string
  tipo: TipoParqueo
  unidad_id?: string | null
  placa_vehiculo?: string | null
  marca_vehiculo?: string | null
  color_vehiculo?: string | null
  activo: boolean
  notas?: string | null
  created_at: string
  // joins
  unidad_nombre?: string
}

export interface Mascota {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  nombre: string
  especie: EspecieMascota
  raza?: string | null
  color?: string | null
  fecha_nacimiento?: string | null
  fecha_ultima_vacuna?: string | null
  activo: boolean
  foto_url?: string | null
  notas?: string | null
  created_at: string
  // joins
  unidad_nombre?: string
}

/**
 * Fila de `paquetes_recibidos`, el motor único de recepción (migración
 * 20260829000000). Guarda las dos clases de pieza en custodia de portería:
 * paquetería y correspondencia. `clase` decide qué vocabulario de `tipo` y
 * `estado` aplica, y qué permiso RBAC gobierna la fila.
 */
export interface PiezaRecepcion {
  id: string
  company_id: string
  project_id: string
  /** NULL solo cuando la pieza no va dirigida a una unidad (correspondencia a la administración o la junta). */
  unidad_id: string | null
  clase: ClasePieza
  destinatario_tipo: DestinatarioPieza
  remitente?: string | null
  /** Descripción del paquete o asunto del documento. */
  descripcion: string
  destinatario?: string | null
  num_guia?: string | null
  empresa_mensajeria?: string | null
  /** Subtipo: paquete/documento/sobre/otro, o carta/notificacion_legal/factura/circular/otro. */
  tipo: SubtipoPieza
  /** pendiente/entregado/devuelto, o pendiente/atendido/archivado. */
  estado: EstadoPieza
  direccion?: DireccionPaquete | null
  prioridad: PrioridadPieza
  /** Plazo legal de la pieza (correspondencia). */
  fecha_limite?: string | null
  /** Fecha del documento; distinta de hora_recepcion, que es cuándo se registró. */
  fecha_pieza?: string | null
  fotos?: string[] | null
  firma_path?: string | null
  // Salida para retiro por tercero
  autorizado_nombre?: string | null
  autorizado_documento?: string | null
  autorizado_telefono?: string | null
  codigo_retiro?: string | null
  hora_recepcion: string
  hora_entrega?: string | null
  recibido_por?: string | null
  entregado_por?: string | null
  entregado_a_nombre?: string | null
  entregado_via?: 'portal' | 'porteria' | null
  notificado_at?: string | null
  notas?: string | null
  created_at: string
  // joins
  unidad_nombre?: string
}

/**
 * Nombre histórico de la fila cuando se la mira desde paquetería. Es el MISMO
 * tipo: la tabla es una sola desde la unificación.
 */
export type PaqueteRecibido = PiezaRecepcion

export interface InfraccionCondominio {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  tipo: TipoInfraccion
  descripcion: string
  monto_multa?: number | null
  estado: EstadoInfraccion
  reportado_por?: string | null
  fecha_infraccion: string
  fecha_limite_descargo?: string | null
  descargo?: string | null
  resolucion?: string | null
  created_at: string
  // joins
  unidad_nombre?: string
}

export interface RondaSeguridad {
  id: string
  company_id: string
  project_id: string
  guardia_id?: string | null
  ruta_id?: string | null
  inicio: string
  fin?: string | null
  estado: EstadoRonda
  notas?: string | null
  created_at: string
  // joins
  ruta_nombre?: string
}

export interface AreaCondominio {
  id: string
  company_id: string
  project_id: string
  nombre: string
  descripcion?: string | null
  icono: string
  orden: number
  activo: boolean
  created_at: string
}

export interface RutaRonda {
  id: string
  company_id: string
  project_id: string
  nombre: string
  descripcion?: string | null
  tiempo_estimado_min?: number | null
  activo: boolean
  created_at: string
}

export interface PuntoControlRuta {
  id: string
  ruta_id: string
  area_id: string
  orden: number
  instrucciones?: string | null
  tiempo_estimado_min?: number | null
  created_at: string
  // joins
  area_nombre?: string
  area_icono?: string
}

export type EstadoVisitaControl = 'pendiente' | 'ok' | 'novedad' | 'omitido'

export interface VisitaControl {
  id: string
  ronda_id: string
  punto_id: string
  estado: EstadoVisitaControl
  notas?: string | null
  visitado_en?: string | null
  created_at: string
  // joins
  area_nombre?: string
  area_icono?: string
  punto_orden?: number
  instrucciones?: string | null
}


// ━━ Fase 20: estacionamiento visitas, guardias, bitácora, equipos ━━
// ── Fase 20 ───────────────────────────────────────────────────────────────────

export type TipoVehiculoVisita = 'auto' | 'moto' | 'camion' | 'otro'

export interface EstacionamientoVisita {
  id: string
  company_id: string
  project_id: string
  espacio: string
  unidad_visitada?: string | null
  placa: string
  tipo_vehiculo: TipoVehiculoVisita
  visitante_nombre?: string | null
  hora_entrada: string
  hora_salida?: string | null
  autorizado_por?: string | null
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}

export type TurnoGuardia = 'mañana' | 'tarde' | 'noche'
export type EstadoBitacoraGuardia = 'abierto' | 'cerrado'
export type TipoNovedadGuardia = 'normal' | 'urgente' | 'informativo'

export interface NovedadGuardia {
  hora: string
  descripcion: string
  tipo: TipoNovedadGuardia
}

export interface BitacoraGuardia {
  id: string
  company_id: string
  project_id: string
  fecha: string
  turno: TurnoGuardia
  guardia_nombre: string
  hora_inicio?: string | null
  hora_fin?: string | null
  novedades: NovedadGuardia[]
  observaciones?: string | null
  estado: EstadoBitacoraGuardia
  created_at: string
}

export type CategoriaEquipo = 'bomba' | 'ascensor' | 'generador' | 'camara' | 'extintor' | 'planta_electrica' | 'otro'
export type EstadoEquipo = 'operativo' | 'mantenimiento' | 'fuera_servicio' | 'baja'

export interface EquipoComun {
  id: string
  company_id: string
  project_id: string
  nombre: string
  categoria: CategoriaEquipo
  marca?: string | null
  modelo?: string | null
  serial?: string | null
  ubicacion?: string | null
  fecha_compra?: string | null
  valor_compra?: number | null
  vida_util_anios?: number | null
  estado: EstadoEquipo
  ultimo_mantenimiento?: string | null
  proximo_mantenimiento?: string | null
  notas?: string | null
  created_at: string
}

export type EstadoPresencia = 'presente' | 'ausente' | 'tardanza' | 'permiso' | 'vacaciones'

export interface PresenciaPersonal {
  id: string
  company_id: string
  project_id: string
  nombre: string
  cargo?: string | null
  fecha: string
  hora_entrada?: string | null
  hora_salida?: string | null
  estado: EstadoPresencia
  observaciones?: string | null
  created_at: string
  // Vínculo con el expediente y con el turno planificado (20260820000100). Sin
  // `personal_id` no hay cómputo de horas por empleado: `nombre` es texto libre.
  // Nullable porque la tabla también registra a quien no está en plantilla.
  personal_id?: string | null
  bloque_id?: string | null
}


// ━━ Fase 25: generador, sistema de incendio, cámaras ━━
// ── Fase 25 ───────────────────────────────────────────────────────────────────

export type TipoRegistroGenerador = 'lectura' | 'mantenimiento' | 'prueba' | 'falla' | 'arranque_emergencia'
export type EstadoGenerador = 'standby' | 'operando' | 'mantenimiento' | 'falla' | 'apagado'

export interface ControlGenerador {
  id: string
  company_id: string
  project_id: string
  generador: string
  fecha: string
  tipo: TipoRegistroGenerador
  nivel_combustible_pct?: number | null
  horas_operacion?: number | null
  horas_acumuladas?: number | null
  estado: EstadoGenerador
  voltaje?: number | null
  frecuencia?: number | null
  operador?: string | null
  empresa_servicio?: string | null
  costo?: number | null
  proximo_mantenimiento?: string | null
  observaciones?: string | null
  created_at: string
}

export type TipoSistemaIncendio = 'extintor' | 'rociador' | 'alarma' | 'hidrant' | 'detector_humo' | 'gabinete' | 'otro'
export type TipoInspeccionIncendio = 'revision_visual' | 'prueba_funcional' | 'recarga' | 'reemplazo' | 'inspeccion_legal'
export type ResultadoInspeccionIncendio = 'aprobado' | 'observacion' | 'requiere_mantenimiento' | 'fuera_servicio'

export interface ControlSistemaIncendio {
  id: string
  company_id: string
  project_id: string
  fecha: string
  tipo_sistema: TipoSistemaIncendio
  identificador: string
  ubicacion: string
  tipo_inspeccion: TipoInspeccionIncendio
  resultado: ResultadoInspeccionIncendio
  fecha_vencimiento?: string | null
  empresa_servicio?: string | null
  tecnico?: string | null
  costo?: number | null
  proxima_inspeccion?: string | null
  observaciones?: string | null
  created_at: string
}

export type TipoCamara = 'domo' | 'bullet' | 'ptz' | 'fisheye' | 'otro'
export type EstadoCamara = 'activa' | 'falla' | 'mantenimiento' | 'sin_señal' | 'inactiva'

export interface ControlCamaraSeguridad {
  id: string
  company_id: string
  project_id: string
  codigo: string
  nombre: string
  ubicacion: string
  tipo: TipoCamara
  resolucion?: string | null
  ip_address?: string | null
  grabacion: boolean
  dias_retencion?: number | null
  estado: EstadoCamara
  ultimo_mantenimiento?: string | null
  proximo_mantenimiento?: string | null
  observaciones?: string | null
  activo: boolean
  created_at: string
}

export interface LecturaMedidorGas {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  area?: string | null
  fecha: string
  lectura_anterior?: number | null
  lectura_actual: number
  consumo?: number | null
  alerta_fuga: boolean
  costo_unitario?: number | null
  costo_total?: number | null
  periodo?: string | null
  leido_por?: string | null
  observaciones?: string | null
  created_at: string
  // join
  unidad_nombre?: string
}

