// Tipos del módulo Condominios — sub-dominio: finanzas.
// Particionado de types/condominios.ts (auditoría P1); el barrel
// ./index.ts re-exporta todo, así que la superficie pública no cambia.

import type { RubroConfig } from './core'
import type { CanalNotificacion } from './residentes'
import type { TipoResidente } from './operaciones'

// ━━ Fase 9: gastos, presupuesto legacy, alertas ━━
// ── Phase 9: Contabilidad, Presupuesto, Alertas ───────────────────────────────

export type CategoriaGasto = 'mantenimiento' | 'servicios' | 'administrativo' | 'seguridad' | 'limpieza' | 'obras' | 'otros'
export type EstadoGasto = 'pendiente' | 'pagado' | 'anulado'
export interface GastoCondominio {
  id: string
  company_id: string
  project_id: string
  concepto: string
  categoria: CategoriaGasto
  monto: number
  fecha: string
  proveedor_nombre?: string | null
  estado: EstadoGasto
  metodo_pago?: string | null
  comprobante_num?: string | null
  notas?: string | null
  created_at: string
}

export interface PresupuestoCondominio {
  id: string
  company_id: string
  project_id: string
  anio: number
  categoria: string
  monto_presupuestado: number
  notas?: string | null
  created_at: string
}

export type TipoAlerta = 'vencimiento' | 'recordatorio' | 'aviso' | 'urgente'
export type EstadoAlerta = 'activa' | 'resuelta' | 'ignorada'
export interface AlertaCondominio {
  id: string
  company_id: string
  project_id: string
  tipo: TipoAlerta
  titulo: string
  descripcion?: string | null
  fecha_alerta: string
  estado: EstadoAlerta
  referencia_tabla?: string | null
  referencia_id?: string | null
  created_at: string
}


// ━━ Fase 18: fondo de reserva, permisos de obra, tarifas ━━
// ── Fase 18 ───────────────────────────────────────────────────────────────────

export type TipoMovimientoFondo = 'aporte' | 'retiro' | 'ajuste'
export type EstadoMovimientoFondo = 'pendiente' | 'aprobado' | 'rechazado'

export interface FondoReserva {
  id: string
  company_id: string
  project_id: string
  tipo: TipoMovimientoFondo
  concepto: string
  monto: number
  fecha: string
  justificacion?: string | null
  aprobado_por?: string | null
  estado: EstadoMovimientoFondo
  notas?: string | null
  created_at: string
}

export type TipoObra = 'remodelacion' | 'ampliacion' | 'reparacion' | 'pintura' | 'otro'
export type EstadoPermisoObra = 'solicitado' | 'aprobado' | 'en_ejecucion' | 'completado' | 'rechazado'

export interface PermisoObraUnidad {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  tipo_obra: TipoObra
  descripcion: string
  fecha_inicio?: string | null
  fecha_fin_estimada?: string | null
  horario_permitido?: string | null
  fianza?: number | null
  estado: EstadoPermisoObra
  aprobado_por?: string | null
  observaciones?: string | null
  created_at: string
  unidad_nombre?: string
}

export type TipoUnidadTarifa = 'todas' | 'residencial' | 'comercial' | 'bodega' | 'parqueo'
export type PeriodicidadTarifa = 'mensual' | 'trimestral' | 'semestral' | 'anual' | 'unica_vez'

export interface TarifaCondominio {
  id: string
  company_id: string
  project_id: string
  concepto: string
  descripcion?: string | null
  monto: number
  tipo_unidad: TipoUnidadTarifa
  periodicidad: PeriodicidadTarifa
  activo: boolean
  vigente_desde?: string | null
  vigente_hasta?: string | null
  notas?: string | null
  created_at: string
}

export type TipoIncidente = 'robo' | 'vandalismo' | 'accidente' | 'incendio' | 'pelea' | 'otro'
export type EstadoIncidente = 'reportado' | 'investigando' | 'resuelto' | 'cerrado'

export interface IncidenteSeguridad {
  id: string
  company_id: string
  project_id: string
  fecha: string
  hora?: string | null
  tipo: TipoIncidente
  descripcion: string
  area?: string | null
  reportado_por?: string | null
  estado: EstadoIncidente
  involucrados?: string | null
  seguimiento?: string | null
  created_at: string
}


// ━━ Fase 23: cargos adicionales, actividades, autoridades ━━
// ── Fase 23 ──────────────────────────────────────────────────────────────────
export type CategoriaCargoAdicional = 'reparacion' | 'exceso_consumo' | 'dano' | 'servicio' | 'multa' | 'otro'
export type EstadoCargoAdicional = 'pendiente' | 'pagado' | 'anulado'
export interface CargoAdicionalUnidad {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  concepto: string
  categoria: CategoriaCargoAdicional
  monto: number
  fecha_cargo: string
  fecha_vencimiento?: string | null
  estado: EstadoCargoAdicional
  referencia?: string | null
  observaciones?: string | null
  created_at: string
  unidad_nombre?: string
}

