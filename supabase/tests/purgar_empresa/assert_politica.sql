-- ════════════════════════════════════════════════════════════════════════════
-- Política de retención y purga (20261030000000). Requiere pre_migracion.sql
-- (antes de la migración), fixture.sql, fixture_politica.sql y helpers.sql en
-- la misma sesión. Corre igual con la forma de llaves del repositorio y con la
-- de producción, y ANTES de assert.sql: todo lo que escribe aquí lo deshace.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

-- Acción ON DELETE de la llave de una columna hacia un destino (NULL si no hay).
CREATE FUNCTION pg_temp.accion(p_tabla text, p_columna text, p_destino text) RETURNS text LANGUAGE sql AS $$
  SELECT k.confdeltype::text
    FROM pg_catalog.pg_constraint k
    JOIN pg_catalog.pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
   WHERE k.contype = 'f' AND cardinality(k.conkey) = 1
     AND k.conrelid = format('public.%I', p_tabla)::regclass
     AND k.confrelid = format('public.%I', p_destino)::regclass
     AND a.attname = p_columna;
$$;

-- Siembra (con los triggers de usuario apagados donde haga falta) y comprueba
-- que la purga de X se detiene en la compuerta de retención con ese motivo,
-- sin cambiar nada. Todo se deshace al salir.
CREATE FUNCTION pg_temp.caso_retencion(p_nombre text, p_siembra text[], p_motivo text, p_ensayo boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE antes jsonb; r text; s text;
BEGIN
  BEGIN
    FOREACH s IN ARRAY p_siembra LOOP
      EXECUTE s;
    END LOOP;
    antes := pg_temp.huella_x();
    r := pg_temp.intento(pg_temp.purga_x(p_ensayo => p_ensayo));
    PERFORM pg_temp.chk(r LIKE '55000 PURGA_RETENCION:%' || p_motivo || '%',
      format('retención «%s» → PURGA_RETENCION con «%s» (recibido: %s)', p_nombre, p_motivo, left(r, 220)));
    PERFORM pg_temp.chk(pg_temp.huella_x() = antes, format('retención «%s»: nada cambió', p_nombre));
    RAISE EXCEPTION 'DESHACER';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'DESHACER' THEN RAISE; END IF;
  END;
END $$;

-- ── 1. Catálogo: llaves, acciones y permisos ───────────────────────────────
DO $$
DECLARE v_faltan text;
BEGIN
  -- Toda columna company_id / project_id / cliente_id de public tiene llave, o
  -- una razón escrita aquí. Una tabla nueva sin llave rompe esta comprobación:
  -- es lo que dejaba huérfanos.
  SELECT string_agg(format('%s.%s', c.relname, a.attname), ', ' ORDER BY c.relname, a.attname) INTO v_faltan
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname IN ('company_id', 'project_id', 'cliente_id')
     AND a.atttypid = 'uuid'::regtype
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint k
        WHERE k.contype = 'f' AND k.conrelid = c.oid AND a.attnum = ANY (k.conkey)
          AND k.confrelid = CASE a.attname WHEN 'company_id' THEN 'public.companies'::regclass
                                           WHEN 'project_id' THEN 'public.projects'::regclass
                                           ELSE 'public.clientes'::regclass END)
     AND (c.relname, a.attname) NOT IN (VALUES
       -- La purga las trata explícitamente (desliga, borra o pone a NULL).
       ('app_users', 'company_id'), ('app_users', 'project_id'), ('app_users', 'cliente_id'),
       -- A propósito: la auditoría sobrevive a la empresa. La bitácora del interruptor
       -- de separación de compras (20261027000900, #926; append-only, su guard impide
       -- UPDATE/DELETE) es auditoría: sobrevive igual (decisión del dueño, 2026-10-13).
       ('audit_log', 'company_id'), ('audit_log', 'project_id'),
       ('compras_config_separacion_bitacora', 'company_id'),
       -- Sólo en la forma de producción (drift #826): caen con el proyecto
       -- (project_id NOT NULL, ON DELETE CASCADE).
       ('plantillas_tarea_cargo', 'company_id'), ('rutas_ronda', 'company_id'),
       -- A propósito (20261028000000, #927): la cola de borrado del bucket de
       -- housekeeping sobrevive a la empresa/proyecto para retirar sus archivos.
       ('hk_limpieza_storage', 'company_id'), ('hk_limpieza_storage', 'project_id'));
  PERFORM pg_temp.chk(v_faltan IS NULL,
    format('toda columna company_id/project_id/cliente_id de public tiene llave foránea o una razón escrita (faltan: %s)', v_faltan));

  PERFORM pg_temp.chk(pg_temp.accion('conversations', 'company_id', 'companies') = 'c'
                      AND pg_temp.accion('broadcasts', 'company_id', 'companies') = 'c'
                      AND pg_temp.accion('solicitud_renta_unidad', 'project_id', 'projects') = 'c'
                      AND pg_temp.accion('report_runs', 'company_id', 'companies') = 'c'
                      AND pg_temp.accion('bloques_turno', 'company_id', 'companies') = 'c'
                      AND pg_temp.accion('amenidades_bloqueos', 'company_id', 'companies') = 'c',
    'operación y datos personales: CASCADE hacia su empresa/proyecto (amenidades_bloqueos converge al repositorio)');
  PERFORM pg_temp.chk(pg_temp.accion('conversations', 'project_id', 'projects') = 'n'
                      AND pg_temp.accion('conversations', 'cliente_id', 'clientes') = 'n'
                      AND pg_temp.accion('solicitud_mudanza_unidad', 'cliente_id', 'clientes') = 'n'
                      AND pg_temp.accion('solicitud_renta_unidad', 'cliente_id', 'clientes') = 'n'
                      AND pg_temp.accion('broadcast_recipients', 'cliente_id', 'clientes') = 'c',
    'hacia el cliente: el destinatario de una difusión cae con él; conversación y solicitudes pierden el vínculo');
  PERFORM pg_temp.chk(pg_temp.accion('conta_tasas_manuales', 'company_id', 'companies') = 'c'
                      AND pg_temp.accion('conta_tasas_manuales', 'project_id', 'projects') = 'c'
                      AND pg_temp.accion('pasarela_eventos', 'company_id', 'companies') = 'c'
                      AND pg_temp.accion('conta_sf_cuota_estado_eventos', 'company_id', 'companies') = 'c',
    'historia inmutable: CASCADE (el guard aborta la cascada: retención impuesta por el esquema)');
  PERFORM pg_temp.chk(pg_temp.accion('conta_anticipos', 'cliente_id', 'clientes') = 'r'
                      AND pg_temp.accion('conta_notas_credito', 'cliente_id', 'clientes') = 'r'
                      AND pg_temp.accion('conta_saldo_favor_aplicaciones', 'cliente_id', 'clientes') = 'r'
                      AND pg_temp.accion('conta_saldo_favor_origenes', 'cliente_id', 'clientes') = 'r',
    'contraparte contable: RESTRICT hacia el cliente');

  PERFORM pg_temp.chk(NOT has_function_privilege('anon', 'public.purgar_empresa_retencion(uuid, uuid[], uuid[])', 'EXECUTE')
                      AND NOT has_function_privilege('authenticated', 'public.purgar_empresa_retencion(uuid, uuid[], uuid[])', 'EXECUTE')
                      AND NOT has_function_privilege('service_role', 'public.purgar_empresa_retencion(uuid, uuid[], uuid[])', 'EXECUTE')
                      AND NOT has_function_privilege('anon', 'public.purgar_empresa_previos(uuid)', 'EXECUTE')
                      AND NOT has_function_privilege('authenticated', 'public.purgar_empresa_previos(uuid)', 'EXECUTE')
                      AND NOT has_function_privilege('service_role', 'public.purgar_empresa_previos(uuid)', 'EXECUTE'),
    'purgar_empresa_retencion y purgar_empresa_previos no las ejecuta nadie desde fuera');
END $$;

-- ── 2. Limpieza previa (lo sembrado por pre_migracion.sql) ─────────────────
DO $$
BEGIN
  PERFORM pg_temp.chk(EXISTS (SELECT 1 FROM public.conversations
                               WHERE id = '95000000-0000-4000-8000-0000000000c1' AND cliente_id IS NULL),
    'limpieza previa: la conversación con un cliente ya borrado se conserva, con cliente_id NULL');
  PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM public.conversations WHERE id = '95000000-0000-4000-8000-0000000000c2')
                      AND NOT EXISTS (SELECT 1 FROM public.broadcasts WHERE id = '95000000-0000-4000-8000-0000000000d1'),
    'limpieza previa: conversación y difusión de una empresa que ya no existe, borradas');
