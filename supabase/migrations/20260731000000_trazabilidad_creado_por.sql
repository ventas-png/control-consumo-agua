-- ============================================================================
-- Trazabilidad de usuario: quién creó la fila y quién la dio por hecha
-- ============================================================================
-- PROBLEMA. De las 234 tablas de `public`, solo 45 tienen alguna columna de
-- actor — y casi todas son de NEGOCIO (`aprobado_por`, `atendido_por`,
-- `responsable`), no "quién lo tecleó". Peor: a partir de condominios fase 8 esas
-- columnas dejaron de ser FK y pasaron a ser `text` escrito a mano
-- (20260420000013 `registrado_por text`, 20260420000019 `inspector text`,
-- 20260420000025 `operador text`…). Diez pestañas piden hoy al usuario que
-- escriba su propio nombre en un input.
--
-- El hueco es total en la operación diaria: `registros` (las lecturas de agua,
-- el núcleo del producto), `programacion_limpieza`, `bitacora_manto`,
-- `checklist_areas`, `visitas_control`, `paquetes_recibidos`… ninguna sabe quién
-- creó la fila. `tareas_bloque` ni siquiera sabe quién la marcó como hecha.
--
-- DISEÑO — tres conceptos, tres columnas. No se renombra ni se modifica ninguna
-- columna existente; solo se agrega:
--
--   creado_por       quién lo tecleó en el sistema   ← la BD, inmutable
--   <hito>_por       quién lo dio por hecho          ← la BD, al cruzar el hito
--   responsable /    a quién le corresponde el hecho ← el usuario, editable
--   tecnico /
--   guardia_id …
--
-- El supervisor abre una ronda a nombre del guardia Pérez: `guardia_id` = Pérez
-- (negocio) y `creado_por` = supervisor (realidad). Hoy solo existe el primero,
-- y miente.
--
-- POR QUÉ TRIGGER Y NO `DEFAULT auth.uid()`. El DEFAULT solo aplica cuando el
-- cliente OMITE la columna; si manda `creado_por: <otro-uuid>` gana el cliente.
-- El BEFORE INSERT la sobreescribe siempre → no falsificable desde el navegador.
-- El BEFORE UPDATE la congela → tampoco se puede reescribir después.
--
-- SIN CAMBIOS DE CÓDIGO. El sello lo pone Postgres con el JWT que ya viaja en
-- cada request: los ~296 callsites de las pestañas de condominios,
-- `createRegistro()` y el sync offline del outbox de lecturas no se tocan.
--
-- auth.uid() NULL = escritura de sistema (edge function con service-role,
-- pg_cron). Se deja NULL a propósito y la UI lo muestra como "Sistema".
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- sellar_actor(columna, modo) — sella quién CREÓ la fila.
-- ────────────────────────────────────────────────────────────────────────────
-- modo 'forzar'  : el valor del cliente se ignora siempre (default).
-- modo 'si_nulo' : solo rellena cuando el cliente no mandó nada. Se usa donde ya
--                  existe una columna con esta misma semántica y poblada por la
--                  UI (visitantes.registrado_por), para no cambiar su
--                  comportamiento actual.
--
-- SECURITY INVOKER a propósito: la función NO lee ni escribe tablas, solo
-- reescribe NEW. Sin privilegios elevados no hay superficie que endurecer.
CREATE OR REPLACE FUNCTION public.sellar_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_col  text := TG_ARGV[0];
  v_modo text := COALESCE(TG_ARGV[1], 'forzar');
  v_uid  uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL AND (v_modo = 'forzar' OR to_jsonb(NEW)->>v_col IS NULL) THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object(v_col, v_uid));
    END IF;
  ELSE
    -- INMUTABLE. Solo se reescribe si alguien intentó cambiarla, para no pagar
    -- el jsonb_populate_record en cada UPDATE normal.
    IF to_jsonb(NEW)->>v_col IS DISTINCT FROM to_jsonb(OLD)->>v_col THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object(v_col, to_jsonb(OLD)->>v_col));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sellar_actor() IS
  'Trigger BEFORE INSERT OR UPDATE: sella TG_ARGV[0] con auth.uid() al crear y la vuelve inmutable. TG_ARGV[1] = forzar | si_nulo.';

