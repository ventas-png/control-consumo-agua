// Tipos del módulo Condominios — sub-dominio: residentes.
// Particionado de types/condominios.ts (auditoría P1); el barrel
// ./index.ts re-exporta todo, así que la superficie pública no cambia.

import type { TipoResidente } from './operaciones'

/**
 * Membresía de un residente en una unidad (portal propietario/inquilino · fase 1).
 * Una unidad puede tener VARIOS residentes con rol distinto (propietario,
 * arrendatario, familiar…). La tabla `unidad_residentes` es la fundación para
 * diferenciar accesos y cargos por rol en las fases siguientes. `tipo` casa con el
 * CHECK de la migración.
 */
export interface UnidadResidente {
  id: string
  unidad_id: string
  cliente_id: string
  company_id: string
  project_id: string
  tipo: TipoResidente
  activo: boolean
  created_at: string
  updated_at: string
}

// ━━ Autorizaciones de renta y mudanza por unidad ━━
// ── Autorización de Renta por Unidad ──────────────────────────────────────

export type TipoRenta = 'arrendamiento' | 'str' | 'ambas'
export type EstadoSolicitudRenta = 'borrador' | 'pendiente' | 'aprobada' | 'rechazada' | 'baja'

/**
 * Adjunto que el propietario anexa a su solicitud de renta para que la
 * administración evalúe y archive. `path` es el path BARE del bucket privado
 * `renta-docs` (20260828000100); la lectura firma con useSignedUrl.
 */
export interface DocumentoSolicitudRenta {
  path: string
  nombre: string
  etiqueta?: string | null
  mime?: string | null
  size?: number | null
}

/** Quién paga un servicio del inmueble. Espeja el CHECK de 20260829000000. */
export type ResponsableServicio = 'propietario' | 'inquilino'

/** Los seis servicios cuyo pagador se pacta al autorizar la renta. */
export interface ResponsablesServicios {
  mantenimiento: ResponsableServicio
  agua:          ResponsableServicio
  electricidad:  ResponsableServicio
  basura:        ResponsableServicio
  telefonia:     ResponsableServicio
  internet:      ResponsableServicio
}

export interface SolicitudRentaUnidad {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  cliente_id?: string | null
  tipo_renta: TipoRenta
  motivo?: string | null
  estado: EstadoSolicitudRenta
  tipo_aprobado?: TipoRenta | null
  comentario_admin?: string | null
  aprobado_por?: string | null
  fecha_resolucion?: string | null
  created_at: string
  // Datos del contrato propuestos por el propietario (20260828000000). Espejan
  // a ContratoArrendamiento; nulos cuando la solicitud es solo STR.
  arrendatario_nombre?: string | null
  arrendatario_identificacion?: string | null
  arrendatario_telefono?: string | null
  arrendatario_email?: string | null
  monto_renta?: number | null
  deposito?: number | null
  dia_pago?: number | null
  fecha_inicio?: string | null
  fecha_fin?: string | null
  notas_contrato?: string | null
  documentos?: DocumentoSolicitudRenta[] | null
  // Responsables del pago de cada servicio (20260829000000). Nulos en STR y en
  // las solicitudes anteriores a la feature.
  resp_mantenimiento?: ResponsableServicio | null
  resp_agua?:          ResponsableServicio | null
  resp_electricidad?:  ResponsableServicio | null
  resp_basura?:        ResponsableServicio | null
  resp_telefonia?:     ResponsableServicio | null
  resp_internet?:      ResponsableServicio | null
  /** Contrato creado al aprobar (lo escribe solo el RPC aprobar_solicitud_renta). */
  contrato_id?: string | null
  /** Identidad de auditoría de quien resolvió: auth.uid(), no texto del cliente. */
  aprobado_por_user_id?: string | null
  /** Justificación obligatoria al aprobar un arrendamiento sin crear el contrato. */
  motivo_sin_contrato?: string | null
  // joined
  unidad_nombre?: string
}

// ── Autorización de Mudanza por Unidad ────────────────────────────────────