END $$;

-- ── 3. Retención: cada categoría detiene la purga, sin cambiar nada ─────────
SELECT pg_temp.caso_retencion('póliza publicada',
  ARRAY[$s$INSERT INTO public.cuotas_condominio (company_id, project_id, unidad_id, monto, periodo)
           VALUES ('e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
                   'd1000000-0000-4000-8000-000000000001', 250, '2026-09')$s$],
  'pólizas contables publicadas o anuladas (1)');

SELECT pg_temp.caso_retencion('bitácoras inmutables',
  ARRAY[$s$INSERT INTO public.conta_tasas_manuales (company_id, project_id, asiento_id, linea_id, moneda, moneda_base, periodo, tasa_usada, motivo)
           VALUES ('e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
                   gen_random_uuid(), gen_random_uuid(), 'USD', 'GTQ', '2026-09', 7.8, 'tasa del día')$s$,
        $s$INSERT INTO public.conta_borradores_tc_resoluciones (company_id, asiento_id, moneda, periodo, fecha_asiento, motivo, actor)
           VALUES ('e1000000-0000-4000-8000-000000000001', gen_random_uuid(), 'USD', '2026-09', CURRENT_DATE, 'resuelto',
                   'a0000000-0000-4000-8000-0000000000a2')$s$],
  'conta_borradores_tc_resoluciones (1), conta_tasas_manuales (1)');

