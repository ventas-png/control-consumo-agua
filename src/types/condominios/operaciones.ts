// Tipos del módulo Condominios — sub-dominio: operaciones.
// Particionado de types/condominios.ts (auditoría P1); el barrel
// ./index.ts re-exporta todo, así que la superficie pública no cambia.

import type { EstadoContrato, PrioridadNovedad, TipoNovedad } from './seguridad'
import type { ResponsableServicio } from './residentes'

// ━━ Tareas operativas: turnos, bloques, revisiones ━━
// ── Tareas operativas ─────────────────────────────────────────────────────

/**
 * Familia operativa de una ACTIVIDAD (20260904000200). No confundir con
 * `cargo`, que es el puesto del personal que puede desempeñarla.
 */
export type ServicioOperativo =
  | 'limpieza'
  | 'mantenimiento'
  | 'seguridad'
  | 'jardineria'
  | 'administracion'
  | 'otro'

export interface PlantillaTareaCargo {
  id: string
  company_id: string
  project_id: string
  cargo: string
  titulo: string
  descripcion?: string | null
  icono: string
  orden: number
  area_id?: string | null
  requiere_foto: boolean
  activo: boolean
  created_at: string
  // ── Catálogo de actividades (20260904000200) ─────────────────────────────
  // Opcionales porque las filas creadas antes de la migración no las traen.
  /** NULL = fila legada pendiente de clasificar. */
  servicio?: ServicioOperativo | null
  /** Minutos (> 0). NULL = sin estimación. */
  duracion_estimada_min?: number | null
  /** Pasos esperados, en orden. En BD es jsonb; el loader lo castea a string[]. */
  checklist?: string[]
  instrucciones_seguridad?: string | null
  requiere_comentario?: boolean
  requiere_checklist?: boolean
  // joins
  area_nombre?: string
}

// ── Recursos planificados por actividad (20260904000300) ─────────────────────

/** Insumo planificado de una actividad. La unidad se deriva del suministro. */
export interface PlantillaTareaSuministro {
  id: string
  company_id: string
  project_id: string
  plantilla_tarea_id: string
  suministro_id: string
  cantidad: number
  notas?: string | null
  creado_por?: string | null
  created_at: string
  // joins (embed suministros_condominio(nombre, unidad_medida, activo))
  suministro_nombre?: string
  unidad_medida?: string
  suministro_activo?: boolean
}

/** Herramienta/equipo planificado de una actividad. */
export interface PlantillaTareaHerramienta {
  id: string
  company_id: string
  project_id: string
  plantilla_tarea_id: string
  inventario_id: string
  cantidad: number
  obligatoria: boolean
  notas?: string | null
  creado_por?: string | null
  created_at: string
  // joins (embed inventario_condominio(nombre, estado))
  inventario_nombre?: string
  inventario_estado?: string
}

// ── Rutinas de limpieza (20260907000200) ─────────────────────────────────────

/**
 * Receta repetible: un conjunto ordenado de actividades del catálogo que se
 * ejecuta junto. Es DEFINICIÓN — la ocurrencia del día se materializa en
 * `tareas_bloque`, no aquí.
 */
export interface RutinaLimpieza {
  id: string
  company_id: string
  project_id: string
  nombre: string
  descripcion?: string | null
  /** Área del catálogo. null = rutina general, no atada a una zona. */
  area_id?: string | null
  servicio: ServicioOperativo
  /** Jornada en la que corre. null = sin jornada fija. */
  plantilla_horario_id?: string | null
  activa: boolean
  orden: number
  creado_por?: string | null
  created_at: string
  // joins (embed areas_condominio(nombre), plantillas_horario(nombre))
  area_nombre?: string
  horario_nombre?: string
}

/** Un paso de la rutina: una actividad del catálogo, en su orden. */
export interface RutinaActividad {
  id: string
  company_id: string
  project_id: string
  rutina_id: string
  plantilla_tarea_id: string
  orden: number
  /** false = paso opcional; la rutina se cumple sin él. */
  obligatoria: boolean
  notas?: string | null
  creado_por?: string | null
  created_at: string
}