export type TipoSolicitudMudanza = 'nueva_mudanza' | 'ingreso_articulos' | 'egreso_articulos' | 'mudanza_salida'
export type EstadoSolicitudMudanza =
  | 'pendiente'
  | 'aprobada'
  | 'rechazada'
  | 'programada'
  | 'en_curso'
  | 'completada'
  | 'cancelada'

export interface SolicitudMudanzaUnidad {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  cliente_id?: string | null
  tipo_mudanza: TipoSolicitudMudanza
  fecha_solicitada?: string | null
  hora_solicitada?: string | null
  descripcion?: string | null
  imagenes?: string[] | null
  estado: EstadoSolicitudMudanza
  comentario_admin?: string | null
  fecha_autorizada?: string | null
  hora_autorizada?: string | null
  aprobado_por?: string | null
  fecha_resolucion?: string | null
  // Operational fields (fusionados desde la tabla mudanzas)
  empresa_mudanza?: string | null
  telefono?: string | null
  hora_fin?: string | null
  deposito_requerido?: boolean
  deposito_pagado?: boolean
  monto_deposito?: number | null
  ascensor_reservado?: boolean
  notas?: string | null
  created_at: string
  // joined
  unidad_nombre?: string
}

export interface Parametro {
  key: string;
  label: string;
  unidad: string;
  min: number;
  max: number;
}

export interface Tipologia {
  label: string;
  parametros: Parametro[];
}


// ━━ Fase 5: contactos de emergencia, documentos, residuos ━━
// ── Condominios Fase 5 ────────────────────────────────────────────────────────

export type TipoContactoEmergencia = 'bomberos' | 'policia' | 'ambulancia' | 'hospital' | 'electricidad' | 'agua' | 'gas' | 'administracion' | 'general'
export type CategoriaDocumento = 'reglamento' | 'circular' | 'manual' | 'acta' | 'contrato' | 'formulario' | 'otro'
export type VisibilidadDocumento = 'admin' | 'residentes' | 'todos'
export type TipoResiduo = 'general' | 'reciclable' | 'organico' | 'electronico' | 'peligroso' | 'escombros'
export type EstadoResiduo = 'pendiente' | 'recolectado' | 'procesado'

export interface ContactoEmergencia {
  id: string
  company_id: string
  project_id: string
  nombre: string
  tipo: TipoContactoEmergencia
  telefono: string
  telefono_alternativo?: string | null
  descripcion?: string | null
  disponible_24h: boolean
  orden: number
  activo: boolean
  created_at: string
}

export interface DocumentoCondominio {
  id: string
  company_id: string
  project_id: string
  titulo: string
  categoria: CategoriaDocumento
  descripcion?: string | null
  url: string
  version?: string | null
  vigente: boolean
  visibilidad: VisibilidadDocumento
  subido_por?: string | null
  created_at: string
}

export interface RegistroResiduo {
  id: string
  company_id: string
  project_id: string
  fecha: string
  tipo_residuo: TipoResiduo
  cantidad_kg?: number | null
  punto_acopio?: string | null
  empresa_recolectora?: string | null
  estado: EstadoResiduo
  incidencia: boolean
  descripcion_incidencia?: string | null
  registrado_por?: string | null
  notas?: string | null
  created_at: string
}

// ── Fase 6: Bodegas, Onboarding, Propuestas, Memoria ──────────────────────────
export type EstadoBodega = 'disponible' | 'asignada' | 'bloqueada'
export interface BodegaCondominio {
  id: string
  company_id: string
  project_id: string
  numero: string
  piso?: string | null
  area_m2?: number | null
  unidad_id?: string | null
  estado: EstadoBodega
  monto_renta?: number | null
  fecha_asignacion?: string | null
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}

export type EstadoOnboarding = 'en_proceso' | 'completado' | 'cancelado'
export interface OnboardingResidente {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  nombre_residente: string
  fecha_ingreso: string
  tipo: 'propietario' | 'arrendatario'
  estado: EstadoOnboarding
  llaves_entregadas: boolean
  reglamento_firmado: boolean
  deposito_pagado: boolean
  datos_registrados: boolean
  accesos_configurados: boolean
  inspeccion_unidad: boolean
  bienvenida_enviada: boolean
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}