export type CategoriaActividad = 'recreativa' | 'deportiva' | 'cultural' | 'educativa' | 'salud' | 'otro'
export type EstadoActividad = 'programada' | 'activa' | 'completada' | 'cancelada'
export interface ProgramaActividad {
  id: string
  company_id: string
  project_id: string
  nombre: string
  descripcion?: string | null
  categoria: CategoriaActividad
  instructor?: string | null
  lugar?: string | null
  fecha_inicio: string
  fecha_fin?: string | null
  hora_inicio?: string | null
  hora_fin?: string | null
  dias_semana?: string[] | null
  cupo_maximo?: number | null
  inscritos: number
  costo: number
  estado: EstadoActividad
  activo: boolean
  notas?: string | null
  created_at: string
}

export type TipoAutoridad = 'policia' | 'bomberos' | 'salud' | 'municipalidad' | 'electricidad' | 'agua' | 'otro'
export type ResultadoAutoridad = 'sin_novedad' | 'acta_levantada' | 'sancion' | 'recomendacion' | 'otro'
export interface RegistroAutoridad {
  id: string
  company_id: string
  project_id: string
  tipo_autoridad: TipoAutoridad
  nombre_institucion?: string | null
  nombre_funcionario?: string | null
  motivo: string
  fecha: string
  hora_llegada?: string | null
  hora_salida?: string | null
  resultado?: ResultadoAutoridad | null
  documento_referencia?: string | null
  requiere_seguimiento: boolean
  fecha_seguimiento?: string | null
  observaciones?: string | null
  created_at: string
}

export type CategoriaNota = 'general' | 'urgente' | 'recordatorio' | 'seguimiento' | 'reunion' | 'otro'
export type PrioridadNota = 'normal' | 'alta' | 'urgente'
export interface NotaAdmin {
  id: string
  company_id: string
  project_id: string
  titulo: string
  contenido: string
  categoria: CategoriaNota
  prioridad: PrioridadNota
  fijada: boolean
  resuelta: boolean
  fecha_recordatorio?: string | null
  autor?: string | null
  created_at: string
}


// ━━ Fases 28-31: recordatorios, mora, convenios, cierres, cobranza ━━
// ── Fase 28: Comentarios Ticket, Recordatorios, Plantillas Cuota, Bitácora ──

export interface ComentarioTicket {
  id: string
  company_id: string
  ticket_id: string
  autor_id?: string | null
  autor_nombre: string
  contenido: string
  estado_nuevo?: string | null
  /** Paths de `condominios-media` adjuntos al mensaje (se firman al render). */
  foto_urls: string[]
  /** Nota interna del equipo: el residente no la ve (RLS la filtra igual). */
  es_interno: boolean
  /** auth.uid() sellado por la BD; identifica los mensajes propios en el hilo. */
  creado_por?: string | null
  created_at: string
}

export type PrioridadRecordatorio = 'normal' | 'alta' | 'critica'
export type TipoEntidadRecordatorio = 'cuota' | 'contrato' | 'inspeccion' | 'mantenimiento' | 'general'

export interface RecordatorioCondominio {
  id: string
  company_id: string
  project_id: string
  titulo: string
  descripcion?: string | null
  fecha_limite: string
  tipo_entidad?: TipoEntidadRecordatorio | null
  entidad_id?: string | null
  asignado_a?: string | null
  asignado_nombre?: string | null
  prioridad: PrioridadRecordatorio
  completado: boolean
  fecha_completado?: string | null
  created_by?: string | null
  created_at: string
}

export type PeriodicidadPlantilla = 'mensual' | 'bimestral' | 'trimestral' | 'semestral' | 'anual' | 'única'

export interface PlantillaCuota {
  id: string
  company_id: string
  project_id: string
  nombre: string
  concepto: string
  monto: number
  dia_vencimiento: number
  periodicidad: PeriodicidadPlantilla
  aplica_a: string
  activa: boolean
  notas?: string | null
  created_at: string
  rubros?: RubroConfig[] | null
  monto_total_estimado?: number | null
  /**
   * Rol responsable por defecto que la generación en lote estampa en cada cuota
   * (mismo dominio que `unidad_residentes.tipo`). NULL = sin diferenciar.
   */
  rol_responsable?: TipoResidente | null
}

export type AccionBitacora = 'crear' | 'editar' | 'eliminar' | 'aprobar' | 'rechazar' | 'pagar' | 'cerrar'