export type EstadoBloqueTurno = 'pendiente' | 'en_curso' | 'completado' | 'incompleto'
export type TurnoTipo = 'manana' | 'tarde' | 'noche'

/** De dónde salió el bloque: alta manual o materialización de una regla. */
export type OrigenBloqueTurno = 'manual' | 'recurrencia'

export interface BloqueTurno {
  id: string
  company_id: string
  project_id: string
  personal_id: string
  turno: TurnoTipo
  fecha: string
  estado: EstadoBloqueTurno
  iniciado_en?: string | null
  cerrado_en?: string | null
  puntaje_completitud?: number | null
  creado_por?: string | null
  notas?: string | null
  created_at: string
  // Horario del bloque (20260820000000). Nullable en los bloques anteriores a
  // esa migración, que no tenían horas.
  plantilla_horario_id?: string | null
  asignacion_id?: string | null
  hora_inicio?: string | null
  hora_fin?: string | null
  cruza_medianoche?: boolean | null
  horas_planificadas?: number | null
  origen?: OrigenBloqueTurno | null
  // joins
  personal_nombre?: string
  personal_cargo?: string
}

export type EstadoTareaBloque = 'pendiente' | 'completada' | 'con_observacion' | 'omitida'

export interface TareaBloque {
  id: string
  bloque_id: string
  plantilla_id?: string | null
  titulo: string
  descripcion?: string | null
  area_id?: string | null
  orden: number
  requiere_foto: boolean
  estado: EstadoTareaBloque
  completada_en?: string | null
  evidencia_texto?: string | null
  foto_urls: string[]
  notas_operativo?: string | null
  created_at: string
  // ── Paridad con ejecuciones_limpieza (20260907000100) ────────────────────
  /** Usuario que cerró la tarea. Lo sella la BD; no es falsificable. */
  completado_por?: string | null
  /** Lo que se encontró y no le toca resolver a quien ejecuta. */
  novedad?: string | null
  /** Mismo dominio que `EjecucionLimpieza.prioridad`: lo fija un CHECK en BD. */
  prioridad?: PrioridadNovedadLimpieza | null
  requiere_mantenimiento?: boolean
  /** Anulación lógica: la fila fue un error. Se conserva con su evidencia. */
  anulada_en?: string | null
  anulada_por?: string | null
  motivo_anulacion?: string | null
  // ── Snapshot al materializar (20260907000300) ────────────────────────────
  // Copia, no join: editar el catálogo no reescribe lo que se pidió aquel día.
  duracion_estimada_min?: number | null
  checklist?: string[]
  instrucciones_seguridad?: string | null
  requiere_comentario?: boolean
  requiere_checklist?: boolean
  /** Rutina que generó la tarea. null = alta manual o carga suelta. */
  rutina_id?: string | null
  // ── Evidencia al cerrar (20260907000400) ─────────────────────────────────
  /** Posiciones (0-based) de `checklist` ya cumplidas. */
  checklist_completado?: number[]
  /**
   * Excepción DECLARADA: permite cerrar sin la evidencia exigida dejando por
   * escrito el porqué. Es la alternativa a un bypass por rol, que no dejaría
   * rastro en la fila.
   */
  motivo_sin_evidencia?: string | null
  // joins
  area_nombre?: string
  area_icono?: string
}

export type EstadoRevision = 'pendiente' | 'aprobado' | 'rechazado'

export interface RevisionTarea {
  id: string
  tarea_id: string
  bloque_id: string
  revisado_por: string
  estado: EstadoRevision
  comentario?: string | null
  revisado_en: string
  created_at: string
}

// ━━ Control de asignación de turnos (20260820000000 … 000300) ━━
// Tres piezas que no hay que confundir:
//   PlantillaHorario   el catálogo de jornadas ("Nocturno 22:00–06:00")
//   AsignacionTurno    la REGLA recurrente ("a Pérez, el nocturno, L-V")
//   BloqueTurno        la OCURRENCIA (arriba): el día concreto ya materializado

/** Periodicidad de una regla de asignación. Extiende el vocabulario de `rutas`. */
export type FrecuenciaTurno =
  | 'unica' | 'diaria' | 'semanal' | 'quincenal' | 'mensual'
  | 'bimestral' | 'trimestral' | 'semestral' | 'anual' | 'fechas'