export type CategoriaPropuesta = 'mejora' | 'reparacion' | 'expansion' | 'tecnologia' | 'seguridad' | 'otro'
export type EstadoPropuesta = 'propuesta' | 'en_evaluacion' | 'aprobada' | 'rechazada' | 'en_ejecucion' | 'completada'
export type PrioridadPropuesta = 'baja' | 'media' | 'alta'
export interface PropuestaInversion {
  id: string
  company_id: string
  project_id: string
  titulo: string
  descripcion?: string | null
  categoria: CategoriaPropuesta
  monto_estimado?: number | null
  prioridad: PrioridadPropuesta
  estado: EstadoPropuesta
  votos_favor: number
  votos_contra: number
  fecha_propuesta: string
  fecha_aprobacion?: string | null
  fecha_ejecucion?: string | null
  notas?: string | null
  created_at: string
}

export type TipoPeriodo = 'mensual' | 'trimestral' | 'anual'
export type EstadoMemoria = 'borrador' | 'publicado'
export interface MemoriaLabores {
  id: string
  company_id: string
  project_id: string
  titulo: string
  periodo: string
  tipo_periodo: TipoPeriodo
  resumen?: string | null
  logros?: string | null
  pendientes?: string | null
  tickets_resueltos?: number | null
  visitantes_registrados?: number | null
  cuotas_cobradas?: number | null
  incidencias_atendidas?: number | null
  estado: EstadoMemoria
  created_at: string
}


// ━━ Fase 8: firma digital, concierge, llaves, encuestas ━━
// ── Fase 8: Firma Digital, Concierge, Llaves, Encuestas ───────────────────────
export type TipoDocumentoFirma = 'contrato' | 'reglamento' | 'acta' | 'aviso' | 'otro'
export type EstadoFirma = 'pendiente' | 'firmado' | 'rechazado' | 'expirado'
export interface FirmaDigital {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  documento_titulo: string
  documento_tipo: TipoDocumentoFirma
  firmante_nombre?: string | null
  firmante_email?: string | null
  estado: EstadoFirma
  fecha_vencimiento?: string | null
  fecha_firma?: string | null
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}

export type TipoConcierge = 'taxi' | 'restaurante' | 'tour' | 'compras' | 'mensajeria' | 'limpieza_extra' | 'otro'
export type EstadoConcierge = 'pendiente' | 'en_proceso' | 'completado' | 'cancelado'
export interface SolicitudConcierge {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  tipo: TipoConcierge
  descripcion: string
  fecha_solicitud: string
  hora_solicitud?: string | null
  estado: EstadoConcierge
  atendido_por?: string | null
  costo?: number | null
  notas_staff?: string | null
  created_at: string
  unidad_nombre?: string
}

export type TipoLlave = 'fisica' | 'tarjeta' | 'codigo' | 'app'
export type EstadoLlave = 'activa' | 'devuelta' | 'perdida' | 'bloqueada'
export interface LlaveCondominio {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  tipo: TipoLlave
  descripcion: string
  codigo?: string | null
  cantidad: number
  fecha_entrega?: string | null
  fecha_devolucion?: string | null
  estado: EstadoLlave
  deposito_pagado: boolean
  monto_deposito?: number | null
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}

export type EstadoEncuesta = 'borrador' | 'activa' | 'cerrada'
export interface Encuesta {
  id: string
  company_id: string
  project_id: string
  titulo: string
  descripcion?: string | null
  preguntas: unknown[]
  fecha_inicio?: string | null
  fecha_fin?: string | null
  estado: EstadoEncuesta
  created_at: string
}

export interface RespuestaEncuesta {
  id: string
  company_id: string
  project_id: string
  encuesta_id: string
  unidad_id?: string | null
  nombre_respondente?: string | null
  respuestas: unknown
  created_at: string
  unidad_nombre?: string
}


// ━━ Fases 10-17: calendario, configuración, solicitudes, junta, comunicados ━━
// ── Phase 10: Calendario, Configuración ──────────────────────────────────────