SELECT pg_temp.caso_retencion('bitácora, también en el ensayo (Stripe no se toca)',
  ARRAY[$s$INSERT INTO public.conta_tasas_manuales (company_id, asiento_id, linea_id, moneda, moneda_base, periodo, tasa_usada, motivo)
           VALUES ('e1000000-0000-4000-8000-000000000001', gen_random_uuid(), gen_random_uuid(), 'USD', 'GTQ', '2026-09', 7.8, 'x')$s$],
  'conta_tasas_manuales (1)', true);

SELECT pg_temp.caso_retencion('anticipo',
  ARRAY[$s$INSERT INTO public.conta_anticipos (pago_id, company_id, project_id, cliente_id, unidad_id)
           VALUES ('91000000-0000-4000-8000-0000000000e1', 'e1000000-0000-4000-8000-000000000001',
                   'f1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002',
                   'd1000000-0000-4000-8000-000000000001')$s$],
  'anticipos (1)');

SELECT pg_temp.caso_retencion('cobro verificado',
  ARRAY['ALTER TABLE public.pagos DISABLE TRIGGER USER',
        $s$UPDATE public.pagos SET estado = 'verificado' WHERE id = '91000000-0000-4000-8000-0000000000e1'$s$,
        'ALTER TABLE public.pagos ENABLE TRIGGER USER'],
  'cobros verificados, aplicados o de cargos adicionales (1)');

