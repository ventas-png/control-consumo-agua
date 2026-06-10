// domain/condominios/sectionData.ts — Loader de datos del panel admin de
// Condominios (CondominiosSection). T7/PR3: baja el acceso directo a Supabase
// (un Promise.all gigante de ~141 tablas, en 5 batches por dependencias/tamaño)
// a la capa domain. Cada función devuelve el arreglo de resultados crudo; la UI
// destructura igual que antes y mantiene su parseo/mapeo (joins → campos planos)
// y casts. Tipos de retorno inferidos (PostgrestResponse[]) para no fabricar 141
// interfaces; el objetivo es relocalizar el acceso, no re-tipar las filas.
import { supabase } from '../../lib/supabase'

/**
 * Batch grande: ~143 colecciones del condominio para (project, company). El orden
 * del arreglo DEBE coincidir con el destructuring del componente.
 */
export async function fetchCondominiosSectionData(pid: string, cid: string) {
  return Promise.all([
    // limit(5000): salvaguarda interina contra truncado de totales/saldos en
    // condominios grandes (las cuotas crecen por-unidad por-mes y este arreglo
    // alimenta totales de CuotasTab, snapshot de HistorialSaldos y mora masiva).
    // TODO(Fase 6): mover los totales a agregados server-side / fetch por-tab.
    supabase.from('cuotas_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).is('deleted_at', null).order('created_at', { ascending: false }).limit(5000),
    supabase.from('visitantes').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('hora_entrada', { ascending: false }).limit(200),
    supabase.from('amenidades').select('*').eq('project_id', pid).eq('company_id', cid).order('nombre'),
    supabase.from('reservas_amenidades').select('*, amenidades(nombre), unidades(nombre)').eq('company_id', cid).order('fecha', { ascending: false }).limit(200),
    supabase.from('tickets_mantenimiento').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).is('deleted_at', null).order('created_at', { ascending: false }).limit(300),
    supabase.from('anuncios_comunidad').select('*, app_users(full_name)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    supabase.from('parqueos_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('numero'),
    supabase.from('mascotas').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('nombre'),
    supabase.from('paquetes_recibidos').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('hora_recepcion', { ascending: false }).limit(200),
    supabase.from('infracciones_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }).limit(300),
    supabase.from('rondas_seguridad').select('*').eq('project_id', pid).eq('company_id', cid).order('inicio', { ascending: false }).limit(100),
    supabase.from('novedades_seguridad').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }).limit(200),
    supabase.from('contratos_arrendamiento').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    supabase.from('asambleas').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    supabase.from('contratos_proveedores').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    supabase.from('objetos_perdidos').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_encontrado', { ascending: false }),
    supabase.from('agenda_operativa').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha').order('hora_inicio'),
    supabase.from('inventario_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('categoria').order('nombre'),
    supabase.from('polizas_seguro').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_vencimiento'),
    supabase.from('inspecciones_normativas').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    supabase.from('personal_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('cargo').order('nombre').limit(300),
    supabase.from('contactos_emergencia').select('*').eq('project_id', pid).eq('company_id', cid).order('orden').order('nombre'),
    supabase.from('documentos_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('categoria').order('titulo'),
    supabase.from('registros_residuos').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    supabase.from('bodegas_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('numero'),
    supabase.from('onboarding_residentes').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_ingreso', { ascending: false }),
    supabase.from('propuestas_inversion').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    supabase.from('memoria_labores').select('*').eq('project_id', pid).eq('company_id', cid).order('periodo', { ascending: false }),
    supabase.from('reservas_str').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_entrada', { ascending: false }),
    supabase.from('locales_comerciales').select('*').eq('project_id', pid).eq('company_id', cid).order('numero_local'),
    supabase.from('servicios_housekeeping').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    supabase.from('firmas_digitales').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }).limit(300),
    supabase.from('solicitudes_concierge').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_solicitud', { ascending: false }),
    supabase.from('llaves_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    supabase.from('encuestas').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    supabase.from('respuestas_encuesta').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    supabase.from('gastos_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).limit(500),
    supabase.from('presupuesto_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('anio', { ascending: false }),
    supabase.from('alertas_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_alerta'),
    supabase.from('eventos_calendario').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_inicio'),
    supabase.from('configuracion_condominio').select('*').eq('project_id', pid).eq('company_id', cid),
    supabase.from('solicitudes_residente').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }).limit(300),
    supabase.from('junta_directiva').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    supabase.from('prestamos_equipo').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_prestamo', { ascending: false }),
    supabase.from('comunicados_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_envio', { ascending: false }).limit(300),
    supabase.from('actas_reunion').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    supabase.from('cierres_mensuales').select('*').eq('project_id', pid).eq('company_id', cid).order('periodo', { ascending: false }),
    supabase.from('reglas_notificacion').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    supabase.from('medidores_unidad').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    supabase.from('votaciones').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_inicio', { ascending: false }),
    supabase.from('sanciones_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_emision', { ascending: false }).limit(300),
    supabase.from('planes_mantenimiento').select('*').eq('project_id', pid).eq('company_id', cid).order('proxima_ejecucion'),
    supabase.from('correspondencia_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).limit(300),
    supabase.from('libro_novedades').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).order('turno'),
    supabase.from('seguimiento_acuerdos').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_limite'),
    supabase.from('vehiculos_residentes').select('*').eq('project_id', pid).eq('company_id', cid).order('placa'),
    supabase.from('eventos_comunidad').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    supabase.from('registro_asistentes_evento').select('*').eq('company_id', cid).order('created_at', { ascending: false }),
    supabase.from('caja_chica').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_apertura', { ascending: false }),
    supabase.from('movimientos_caja').select('*').eq('company_id', cid).order('fecha', { ascending: false }),
    supabase.from('obras_mejoras').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    supabase.from('planes_pago_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    supabase.from('cuotas_plan_pago').select('*').eq('company_id', cid).order('numero'),
    supabase.from('accesos_residentes').select('*').eq('project_id', pid).eq('company_id', cid).order('titular'),
    supabase.from('garantias_equipo').select('*').eq('project_id', pid).eq('company_id', cid).order('equipo'),
    supabase.from('entrega_unidades').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    supabase.from('avisos_cobro').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_emision', { ascending: false }).limit(500),
    supabase.from('bitacora_manto').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).limit(500),
    supabase.from('evaluaciones_proveedor').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    supabase.from('reclamos_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    supabase.from('fondo_reserva_condominio').select('*').eq('project_id', pid).eq('company_id', cid).is('deleted_at', null).order('fecha', { ascending: false }),
    supabase.from('permisos_obra_unidad').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    supabase.from('tarifas_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('concepto'),
    supabase.from('incidentes_seguridad').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    supabase.from('checklist_areas').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    supabase.from('programacion_limpieza').select('*').eq('project_id', pid).eq('company_id', cid).order('area'),
    supabase.from('consumo_energia_areas').select('*').eq('project_id', pid).eq('company_id', cid).order('periodo', { ascending: false }).order('area'),
    supabase.from('historial_residentes').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_desde', { ascending: false }),
    supabase.from('estacionamiento_visita').select('*').eq('project_id', pid).eq('company_id', cid).order('hora_entrada', { ascending: false }).limit(500),
    supabase.from('bitacora_guardia').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).order('turno'),
    supabase.from('equipos_comunes').select('*').eq('project_id', pid).eq('company_id', cid).order('categoria').order('nombre'),
    supabase.from('presencia_personal').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).order('nombre'),
    supabase.from('suministros_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('categoria').order('nombre'),
    supabase.from('movimientos_suministro').select('*').eq('company_id', cid).order('fecha', { ascending: false }).limit(500),
    supabase.from('tareas_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_limite').order('created_at', { ascending: false }),
    supabase.from('gestion_cobranza').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }).limit(500),
    supabase.from('solicitudes_certificado').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_solicitud', { ascending: false }),
    supabase.from('visitas_frecuentes').select('*').eq('project_id', pid).eq('company_id', cid).order('nombre'),
    supabase.from('reglamento_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('capitulo').order('numero_articulo'),
    supabase.from('control_plagas').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    supabase.from('cargos_adicionales_unidad').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_cargo', { ascending: false }).limit(500),
    supabase.from('programa_actividades').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_inicio', { ascending: false }),
    supabase.from('registro_autoridades').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    supabase.from('notas_admin').select('*').eq('project_id', pid).eq('company_id', cid).order('fijada', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('control_piscina').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).order('hora', { ascending: false }).limit(500),
    supabase.from('mantenimiento_jardineria').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    supabase.from('incidencias_elevador').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    supabase.from('mantenimiento_cisterna').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    supabase.from('control_generador').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    supabase.from('control_sistema_incendio').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    supabase.from('control_camaras_seguridad').select('*').eq('project_id', pid).eq('company_id', cid).order('nombre'),
    supabase.from('lecturas_medidor_gas').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    // Fase 28
    supabase.from('recordatorios_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_limite'),
    supabase.from('plantillas_cuota').select('*').eq('project_id', pid).eq('company_id', cid).order('nombre'),
    supabase.from('bitacora_acciones').select('*').eq('company_id', cid).order('created_at', { ascending: false }).limit(500),
    // Fase 29
    supabase.from('recargos_mora').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_aplicacion', { ascending: false }).limit(500),
    supabase.from('convenios_cuota_cond').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    supabase.from('historial_saldos_unidad').select('*').eq('project_id', pid).eq('company_id', cid).order('periodo', { ascending: false }).limit(500),
    supabase.from('notificaciones_enviadas').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_envio', { ascending: false }).limit(500),
    // Fase 30
    supabase.from('reglas_mora_config').select('*').eq('project_id', pid).eq('company_id', cid).order('dias_vencimiento'),
    supabase.from('campanas_cobro').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    supabase.from('cierres_anuales').select('*').eq('project_id', pid).eq('company_id', cid).order('anio', { ascending: false }),
    // Fase 31
    supabase.from('cobranza_judicial').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    supabase.from('recibos_digitales').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_emision', { ascending: false }).limit(500),
    supabase.from('informes_mensuales').select('*').eq('project_id', pid).eq('company_id', cid).order('periodo', { ascending: false }),
    supabase.from('sugerencias_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    // Fase 32
    supabase.from('vencimientos_extra').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_vencimiento'),
    supabase.from('capacitacion_personal_cond').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_inicio', { ascending: false }),
    supabase.from('proyectos_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    // Fase 33
    supabase.from('manual_residente_cond').select('*').eq('project_id', pid).eq('company_id', cid).order('orden').order('titulo'),
    // Fase 34
    supabase.from('automatizaciones_cond').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    // Fase 35
    supabase.from('plantillas_mensaje_cond').select('*').eq('project_id', pid).eq('company_id', cid).order('nombre'),
    supabase.from('flujo_aprobacion_cond').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_solicitud', { ascending: false }),
    // Fase 37
    supabase.from('ordenes_compra').select('*').eq('project_id', pid).eq('company_id', cid).order('correlativo', { ascending: false }),
    supabase.from('asambleas_digital').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_hora', { ascending: false }),
    // Fase 38
    supabase.from('proformas_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    // Fase 39
    supabase.from('conciliacion_cobros_log').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    // Fase 43
    supabase.from('fondo_reserva').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).limit(500),
    supabase.from('config_condominio').select('*').eq('project_id', pid).eq('company_id', cid).maybeSingle(),
    supabase.from('solicitud_renta_unidad').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }).limit(300),
    supabase.from('solicitud_mudanza_unidad').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }).limit(300),
  ])
}