export type TipoEvento = 'evento' | 'mantenimiento' | 'asamblea' | 'vencimiento' | 'recordatorio'
export interface EventoCalendario {
  id: string
  company_id: string
  project_id: string
  titulo: string
  descripcion?: string | null
  tipo: TipoEvento
  fecha_inicio: string
  hora_inicio?: string | null
  fecha_fin?: string | null
  hora_fin?: string | null
  recurrente: boolean
  frecuencia?: string | null
  color: string
  todo_el_dia: boolean
  created_by?: string | null
  created_at: string
}

export type TipoConfiguracion = 'texto' | 'numero' | 'booleano' | 'json' | 'texto_largo'
export interface ConfiguracionCondominio {
  id: string
  company_id: string
  project_id: string
  clave: string
  valor?: string | null
  tipo: TipoConfiguracion
  descripcion?: string | null
  updated_at: string
}

// ── Phase 11: Solicitudes, Junta, Préstamos, Comunicados ─────────────────────

export type TipoSolicitud = 'solvencia' | 'permiso_mudanza' | 'permiso_obra' | 'reclamo' | 'sugerencia' | 'certificado' | 'otro'
export type EstadoSolicitud = 'pendiente' | 'en_proceso' | 'resuelto' | 'rechazado'
export type PrioridadSolicitud = 'baja' | 'normal' | 'alta' | 'urgente'
export interface SolicitudResidente {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  tipo: TipoSolicitud
  descripcion: string
  estado: EstadoSolicitud
  respuesta?: string | null
  prioridad: PrioridadSolicitud
  atendido_por?: string | null
  fecha_limite?: string | null
  created_at: string
  unidad_nombre?: string
}

export type CargoJunta = 'presidente' | 'vicepresidente' | 'tesorero' | 'secretario' | 'vocal' | 'fiscal' | 'otro'
export interface MiembroJunta {
  id: string
  company_id: string
  project_id: string
  cargo: CargoJunta
  nombre: string
  unidad_id?: string | null
  telefono?: string | null
  email?: string | null
  periodo_inicio: string
  periodo_fin?: string | null
  activo: boolean
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}

export type EstadoPrestamo = 'prestado' | 'devuelto' | 'dañado' | 'perdido'
export interface PrestamoEquipo {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  equipo_nombre: string
  cantidad: number
  fecha_prestamo: string
  hora_prestamo?: string | null
  fecha_devolucion?: string | null
  hora_devolucion?: string | null
  estado: EstadoPrestamo
  deposito?: number | null
  deposito_pagado: boolean
  observaciones?: string | null
  entregado_por?: string | null
  recibido_por?: string | null
  created_at: string
  unidad_nombre?: string
}

export type TipoComunicado = 'carta' | 'circular' | 'aviso' | 'certificado' | 'acta'
export type DestinatarioComunicado = 'todos' | 'propietarios' | 'arrendatarios' | 'junta' | 'especifico'
export interface ComunicadoCondominio {
  id: string
  company_id: string
  project_id: string
  titulo: string
  contenido: string
  tipo: TipoComunicado
  destinatario: DestinatarioComunicado
  unidad_id?: string | null
  enviado_por?: string | null
  fecha_envio: string
  firmado: boolean
  created_at: string
  unidad_nombre?: string
}

export type TipoActa = 'ordinaria' | 'extraordinaria' | 'junta' | 'comite' | 'otro'
export interface ActaReunion {
  id: string
  company_id: string
  project_id: string
  titulo: string
  tipo: TipoActa
  fecha: string
  hora_inicio?: string | null
  hora_fin?: string | null
  lugar?: string | null
  quorum?: number | null
  quorum_requerido?: number | null
  asistentes: { nombre: string; unidad?: string; rol?: string }[]
  orden_del_dia: { punto: string; descripcion?: string; acuerdo?: string }[]
  acuerdos?: string | null
  observaciones?: string | null
  redactada_por?: string | null
  aprobada: boolean
  created_at: string
}

export interface CierreMensual {
  id: string
  company_id: string
  project_id: string
  periodo: string
  total_cuotas_emitidas: number
  total_cuotas_cobradas: number
  total_gastos: number
  saldo_periodo: number
  unidades_morosas: number
  notas?: string | null
  cerrado_por?: string | null
  estado: 'borrador' | 'cerrado'
  created_at: string
}