SELECT pg_temp.caso_retencion('cobro pendiente de un cargo adicional',
  ARRAY['ALTER TABLE public.pagos DISABLE TRIGGER USER',
        $s$UPDATE public.pagos SET cargo_adicional_id = gen_random_uuid() WHERE id = '91000000-0000-4000-8000-0000000000e1'$s$,
        'ALTER TABLE public.pagos ENABLE TRIGGER USER'],
  'cobros verificados, aplicados o de cargos adicionales (1)');

SELECT pg_temp.caso_retencion('lectura facturada',
  ARRAY['ALTER TABLE public.registros DISABLE TRIGGER USER',
        $s$UPDATE public.registros SET factura_estado = 'emitida' WHERE id = '91000000-0000-4000-8000-0000000000f1'$s$,
        'ALTER TABLE public.registros ENABLE TRIGGER USER'],
  'lecturas facturadas, cobradas o en mora (1)');

SELECT pg_temp.caso_retencion('documento fiscal timbrado',
  ARRAY[$s$UPDATE public.documentos_fiscales SET estado = 'timbrado' WHERE company_id = 'e1000000-0000-4000-8000-000000000001'$s$],
  'documentos fiscales emitidos (1)');

SELECT pg_temp.caso_retencion('factura de proveedor',
  ARRAY[$s$INSERT INTO public.proveedores (id, company_id, nombre)
           VALUES ('91000000-0000-4000-8000-000000000101', 'e1000000-0000-4000-8000-000000000001', 'Proveedor X')$s$,
        'ALTER TABLE public.facturas_proveedor DISABLE TRIGGER USER',
        $s$INSERT INTO public.facturas_proveedor (company_id, proveedor_id, concepto, monto_total)
           VALUES ('e1000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000101', 'Cloro', 100)$s$,
        'ALTER TABLE public.facturas_proveedor ENABLE TRIGGER USER'],
  'facturas de proveedor (1)');

SELECT pg_temp.caso_retencion('recepción registrada',
  ARRAY['ALTER TABLE public.ordenes_compra DISABLE TRIGGER USER',
        $s$INSERT INTO public.ordenes_compra (id, company_id, proveedor_nombre, concepto)
           VALUES ('91000000-0000-4000-8000-000000000102', 'e1000000-0000-4000-8000-000000000001', 'Proveedor X', 'Cloro')$s$,
        'ALTER TABLE public.ordenes_compra ENABLE TRIGGER USER',
        'ALTER TABLE public.recepciones DISABLE TRIGGER USER',
        $s$INSERT INTO public.recepciones (company_id, orden_compra_id, estado)
           VALUES ('e1000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000102', 'registrada')$s$,
        'ALTER TABLE public.recepciones ENABLE TRIGGER USER'],
  'recepciones registradas (1)');

SELECT pg_temp.caso_retencion('turno en curso',
  ARRAY['ALTER TABLE public.bloques_turno DISABLE TRIGGER USER',
        $s$UPDATE public.bloques_turno SET estado = 'en_curso', iniciado_en = now()
            WHERE company_id = 'e1000000-0000-4000-8000-000000000001'$s$,
        'ALTER TABLE public.bloques_turno ENABLE TRIGGER USER'],
  'turnos ya ocurridos (1)');

SELECT pg_temp.caso_retencion('turno de una fecha pasada, aún pendiente',
  ARRAY['ALTER TABLE public.bloques_turno DISABLE TRIGGER USER',
        $s$UPDATE public.bloques_turno SET fecha = CURRENT_DATE - 3
            WHERE company_id = 'e1000000-0000-4000-8000-000000000001'$s$,
        'ALTER TABLE public.bloques_turno ENABLE TRIGGER USER'],
  'turnos ya ocurridos (1)');

SELECT pg_temp.caso_retencion('marcaje de presencia',
  ARRAY['ALTER TABLE public.presencia_personal DISABLE TRIGGER USER',
        $s$INSERT INTO public.presencia_personal (company_id, project_id, nombre)
           VALUES ('e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Conserje X')$s$,
        'ALTER TABLE public.presencia_personal ENABLE TRIGGER USER'],
  'marcajes de presencia (1)');

