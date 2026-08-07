// Tipos del módulo Condominios — sub-dominio: operaciones.
// Particionado de types/condominios.ts (auditoría P1); el barrel
// ./index.ts re-exporta todo, así que la superficie pública no cambia.

import type { EstadoContrato, PrioridadNovedad, TipoNovedad } from './seguridad'

// ━━ Tareas operativas: turnos, bloques, revisiones ━━
// ── Tareas operativas ─────────────────────────────────────────────────────

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
  // joins
  area_nombre?: string
}

export type EstadoBloqueTurno = 'pendiente' | 'en_curso' | 'completado' | 'incompleto'
export type TurnoTipo = 'manana' | 'tarde' | 'noche'

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
  created_at: string
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