export type EventoNotificacion = 'cuota_pendiente' | 'cuota_morosa' | 'visita_registrada' | 'ticket_abierto' | 'ticket_resuelto' | 'reserva_confirmada' | 'alerta_activa' | 'solicitud_nueva'
export type CanalNotificacion = 'email' | 'whatsapp' | 'push' | 'sms'
export type DestinatarioNotificacion = 'admin' | 'residente' | 'ambos'
export interface ReglaNotificacion {
  id: string
  company_id: string
  project_id: string
  nombre: string
  evento: EventoNotificacion
  canal: CanalNotificacion
  destinatario: DestinatarioNotificacion
  dias_anticipacion: number
  activo: boolean
  mensaje_template?: string | null
  created_at: string
}

export interface MedidorUnidad {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  contador_id: string
  activo: boolean
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}

export type TipoVotacion = 'simple' | 'multiple' | 'ponderada'
export type EstadoVotacion = 'abierta' | 'cerrada' | 'anulada'
export interface OpcionVoto { id: string; texto: string }
export interface Votacion {
  id: string
  company_id: string
  project_id: string
  asamblea_id?: string | null
  titulo: string
  descripcion?: string | null
  tipo: TipoVotacion
  opciones: OpcionVoto[]
  estado: EstadoVotacion
  quorum_requerido?: number | null
  total_unidades?: number | null
  fecha_inicio: string
  fecha_cierre?: string | null
  resultado?: string | null
  created_at: string
}

export interface Voto {
  id: string
  company_id: string
  votacion_id: string
  unidad_id: string
  opcion_id: string
  comentario?: string | null
  registrado_por?: string | null
  created_at: string
  unidad_nombre?: string
}

export type EstadoSancion = 'pendiente' | 'pagado' | 'anulado' | 'apelado'
export interface SancionCondominio {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  infraccion_id?: string | null
  concepto: string
  monto: number
  fecha_emision: string
  fecha_vencimiento?: string | null
  estado: EstadoSancion
  observaciones?: string | null
  created_at: string
  unidad_nombre?: string
}

export type FrecuenciaMantenimiento = 'semanal' | 'quincenal' | 'mensual' | 'trimestral' | 'semestral' | 'anual'
export type EstadoEjecucion = 'completado' | 'parcial' | 'omitido'
export interface PlanMantenimiento {
  id: string
  company_id: string
  project_id: string
  equipo: string
  descripcion?: string | null
  frecuencia: FrecuenciaMantenimiento
  responsable?: string | null
  ultima_ejecucion?: string | null
  proxima_ejecucion?: string | null
  costo_estimado?: number | null
  activo: boolean
  created_at: string
}

export interface EjecucionMantenimiento {
  id: string
  company_id: string
  plan_id: string
  fecha: string
  realizado_por?: string | null
  costo_real?: number | null
  observaciones?: string | null
  estado: EstadoEjecucion
  created_at: string
}

// La correspondencia dejó de tener tabla y tipo propios en la migración
// 20260829000600: es una CLASE de `PiezaRecepcion` (types/condominios/seguridad).
// `CategoriaCorrespondencia` y `EstadoCorrespondencia` viven allí, junto al
// resto del vocabulario del motor de recepción.

export type TurnoNovedad = 'mañana' | 'tarde' | 'noche'
export interface LibroNovedad {
  id: string
  company_id: string
  project_id: string
  fecha: string
  turno: TurnoNovedad
  responsable: string
  hora_inicio?: string | null
  hora_fin?: string | null
  novedades: string
  incidentes: unknown[]
  firmado: boolean
  created_at: string
}

export type EstadoAcuerdo = 'pendiente' | 'en_proceso' | 'cumplido' | 'vencido' | 'cancelado'
export interface SeguimientoAcuerdo {
  id: string
  company_id: string
  project_id: string
  acta_id?: string | null
  titulo: string
  descripcion?: string | null
  responsable?: string | null
  fecha_limite?: string | null
  estado: EstadoAcuerdo
  notas_seguimiento?: string | null
  created_at: string
}