-- ────────────────────────────────────────────────────────────────────────────
-- sellar_cierre(columna_hito, columna_actor) — sella quién lo DIO POR HECHO.
-- ────────────────────────────────────────────────────────────────────────────
-- Una tarea de limpieza se CREA cuando se programa y se COMPLETA después, por
-- otra persona: `creado_por` no lo captura. Este trigger dispara solo en la
-- TRANSICIÓN a completado (NULL→valor para timestamps/fechas, false→true para
-- banderas) y sella quién la cruzó.
--
-- Si el hito se revierte (se "descompleta") el actor queda como estaba: el dato
-- dice quién lo marcó la última vez que efectivamente se marcó.
CREATE OR REPLACE FUNCTION public.sellar_cierre()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hito  text := TG_ARGV[0];
  v_actor text := TG_ARGV[1];
  v_uid   uuid := auth.uid();
  v_old   text := to_jsonb(OLD)->>v_hito;
  v_new   text := to_jsonb(NEW)->>v_hito;
BEGIN
  IF v_uid IS NOT NULL
     AND COALESCE(v_old, 'false') IN ('', 'false')
     AND COALESCE(v_new, 'false') NOT IN ('', 'false') THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(v_actor, v_uid));
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sellar_cierre() IS
  'Trigger BEFORE UPDATE: cuando TG_ARGV[0] (hito) pasa de vacío/false a un valor, sella TG_ARGV[1] con auth.uid().';

REVOKE EXECUTE ON FUNCTION public.sellar_actor()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sellar_cierre() FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- Catálogo de tablas operativas → columna `creado_por` + trigger
-- ────────────────────────────────────────────────────────────────────────────
-- Fuente de verdad en git. El test de cobertura
-- (supabase/tests/trazabilidad/) verifica que TODA tabla de esta lista terminó
-- con columna y trigger — protege contra un typo silencioso entre 88 entradas.
--
-- Quedan FUERA a propósito, por no ser actos de usuario o tener su propia
-- auditoría: audit_log, security_logs, permission_audit_log, rate_limit_log,
-- email_send_log, email_send_queue, notification_events, notifications_outbox,
-- broadcast_recipients, billing_sync_log, stripe_webhook_events,
-- platform_metrics_daily, los *_log de conciliación/generación, user_presence,
-- user_sessions, las tablas *_secrets y las de RBAC.
DO $$
DECLARE
  v_tablas text[] := ARRAY[
    -- Campo y medición (agua, gas, energía, calidad, residuos)
    'registros', 'rutas', 'ruta_ocurrencias', 'lecturas_medidor_gas',
    'contadores', 'medidores_unidad', 'registros_residuos',
    'fuentes_agua', 'consumo_energia_areas', 'facturas_energia',
    -- Limpieza y mantenimiento
    'programacion_limpieza', 'servicios_housekeeping', 'mantenimiento_cisterna',
    'mantenimiento_jardineria', 'bitacora_manto', 'planes_mantenimiento',
    'ejecuciones_mantenimiento', 'checklist_areas', 'control_plagas',
    'control_piscina', 'control_generador', 'control_sistema_incendio',
    'control_camaras_seguridad', 'incidencias_elevador', 'inspecciones_normativas',
    'equipos_comunes', 'prestamos_equipo', 'garantias_equipo',
    'suministros_condominio', 'movimientos_suministro', 'inventario_condominio',
    'obras_mejoras',
    -- Seguridad y accesos
    'rondas_seguridad', 'visitas_control', 'rutas_ronda', 'puntos_control_ruta',
    'visitas_frecuentes', 'estacionamiento_visita', 'accesos_residentes',
    'paquetes_recibidos', 'correspondencia_condominio', 'libro_novedades',
    'bitacora_guardia', 'novedades_seguridad', 'incidentes_seguridad',
    'registro_autoridades', 'llaves_condominio',
    -- Solicitudes y reportes de residentes
    'solicitudes_residente', 'solicitudes_concierge', 'solicitudes_certificado',
    'solicitud_mudanza_unidad', 'solicitud_renta_unidad', 'reclamos_condominio',
    'sugerencias_condominio', 'infracciones_condominio', 'sanciones_condominio',
    'tickets_mantenimiento', 'tareas_condominio', 'comentarios_ticket',
    -- Personal y turnos
    'personal_condominio', 'presencia_personal', 'bloques_turno', 'tareas_bloque',
    'revisiones_tarea', 'capacitacion_personal_cond', 'agenda_operativa',
    'programa_actividades',
    -- Padrón y activos de unidad
    'mascotas', 'vehiculos_residentes', 'bodegas_condominio', 'parqueos_condominio',
    'unidad_residentes', 'historial_residentes', 'entrega_unidades',
    'onboarding_residentes', 'huespedes_str', 'reservas_str',
    -- Dinero y documentos
    'gastos_condominio', 'caja_chica', 'movimientos_caja', 'ordenes_pago',
    'documentos_condominio',
    'actas_reunion', 'informes_mensuales', 'memoria_labores'
  ];
  v_t text;