export interface PlantillaHorario {
  id: string
  company_id: string
  project_id: string
  nombre: string
  codigo?: string | null
  turno: TurnoTipo
  hora_inicio: string
  hora_fin: string
  cruza_medianoche: boolean
  minutos_descanso: number
  /** Derivada: la sella la BD (trg_turnos_sellar_horas). No la escribe la UI. */
  horas_jornada?: number | null
  tolerancia_entrada_min: number
  color?: string | null
  activo: boolean
  notas?: string | null
  creado_por?: string | null
  created_at: string
}

export interface AsignacionTurno {
  id: string
  company_id: string
  project_id: string
  personal_id: string
  plantilla_horario_id: string
  nombre?: string | null
  frecuencia: FrecuenciaTurno
  /** Días ISO 1..7 (1 = lunes). Vacío en semanal = toda la semana. */
  dias_semana: number[]
  intervalo_dias?: number | null
  dia_mes?: number | null
  mes_ancla?: number | null
  /** Fechas ISO sueltas para `frecuencia = 'fechas'`. */
  fechas_especificas: string[]
  fecha_inicio: string
  fecha_fin?: string | null
  cubre_dias_no_laborables: boolean
  activa: boolean
  notas?: string | null
  creado_por?: string | null
  created_at: string
  // joins
  personal_nombre?: string
  personal_cargo?: string
  plantilla_nombre?: string
}

export type TipoDiaNoLaborable =
  | 'festivo_nacional' | 'asueto_local' | 'suspension_labores' | 'dia_no_laboral'

export interface DiaNoLaborable {
  id: string
  company_id: string
  project_id: string
  fecha: string
  nombre: string
  tipo: TipoDiaNoLaborable
  recurre_anual: boolean
  paga_recargo: boolean
  factor_recargo: number
  notas?: string | null
  creado_por?: string | null
  created_at: string
}

export type TipoAusencia =
  | 'vacaciones' | 'permiso_goce' | 'permiso_sin_goce'
  | 'incapacidad' | 'suspension' | 'falta' | 'licencia'
export type EstadoAusencia = 'solicitada' | 'aprobada' | 'rechazada' | 'cancelada'

export interface AusenciaPersonal {
  id: string
  company_id: string
  project_id: string
  personal_id: string
  tipo: TipoAusencia
  fecha_inicio: string
  fecha_fin: string
  dias_habiles?: number | null
  goce_salario: boolean
  estado: EstadoAusencia
  motivo?: string | null
  documento_url?: string | null
  aprobada_por?: string | null
  aprobada_en?: string | null
  creado_por?: string | null
  created_at: string
  // joins
  personal_nombre?: string
  personal_cargo?: string
}

/** Una fila de `calcular_horas_personal()`. Se recalcula, no se persiste. */
export interface HorasPersonal {
  personal_id: string
  nombre: string
  cargo: string
  dias_planificados: number
  dias_trabajados: number
  dias_ausencia: number
  dias_asueto_trabajado: number
  tardanzas: number
  horas_planificadas: number
  horas_trabajadas: number
  horas_ordinarias: number
  horas_extra: number
  horas_nocturnas: number
  horas_asueto: number
  horas_asueto_ponderadas: number
}

/** Conteo que devuelve `materializar_rutinas_turno()`, por bucket. */
export interface ResultadoMaterializacionRutinas {
  generadas: number
  omitidas_existente: number
  omitidas_bloque_cerrado: number
  /** Rutinas activas que no declaran jornada: no pueden materializarse solas. */
  rutinas_sin_jornada: number
}

/** Conteo que devuelve `generar_bloques_turno()`, por bucket. */
export interface ResultadoGeneracionTurnos {
  generados: number
  omitidos_ausencia: number
  omitidos_no_laborable: number
  omitidos_existente: number
}

export interface NovedadSeguridad {
  id: string
  company_id: string
  project_id: string
  ronda_id?: string | null
  tipo: TipoNovedad
  descripcion: string
  ubicacion?: string | null
  prioridad: PrioridadNovedad
  reportado_por?: string | null
  foto_url?: string | null
  fotos?: string[] | null
  created_at: string
}