-- ── 4. La historia no se borra por NINGÚN camino (ni DELETE directo) ────────
DO $$
DECLARE r text;
BEGIN
  BEGIN
    INSERT INTO public.companies (id, nombre, activa, suspended_at)
    VALUES ('e6000000-0000-4000-8000-000000000006', 'Con bitácora', false, now() - interval '200 days');
    INSERT INTO public.conta_tasas_manuales (company_id, asiento_id, linea_id, moneda, moneda_base, periodo, tasa_usada, motivo)
    VALUES ('e6000000-0000-4000-8000-000000000006', gen_random_uuid(), gen_random_uuid(), 'USD', 'GTQ', '2026-09', 7.8, 'x');
    r := pg_temp.intento($q$DELETE FROM public.companies WHERE id = 'e6000000-0000-4000-8000-000000000006'$q$);
    PERFORM pg_temp.chk(r LIKE '23514 BITACORA_INMUTABLE:%',
      format('una empresa con bitácora inmutable no se borra ni con DELETE directo (recibido: %s)', left(r, 120)));
    PERFORM pg_temp.chk(EXISTS (SELECT 1 FROM public.conta_tasas_manuales WHERE company_id = 'e6000000-0000-4000-8000-000000000006'),
      'y la bitácora sigue ahí, con su empresa (antes quedaba huérfana)');

    -- P2 (de X) no tiene lecturas: su borrado sólo choca con la bitácora.
    INSERT INTO public.conta_tasas_manuales (company_id, project_id, asiento_id, linea_id, moneda, moneda_base, periodo, tasa_usada, motivo)
    VALUES ('e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002',
            gen_random_uuid(), gen_random_uuid(), 'USD', 'GTQ', '2026-09', 7.8, 'x');
    r := pg_temp.intento($q$DELETE FROM public.projects WHERE id = 'f1000000-0000-4000-8000-000000000002'$q$);
    PERFORM pg_temp.chk(r LIKE '23514 BITACORA_INMUTABLE:%',
      format('tampoco el proyecto que la tiene (recibido: %s)', left(r, 120)));
    RAISE EXCEPTION 'DESHACER';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'DESHACER' THEN RAISE; END IF;
  END;
END $$;

-- ── 5. Hacia el cliente: RESTRICT en lo contable, SET NULL / CASCADE en lo demás
DO $$
DECLARE r text;
BEGIN
  BEGIN
    INSERT INTO public.clientes (id, nombre, codigo, project_id) VALUES
      ('c2000000-0000-4000-8000-000000000009', 'Cliente con anticipo', 'Y-009', 'f2000000-0000-4000-8000-000000000001'),
      ('c2000000-0000-4000-8000-000000000008', 'Cliente que se va',     'Y-008', 'f2000000-0000-4000-8000-000000000001');
    INSERT INTO public.conta_anticipos (pago_id, company_id, project_id, cliente_id, unidad_id)
    VALUES (gen_random_uuid(), 'e2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001',
            'c2000000-0000-4000-8000-000000000009', 'd2000000-0000-4000-8000-000000000001');
    r := pg_temp.intento($q$DELETE FROM public.clientes WHERE id = 'c2000000-0000-4000-8000-000000000009'$q$);
    PERFORM pg_temp.chk(r LIKE '23503 %conta_anticipos_cliente_id_fkey%',
      format('el cliente de un anticipo no se borra por debajo (recibido: %s)', left(r, 140)));

    INSERT INTO public.conversations (id, company_id, cliente_id, subject) VALUES
      ('92000000-0000-4000-8000-0000000000c8', 'e2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000008', 'Me mudo');
    INSERT INTO public.broadcast_recipients (broadcast_id, cliente_id) VALUES
      ('92000000-0000-4000-8000-0000000000d1', 'c2000000-0000-4000-8000-000000000008');
    INSERT INTO public.solicitud_mudanza_unidad (id, company_id, project_id, unidad_id, tipo_mudanza, cliente_id) VALUES
      ('92000000-0000-4000-8000-0000000000b8', 'e2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001',
       'd2000000-0000-4000-8000-000000000001', 'mudanza_salida', 'c2000000-0000-4000-8000-000000000008');
    INSERT INTO public.solicitud_renta_unidad (id, company_id, project_id, unidad_id, cliente_id, estado) VALUES
      ('92000000-0000-4000-8000-0000000000b9', 'e2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001',
       'd2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000008', 'rechazada');
    r := pg_temp.intento($q$DELETE FROM public.clientes WHERE id = 'c2000000-0000-4000-8000-000000000008'$q$);
    PERFORM pg_temp.chk(r = 'OK', format('un cliente sin documentos contables se borra (recibido: %s)', left(r, 140)));
    PERFORM pg_temp.chk(EXISTS (SELECT 1 FROM public.conversations WHERE id = '92000000-0000-4000-8000-0000000000c8' AND cliente_id IS NULL)
                        AND EXISTS (SELECT 1 FROM public.solicitud_mudanza_unidad WHERE id = '92000000-0000-4000-8000-0000000000b8' AND cliente_id IS NULL)
                        AND EXISTS (SELECT 1 FROM public.solicitud_renta_unidad WHERE id = '92000000-0000-4000-8000-0000000000b9' AND cliente_id IS NULL),
      'su conversación y sus solicitudes (de la empresa) se conservan sin el vínculo');
    PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM public.broadcast_recipients WHERE cliente_id = 'c2000000-0000-4000-8000-000000000008'),
      'y su fila de destinatario de difusión se va con él');
    RAISE EXCEPTION 'DESHACER';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'DESHACER' THEN RAISE; END IF;
  END;