export type TipoVehiculo = 'auto' | 'moto' | 'camion' | 'otro'
export interface VehiculoResidente {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  placa: string
  marca?: string | null
  modelo?: string | null
  color?: string | null
  anio?: number | null
  tipo: TipoVehiculo
  activo: boolean
  notas?: string | null
  created_at: string
}

export type TipoEventoComunidad = 'cultural' | 'deportivo' | 'social' | 'informativo' | 'otro'
export type EstadoEventoComunidad = 'programado' | 'en_curso' | 'realizado' | 'cancelado'
export interface EventoComunidad {
  id: string
  company_id: string
  project_id: string
  titulo: string
  descripcion?: string | null
  tipo: TipoEventoComunidad
  fecha: string
  hora_inicio?: string | null
  hora_fin?: string | null
  lugar?: string | null
  capacidad_max?: number | null
  estado: EstadoEventoComunidad
  asistentes_real?: number | null
  costo_estimado?: number | null
  created_at: string
}

export interface RegistroAsistenteEvento {
  id: string
  company_id: string
  evento_id: string
  unidad_id: string
  nombre: string
  num_personas: number
  confirmado: boolean
  asistio?: boolean | null
  created_at: string
}

export interface CajaChica {
  id: string
  company_id: string
  project_id: string
  fecha_apertura: string
  monto_inicial: number
  responsable: string
  estado: 'abierta' | 'cerrada'
  fecha_cierre?: string | null
  cerrado_por?: string | null
  notas?: string | null
  created_at: string
}

export interface MovimientoCaja {
  id: string
  company_id: string
  caja_id: string
  tipo: 'ingreso' | 'egreso'
  concepto: string
  monto: number
  comprobante?: string | null
  fecha: string
  registrado_por?: string | null
  created_at: string
}

export type EstadoObra = 'planificada' | 'en_ejecucion' | 'completada' | 'pausada' | 'cancelada'
export interface ObraMejora {
  id: string
  company_id: string
  project_id: string
  titulo: string
  descripcion?: string | null
  area?: string | null
  contratista?: string | null
  monto_contrato?: number | null
  fecha_inicio?: string | null
  fecha_fin_estimada?: string | null
  fecha_fin_real?: string | null
  estado: EstadoObra
  progreso: number
  notas?: string | null
  created_at: string
}

export interface PlanPagoCond {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  concepto: string
  monto_total: number
  num_cuotas: number
  monto_cuota: number
  fecha_inicio: string
  estado: 'activo' | 'completado' | 'incumplido' | 'cancelado'
  notas?: string | null
  aprobado_por?: string | null
  created_at: string
}

export interface CuotaPlanPago {
  id: string
  company_id: string
  plan_id: string
  numero: number
  monto: number
  fecha_vencimiento: string
  pagado: boolean
  fecha_pago?: string | null
  comprobante?: string | null
  created_at: string
}

export type TipoAcceso = 'tarjeta' | 'codigo' | 'llave_digital' | 'biometrico'
export interface AccesoResidente {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  tipo: TipoAcceso
  identificador: string
  titular: string
  activo: boolean
  fecha_emision: string
  fecha_vencimiento?: string | null
  notas?: string | null
  created_at: string
}

export type EstadoGarantia = 'vigente' | 'vencida' | 'reclamada' | 'sin_garantia'
export interface GarantiaEquipo {
  id: string
  company_id: string
  project_id: string
  equipo: string
  area?: string | null
  numero_serie?: string | null
  proveedor?: string | null
  contacto_soporte?: string | null
  fecha_compra?: string | null
  fecha_vencimiento?: string | null
  monto_compra?: number | null
  estado: EstadoGarantia
  notas?: string | null
  created_at: string
}

export interface EntregaUnidad {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  tipo: 'entrega' | 'devolucion'
  fecha: string
  condicion_general: 'excelente' | 'buena' | 'regular' | 'deteriorada'
  inquilino?: string | null
  propietario?: string | null
  representante_admin?: string | null
  observaciones?: string | null
  inventario_items: unknown[]
  firmado_propietario: boolean
  firmado_inquilino: boolean
  created_at: string
}