export interface ContratoArrendamiento {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  arrendatario_nombre: string
  arrendatario_identificacion?: string | null
  arrendatario_telefono?: string | null
  arrendatario_email?: string | null
  monto_renta: number
  dia_pago: number
  fecha_inicio: string
  fecha_fin?: string | null
  deposito?: number | null
  estado: EstadoContrato
  notas?: string | null
  // Responsables del pago de cada servicio, copiados de la solicitud al aprobar
  // (20260829000300). Cada contrato conserva LOS SUYOS: el histórico se lee por
  // contrato, no por unidad.
  resp_mantenimiento?: ResponsableServicio | null
  resp_agua?:          ResponsableServicio | null
  resp_electricidad?:  ResponsableServicio | null
  resp_basura?:        ResponsableServicio | null
  resp_telefonia?:     ResponsableServicio | null
  resp_internet?:      ResponsableServicio | null
  created_at: string
  // joins
  unidad_nombre?: string
}


// ━━ Fase 4: inventario, pólizas de seguro, inspecciones, personal ━━
// ── Condominios Fase 4 ────────────────────────────────────────────────────────

export type CategoriaInventario = 'herramienta' | 'equipo' | 'material' | 'mobiliario' | 'vehiculo' | 'otro'
export type EstadoInventario = 'disponible' | 'en_uso' | 'en_reparacion' | 'dado_de_baja'
export type TipoPoliza = 'incendio' | 'responsabilidad_civil' | 'terremoto' | 'inundacion' | 'robo' | 'vida' | 'otro'
export type EstadoPoliza = 'vigente' | 'vencida' | 'cancelada'
export type TipoInspeccion = 'bomberos' | 'igss' | 'municipalidad' | 'electrica' | 'sanitaria' | 'elevadores' | 'otro'
export type ResultadoInspeccion = 'aprobado' | 'aprobado_con_observaciones' | 'reprobado' | 'pendiente'
export type CargoPersonal = 'conserje' | 'guardia' | 'jardinero' | 'mantenimiento' | 'administrador' | 'otro'
export type TurnoPersonal = 'diurno' | 'nocturno' | 'rotativo'
export type EstadoPersonal = 'activo' | 'inactivo' | 'vacaciones' | 'incapacidad'

export interface ItemInventario {
  id: string
  company_id: string
  project_id: string
  nombre: string
  categoria: CategoriaInventario
  descripcion?: string | null
  numero_serie?: string | null
  ubicacion?: string | null
  estado: EstadoInventario
  cantidad: number
  cantidad_minima: number
  unidad_medida: string
  costo_unitario?: number | null
  proveedor?: string | null
  fecha_adquisicion?: string | null
  fecha_vencimiento?: string | null
  foto_url?: string | null
  notas?: string | null
  created_at: string
}

export interface PolizaSeguro {
  id: string
  company_id: string
  project_id: string
  numero_poliza: string
  aseguradora: string
  tipo: TipoPoliza
  descripcion?: string | null
  suma_asegurada?: number | null
  prima_anual?: number | null
  fecha_inicio: string
  fecha_vencimiento: string
  estado: EstadoPoliza
  agente_nombre?: string | null
  agente_telefono?: string | null
  agente_email?: string | null
  documento_url?: string | null
  notas?: string | null
  created_at: string
}

export interface InspeccionNormativa {
  id: string
  company_id: string
  project_id: string
  tipo: TipoInspeccion
  entidad_inspectora?: string | null
  fecha: string
  resultado: ResultadoInspeccion
  hallazgos?: string | null
  acciones_correctivas?: string | null
  fecha_proxima?: string | null
  inspector_nombre?: string | null
  certificado_url?: string | null
  notas?: string | null
  created_at: string
}

export interface ContactoEmergenciaPersonal {
  nombre: string
  parentesco?: string
  telefono?: string
}

export interface CodigoAccesoPersonal {
  tipo?: string        // 'tarjeta' | 'llavero' | 'pin' | 'control' | 'app' | 'otro'
  codigo: string
  descripcion?: string
}

export interface EquipoAsignadoPersonal {
  item: string
  cantidad?: number
  fecha_entrega?: string
  notas?: string
}

