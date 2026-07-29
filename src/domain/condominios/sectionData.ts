// domain/condominios/sectionData.ts — Loader de datos del panel admin de
// Condominios (CondominiosSection). T7/PR3: baja el acceso directo a Supabase
// (un Promise.all gigante de ~141 tablas, en 5 batches por dependencias/tamaño)
// a la capa domain. Cada función devuelve el arreglo de resultados crudo; la UI
// destructura igual que antes y mantiene su parseo/mapeo (joins → campos planos)
// y casts. Tipos de retorno inferidos (PostgrestResponse[]) para no fabricar 141
// interfaces; el objetivo es relocalizar el acceso, no re-tipar las filas.
// P2 tipos: usa el cliente tipado `db` — tablas, columnas de filtro/orden y
// embeds (`unidades(nombre)`, etc.) se chequean contra el esquema generado.
// EXCEPCIÓN: 4 selects siguen en `supabase` (sin tipar) porque la UI castea su
// columna Json (opciones/items/novedades/comentarios) a interfaces manuales y
// tipar aquí rompería CondominiosSection.tsx (fuera del alcance de este PR).
import { supabase, db } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'

// Fase 6 — cuotas SIN truncar: el .limit(5000) anterior era una "salvaguarda
// interina" que en condominios grandes truncaba en silencio los totales de
// CuotasTab, el snapshot de HistorialSaldos y la mora masiva (este arreglo los
// alimenta a todos vía ctx.cuotas). Se trae el set COMPLETO paginando por
// chunks con orden total (created_at desc + id) — cada ventana es chica, así
// que el statement_timeout que motivó el cap ya no es riesgo. Devuelve el
// shape { data, error } que el Promise.all posicional del componente espera.
async function fetchAllCuotas(pid: string, cid: string) {
  const { data, error, truncated } = await fetchAllRows((from, to) =>
    db.from('cuotas_condominio')
      .select('*, unidades(nombre)')
      .eq('project_id', pid)
      .eq('company_id', cid)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  )
  if (truncated) {
    console.warn(`[condominios] cuotas cortadas en el techo de seguridad (${data.length}) — totales incompletos`)
  }
  return { data: error ? null : data, error: error ? { message: error } : null }
}

/**
 * Fase PANEL del loader (P2 perf): SOLO las 9 colecciones que consume el tab por
 * defecto (PanelGeneralTab: cuotas, visitantes, amenidades, reservas, tickets,
 * paquetes, pólizas, inspecciones, gastos). Abrir Condominios pasa de ~141
 * queries a 9; el resto se carga al activar el primer tab distinto de Panel
 * (fetchCondominiosSectionData, sin cambios). Cada select ESPEJA 1:1 su entrada
 * del batch grande (mismos filtros/orden/límites) — mantener sincronizados.
 */