BEGIN
  FOREACH v_t IN ARRAY v_tablas LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = v_t
    ) THEN
      RAISE NOTICE 'trazabilidad: omitida (no existe) %', v_t;
      CONTINUE;
    END IF;

    -- ADD COLUMN con default NULL no reescribe la tabla (PG >= 11): sin lock
    -- largo ni siquiera en `registros`.
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS creado_por uuid '
      'REFERENCES auth.users(id) ON DELETE SET NULL', v_t);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_sellar_creado_por ON public.%I', v_t);
    EXECUTE format(
      'CREATE TRIGGER trg_sellar_creado_por BEFORE INSERT OR UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.sellar_actor(%L, %L)',
      v_t, 'creado_por', 'forzar');

    EXECUTE format(
      'COMMENT ON COLUMN public.%I.creado_por IS %L', v_t,
      'Usuario que creó la fila. Lo sella la BD (trg_sellar_creado_por) y es inmutable. NULL = escritura de sistema.');
  END LOOP;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Tablas que YA tienen `created_by` uuid — se sella ESA, no se duplica
-- ────────────────────────────────────────────────────────────────────────────
-- registros_calidad, ordenes_compra y facturas_proveedor ya traen `created_by`
-- (uuid FK) con exactamente esta semántica. Agregarles `creado_por` dejaría dos
-- columnas para lo mismo y partiría el histórico en dos. Se les pone el mismo
-- trigger sobre la columna existente, en modo 'forzar'.
DO $$
DECLARE
  v_t text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['registros_calidad', 'ordenes_compra', 'facturas_proveedor'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v_t AND column_name = 'created_by'
    ) THEN
      RAISE NOTICE 'trazabilidad: % sin created_by, omitida', v_t;
      CONTINUE;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS trg_sellar_creado_por ON public.%I', v_t);
    EXECUTE format(
      'CREATE TRIGGER trg_sellar_creado_por BEFORE INSERT OR UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.sellar_actor(%L, %L)',
      v_t, 'created_by', 'forzar');
  END LOOP;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- visitantes.registrado_por — caso aparte
-- ────────────────────────────────────────────────────────────────────────────
-- Ya es `uuid` FK y ya significa exactamente "quién lo registró en caseta"; dos
-- de las entradas la pueblan (VisitantesTab, SeguridadTab) y el resto (StrModal,
-- MudanzaModal, portal) la dejan NULL. Agregar `creado_por` aquí sería tener dos
-- columnas con el mismo significado, así que se sella LA EXISTENTE en modo
-- 'si_nulo': se rellena sola donde falta, sin pisar lo que ya manda la UI.
DROP TRIGGER IF EXISTS trg_sellar_creado_por ON public.visitantes;
CREATE TRIGGER trg_sellar_creado_por
  BEFORE INSERT OR UPDATE ON public.visitantes
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('registrado_por', 'si_nulo');

COMMENT ON COLUMN public.visitantes.registrado_por IS
  'Usuario que registró la visita. La BD lo rellena cuando la UI no lo manda (trg_sellar_creado_por, modo si_nulo) y luego es inmutable.';

-- ────────────────────────────────────────────────────────────────────────────
-- Sellos de cierre: quién lo dio por hecho
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  -- (tabla, columna_hito, columna_actor_nueva)
  v_pares text[][] := ARRAY[
    ['tareas_bloque',          'completado_en',   'completado_por'],
    ['ruta_ocurrencias',       'completada_at',   'completada_por'],
    ['rutas',                  'completada',      'completada_por'],
    ['visitas_control',        'visitado_en',     'visitado_por'],
    ['visitantes',             'hora_salida',     'salida_registrada_por'],
    ['programacion_limpieza',  'ultima_ejecucion','ejecutado_por'],
    ['paquetes_recibidos',     'hora_entrega',    'entrega_registrada_por'],
    ['tareas_condominio',      'fecha_cierre',    'cerrado_por'],
    ['libro_novedades',        'firmado',         'firmado_por'],
    ['bitacora_manto',         'firmado',         'firmado_por'],
    ['reclamos_condominio',    'fecha_respuesta', 'respuesta_sellada_por'],
    ['sugerencias_condominio', 'fecha_respuesta', 'respuesta_sellada_por']
  ];
  i int;
  v_tabla text; v_hito text; v_actor text;