export interface PersonalCondominio {
  id: string
  company_id: string
  project_id: string
  nombre: string
  cargo: CargoPersonal
  telefono?: string | null
  email?: string | null
  fecha_ingreso?: string | null
  fecha_nacimiento?: string | null
  turno: TurnoPersonal
  estado: EstadoPersonal
  salario?: number | null
  dpi?: string | null
  foto_url?: string | null
  notas?: string | null
  // Contactos de emergencia (parientes / personas a avisar)
  contactos_emergencia?: ContactoEmergenciaPersonal[] | null
  // Afiliaciones / identificadores patronales
  numero_igss?: string | null
  numero_irtra?: string | null
  nit?: string | null
  // Etiquetas, accesos y equipo
  tags?: string[] | null
  codigos_acceso?: CodigoAccesoPersonal[] | null
  equipo_asignado?: EquipoAsignadoPersonal[] | null
  // Datos médicos / seguridad
  tipo_sangre?: string | null
  alergias?: string | null
  // Datos de contrato
  tipo_contrato?: string | null
  fecha_fin_contrato?: string | null
  supervisor?: string | null
  // Datos personales
  direccion?: string | null
  genero?: string | null
  estado_civil?: string | null
  // Datos bancarios (planilla)
  banco?: string | null
  numero_cuenta?: string | null
  tipo_cuenta?: string | null
  // Cuenta de ingreso con la que este empleado entra al sistema (app_users).
  // NULL = sin cuenta, que es el caso normal del personal operativo. Es el
  // puente entre el expediente y lo que la cuenta ejecuta (creado_por,
  // actividad del equipo, asignación de tareas); NO otorga permisos por sí solo.
  user_id?: string | null
  created_at: string
}

/**
 * Fila del catálogo `personal_usuarios_asignables` (20260826000000): las cuentas
 * de staff de la empresa que pueden vincularse a un empleado del condominio.
 * `personal_id`/`personal_nombre` vienen con el empleado que YA la tiene tomada
 * en ese proyecto (null si está libre), y `tiene_acceso_proyecto` avisa cuando la
 * cuenta todavía no ve el condominio y por tanto no podría registrar nada en él.
 */
export interface UsuarioAsignablePersonal {
  usuario_id: string
  nombre: string
  email: string | null
  rol: string
  activo: boolean
  tiene_acceso_proyecto: boolean
  personal_id: string | null
  personal_nombre: string | null
}


// ━━ Fase 19: checklists, limpieza, consumo energético ━━
// ── Fase 19 ───────────────────────────────────────────────────────────────────

export type EstadoChecklist = 'completo' | 'con_observaciones' | 'pendiente'

export interface ChecklistItem { item: string; ok: boolean; observacion: string }

export interface ChecklistArea {
  id: string
  company_id: string
  project_id: string
  area: string
  fecha: string
  inspector?: string | null
  items: ChecklistItem[]
  estado: EstadoChecklist
  notas?: string | null
  created_at: string
}

export type FrecuenciaLimpieza = 'diaria' | 'semanal' | 'quincenal' | 'mensual'
export type EstadoLimpieza = 'pendiente' | 'en_curso' | 'completado'

export interface ProgramacionLimpieza {
  id: string
  company_id: string
  project_id: string
  area: string
  frecuencia: FrecuenciaLimpieza
  /** Texto libre: sirve para terceros (empresa de limpieza) que no están en `personal_condominio`. */
  responsable?: string | null
  ultima_ejecucion?: string | null
  proxima_ejecucion?: string | null
  estado: EstadoLimpieza
  activo: boolean
  notas?: string | null
  created_at: string
  // ── Asignación (20260807130000) ──────────────────────────────────────────
  // Opcionales porque las filas creadas antes de la migración no las traen.
  /** Empleado asignado. NULL = la cubre quien encaje con `turno`/`cargo`. */
  personal_id?: string | null
  /** NULL = cualquier turno. */
  turno?: TurnoPersonal | null
  /** NULL = cualquier cargo. */
  cargo?: CargoPersonal | null
  /** Orden del área dentro de la ruta (menor primero). */
  orden?: number
  /** Si es true, la ejecución del día no se cierra sin al menos una foto. */
  requiere_foto?: boolean
  // ── Normalización de áreas (20260904000100) ──────────────────────────────
  /**
   * Área del catálogo (areas_condominio). NULL = registro legado pendiente de
   * vincular (o ambiguo en el backfill). `area` queda como snapshot del texto.
   */
  area_id?: string | null
}