export interface BitacoraAccion {
  id: string
  company_id: string
  project_id?: string | null
  usuario_id?: string | null
  usuario_nombre: string
  accion: AccionBitacora
  modulo: string
  entidad_id?: string | null
  entidad_desc?: string | null
  detalles?: Record<string, unknown> | null
  ip_address?: string | null
  created_at: string
}

// ── Fase 29: Recargos mora, Convenios cuota, Historial saldos, Notificaciones ─

export type EstadoRecargo = 'pendiente' | 'aplicado' | 'anulado'
export type TipoRecargo = 'porcentaje' | 'monto_fijo'

export interface RecargoMora {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  cuota_id?: string | null
  tipo: TipoRecargo
  valor: number
  monto_calculado: number
  fecha_aplicacion: string
  estado: EstadoRecargo
  motivo?: string | null
  anulado_por?: string | null
  fecha_anulacion?: string | null
  created_at: string
  // joins
  unidad_nombre?: string
}

export type EstadoConvenioCuota = 'activo' | 'cumplido' | 'incumplido' | 'anulado'

export interface ConvenioCuotaCond {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  descripcion: string
  monto_total: number
  num_cuotas: number
  monto_cuota: number
  dia_pago: number
  fecha_inicio: string
  fecha_fin?: string | null
  cuotas_pagadas: number
  estado: EstadoConvenioCuota
  aprobado_por?: string | null
  notas?: string | null
  created_at: string
  // joins
  unidad_nombre?: string
}

export interface HistorialSaldoUnidad {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  periodo: string
  saldo_anterior: number
  cargos_periodo: number
  pagos_periodo: number
  saldo_final: number
  num_cuotas_vencidas: number
  created_at: string
  // joins
  unidad_nombre?: string
}

export type EstadoNotificacion = 'enviado' | 'fallido' | 'pendiente' | 'leido'

export interface NotificacionEnviada {
  id: string
  company_id: string
  project_id?: string | null
  unidad_id?: string | null
  cliente_id?: string | null
  canal: CanalNotificacion
  destinatario: string
  asunto?: string | null
  contenido: string
  estado: EstadoNotificacion
  error_detalle?: string | null
  enviado_por?: string | null
  fecha_envio: string
  created_at: string
  // joins
  unidad_nombre?: string
}

// ── Fase 30 ────────────────────────────────────────────────────────────────────
export type TipoReglaRecargo = 'porcentaje' | 'monto_fijo'
export type AplicarSobreRecargo = 'saldo_vencido' | 'monto_cuota'
export interface ReglaMoraConfig {
  id: string
  company_id: string
  project_id: string
  nombre: string
  dias_vencimiento: number
  tipo: TipoReglaRecargo
  valor: number
  aplicar_sobre: AplicarSobreRecargo
  periodo_gracia: number
  activa: boolean
  notas?: string | null
  created_at: string
}

export type CanalCampana = 'whatsapp' | 'email' | 'sms'
export type EstadoCampana = 'borrador' | 'enviada' | 'completada'
export interface CampanaCobro {
  id: string
  company_id: string
  project_id: string
  nombre: string
  mensaje: string
  canal: CanalCampana
  estado: EstadoCampana
  total_destinatarios: number
  enviadas: number
  fallidas: number
  criterio_dias_mora?: number | null
  criterio_monto_min?: number | null
  enviada_por?: string | null
  fecha_envio?: string | null
  created_at: string
}

export type EstadoCierreAnual = 'borrador' | 'cerrado'
export interface CierreAnual {
  id: string
  company_id: string
  project_id: string
  anio: number
  total_ingresos: number
  total_egresos: number
  saldo: number
  total_cuotas_generadas: number
  total_cuotas_cobradas: number
  tasa_recaudacion?: number | null
  unidades_morosas: number
  monto_mora_total: number
  notas?: string | null
  firmado_por?: string | null
  fecha_cierre?: string | null
  estado: EstadoCierreAnual
  created_at: string
}

// ── Fase 31 ────────────────────────────────────────────────────────────────────
export type EtapaCobranzaJudicial = 'carta_notarial' | 'juzgado' | 'sentencia' | 'ejecutado' | 'archivado'
export type EstadoCobranzaJudicial = 'activo' | 'resuelto' | 'archivado'
export interface CobranzaJudicial {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  etapa: EtapaCobranzaJudicial
  monto_adeudado: number
  fecha_inicio: string
  fecha_actualizacion?: string | null
  abogado?: string | null
  expediente?: string | null
  notas?: string | null
  estado: EstadoCobranzaJudicial
  created_at: string
  unidad_nombre?: string
}

export type EstadoReciboDigital = 'generado' | 'enviado' | 'anulado'
export interface ReciboDigital {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  cuota_id?: string | null
  numero_recibo: string
  monto: number
  concepto: string
  fecha_emision: string
  enviado_por?: string | null
  destinatario_email?: string | null
  destinatario_nombre?: string | null
  estado: EstadoReciboDigital
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}