BEGIN
  FOR i IN 1..array_length(v_pares, 1) LOOP
    v_tabla := v_pares[i][1]; v_hito := v_pares[i][2]; v_actor := v_pares[i][3];

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v_tabla AND column_name = v_hito
    ) THEN
      RAISE NOTICE 'trazabilidad: hito inexistente %.%', v_tabla, v_hito;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS %I uuid '
      'REFERENCES auth.users(id) ON DELETE SET NULL', v_tabla, v_actor);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_sellar_cierre ON public.%I', v_tabla);
    EXECUTE format(
      'CREATE TRIGGER trg_sellar_cierre BEFORE UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.sellar_cierre(%L, %L)',
      v_tabla, v_hito, v_actor);

    EXECUTE format('COMMENT ON COLUMN public.%I.%I IS %L', v_tabla, v_actor,
      format('Usuario que marcó %s. Lo sella la BD (trg_sellar_cierre).', v_hito));
  END LOOP;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Índices — solo donde el volumen lo justifica
-- ────────────────────────────────────────────────────────────────────────────
-- Sirven a "qué hizo este usuario" (panel de actividad) sin cargar el resto de
-- tablas con un índice que nadie consulta. Mismo patrón que idx_audit_log_actor.
--
-- Van en un DO guardado, igual que los bloques de arriba: si una tabla no
-- existe en el entorno donde corre la migración, se omite en vez de abortar el
-- deploy entero por un índice accesorio.
DO $$
DECLARE
  -- (índice, tabla, columna_actor, columna_orden)
  v_idx text[][] := ARRAY[
    ['idx_registros_creado_por',          'registros',          'creado_por',     'fecha'],
    ['idx_visitantes_registrado_por',     'visitantes',         'registrado_por', 'created_at'],
    ['idx_visitas_control_visitado_por',  'visitas_control',    'visitado_por',   'visitado_en'],
    ['idx_tareas_bloque_completado_por',  'tareas_bloque',      'completado_por', 'completado_en'],
    ['idx_paquetes_recibidos_creado_por', 'paquetes_recibidos', 'creado_por',     'created_at']
  ];
  i int;
BEGIN
  FOR i IN 1..array_length(v_idx, 1) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v_idx[i][2]
        AND column_name = v_idx[i][3]
    ) THEN
      RAISE NOTICE 'trazabilidad: índice % omitido (sin %.%)', v_idx[i][1], v_idx[i][2], v_idx[i][3];
      CONTINUE;
    END IF;
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I(%I, %I DESC) WHERE %I IS NOT NULL',
      v_idx[i][1], v_idx[i][2], v_idx[i][3], v_idx[i][4], v_idx[i][3]);
  END LOOP;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Backfill
-- ────────────────────────────────────────────────────────────────────────────
-- Solo donde hay evidencia REAL: audit_log ya guardó actor_id del INSERT
-- original de las tablas que tienen trigger de auditoría desde 20260528000000.
-- Para el resto `creado_por` queda NULL y la UI lo muestra como "—" en vez de
-- inventar un responsable. Se hace con la fila de audit_log más antigua
-- (action='INSERT') de cada record_id.
--
-- El trigger de sellado es BEFORE UPDATE e inmutabiliza la columna, así que el
-- backfill se hace con el trigger deshabilitado en la sesión de la migración.
DO $$
DECLARE
  v_t text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['gastos_condominio', 'tickets_mantenimiento'] LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER trg_sellar_creado_por', v_t);
    EXECUTE format($f$
      UPDATE public.%I t
         SET creado_por = a.actor_id
        FROM (
          SELECT DISTINCT ON (record_id) record_id, actor_id
            FROM public.audit_log
           WHERE table_name = %L AND action = 'INSERT' AND actor_id IS NOT NULL
           ORDER BY record_id, occurred_at ASC
        ) a
       WHERE a.record_id = t.id AND t.creado_por IS NULL
    $f$, v_t, v_t);
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER trg_sellar_creado_por', v_t);
  END LOOP;
END;
$$;