// ── Ejecución diaria de limpieza (rutas) — 20260807130000 ────────────────────

export type EstadoEjecucionLimpieza = 'pendiente' | 'completada' | 'con_novedad' | 'omitida'
export type PrioridadNovedadLimpieza = 'baja' | 'media' | 'alta'

/** Una fila por (área, día): lo que le toca hoy a un empleado y cómo quedó. */
export interface EjecucionLimpieza {
  id: string
  company_id: string
  project_id: string
  programacion_id: string
  personal_id?: string | null
  fecha: string
  turno?: TurnoPersonal | null
  orden: number
  estado: EstadoEjecucionLimpieza
  completada_en?: string | null
  /** Paths bare de `condominios-media`; se firman al render (SecureImage). */
  foto_urls: string[]
  observacion?: string | null
  novedad?: string | null
  requiere_mantenimiento: boolean
  prioridad?: PrioridadNovedadLimpieza | null
  created_at: string
  // ── Anulación lógica (20260904000100) ────────────────────────────────────
  // El historial no se borra físicamente: una ejecución equivocada se anula
  // con motivo y queda fuera de la ruta activa, con sus fotos intactas.
  /** NULL = vigente. La BD sella `anulada_por` en la transición. */
  anulada_en?: string | null
  anulada_por?: string | null
  /** Obligatorio cuando anulada_en no es NULL (CHECK en BD). */
  motivo_anulacion?: string | null
}

export type TipoConsumoEnergia = 'electricidad' | 'agua' | 'gas' | 'otro'

export interface ConsumoEnergiaArea {
  id: string
  company_id: string
  project_id: string
  area: string
  tipo: TipoConsumoEnergia
  periodo: string
  lectura_anterior?: number | null
  lectura_actual: number
  unidad: string
  costo_unitario?: number | null
  total_costo?: number | null
  fecha_lectura: string
  notas?: string | null
  created_at: string
}

export type TipoResidente = 'propietario' | 'arrendatario' | 'familiar' | 'otro'
export type EstadoResidente = 'activo' | 'anterior'

export interface HistorialResidente {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  nombre_completo: string
  tipo: TipoResidente
  fecha_desde: string
  fecha_hasta?: string | null
  email?: string | null
  telefono?: string | null
  estado: EstadoResidente
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}


// ━━ Fase 21: suministros, tareas de condominio ━━
// ── Fase 21 ──────────────────────────────────────────────────────────────────
export type CategoriaSupministro = 'limpieza' | 'herramienta' | 'material' | 'oficina' | 'seguridad' | 'otro'
export type UnidadMedidaSum = 'unidad' | 'litro' | 'kg' | 'metro' | 'caja' | 'rollo' | 'otro'
export interface SuministroCondominio {
  id: string
  company_id: string
  project_id: string
  nombre: string
  categoria: CategoriaSupministro
  unidad_medida: UnidadMedidaSum
  stock_actual: number
  stock_minimo: number
  ubicacion?: string | null
  proveedor?: string | null
  costo_unitario?: number | null
  notas?: string | null
  activo: boolean
  created_at: string
}

export type TipoMovimientoSum = 'entrada' | 'salida' | 'ajuste'
export interface MovimientoSuministro {
  id: string
  company_id: string
  suministro_id: string
  tipo: TipoMovimientoSum
  cantidad: number
  motivo?: string | null
  area_destino?: string | null
  realizado_por?: string | null
  fecha: string
  notas?: string | null
  created_at: string
  // join
  suministro_nombre?: string
}