export interface AvisoCobro {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  tipo: 'primer_aviso' | 'segundo_aviso' | 'ultimo_aviso' | 'notificacion_legal'
  monto_total: number
  detalle: unknown[]
  fecha_emision: string
  fecha_limite?: string | null
  estado: 'emitido' | 'entregado' | 'pagado' | 'anulado'
  enviado_por?: string | null
  notas?: string | null
  created_at: string
}

export interface BitacoraManto {
  id: string
  company_id: string
  project_id: string
  fecha: string
  turno: 'mañana' | 'tarde' | 'noche'
  responsable: string
  area?: string | null
  tareas: unknown[]
  observaciones?: string | null
  firmado: boolean
  created_at: string
}

export interface EvaluacionProveedor {
  id: string
  company_id: string
  project_id: string
  proveedor_id?: string | null
  nombre_proveedor: string
  calificacion: number
  puntualidad?: number | null
  calidad?: number | null
  precio?: number | null
  comentarios?: string | null
  evaluado_por?: string | null
  fecha: string
  created_at: string
}

export interface ReclamoCondominio {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  tipo: 'queja' | 'sugerencia' | 'reclamo_formal' | 'apelacion'
  asunto: string
  descripcion?: string | null
  prioridad: 'baja' | 'normal' | 'alta' | 'urgente'
  estado: 'recibido' | 'en_revision' | 'respondido' | 'cerrado' | 'escalado'
  respuesta_admin?: string | null
  respondido_por?: string | null
  fecha_respuesta?: string | null
  plazo_respuesta?: string | null
  anonimo: boolean
  created_at: string
}


// ━━ Fase 22: certificados, visitas frecuentes, reglamento, plagas ━━
// ── Fase 22 ──────────────────────────────────────────────────────────────────
export type TipoCertificado = 'solvencia' | 'residencia' | 'historial_pagos' | 'paz_y_salvo' | 'otro'
export type EstadoCertificado = 'pendiente' | 'en_proceso' | 'aprobado' | 'rechazado' | 'entregado'
export interface SolicitudCertificado {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  solicitante: string
  tipo: TipoCertificado
  motivo?: string | null
  estado: EstadoCertificado
  fecha_solicitud: string
  fecha_aprobacion?: string | null
  fecha_entrega?: string | null
  aprobado_por?: string | null
  observaciones?: string | null
  created_at: string
  // join
  unidad_nombre?: string
}

export type RelacionVisitaFrecuente = 'familiar' | 'empleado' | 'proveedor' | 'amigo' | 'otro'
export interface VisitaFrecuente {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  nombre: string
  identificacion?: string | null
  relacion: RelacionVisitaFrecuente
  telefono?: string | null
  placa_vehiculo?: string | null
  foto_url?: string | null
  dias_permitidos?: string[] | null
  hora_desde?: string | null
  hora_hasta?: string | null
  activo: boolean
  notas?: string | null
  created_at: string
  // join
  unidad_nombre?: string
}

export type CategoriaReglamento = 'convivencia' | 'pagos' | 'seguridad' | 'areas_comunes' | 'mascotas' | 'mudanzas' | 'otro'
export interface ArticuloReglamento {
  id: string
  company_id: string
  project_id: string
  capitulo: string
  numero_articulo: string
  titulo: string
  contenido: string
  categoria: CategoriaReglamento
  vigente: boolean
  version: string
  fecha_vigencia?: string | null
  notas?: string | null
  created_at: string
}

export type TipoControlPlagas = 'fumigacion' | 'inspeccion' | 'tratamiento' | 'preventivo'
export type ResultadoControlPlagas = 'satisfactorio' | 'con_observaciones' | 'requiere_seguimiento' | 'no_realizado'
export interface ControlPlagas {
  id: string
  company_id: string
  project_id: string
  tipo: TipoControlPlagas
  empresa?: string | null
  tecnico?: string | null
  areas: string[]
  productos?: string | null
  fecha: string
  hora_inicio?: string | null
  hora_fin?: string | null
  resultado: ResultadoControlPlagas
  proxima_visita?: string | null
  costo?: number | null
  observaciones?: string | null
  created_at: string
}