export async function fetchCondominiosPanelData(pid: string, cid: string) {
  return Promise.all([
    fetchAllCuotas(pid, cid), // Fase 6: completo por chunks (antes .limit(5000) truncaba totales)
    db.from('visitantes').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('hora_entrada', { ascending: false }).limit(200),
    db.from('amenidades').select('*').eq('project_id', pid).eq('company_id', cid).order('nombre'),
    db.from('reservas_amenidades').select('*, amenidades(nombre), unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).limit(200),
    db.from('tickets_mantenimiento').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).is('deleted_at', null).order('created_at', { ascending: false }).limit(300),
    db.from('paquetes_recibidos').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('hora_recepcion', { ascending: false }).limit(200),
    db.from('polizas_seguro').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_vencimiento'),
    db.from('inspecciones_normativas').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    db.from('gastos_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).limit(500),
  ])
}

/**
 * Batch grande: ~143 colecciones del condominio para (project, company). El orden
 * del arreglo DEBE coincidir con el destructuring del componente.
 */
export async function fetchCondominiosSectionData(pid: string, cid: string) {
  return Promise.all([
    // Fase 6 HECHA: cuotas completas por chunks (fetchAllCuotas). El arreglo
    // alimenta totales de CuotasTab, snapshot de HistorialSaldos y mora masiva
    // — con el .limit(5000) anterior esos números salían truncados en silencio.
    // (Mover los totales a agregados server-side sigue siendo la optimización
    // futura de perf; la CORRECTITUD ya no depende de ella.)
    fetchAllCuotas(pid, cid),
    db.from('visitantes').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('hora_entrada', { ascending: false }).limit(200),
    db.from('amenidades').select('*').eq('project_id', pid).eq('company_id', cid).order('nombre'),
    db.from('reservas_amenidades').select('*, amenidades(nombre), unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).limit(200),
    db.from('tickets_mantenimiento').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).is('deleted_at', null).order('created_at', { ascending: false }).limit(300),
    db.from('anuncios_comunidad').select('*, app_users(full_name)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    db.from('parqueos_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('numero'),
    db.from('mascotas').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('nombre'),
    db.from('paquetes_recibidos').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('hora_recepcion', { ascending: false }).limit(200),
    db.from('infracciones_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }).limit(300),
    db.from('rondas_seguridad').select('*').eq('project_id', pid).eq('company_id', cid).order('inicio', { ascending: false }).limit(100),
    db.from('novedades_seguridad').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }).limit(200),
    db.from('contratos_arrendamiento').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    db.from('asambleas').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    db.from('contratos_proveedores').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    db.from('objetos_perdidos').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_encontrado', { ascending: false }),
    db.from('agenda_operativa').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha').order('hora_inicio'),
    db.from('inventario_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('categoria').order('nombre'),
    db.from('polizas_seguro').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_vencimiento'),
    db.from('inspecciones_normativas').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    db.from('personal_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('cargo').order('nombre').limit(300),
    db.from('contactos_emergencia').select('*').eq('project_id', pid).eq('company_id', cid).order('orden').order('nombre'),
    db.from('documentos_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('categoria').order('titulo'),
    db.from('registros_residuos').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    db.from('bodegas_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('numero'),
    db.from('onboarding_residentes').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_ingreso', { ascending: false }),
    db.from('propuestas_inversion').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    db.from('memoria_labores').select('*').eq('project_id', pid).eq('company_id', cid).order('periodo', { ascending: false }),
    db.from('reservas_str').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_entrada', { ascending: false }),
    db.from('locales_comerciales').select('*').eq('project_id', pid).eq('company_id', cid).order('numero_local'),
    db.from('servicios_housekeeping').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    db.from('firmas_digitales').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }).limit(300),
    db.from('solicitudes_concierge').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_solicitud', { ascending: false }),
    db.from('llaves_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    db.from('encuestas').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    db.from('respuestas_encuesta').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    db.from('gastos_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).limit(500),
    db.from('presupuesto_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('anio', { ascending: false }),
    db.from('alertas_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_alerta'),
    db.from('eventos_calendario').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_inicio'),
    db.from('configuracion_condominio').select('*').eq('project_id', pid).eq('company_id', cid),
    db.from('solicitudes_residente').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }).limit(300),
    db.from('junta_directiva').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    db.from('prestamos_equipo').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_prestamo', { ascending: false }),
    db.from('comunicados_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_envio', { ascending: false }).limit(300),
    db.from('actas_reunion').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    db.from('cierres_mensuales').select('*').eq('project_id', pid).eq('company_id', cid).order('periodo', { ascending: false }),
    db.from('reglas_notificacion').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    db.from('medidores_unidad').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    // Sin tipar: la UI castea `opciones` (Json) a OpcionVoto[].
    supabase.from('votaciones').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_inicio', { ascending: false }),
    db.from('sanciones_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_emision', { ascending: false }).limit(300),
    db.from('planes_mantenimiento').select('*').eq('project_id', pid).eq('company_id', cid).order('proxima_ejecucion'),
    db.from('correspondencia_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).limit(300),
    db.from('libro_novedades').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).order('turno'),
    db.from('seguimiento_acuerdos').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_limite'),
    db.from('vehiculos_residentes').select('*').eq('project_id', pid).eq('company_id', cid).order('placa'),
    db.from('eventos_comunidad').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    // PR-27: las 5 tablas hijas marcadas abajo no TENÍAN `project_id` — por eso
    // filtraban solo por empresa mientras las otras ~135 de este batch filtraban
    // por ambas. La migración 20260729000600 añade la columna (derivada del
    // padre por trigger, no del cliente) y aquí se cierra el filtro.
    db.from('registro_asistentes_evento').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    db.from('caja_chica').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_apertura', { ascending: false }),
    db.from('movimientos_caja').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    db.from('obras_mejoras').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    db.from('planes_pago_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    db.from('cuotas_plan_pago').select('*').eq('project_id', pid).eq('company_id', cid).order('numero'),
    db.from('accesos_residentes').select('*').eq('project_id', pid).eq('company_id', cid).order('titular'),
    db.from('garantias_equipo').select('*').eq('project_id', pid).eq('company_id', cid).order('equipo'),
    db.from('entrega_unidades').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    db.from('avisos_cobro').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_emision', { ascending: false }).limit(500),
    db.from('bitacora_manto').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).limit(500),
    db.from('evaluaciones_proveedor').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    db.from('reclamos_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    db.from('fondo_reserva_condominio').select('*').eq('project_id', pid).eq('company_id', cid).is('deleted_at', null).order('fecha', { ascending: false }),
    db.from('permisos_obra_unidad').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    db.from('tarifas_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('concepto'),
    db.from('incidentes_seguridad').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    // Sin tipar: la UI castea `items` (Json) a ChecklistItem[].
    supabase.from('checklist_areas').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    db.from('programacion_limpieza').select('*').eq('project_id', pid).eq('company_id', cid).order('area'),
    db.from('consumo_energia_areas').select('*').eq('project_id', pid).eq('company_id', cid).order('periodo', { ascending: false }).order('area'),
    db.from('historial_residentes').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_desde', { ascending: false }),
    db.from('estacionamiento_visita').select('*').eq('project_id', pid).eq('company_id', cid).order('hora_entrada', { ascending: false }).limit(500),
    // Sin tipar: la UI castea `novedades` (Json) a NovedadGuardia[].
    supabase.from('bitacora_guardia').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).order('turno'),
    db.from('equipos_comunes').select('*').eq('project_id', pid).eq('company_id', cid).order('categoria').order('nombre'),
    db.from('presencia_personal').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).order('nombre'),
    db.from('suministros_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('categoria').order('nombre'),
    db.from('movimientos_suministro').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).limit(500),
    // Sin tipar: la UI castea `comentarios` (Json) a ComentarioTarea[].
    supabase.from('tareas_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_limite').order('created_at', { ascending: false }),
    db.from('gestion_cobranza').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }).limit(500),
    db.from('solicitudes_certificado').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_solicitud', { ascending: false }),
    db.from('visitas_frecuentes').select('*').eq('project_id', pid).eq('company_id', cid).order('nombre'),
    db.from('reglamento_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('capitulo').order('numero_articulo'),
    db.from('control_plagas').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    db.from('cargos_adicionales_unidad').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_cargo', { ascending: false }).limit(500),
    db.from('programa_actividades').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_inicio', { ascending: false }),
    db.from('registro_autoridades').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    db.from('notas_admin').select('*').eq('project_id', pid).eq('company_id', cid).order('fijada', { ascending: false }).order('created_at', { ascending: false }),
    db.from('control_piscina').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).order('hora', { ascending: false }).limit(500),
    db.from('mantenimiento_jardineria').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    db.from('incidencias_elevador').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    db.from('mantenimiento_cisterna').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    db.from('control_generador').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    db.from('control_sistema_incendio').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    db.from('control_camaras_seguridad').select('*').eq('project_id', pid).eq('company_id', cid).order('nombre'),
    db.from('lecturas_medidor_gas').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    // Fase 28
    db.from('recordatorios_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_limite'),
    db.from('plantillas_cuota').select('*').eq('project_id', pid).eq('company_id', cid).order('nombre'),
    // PR-26 (auditoría 2026-07-28): faltaba el filtro por proyecto. La tabla SÍ
    // tiene `project_id` —confirmado en los tipos generados— y todas sus hermanas
    // de este mismo batch lo filtran; solo ésta se quedó sin él. En un tenant con
    // varios condominios, la bitácora de cada proyecto mostraba las acciones de
    // todos: no es fuga cross-tenant (el company_id acota), pero sí mezcla
    // proyectos dentro de la empresa.
    db.from('bitacora_acciones').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }).limit(500),
    // Fase 29
    db.from('recargos_mora').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_aplicacion', { ascending: false }).limit(500),
    db.from('convenios_cuota_cond').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    db.from('historial_saldos_unidad').select('*').eq('project_id', pid).eq('company_id', cid).order('periodo', { ascending: false }).limit(500),
    db.from('notificaciones_enviadas').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_envio', { ascending: false }).limit(500),
    // Fase 30
    db.from('reglas_mora_config').select('*').eq('project_id', pid).eq('company_id', cid).order('dias_vencimiento'),
    db.from('campanas_cobro').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    db.from('cierres_anuales').select('*').eq('project_id', pid).eq('company_id', cid).order('anio', { ascending: false }),
    // Fase 31
    db.from('cobranza_judicial').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    db.from('recibos_digitales').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_emision', { ascending: false }).limit(500),
    db.from('informes_mensuales').select('*').eq('project_id', pid).eq('company_id', cid).order('periodo', { ascending: false }),
    db.from('sugerencias_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    // Fase 32
    db.from('vencimientos_extra').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_vencimiento'),
    db.from('capacitacion_personal_cond').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_inicio', { ascending: false }),
    db.from('proyectos_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    // Fase 33
    db.from('manual_residente_cond').select('*').eq('project_id', pid).eq('company_id', cid).order('orden').order('titulo'),
    // Fase 34
    db.from('automatizaciones_cond').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    // Fase 35
    db.from('plantillas_mensaje_cond').select('*').eq('project_id', pid).eq('company_id', cid).order('nombre'),
    db.from('flujo_aprobacion_cond').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_solicitud', { ascending: false }),
    // Fase 37
    db.from('ordenes_compra').select('*').eq('project_id', pid).eq('company_id', cid).order('correlativo', { ascending: false }),
    db.from('asambleas_digital').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_hora', { ascending: false }),
    // Fase 38
    db.from('proformas_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    // Fase 39
    db.from('conciliacion_cobros_log').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
    // Fase 43
    db.from('fondo_reserva').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).limit(500),
    db.from('config_condominio').select('*').eq('project_id', pid).eq('company_id', cid).maybeSingle(),
    db.from('solicitud_renta_unidad').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }).limit(300),
    db.from('solicitud_mudanza_unidad').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }).limit(300),
  ])
}