export type CategoriaTareaCondominio = 'operativa' | 'mantenimiento' | 'administrativa' | 'seguridad' | 'limpieza' | 'otro'
export type PrioridadTarea = 'baja' | 'media' | 'alta' | 'urgente'
export type EstadoTarea = 'pendiente' | 'en_proceso' | 'completada' | 'cancelada'
export interface ComentarioTarea { fecha: string; autor: string; texto: string }
export interface TareaCondominio {
  id: string
  company_id: string
  project_id: string
  titulo: string
  descripcion?: string | null
  categoria: CategoriaTareaCondominio
  prioridad: PrioridadTarea
  estado: EstadoTarea
  asignado_a?: string | null
  reportado_por?: string | null
  area?: string | null
  fecha_limite?: string | null
  fecha_inicio?: string | null
  fecha_cierre?: string | null
  costo_estimado?: number | null
  costo_real?: number | null
  comentarios: ComentarioTarea[]
  notas?: string | null
  created_at: string
}

export type EtapaCobranza = 'aviso_amistoso' | 'recordatorio' | 'carta_formal' | 'suspension_servicios' | 'cobro_juridico' | 'acuerdo_pago' | 'resuelto'
export type EstadoCobranza = 'activo' | 'resuelto' | 'cancelado'
export type TipoContactoCobranza = 'llamada' | 'email' | 'visita' | 'mensaje'
export interface ContactoCobranza {
  fecha: string
  tipo: TipoContactoCobranza
  resultado: string
  siguiente_accion?: string
}
export interface GestionCobranza {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  responsable: string
  monto_adeudado: number
  monto_pagado: number
  etapa: EtapaCobranza
  fecha_inicio: string
  fecha_resolucion?: string | null
  contactos: ContactoCobranza[]
  observaciones?: string | null
  estado: EstadoCobranza
  created_at: string
  // join
  unidad_nombre?: string
}


// ━━ Fase 24: piscina, jardinería, elevadores ━━
// ── Fase 24 ───────────────────────────────────────────────────────────────────

export type TurbiededadPiscina = 'cristalina' | 'ligeramente_turbia' | 'turbia'
export type EstadoPiscina = 'abierta' | 'cerrada_mantenimiento' | 'cerrada_quimica' | 'cerrada_incidente'

export interface ControlPiscina {
  id: string
  company_id: string
  project_id: string
  fecha: string
  hora?: string | null
  piscina: string
  ph?: number | null
  cloro?: number | null
  temperatura?: number | null
  turbiedad: TurbiededadPiscina
  estado: EstadoPiscina
  num_usuarios?: number | null
  registrado_por?: string | null
  observaciones?: string | null
  created_at: string
}

export type TipoJardineria = 'mantenimiento_general' | 'poda' | 'fumigacion' | 'siembra' | 'riego' | 'limpieza' | 'otro'
export type EstadoJardineria = 'programado' | 'en_proceso' | 'completado' | 'cancelado'

export interface MantenimientoJardineria {
  id: string
  company_id: string
  project_id: string
  fecha: string
  tipo: TipoJardineria
  areas: string[]
  proveedor?: string | null
  trabajadores?: number | null
  horas_trabajo?: number | null
  insumos?: string | null
  costo?: number | null
  estado: EstadoJardineria
  proxima_visita?: string | null
  observaciones?: string | null
  created_at: string
}

export type TipoIncidenciaElevador = 'falla' | 'mantenimiento_preventivo' | 'mantenimiento_correctivo' | 'inspeccion_legal' | 'otro'
export type EstadoIncidenciaElevador = 'reportado' | 'en_atencion' | 'resuelto' | 'requiere_seguimiento'

export interface IncidenciaElevador {
  id: string
  company_id: string
  project_id: string
  elevador: string
  tipo: TipoIncidenciaElevador
  descripcion: string
  fecha: string
  hora_inicio?: string | null
  hora_fin?: string | null
  empresa_servicio?: string | null
  tecnico?: string | null
  estado: EstadoIncidenciaElevador
  costo?: number | null
  proxima_inspeccion?: string | null
  observaciones?: string | null
  created_at: string
}

export type TipoMantenimientoCisterna = 'lectura' | 'limpieza' | 'cloracion' | 'inspeccion' | 'reparacion'
export type EstadoCisterna = 'normal' | 'bajo_nivel' | 'mantenimiento' | 'fuera_servicio'