export type EstadoInformeMensual = 'borrador' | 'publicado'
export interface InformeMensual {
  id: string
  company_id: string
  project_id: string
  periodo: string
  total_cuotas: number
  cuotas_pagadas: number
  cuotas_morosas: number
  total_recaudado: number
  total_gastos: number
  num_tickets: number
  tickets_resueltos: number
  num_visitantes: number
  num_incidentes: number
  notas?: string | null
  firmado_por?: string | null
  estado: EstadoInformeMensual
  created_at: string
}

export type CategoriaSugerencia = 'instalaciones' | 'seguridad' | 'servicios' | 'convivencia' | 'otro'
export type EstadoSugerencia = 'pendiente' | 'en_revision' | 'respondida' | 'archivada'
export interface SugerenciaCondominio {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  categoria: CategoriaSugerencia
  titulo: string
  descripcion: string
  estado: EstadoSugerencia
  respuesta?: string | null
  respondido_por?: string | null
  fecha_respuesta?: string | null
  anonima: boolean
  created_at: string
  unidad_nombre?: string
}


// ━━ Fases 36-43: logs de generación, órdenes de compra, proformas, fondo ━━
// ── Fase 36 ───────────────────────────────────────────────────────────────────
export interface GeneracionCuotasLog {
  id: string
  company_id: string
  project_id: string
  periodo: string
  concepto: string
  monto_unitario: number
  fecha_vencimiento: string
  unidades_generadas: number
  created_at: string
  rubros?: RubroConfig[] | null
  metodo_calculo?: string | null
}

// ── Fase 37 ───────────────────────────────────────────────────────────────────
export type EstadoOrdenCompra = 'borrador' | 'aprobada' | 'emitida' | 'recibida' | 'cancelada'
export interface OrdenCompra {
  id: string
  company_id: string
  project_id: string
  correlativo: number
  proveedor_nombre: string
  concepto: string
  descripcion?: string | null
  monto_estimado?: number | null
  monto_real?: number | null
  fecha_entrega_esperada?: string | null
  estado: EstadoOrdenCompra
  notas?: string | null
  created_by?: string | null
  created_at: string
}

export interface AsambleaDigital {
  id: string
  company_id: string
  project_id: string
  titulo: string
  descripcion?: string | null
  fecha_hora: string
  modalidad: 'presencial' | 'virtual' | 'hibrida'
  link_reunion?: string | null
  quorum_requerido: number
  estado: 'programada' | 'en_curso' | 'finalizada' | 'cancelada'
  acta_url?: string | null
  created_by?: string | null
  created_at: string
}

export interface PuntoAsamblea2 {
  id: string
  asamblea_id: string
  orden: number
  titulo: string
  descripcion?: string | null
  tipo: 'informativo' | 'aprobacion' | 'eleccion'
  resultado?: string | null
  votos_favor: number
  votos_contra: number
  votos_abstencion: number
}

// ── Fase 38 ───────────────────────────────────────────────────────────────────
export type EstadoProforma = 'borrador' | 'enviada' | 'aprobada' | 'convertida_oc' | 'rechazada'
export interface Proforma {
  id: string
  company_id: string
  project_id: string
  proveedor_nombre: string
  concepto: string
  descripcion?: string | null
  monto?: number | null
  fecha_validez?: string | null
  estado: EstadoProforma
  notas?: string | null
  created_at: string
}

// ── Fase 39 ───────────────────────────────────────────────────────────────────
export interface ConciliacionCobrosLog {
  id: string
  company_id: string
  project_id: string
  cuota_id: string
  unidad_id: string
  monto_cuota: number
  monto_recibido: number
  diferencia: number
  referencia_pago?: string | null
  fecha_pago: string
  metodo_pago: string
  notas?: string | null
  estado: 'conciliado' | 'diferencia'
  created_at: string
}

// ── Fase 43 ───────────────────────────────────────────────────────────────────
export interface FondoReservaMovimiento {
  id: string
  company_id: string
  project_id: string
  tipo: 'aportacion' | 'retiro' | 'rendimiento' | 'ajuste'
  concepto: string
  monto: number
  fecha: string
  referencia?: string | null
  notas?: string | null
  created_at: string
}

export interface ConfigCondominio {
  id: string
  company_id: string
  project_id: string
  cuota_base?: number | null
  dias_gracia: number
  tasa_mora_mensual: number
  metodos_pago: string[]
  nombre_administrador?: string | null
  telefono_admin?: string | null
  email_admin?: string | null
  reglamento_url?: string | null
  notif_dias_antes_vencimiento: number
  permitir_reservas_online: boolean
  max_reservas_por_unidad_mes: number
  created_at: string
  updated_at: string
}
