-- Helpers de la suite (pg_temp: viven sólo en la sesión de psql que los crea).
\set ON_ERROR_STOP on

CREATE FUNCTION pg_temp.chk(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN
    RAISE EXCEPTION 'INVARIANTE: %', msg;
  END IF;
  RAISE NOTICE '✓ %', msg;
END $$;

-- Ejecuta y devuelve 'OK' o 'SQLSTATE mensaje'. Si falla, el subbloque deshace
-- TODO lo que la sentencia alcanzó a escribir: exactamente lo que le pasa a
-- una petición de PostgREST que termina en error.
CREATE FUNCTION pg_temp.intento(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_msg text; v_st text;
BEGIN
  EXECUTE p_sql;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_st = RETURNED_SQLSTATE;
  RETURN v_st || ' ' || v_msg;
END $$;

-- Las tablas de la política (20261030000000) para una empresa: una fila por
-- tabla, con su conteo. La usan las dos huellas.
CREATE FUNCTION pg_temp.politica_de(p_empresa uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'conversation_access_rules', (SELECT count(*) FROM public.conversation_access_rules WHERE company_id = p_empresa),
    'conta_diferenciales',       (SELECT count(*) FROM public.conta_diferenciales_cambiarios WHERE company_id = p_empresa),
    'report_runs',               (SELECT count(*) FROM public.report_runs WHERE company_id = p_empresa),
    'bloques_turno',             (SELECT count(*) FROM public.bloques_turno WHERE company_id = p_empresa),
    'conversations',             (SELECT jsonb_agg(jsonb_build_array(id, project_id, cliente_id) ORDER BY id) FROM public.conversations WHERE company_id = p_empresa),
    'conversation_messages',     (SELECT count(*) FROM public.conversation_messages m JOIN public.conversations c ON c.id = m.conversation_id WHERE c.company_id = p_empresa),
    'broadcasts',                (SELECT count(*) FROM public.broadcasts WHERE company_id = p_empresa),
    'broadcast_recipients',      (SELECT count(*) FROM public.broadcast_recipients r JOIN public.broadcasts b ON b.id = r.broadcast_id WHERE b.company_id = p_empresa),
    'solicitud_mudanza_unidad',  (SELECT count(*) FROM public.solicitud_mudanza_unidad WHERE company_id = p_empresa),
    'solicitud_renta_unidad',    (SELECT count(*) FROM public.solicitud_renta_unidad WHERE company_id = p_empresa),
    'registro_recordatorios_log',(SELECT count(*) FROM public.registro_recordatorios_log WHERE company_id = p_empresa),
    'documentos_fiscales',       (SELECT count(*) FROM public.documentos_fiscales WHERE company_id = p_empresa),
    'conta_reglas_compra',       (SELECT count(*) FROM public.conta_reglas_compra WHERE company_id = p_empresa),
    'cuentas_bancarias',         (SELECT count(*) FROM public.cuentas_bancarias WHERE company_id = p_empresa),
    'conta_asientos',            (SELECT count(*) FROM public.conta_asientos WHERE company_id = p_empresa),
    'conta_asiento_lineas',      (SELECT count(*) FROM public.conta_asiento_lineas WHERE company_id = p_empresa));
$$;

-- Todo lo que la purga de X puede tocar. Dos huellas iguales = nada cambió.
CREATE FUNCTION pg_temp.huella_x() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'empresa',      (SELECT to_jsonb(c) FROM public.companies c WHERE c.id = 'e1000000-0000-4000-8000-000000000001'),
    'proyectos',    (SELECT count(*) FROM public.projects WHERE company_id = 'e1000000-0000-4000-8000-000000000001'),
    'app_users',    (SELECT jsonb_agg(jsonb_build_array(id, role, company_id, project_id, cliente_id) ORDER BY id) FROM public.app_users),
    'auth_users',   (SELECT count(*) FROM auth.users),
    'user_roles',   (SELECT count(*) FROM public.user_roles),
    'roles',        (SELECT count(*) FROM public.roles WHERE company_id = 'e1000000-0000-4000-8000-000000000001'),
    'clientes',     (SELECT jsonb_agg(jsonb_build_array(id, project_id) ORDER BY id) FROM public.clientes),
    'company_clientes', (SELECT count(*) FROM public.company_clientes),
    'pagos',        (SELECT count(*) FROM public.pagos),
    'unidades',     (SELECT count(*) FROM public.unidades WHERE company_id = 'e1000000-0000-4000-8000-000000000001'),
    'cuentas',      (SELECT count(*) FROM public.conta_cuentas WHERE company_id = 'e1000000-0000-4000-8000-000000000001'),
    'suscripciones',(SELECT count(*) FROM public.subscriptions WHERE company_id = 'e1000000-0000-4000-8000-000000000001'),
    'auditoria',    (SELECT count(*) FROM public.audit_log WHERE table_name = 'companies' AND record_id = 'e1000000-0000-4000-8000-000000000001'),
    'bloqueantes',  jsonb_build_array(
      (SELECT count(*) FROM public.fuentes_agua           WHERE company_id = 'e1000000-0000-4000-8000-000000000001'),
      (SELECT count(*) FROM public.registros_calidad      WHERE company_id = 'e1000000-0000-4000-8000-000000000001'),
      (SELECT count(*) FROM public.rutas                  WHERE company_id = 'e1000000-0000-4000-8000-000000000001'),
      (SELECT count(*) FROM public.convenios_pago         WHERE company_id = 'e1000000-0000-4000-8000-000000000001'),
      (SELECT count(*) FROM public.payment_requests       WHERE company_id = 'e1000000-0000-4000-8000-000000000001'),
      (SELECT count(*) FROM public.areas_condominio       WHERE company_id = 'e1000000-0000-4000-8000-000000000001'),
      (SELECT count(*) FROM public.mensajes_portal        WHERE company_id = 'e1000000-0000-4000-8000-000000000001'),
      (SELECT count(*) FROM public.plantillas_tarea_cargo WHERE company_id = 'e1000000-0000-4000-8000-000000000001'),
      (SELECT count(*) FROM public.rutas_ronda            WHERE company_id = 'e1000000-0000-4000-8000-000000000001')),
    -- Lo que sembró fixture_politica.sql (si no se cargó, todo en 0).
    'politica',     pg_temp.politica_de('e1000000-0000-4000-8000-000000000001'),
    'registros',    (SELECT count(*) FROM public.registros));
$$;

-- Lo de Y (y Z): la purga de X no puede tocar ni una fila.
CREATE FUNCTION pg_temp.huella_vecinos() RETURNS jsonb LANGUAGE sql AS $$
  WITH v(id) AS (VALUES ('e2000000-0000-4000-8000-000000000002'::uuid), ('e3000000-0000-4000-8000-000000000003'::uuid))
  SELECT jsonb_build_object(
    'empresas',   (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.companies c WHERE c.id IN (SELECT id FROM v)),
    'proyectos',  (SELECT count(*) FROM public.projects WHERE company_id IN (SELECT id FROM v)),
    'personas',   (SELECT jsonb_agg(jsonb_build_array(id, role, company_id) ORDER BY id) FROM public.app_users WHERE company_id IN (SELECT id FROM v)),
    'unidades',   (SELECT count(*) FROM public.unidades WHERE company_id IN (SELECT id FROM v)),
    'cuentas',    (SELECT count(*) FROM public.conta_cuentas WHERE company_id IN (SELECT id FROM v)),
    'pagos_y',    (SELECT count(*) FROM public.pagos WHERE project_id = 'f2000000-0000-4000-8000-000000000001'),
    'vinculos_y', (SELECT count(*) FROM public.company_clientes WHERE company_id IN (SELECT id FROM v)),
    'bloqueantes', jsonb_build_array(
      (SELECT count(*) FROM public.fuentes_agua           WHERE company_id IN (SELECT id FROM v)),
      (SELECT count(*) FROM public.registros_calidad      WHERE company_id IN (SELECT id FROM v)),
      (SELECT count(*) FROM public.rutas                  WHERE company_id IN (SELECT id FROM v)),
      (SELECT count(*) FROM public.convenios_pago         WHERE company_id IN (SELECT id FROM v)),
      (SELECT count(*) FROM public.payment_requests       WHERE company_id IN (SELECT id FROM v)),
      (SELECT count(*) FROM public.areas_condominio       WHERE company_id IN (SELECT id FROM v)),
      (SELECT count(*) FROM public.mensajes_portal        WHERE company_id IN (SELECT id FROM v)),
      (SELECT count(*) FROM public.plantillas_tarea_cargo WHERE company_id IN (SELECT id FROM v)),
      (SELECT count(*) FROM public.rutas_ronda            WHERE company_id IN (SELECT id FROM v))),
    'politica',   pg_temp.politica_de('e2000000-0000-4000-8000-000000000002'),
    'registros_y', (SELECT count(*) FROM public.registros WHERE project_id = 'f2000000-0000-4000-8000-000000000001'));
$$;

-- Leído del catálogo: cada columna company_id/project_id/cliente_id de public que
-- conserva filas de la empresa, de sus proyectos o de sus clientes, con su conteo.
-- audit_log no cuenta (sobrevive a propósito). Vacío: la purga no dejó nada.
CREATE FUNCTION pg_temp.restos_de(p_empresa uuid, p_proyectos uuid[], p_clientes uuid[]) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE
  t      record;
  n      bigint;
  quedan text[] := ARRAY[]::text[];
BEGIN
  FOR t IN
    SELECT c.oid::regclass AS tabla, a.attname AS col
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
       AND a.attnum > 0 AND NOT a.attisdropped AND a.atttypid = 'uuid'::regtype
       AND a.attname IN ('company_id', 'project_id', 'cliente_id')
       AND c.relname <> 'audit_log'
     ORDER BY c.relname, a.attname
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = ANY ($1)', t.tabla, t.col)
      INTO n USING CASE t.col WHEN 'company_id' THEN ARRAY[p_empresa] WHEN 'project_id' THEN p_proyectos ELSE p_clientes END;
    IF n > 0 THEN quedan := quedan || format('%s.%s (%s)', t.tabla, t.col, n); END IF;
  END LOOP;
  RETURN quedan;
END $$;

-- La llamada de la purga de X por el actor, con lo que se le pase.
CREATE FUNCTION pg_temp.purga_x(p_actor text DEFAULT 'a0000000-0000-4000-8000-00000000000a',
                                p_nombre text DEFAULT 'Residencial Purga',
                                p_gracia int DEFAULT 90,
                                p_ensayo boolean DEFAULT false,
                                p_empresa text DEFAULT 'e1000000-0000-4000-8000-000000000001')
RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.purgar_empresa(%L::uuid, %L::uuid, %L, %s, %L, %L::boolean)',
                p_empresa, p_actor, p_nombre, COALESCE(p_gracia::text, 'NULL'), 'sub_123', p_ensayo);
$$;