export interface MantenimientoCisterna {
  id: string
  company_id: string
  project_id: string
  fecha: string
  cisterna: string
  tipo: TipoMantenimientoCisterna
  nivel_agua_pct?: number | null
  cloro_residual?: number | null
  ph?: number | null
  estado: EstadoCisterna
  empresa_servicio?: string | null
  tecnico?: string | null
  costo?: number | null
  proxima_revision?: string | null
  observaciones?: string | null
  created_at: string
}


// ━━ Fase 32: vencimientos, capacitación, proyectos, manual ━━
// ── Fase 32 ────────────────────────────────────────────────────────────────────
export type CategoriaVencimiento = 'contrato' | 'permiso' | 'certificacion' | 'seguro' | 'otro'
export interface VencimientoExtra {
  id: string
  company_id: string
  project_id: string
  titulo: string
  descripcion?: string | null
  categoria: CategoriaVencimiento
  fecha_vencimiento: string
  entidad?: string | null
  monto?: number | null
  alerta_dias: number
  renovado: boolean
  notas?: string | null
  created_at: string
}

export type EstadoCapacitacion = 'planificado' | 'en_progreso' | 'completado' | 'vencido'
export interface CapacitacionPersonal {
  id: string
  company_id: string
  project_id: string
  personal_id?: string | null
  nombre_empleado: string
  cargo?: string | null
  curso: string
  proveedor?: string | null
  fecha_inicio: string
  fecha_fin?: string | null
  fecha_vencimiento_cert?: string | null
  costo?: number | null
  estado: EstadoCapacitacion
  notas?: string | null
  created_at: string
}

export type CategoriaProyectoCond = 'mejora' | 'mantenimiento' | 'seguridad' | 'tecnologia' | 'otro'
export type EstadoProyectoCond = 'planificado' | 'en_progreso' | 'pausado' | 'completado' | 'cancelado'
export interface ProyectoCondominio {
  id: string
  company_id: string
  project_id: string
  nombre: string
  descripcion?: string | null
  categoria: CategoriaProyectoCond
  estado: EstadoProyectoCond
  responsable?: string | null
  fecha_inicio?: string | null
  fecha_fin_estimada?: string | null
  fecha_fin_real?: string | null
  porcentaje_avance: number
  presupuesto?: number | null
  costo_real?: number | null
  notas?: string | null
  created_at: string
}

export type SeccionManual = 'amenidades' | 'normas' | 'faq' | 'contactos' | 'otro'
export interface ArticuloManual {
  id: string
  company_id: string
  project_id: string
  seccion: SeccionManual
  titulo: string
  contenido: string
  orden: number
  activo: boolean
  created_at: string
}

export type TriggerTipoAuto = 'cuota_vencida_dias' | 'ticket_sin_resolver_dias' | 'vencimiento_critico_dias' | 'cert_personal_vence_dias'
export type AccionTipoAuto = 'notificacion_interna' | 'crear_alerta' | 'marcar_moroso'
export interface AutomatizacionCond {
  id: string
  company_id: string
  project_id: string
  nombre: string
  trigger_tipo: TriggerTipoAuto
  trigger_valor: number
  accion_tipo: AccionTipoAuto
  accion_config: Record<string, unknown>
  activa: boolean
  ultima_ejecucion?: string | null
  notas?: string | null
  created_at: string
}

export type CanalPlantilla = 'whatsapp' | 'email' | 'sms'
export interface PlantillaMensajeCond {
  id: string
  company_id: string
  project_id: string
  nombre: string
  canal: CanalPlantilla
  asunto?: string | null
  cuerpo: string
  variables: string[]
  activa: boolean
  created_at: string
}

export type TipoFlujoAprobacion = 'gasto_mayor' | 'propuesta' | 'permiso_obra' | 'mudanza' | 'otro'
export type EstadoFlujoAprobacion = 'pendiente' | 'aprobado' | 'rechazado'
export interface FlujoAprobacionCond {
  id: string
  company_id: string
  project_id: string
  tipo: TipoFlujoAprobacion
  titulo: string
  descripcion?: string | null
  monto?: number | null
  solicitado_por?: string | null
  aprobado_por?: string | null
  estado: EstadoFlujoAprobacion
  fecha_solicitud: string
  fecha_resolucion?: string | null
  comentario_resolucion?: string | null
  created_at: string
}

