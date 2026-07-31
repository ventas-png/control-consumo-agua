-- ============================================================================
-- Encender `bitacora_acciones`: la pestaña existe y siempre sale vacía
-- ============================================================================
-- PROBLEMA. La tabla `bitacora_acciones` se creó en 20260420000028, la pestaña
-- "Bitácora" 🔎 existe (tabRegistry.tsx → BitacoraAccionesTab.tsx, con filtros
-- por usuario/módulo/acción y KPIs ya implementados) y la consulta existe
-- (sectionData.ts). Pero NINGÚN código escribe en ella: la pestaña siempre sale
-- vacía. Esta migración la alimenta desde la BD, sin tocar una línea de UI.
--
-- RELACIÓN CON audit_log. No se solapan:
--   audit_log            forense: row completo before/after, 5 tablas de dinero,
--                        incluye escrituras de sistema. Para investigar un
--                        incidente.
--   bitacora_acciones    línea de tiempo LEGIBLE para el administrador del
--                        condominio: quién hizo qué, en qué módulo, sobre qué
--                        registro. Solo acciones de USUARIO.
--
-- POR QUÉ SOLO ACCIONES DE USUARIO (auth.uid() IS NOT NULL). Los procesos
-- automáticos (pg_cron de mora, recordatorios, cierre de ciclo por lote) tocan
-- miles de filas por corrida; meterlas aquí inundaría la bitácora y la volvería
-- inútil justo para lo que sirve. Esas quedan cubiertas por audit_log y por
-- cron.job_run_details.
--
-- NUNCA ROMPE LA ESCRITURA. El trigger es AFTER y todo su cuerpo va envuelto en
-- EXCEPTION WHEN OTHERS: si la bitácora falla (FK, company_id irresoluble,
-- lo que sea), la lectura/ronda/limpieza que el usuario estaba guardando se
-- guarda igual. Un log que tumba la operación es peor que no tener log.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- registrar_bitacora(modulo, cols_desc [, tabla_padre, col_fk])
-- ────────────────────────────────────────────────────────────────────────────
--   TG_ARGV[0]  módulo legible que se muestra en la pestaña ('Limpieza', 'Agua'…)
--   TG_ARGV[1]  columnas candidatas para `entidad_desc`, separadas por coma; se
--               usa la primera no nula (ej. 'titulo,nombre,area,asunto').
--   TG_ARGV[2]  (opcional) tabla padre para resolver company_id/project_id en
--               tablas hijas que no los tienen (visitas_control → rondas_seguridad).
--   TG_ARGV[3]  (opcional) columna FK hacia esa tabla padre.
--
-- SECURITY DEFINER: `bitacora_acciones` tiene RLS y ninguna policy de INSERT
-- para clientes (a propósito: nadie debe poder escribir su propia bitácora).
CREATE OR REPLACE FUNCTION public.registrar_bitacora()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_modulo   text := TG_ARGV[0];
  v_cols     text[] := string_to_array(COALESCE(TG_ARGV[1], ''), ',');
  v_padre    text := NULLIF(TG_ARGV[2], '');
  v_col_fk   text := NULLIF(TG_ARGV[3], '');
  v_uid      uuid := auth.uid();
  v_row      jsonb;
  v_before   jsonb;
  v_accion   text;
  v_estado   text;
  v_desc     text;
  v_col      text;
  v_company  uuid;
  v_project  uuid;
  v_nombre   text;
  v_usuario  uuid;
  v_detalles jsonb;
  v_fk       uuid;
  v_cambios  jsonb := '{}'::jsonb;
  v_k        text;