/** Fase 57 — Rutas de ronda (separado para no exceder el tamaño del Promise.all). */
export async function fetchCondominiosRondasData(pid: string, cid: string) {
  return Promise.all([
    supabase.from('areas_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('orden').order('nombre'),
    supabase.from('rutas_ronda').select('*').eq('project_id', pid).eq('company_id', cid).order('nombre'),
    supabase.from('puntos_control_ruta').select('*, areas_condominio(nombre, icono)').eq('areas_condominio.project_id', pid).order('orden'),
    supabase.from('amenidades_bloqueos').select('*, amenidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_inicio', { ascending: false }),
  ])
}

/** Visitas de control de las rondas (últimos 30 días, cap 500). */
export async function fetchVisitasControlRecent() {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
  return supabase
    .from('visitas_control')
    .select('*, puntos_control_ruta(orden, instrucciones, areas_condominio(nombre, icono))')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500)
}

/** Fase 58 — Tareas operativas: plantillas por cargo + bloques de turno. */
export async function fetchCondominiosTareasData(pid: string, cid: string) {
  return Promise.all([
    supabase.from('plantillas_tarea_cargo').select('*, areas_condominio(nombre)').eq('project_id', pid).eq('company_id', cid).order('cargo').order('orden'),
    supabase.from('bloques_turno').select('*, personal_condominio(nombre, cargo)').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).order('created_at', { ascending: false }).limit(200),
  ])
}

/** Tareas + revisiones de un conjunto de bloques de turno. */
export async function fetchTareasBloqueData(bloqueIds: string[]) {
  return Promise.all([
    supabase.from('tareas_bloque').select('*, areas_condominio(nombre, icono)').in('bloque_id', bloqueIds).order('orden'),
    supabase.from('revisiones_tarea').select('*').in('bloque_id', bloqueIds).order('revisado_en', { ascending: false }),
  ])
}

/** Clientes (de las unidades del proyecto) con fecha de nacimiento — calendario de cumpleaños. */
export async function fetchClientesConCumple(clienteIds: string[]) {
  return supabase
    .from('clientes')
    .select('id, nombre, fecha_nacimiento')
    .in('id', clienteIds)
    .not('fecha_nacimiento', 'is', null)
}
