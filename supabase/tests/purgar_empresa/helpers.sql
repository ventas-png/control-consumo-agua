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
      (SELECT count(*) FROM public.rutas_ronda            WHERE company_id = 'e1000000-0000-4000-8000-000000000001')));
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
      (SELECT count(*) FROM public.rutas_ronda            WHERE company_id IN (SELECT id FROM v))));
$$;

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