BEGIN
  -- Solo acciones de usuario (ver cabecera).
  IF v_uid IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_row    := to_jsonb(COALESCE(NEW, OLD));
  v_before := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;

  -- ── acción ───────────────────────────────────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    v_accion := 'crear';
  ELSIF TG_OP = 'DELETE' THEN
    v_accion := 'eliminar';
  ELSE
    -- Soft delete: el UPDATE que marca deleted_at es, para el usuario, un borrado.
    IF v_before ? 'deleted_at'
       AND v_before->>'deleted_at' IS NULL
       AND v_row->>'deleted_at' IS NOT NULL THEN
      v_accion := 'eliminar';
    ELSE
      v_estado := lower(COALESCE(v_row->>'estado', ''));
      IF v_row->>'estado' IS DISTINCT FROM v_before->>'estado' THEN
        v_accion := CASE
          WHEN v_estado IN ('pagado', 'pagada')                                    THEN 'pagar'
          WHEN v_estado IN ('aprobado', 'aprobada', 'autorizado', 'autorizada')    THEN 'aprobar'
          WHEN v_estado IN ('rechazado', 'rechazada', 'denegado', 'denegada')      THEN 'rechazar'
          WHEN v_estado IN ('cerrado', 'cerrada', 'completado', 'completada',
                            'finalizado', 'finalizada', 'resuelto', 'resuelta')    THEN 'cerrar'
          ELSE 'editar'
        END;
      ELSE
        v_accion := 'editar';
      END IF;
    END IF;
  END IF;

  -- ── scope (company_id es NOT NULL en la tabla: sin él no se registra) ────
  v_company := NULLIF(v_row->>'company_id', '')::uuid;
  v_project := NULLIF(v_row->>'project_id', '')::uuid;

  IF (v_company IS NULL OR v_project IS NULL) AND v_padre IS NOT NULL AND v_col_fk IS NOT NULL THEN
    v_fk := NULLIF(v_row->>v_col_fk, '')::uuid;
    IF v_fk IS NOT NULL THEN
      EXECUTE format(
        'SELECT company_id, project_id FROM public.%I WHERE id = $1', v_padre)
        INTO v_company, v_project USING v_fk;
    END IF;
  END IF;

  IF v_company IS NULL AND v_project IS NOT NULL THEN
    SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = v_project;
  END IF;

  IF v_company IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- ── quién ────────────────────────────────────────────────────────────────
  -- usuario_nombre se DESNORMALIZA: la bitácora debe seguir siendo legible
  -- aunque el usuario se borre después (usuario_id es ON DELETE SET NULL).
  SELECT au.id, au.full_name INTO v_usuario, v_nombre
    FROM public.app_users au WHERE au.id = v_uid;
  v_nombre := COALESCE(NULLIF(v_nombre, ''), 'Usuario ' || left(v_uid::text, 8));

  -- ── descripción legible del registro ─────────────────────────────────────
  FOREACH v_col IN ARRAY v_cols LOOP
    v_col := btrim(v_col);
    IF v_col <> '' AND v_row ? v_col AND NULLIF(v_row->>v_col, '') IS NOT NULL THEN
      v_desc := left(v_row->>v_col, 180);
      EXIT;
    END IF;
  END LOOP;

  -- ── detalles: solo las columnas que CAMBIARON ────────────────────────────
  -- Guardar el row completo (como audit_log) duplicaría el forense y haría
  -- crecer la tabla sin aportar: aquí interesa el delta legible.
  IF TG_OP = 'UPDATE' THEN
    FOR v_k IN SELECT jsonb_object_keys(v_row) LOOP
      IF v_row->v_k IS DISTINCT FROM v_before->v_k THEN
        v_cambios := v_cambios || jsonb_build_object(
          v_k, jsonb_build_object('antes', v_before->v_k, 'despues', v_row->v_k));
      END IF;
    END LOOP;
    v_detalles := CASE WHEN v_cambios = '{}'::jsonb THEN NULL ELSE v_cambios END;
  END IF;

  INSERT INTO public.bitacora_acciones (
    company_id, project_id, usuario_id, usuario_nombre,
    accion, modulo, entidad_id, entidad_desc, detalles
  ) VALUES (
    v_company, v_project, v_usuario, v_nombre,
    v_accion, v_modulo, NULLIF(v_row->>'id', '')::uuid, v_desc, v_detalles
  );

  RETURN COALESCE(NEW, OLD);

EXCEPTION WHEN OTHERS THEN
  -- Un fallo de bitácora JAMÁS puede tumbar la operación del usuario.
  RAISE WARNING 'registrar_bitacora(% / %) falló: %', TG_TABLE_NAME, TG_OP, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.registrar_bitacora() IS
  'Trigger AFTER: escribe la acción del usuario en bitacora_acciones. Ignora escrituras de sistema (auth.uid() NULL) y nunca aborta la operación original.';