END $$;

-- ── 6. La purga de una empresa sin historia no deja NADA suyo ──────────────
-- Leído del catálogo: ninguna tabla de public conserva una fila con la
-- empresa, sus proyectos o sus clientes exclusivos, salvo audit_log (que
-- sobrevive a propósito). Se deshace al final: assert.sql purga X otra vez.
DO $$
DECLARE
  X       constant uuid   := 'e1000000-0000-4000-8000-000000000001';
  P       constant uuid[] := ARRAY['f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002']::uuid[];
  C       constant uuid[] := ARRAY['c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000003']::uuid[];
  vecinos jsonb := pg_temp.huella_vecinos();
  r       text;
  quedan  text[];
BEGIN
  BEGIN
    r := pg_temp.intento(pg_temp.purga_x());
    PERFORM pg_temp.chk(r = 'OK', format('X (sin historia, con datos de cada grupo de la política) se purga (recibido: %s)', left(r, 200)));

    quedan := pg_temp.restos_de(X, P, C);
    PERFORM pg_temp.chk(cardinality(quedan) = 0,
      format('ninguna tabla de public conserva filas de X, sus proyectos o sus clientes exclusivos (quedan: %s)', array_to_string(quedan, ', ')));

    PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM public.pagos WHERE id IN ('91000000-0000-4000-8000-0000000000e1', '91000000-0000-4000-8000-0000000000e2'))
                        AND NOT EXISTS (SELECT 1 FROM public.registros WHERE id = '91000000-0000-4000-8000-0000000000f1'),
      'el cobro pendiente del cliente compartido y su lectura sin facturar ya no sobreviven con project_id NULL');
    PERFORM pg_temp.chk(EXISTS (SELECT 1 FROM public.clientes WHERE id = 'c1000000-0000-4000-8000-000000000002'),
      'el cliente compartido con Y sigue (sólo pierde lo de X)');
    PERFORM pg_temp.chk(pg_temp.huella_vecinos() = vecinos,
      'Y: conversaciones, difusiones, solicitudes, cobros, lecturas (facturada incluida), turnos y reportes intactos');
    RAISE EXCEPTION 'DESHACER';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'DESHACER' THEN RAISE; END IF;
  END;
END $$;