/** Fase 57 — Rutas de ronda (separado para no exceder el tamaño del Promise.all). */
export async function fetchCondominiosRondasData(pid: string, cid: string) {
  return Promise.all([
    db.from('areas_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('orden').order('nombre'),
    db.from('rutas_ronda').select('*').eq('project_id', pid).eq('company_id', cid).order('nombre'),
    // PR-27 (auditoría 2026-07-28): faltaba el `!inner`. En PostgREST, filtrar
    // por una columna EMBEBIDA no filtra las filas de arriba salvo que el embed
    // sea inner — sin él, `.eq('areas_condominio.project_id', pid)` solo anula
    // el embed de las que no casan y devuelve igual TODOS los puntos de control.
    // La tabla no tiene project_id NI company_id propios (se acota vía la RLS de
    // `rutas_ronda`, que es por empresa, no por proyecto), así que el embed era
    // el único filtro de proyecto que había — y no filtraba nada.
    db.from('puntos_control_ruta').select('*, areas_condominio!inner(nombre, icono)').eq('areas_condominio.project_id', pid).order('orden'),
    db.from('amenidades_bloqueos').select('*, amenidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_inicio', { ascending: false }),
  ])
}

/** Visitas de control de las rondas (últimos 30 días, cap 500). */
export async function fetchVisitasControlRecent() {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
  return db
    .from('visitas_control')
    .select('*, puntos_control_ruta(orden, instrucciones, areas_condominio(nombre, icono))')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500)
}

/** Fase 58 — Tareas operativas: plantillas por cargo + bloques de turno. */
export async function fetchCondominiosTareasData(pid: string, cid: string) {
  return Promise.all([
    db.from('plantillas_tarea_cargo').select('*, areas_condominio(nombre)').eq('project_id', pid).eq('company_id', cid).order('cargo').order('orden'),
    db.from('bloques_turno').select('*, personal_condominio(nombre, cargo)').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).order('created_at', { ascending: false }).limit(200),
  ])
}

/** Tareas + revisiones de un conjunto de bloques de turno. */
export async function fetchTareasBloqueData(bloqueIds: string[]) {
  return Promise.all([
    db.from('tareas_bloque').select('*, areas_condominio(nombre, icono)').in('bloque_id', bloqueIds).order('orden'),
    db.from('revisiones_tarea').select('*').in('bloque_id', bloqueIds).order('revisado_en', { ascending: false }),
  ])
}

/** Clientes (de las unidades del proyecto) con fecha de nacimiento — calendario de cumpleaños. */
export async function fetchClientesConCumple(clienteIds: string[]) {
  return db
    .from('clientes')
    .select('id, nombre, fecha_nacimiento')
    .in('id', clienteIds)
    .not('fecha_nacimiento', 'is', null)
}