REVOKE EXECUTE ON FUNCTION public.registrar_bitacora() FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- Catálogo: solo tablas de HECHOS
-- ────────────────────────────────────────────────────────────────────────────
-- La bitácora es una línea de tiempo legible, no un log de todo. Se dejan fuera
-- los catálogos y el padrón (áreas, tarifas, unidades, personal, mascotas…):
-- cambian poco, y meterlos solo generaría ruido y volumen. `creado_por` sí los
-- cubre a todos — ahí está el "quién" de cada fila.
DO $$
DECLARE
  -- (tabla, módulo, columnas para entidad_desc, tabla_padre, col_fk)
  v_cfg text[][] := ARRAY[
    -- Agua y medición
    ['registros',                'Agua',           'cliente_nombre,notas',              '', ''],
    ['rutas',                    'Rutas',          'nombre,descripcion',                '', ''],
    ['ruta_ocurrencias',         'Rutas',          'estado,fecha',                      'rutas', 'ruta_id'],
    ['lecturas_medidor_gas',     'Gas',            'observaciones,periodo,area',        '', ''],
    ['registros_calidad',        'Calidad',        'observaciones',                     '', ''],
    ['registros_residuos',       'Residuos',       'tipo_residuo,notas',                '', ''],
    -- Limpieza y mantenimiento
    ['programacion_limpieza',    'Limpieza',       'area,frecuencia',                   '', ''],
    ['servicios_housekeeping',   'Limpieza',       'tipo,notas',                        '', ''],
    ['bitacora_manto',           'Mantenimiento',  'area,turno',                        '', ''],
    ['checklist_areas',          'Limpieza',       'area,notas',                        '', ''],
    ['mantenimiento_cisterna',   'Mantenimiento',  'cisterna,tipo',                     '', ''],
    ['mantenimiento_jardineria', 'Mantenimiento',  'tipo,areas',                        '', ''],
    ['control_plagas',           'Mantenimiento',  'tipo,areas',                        '', ''],
    ['control_piscina',          'Mantenimiento',  'observaciones',                     '', ''],
    ['control_generador',        'Mantenimiento',  'tipo,observaciones',                '', ''],
    ['ejecuciones_mantenimiento','Mantenimiento',  'observaciones,estado',              '', ''],
    ['incidencias_elevador',     'Mantenimiento',  'descripcion,tipo',                  '', ''],
    ['inspecciones_normativas',  'Mantenimiento',  'tipo,entidad_inspectora',           '', ''],
    ['movimientos_suministro',   'Suministros',    'tipo,notas',                        '', ''],
    ['obras_mejoras',            'Obras',          'titulo,descripcion',                '', ''],
    -- Seguridad y accesos
    ['rondas_seguridad',         'Seguridad',      'notas,estado',                      '', ''],
    ['visitas_control',          'Seguridad',      'estado,notas',                      'rondas_seguridad', 'ronda_id'],
    ['visitantes',               'Visitas',        'nombre,motivo',                     '', ''],
    ['paquetes_recibidos',       'Paquetes',       'descripcion,remitente',             '', ''],
    ['correspondencia_condominio','Correspondencia','asunto,remitente',                 '', ''],
    ['libro_novedades',          'Seguridad',      'novedades,turno',                   '', ''],
    ['bitacora_guardia',         'Seguridad',      'novedades,turno',                   '', ''],
    ['novedades_seguridad',      'Seguridad',      'descripcion,tipo',                  '', ''],
    ['incidentes_seguridad',     'Seguridad',      'descripcion,tipo',                  '', ''],
    -- Solicitudes, reclamos y tareas
    ['solicitudes_residente',    'Solicitudes',    'descripcion,tipo',                  '', ''],
    ['solicitudes_concierge',    'Concierge',      'descripcion,tipo',                  '', ''],
    ['solicitudes_certificado',  'Solicitudes',    'tipo,motivo',                       '', ''],
    ['reclamos_condominio',      'Reclamos',       'asunto,descripcion',                '', ''],
    ['sugerencias_condominio',   'Sugerencias',    'titulo,descripcion',                '', ''],
    ['infracciones_condominio',  'Infracciones',   'descripcion,tipo',                  '', ''],
    ['tickets_mantenimiento',    'Tickets',        'titulo,descripcion',                '', ''],
    ['tareas_condominio',        'Tareas',         'titulo,descripcion',                '', ''],
    ['tareas_bloque',            'Tareas',         'titulo,descripcion',                'bloques_turno', 'bloque_id'],
    -- Personal
    ['presencia_personal',       'Personal',       'nombre,cargo',                      '', '']
  ];
  i int;
  v_tabla text; v_modulo text; v_desc text; v_padre text; v_fk text;
BEGIN
  FOR i IN 1..array_length(v_cfg, 1) LOOP
    v_tabla := v_cfg[i][1]; v_modulo := v_cfg[i][2]; v_desc := v_cfg[i][3];
    v_padre := v_cfg[i][4]; v_fk := v_cfg[i][5];

    IF NOT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = v_tabla
    ) THEN
      RAISE NOTICE 'bitácora: omitida (no existe) %', v_tabla;
      CONTINUE;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS trg_bitacora ON public.%I', v_tabla);
    EXECUTE format(
      'CREATE TRIGGER trg_bitacora AFTER INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.registrar_bitacora(%L, %L, %L, %L)',
      v_tabla, v_modulo, v_desc, v_padre, v_fk);
  END LOOP;
END;
$$;

-- Índice para el filtro "qué hizo este usuario" de la pestaña y del panel de
-- actividad. Los de (company_id, created_at) ya existen desde fase 28.
CREATE INDEX IF NOT EXISTS idx_bitacora_acciones_usuario
  ON public.bitacora_acciones(usuario_id, created_at DESC)
  WHERE usuario_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bitacora_acciones_proyecto
  ON public.bitacora_acciones(project_id, created_at DESC)
  WHERE project_id IS NOT NULL;
