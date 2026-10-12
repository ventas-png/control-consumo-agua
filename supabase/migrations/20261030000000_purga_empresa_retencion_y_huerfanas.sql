-- ════════════════════════════════════════════════════════════════════════════
-- PURGA DE EMPRESA: POLÍTICA DE RETENCIÓN Y FILAS HUÉRFANAS
-- (sigue a 20261027000000_purgar_empresa_atomica; política completa en
-- docs/PURGA_EMPRESA.md › «Política de retención y purga»)
--
-- QUÉ QUEDABA ABIERTO
-- `purgar_empresa` es todo o nada, pero dejaba dos cosas sin decidir:
--
--   1. FILAS HUÉRFANAS. Fuera de `app_users` y `audit_log` (que la purga
--      trata a propósito), 23 columnas `company_id`, 11 `project_id` y 8
--      `cliente_id` de producción no tienen llave foránea (medido el
--      2026-10-12, sólo SELECT sobre pg_constraint). Nada las borra en cascada:
--      tras la purga, `conversations`, `broadcasts`, `solicitud_*`,
--      `report_runs`… sobrevivían con datos personales y sin dueño. `pagos` y
--      `registros` cuelgan de `projects` con SET NULL: sobrevivían con
--      `project_id = NULL`. Medido el mismo día: hoy NO hay ninguna fila
--      huérfana en producción (todas las empresas existen), así que las llaves
--      validan sin tocar datos.
--   2. HISTORIA INMUTABLE. Los guards sin escape (bitácoras, saldo a favor,
--      anticipos, cobros de cargos, turnos ocurridos, respaldos de
--      recepciones) abortaban la purga a mitad con su propio mensaje, y las
--      bitácoras SIN llave (conta_tasas_manuales, conta_borradores_tc_…,
--      conta_sf_cuota_estado_eventos…) ni siquiera la abortaban: quedaban
--      huérfanas. Y una empresa con contabilidad publicada fallaba igual por
--      ORDEN de llaves (las líneas de póliza sobreviven al DELETE de projects
--      con SET NULL y bloquean con RESTRICT el borrado de las cuentas del
--      proyecto) — reproducido en la suite.
--
-- LA POLÍTICA (propuesta al dueño de producto; docs/PURGA_EMPRESA.md)
-- Una empresa que NO llegó a operar (prueba abandonada, alta por error: la
-- única elegible hoy) se purga entera y no deja huérfanos. Una empresa con
-- historia financiera, fiscal o laboral —lo que la propia aplicación trata
-- como «se anula, no se borra»— NO se purga: queda suspendida (archivada de
-- hecho: nadie entra y nada se toca) y la RPC lo dice con PURGA_RETENCION
-- (409 en el edge) y la lista de lo que la retiene. Borrar esa historia, aun
-- vencido un plazo legal, es otra decisión (plazo, exportación previa,
-- anonimización) que esta migración NO toma.
--
-- QUÉ HACE
--   1. Limpieza previa: lo poco que impediría validar las llaves (en
--      producción, 2 `conversations.cliente_id` que apuntan a clientes
--      borrados → NULL, exactamente lo que hará SET NULL) y las filas de
--      empresas que ya no existan en las tablas que la política borra.
--   2. Llaves foráneas que faltaban, por grupo:
--      · operación y configuración → ON DELETE CASCADE;
--      · comunicaciones y solicitudes (datos personales) → CASCADE hacia la
--        empresa y el proyecto; hacia el cliente, CASCADE en destinatarios
--        de difusión y SET NULL en conversaciones y solicitudes;
--      · historia inmutable → CASCADE hacia empresa y proyecto: ningún camino
--        la deja huérfana, porque la cascada choca con su guard y aborta
--        (es la retención impuesta por el esquema, no sólo por la compuerta);
--      · contraparte contable (`cliente_id` de anticipos, notas de crédito y
--        saldos a favor) → RESTRICT: el cliente de un documento contable no
--        se borra por debajo.
--      Condicional: sólo se crea la que falta. `amenidades_bloqueos.company_id`
--      ya existe en el repositorio y falta en producción: aquí se crea con el
--      mismo nombre y definición (producción converge al repositorio).
--      `plantillas_tarea_cargo` y `rutas_ronda` NO se tocan: en producción ya
--      caen con el proyecto (project_id NOT NULL, CASCADE) y su forma la
--      alinea #826 (están en drift-conocido.json).
--   3. `conta_reglas_compra_borrado_tg`: una regla vigente es configuración,
--      no historia; cae en la cascada de su empresa o proyecto, como ya hacen
--      cuotas y cargos (pg_trigger_depth() > 1). Fuera de la cascada sigue
--      igual.
--   4. `purgar_empresa_retencion`: la compuerta, una categoría por bloque.
--   5. `purgar_empresa_previos`: borra antes que `projects` lo que, cayendo
--      con la empresa pero no con el proyecto, bloquearía ese DELETE por
--      RESTRICT (cuentas bancarias, partidas, líneas de órdenes y de pólizas
--      en borrador que apuntan a cuentas del proyecto). Sólo reordena: son
--      filas que la cascada de `companies` borraría igual.
--   6. `purgar_empresa` (misma firma): la compuerta de retención y el paso de
--      movimientos (cobros pendientes o rechazados, lecturas sin facturar y
--      documentos fiscales en borrador o rechazados de la empresa, que antes
--      sobrevivían con project_id NULL). El resto, igual que antes.
--
-- PRUEBAS: supabase/tests/purgar_empresa/run.sh (Postgres real, con la forma de
-- llaves del repositorio Y la de producción, aplicando esta migración SOBRE la
-- forma medida). Cada bloque `[compuerta:…]` / `[paso:…]` de ESTE archivo se
-- quita por separado y la suite tiene que fallar.
--
-- CÓMO REVERTIR
--   · Llaves: ALTER TABLE public.<tabla> DROP CONSTRAINT <tabla>_<columna>_fkey;
--     para cada una de las listadas abajo (salvo amenidades_bloqueos en el
--     repositorio, que ya existía).
--   · Guard de reglas: volver a aplicar su definición de
--     20261020000300_compras_reglas_cuenta.sql.
--   · Funciones: volver a aplicar purgar_empresa de 20261027000000 y
--     DROP FUNCTION public.purgar_empresa_retencion(uuid, uuid[], uuid[]),
--     public.purgar_empresa_previos(uuid).
--   La limpieza previa no se revierte (eran referencias a filas inexistentes).
-- IMPACTO EN DATOS (medido el 2026-10-12): 2 `conversations.cliente_id` pasan
-- a NULL; ninguna otra fila cambia. Las llaves bloquean las tablas un instante
-- (ADD CONSTRAINT valida con un recorrido; todas tienen cientos de filas o
-- menos).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Ayudante de la migración (pg_temp: no queda en el esquema) ──────────────
-- Crea `<tabla>_<columna>_fkey` sólo si la columna no tiene ya una llave hacia
-- el destino. Si la tiene, con la acción que sea, la deja: así la misma
-- migración converge el repositorio y producción, que difieren (#826), y una
-- segunda pasada no hace nada.
CREATE OR REPLACE FUNCTION pg_temp.purga_asegurar_fk(p_tabla text, p_columna text, p_destino text, p_accion text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_rel    regclass := format('public.%I', p_tabla)::regclass;
  v_dst    regclass := format('public.%I', p_destino)::regclass;
  v_attnum smallint;
BEGIN
  IF p_accion NOT IN ('CASCADE', 'SET NULL', 'RESTRICT') THEN
    RAISE EXCEPTION 'acción ON DELETE no prevista: %', p_accion;
  END IF;
  SELECT a.attnum INTO v_attnum
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = v_rel AND a.attname = p_columna AND NOT a.attisdropped;
  IF v_attnum IS NULL THEN
    RAISE EXCEPTION 'falta la columna %.%', p_tabla, p_columna;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
              WHERE k.contype = 'f' AND k.conrelid = v_rel AND k.confrelid = v_dst
                AND k.conkey = ARRAY[v_attnum]) THEN
    RETURN;
  END IF;
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(id) ON DELETE %s',
                 p_tabla, p_tabla || '_' || p_columna || '_fkey', p_columna, p_destino, p_accion);
END;
$$;

-- ── 1. Limpieza previa ──────────────────────────────────────────────────────
-- [paso:limpieza_previa]
DO $$
DECLARE
  v_t text;
  v_n bigint;
BEGIN
  -- Cliente inexistente → NULL (lo que hará la llave SET NULL).
  FOREACH v_t IN ARRAY ARRAY['conversations', 'solicitud_mudanza_unidad', 'solicitud_renta_unidad'] LOOP
    EXECUTE format('UPDATE public.%I x SET cliente_id = NULL WHERE x.cliente_id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = x.cliente_id)', v_t);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN RAISE NOTICE 'limpieza previa: % filas de % apuntaban a un cliente inexistente → NULL', v_n, v_t; END IF;
  END LOOP;
  UPDATE public.conversations x SET project_id = NULL
   WHERE x.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = x.project_id);

  -- Destinatario de difusión sin cliente → fuera (lo que hará CASCADE).
  DELETE FROM public.broadcast_recipients x
   WHERE NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = x.cliente_id);

  -- Filas de una empresa o un proyecto que ya no existen, en las tablas que la
  -- política borra (lo que hará CASCADE). Las de historia NO se tocan: si
  -- alguna estuviera huérfana, su llave falla al validar y la migración se
  -- detiene para que alguien lo decida.
  FOREACH v_t IN ARRAY ARRAY['amenidades_bloqueos', 'bloques_turno', 'broadcasts', 'broadcast_recipients',
                             'conta_diferenciales_cambiarios', 'conversation_access_rules', 'conversations',
                             'cuota_recordatorios_log', 'registro_recordatorios_log', 'report_runs',
                             'solicitud_mudanza_unidad', 'solicitud_renta_unidad'] LOOP
    EXECUTE format('DELETE FROM public.%I x WHERE x.company_id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = x.company_id)', v_t);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN RAISE NOTICE 'limpieza previa: % filas de % eran de una empresa inexistente → borradas', v_n, v_t; END IF;
  END LOOP;
  FOREACH v_t IN ARRAY ARRAY['conta_diferenciales_cambiarios', 'solicitud_mudanza_unidad', 'solicitud_renta_unidad'] LOOP
    EXECUTE format('DELETE FROM public.%I x WHERE x.project_id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = x.project_id)', v_t);
  END LOOP;
END;
$$;
-- [/paso:limpieza_previa]

-- ── 2. Llaves foráneas ──────────────────────────────────────────────────────
-- Operación y configuración de la empresa: sin valor de retención.
-- [paso:fk_operacion]
DO $$
BEGIN
  PERFORM pg_temp.purga_asegurar_fk(t, c, d, a) FROM (VALUES
    ('amenidades_bloqueos',            'company_id', 'companies', 'CASCADE'),
    ('bloques_turno',                  'company_id', 'companies', 'CASCADE'),
    ('conta_diferenciales_cambiarios', 'company_id', 'companies', 'CASCADE'),
    ('conta_diferenciales_cambiarios', 'project_id', 'projects',  'CASCADE'),
    ('conversation_access_rules',      'company_id', 'companies', 'CASCADE'),
    ('cuota_recordatorios_log',        'company_id', 'companies', 'CASCADE'),
    ('registro_recordatorios_log',     'company_id', 'companies', 'CASCADE'),
    ('report_runs',                    'company_id', 'companies', 'CASCADE')
  ) AS v(t, c, d, a);
END;
$$;
-- [/paso:fk_operacion]

-- Comunicaciones y solicitudes: datos personales de residentes. Se van con la
-- empresa; si se borra el cliente, el destinatario de una difusión se va con
-- él y la conversación o la solicitud (que son de la empresa) pierden el
-- vínculo.
-- [paso:fk_personales]
DO $$
BEGIN
  PERFORM pg_temp.purga_asegurar_fk(t, c, d, a) FROM (VALUES
    ('broadcasts',               'company_id', 'companies', 'CASCADE'),
    ('broadcast_recipients',     'company_id', 'companies', 'CASCADE'),
    ('broadcast_recipients',     'cliente_id', 'clientes',  'CASCADE'),
    ('conversations',            'company_id', 'companies', 'CASCADE'),
    ('conversations',            'project_id', 'projects',  'SET NULL'),
    ('conversations',            'cliente_id', 'clientes',  'SET NULL'),
    ('solicitud_mudanza_unidad', 'company_id', 'companies', 'CASCADE'),
    ('solicitud_mudanza_unidad', 'project_id', 'projects',  'CASCADE'),
    ('solicitud_mudanza_unidad', 'cliente_id', 'clientes',  'SET NULL'),
    ('solicitud_renta_unidad',   'company_id', 'companies', 'CASCADE'),
    ('solicitud_renta_unidad',   'project_id', 'projects',  'CASCADE'),
    ('solicitud_renta_unidad',   'cliente_id', 'clientes',  'SET NULL')
  ) AS v(t, c, d, a);
END;
$$;
-- [/paso:fk_personales]

-- Historia inmutable: CASCADE a propósito. Su guard (BITACORA_INMUTABLE)
-- aborta la cascada, así que la empresa o el proyecto que la tengan no se
-- pueden borrar por NINGÚN camino; sin llave, un DELETE directo los borraba y
-- la bitácora quedaba huérfana. Si un día se decide purgar historia vencida,
-- basta con un escape en el guard: la llave ya dice adónde va.
-- [paso:fk_historia]
DO $$
BEGIN
  PERFORM pg_temp.purga_asegurar_fk(t, c, d, a) FROM (VALUES
    ('pasarela_eventos',                 'company_id', 'companies', 'CASCADE'),
    ('pasarela_reembolsos',              'company_id', 'companies', 'CASCADE'),
    ('conta_ajustes_eventos',            'company_id', 'companies', 'CASCADE'),
    ('conta_ajustes_eventos',            'project_id', 'projects',  'CASCADE'),
    ('conta_ajustes_respaldos',          'company_id', 'companies', 'CASCADE'),
    ('conta_ajustes_respaldos',          'project_id', 'projects',  'CASCADE'),
    ('conta_borradores_tc_resoluciones', 'company_id', 'companies', 'CASCADE'),
    ('conta_borradores_tc_resoluciones', 'project_id', 'projects',  'CASCADE'),
    ('conta_cargo_anulaciones',          'company_id', 'companies', 'CASCADE'),
    ('conta_cargo_anulaciones',          'project_id', 'projects',  'CASCADE'),
    ('conta_cuota_anulaciones',          'company_id', 'companies', 'CASCADE'),
    ('conta_cuota_anulaciones',          'project_id', 'projects',  'CASCADE'),
    ('conta_sf_cuota_estado_eventos',    'company_id', 'companies', 'CASCADE'),
    ('conta_sf_cuota_estado_eventos',    'project_id', 'projects',  'CASCADE'),
    ('conta_tasas_manuales',             'company_id', 'companies', 'CASCADE'),
    ('conta_tasas_manuales',             'project_id', 'projects',  'CASCADE')
  ) AS v(t, c, d, a);
END;
$$;
-- [/paso:fk_historia]

-- Contraparte de los documentos contables: el cliente no se borra por debajo.
-- [paso:fk_contraparte]
DO $$
BEGIN
  PERFORM pg_temp.purga_asegurar_fk(t, c, d, a) FROM (VALUES
    ('conta_anticipos',                'cliente_id', 'clientes', 'RESTRICT'),
    ('conta_notas_credito',            'cliente_id', 'clientes', 'RESTRICT'),
    ('conta_saldo_favor_aplicaciones', 'cliente_id', 'clientes', 'RESTRICT'),
    ('conta_saldo_favor_origenes',     'cliente_id', 'clientes', 'RESTRICT')
  ) AS v(t, c, d, a);
END;
$$;
-- [/paso:fk_contraparte]

-- ── 3. Una regla de compra vigente cae con su empresa o proyecto ────────────
-- Igual que conta_tg_cuota_solo_por_solicitud y conta_tg_cargo_solo_por_solicitud:
-- el borrado que llega desde el trigger de la llave (nivel > 1) no es una
-- edición de la regla. Fuera de esa cascada, el guard no cambia.
-- [paso:reglas_en_cascada]
CREATE OR REPLACE FUNCTION public.conta_reglas_compra_borrado_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF OLD.vigente_desde <= CURRENT_DATE THEN
    RAISE EXCEPTION 'REGLA_VIGENTE_INMUTABLE: una regla que ya rige no se borra: ciérrala con vigente_hasta o desactívala.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$function$;
-- [/paso:reglas_en_cascada]

-- ── 4. Retención: qué impide purgar una empresa ─────────────────────────────
-- Devuelve un motivo legible por categoría que retiene a la empresa (vacío:
-- se puede purgar). Cada categoría es lo que la aplicación ya trata como
-- «se anula, no se borra»; los guards siguen siendo la red: si algo escapa a
-- esta lista y no se puede borrar, la purga se revierte entera igual.
CREATE OR REPLACE FUNCTION public.purgar_empresa_retencion(p_company_id uuid, p_proyectos uuid[], p_clientes uuid[])
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_motivos text[] := ARRAY[]::text[];
  v_n       bigint;
  v_n2      bigint;
  v_t       record;
  v_hoy     date;
BEGIN
  -- Libros: una póliza publicada o anulada es contabilidad, no borrador.
  -- [compuerta:retencion_contabilidad]
  SELECT count(*) INTO v_n FROM public.conta_asientos a
   WHERE a.company_id = p_company_id AND a.estado <> 'borrador';
  IF v_n > 0 THEN
    v_motivos := v_motivos || format('pólizas contables publicadas o anuladas (%s)', v_n);
  END IF;
  -- [/compuerta:retencion_contabilidad]

  -- Bitácoras de sólo inserción y aplicaciones de saldo a favor: toda tabla
  -- con el guard, leída del catálogo (una bitácora nueva entra sola).
  -- [compuerta:retencion_bitacoras]
  FOR v_t IN
    SELECT x.tabla, x.nombre FROM (
      SELECT DISTINCT g.tgrelid::regclass AS tabla, c.relname::text AS nombre
        FROM pg_catalog.pg_trigger g
        JOIN pg_catalog.pg_proc f ON f.oid = g.tgfoid
        JOIN pg_catalog.pg_class c ON c.oid = g.tgrelid
       WHERE NOT g.tgisinternal
         AND c.relnamespace = 'public'::regnamespace
         AND f.pronamespace = 'public'::regnamespace
         AND f.proname IN ('conta_tg_bitacora_inmutable', 'conta_tg_sf_aplicacion_inmutable')
         AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                      WHERE a.attrelid = g.tgrelid AND a.attname = 'company_id' AND NOT a.attisdropped)
    ) x
    ORDER BY x.nombre COLLATE "C"
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE company_id = $1', v_t.tabla) INTO v_n USING p_company_id;
    IF v_n > 0 THEN
      v_motivos := v_motivos || format('%s (%s)', v_t.nombre, v_n);
    END IF;
  END LOOP;
  -- [/compuerta:retencion_bitacoras]

  -- Anticipos: ANTICIPO_INBORRABLE («se anula, no se borra»).
  -- [compuerta:retencion_anticipos]
  SELECT count(*) INTO v_n FROM public.conta_anticipos an WHERE an.company_id = p_company_id;
  IF v_n > 0 THEN
    v_motivos := v_motivos || format('anticipos (%s)', v_n);
  END IF;
  -- [/compuerta:retencion_anticipos]

  -- Dinero recibido: cobros verificados o aplicados, y todo cobro de un cargo
  -- adicional (COBRO_CARGO_INBORRABLE).
  -- [compuerta:retencion_cobros]
  SELECT count(*) INTO v_n FROM public.pagos pg
   WHERE (pg.project_id = ANY (p_proyectos) OR pg.cliente_id = ANY (p_clientes))
     AND (pg.estado IN ('verificado', 'aplicado') OR pg.cargo_adicional_id IS NOT NULL);
  IF v_n > 0 THEN
    v_motivos := v_motivos || format('cobros verificados, aplicados o de cargos adicionales (%s)', v_n);
  END IF;
  -- [/compuerta:retencion_cobros]

  -- Facturación de agua: lecturas facturadas, cobradas o en mora.
  -- [compuerta:retencion_facturacion]
  SELECT count(*) INTO v_n FROM public.registros r
   WHERE (r.project_id = ANY (p_proyectos) OR (r.project_id IS NULL AND r.cliente_id = ANY (p_clientes)))
     AND (r.estado <> 'pendiente' OR r.factura_estado IN ('emitida', 'pagada', 'vencida', 'anulada'));
  IF v_n > 0 THEN
    v_motivos := v_motivos || format('lecturas facturadas, cobradas o en mora (%s)', v_n);
  END IF;
  -- [/compuerta:retencion_facturacion]

  -- Documentos fiscales enviados a timbrar, timbrados o cancelados.
  -- [compuerta:retencion_fiscal]
  SELECT count(*) INTO v_n FROM public.documentos_fiscales d
   WHERE d.company_id = p_company_id AND d.estado IN ('por_timbrar', 'timbrado', 'cancelado');
  IF v_n > 0 THEN
    v_motivos := v_motivos || format('documentos fiscales emitidos (%s)', v_n);
  END IF;
  -- [/compuerta:retencion_fiscal]

  -- Compras: facturas de proveedor (en cualquier estado) y recepciones
  -- registradas o anuladas (su evidencia es COMPRAS_RESPALDO_INMUTABLE).
  -- [compuerta:retencion_compras]
  SELECT count(*) INTO v_n FROM public.facturas_proveedor f WHERE f.company_id = p_company_id;
  SELECT count(*) INTO v_n2 FROM public.recepciones r WHERE r.company_id = p_company_id AND r.estado <> 'borrador';
  IF v_n > 0 THEN
    v_motivos := v_motivos || format('facturas de proveedor (%s)', v_n);
  END IF;
  IF v_n2 > 0 THEN
    v_motivos := v_motivos || format('recepciones registradas (%s)', v_n2);
  END IF;
  -- [/compuerta:retencion_compras]

  -- Presencia: turnos que ya ocurrieron (los mismos que turnos_bloque_borrable
  -- no deja borrar: iniciados, cerrados, fuera de «pendiente» o de una fecha
  -- pasada en la zona de la empresa) y marcajes.
  -- [compuerta:retencion_presencia]
  v_hoy := (now() AT TIME ZONE public.presencia_zona_horaria(p_company_id))::date;
  SELECT count(*) INTO v_n FROM public.bloques_turno b
   WHERE b.company_id = p_company_id
     AND (b.estado <> 'pendiente' OR b.iniciado_en IS NOT NULL OR b.cerrado_en IS NOT NULL OR b.fecha < v_hoy);
  SELECT count(*) INTO v_n2 FROM public.presencia_personal pp WHERE pp.company_id = p_company_id;
  IF v_n > 0 THEN
    v_motivos := v_motivos || format('turnos ya ocurridos (%s)', v_n);
  END IF;
  IF v_n2 > 0 THEN
    v_motivos := v_motivos || format('marcajes de presencia (%s)', v_n2);
  END IF;
  -- [/compuerta:retencion_presencia]

  RETURN v_motivos;
END;
$$;

REVOKE ALL ON FUNCTION public.purgar_empresa_retencion(uuid, uuid[], uuid[]) FROM PUBLIC, anon, authenticated, service_role;

-- ── 5. Lo que bloquearía el DELETE de projects por orden de llaves ──────────
-- Borra, de la empresa, las filas de toda tabla que:
--   · cae con `companies` (company_id → companies ON DELETE CASCADE),
--   · NO cae con `projects` (no tiene project_id → projects CASCADE), y
--   · referencia con RESTRICT/NO ACTION una tabla que SÍ cae con `projects`.
-- Al borrar `projects`, la cascada se lleva esa tabla referenciada (cuentas
-- contables del proyecto, unidades, órdenes de compra) mientras la primera
-- sigue viva, y el RESTRICT revienta el DELETE entero; o, si la primera cuelga
-- del proyecto con SET NULL, esa actualización choca antes con su guard de
-- ledger (BANCO_LEDGER en cuentas_bancarias, reproducido en la suite).
-- Ejemplos medidos: cuentas_bancarias, presupuesto_partidas,
-- orden_compra_lineas y las líneas de pólizas en borrador → conta_cuentas. Se
-- leen del catálogo por la misma razón que en purgar_empresa_bloqueantes, y
-- con el mismo reintento por pasadas.
-- Sólo corre tras la compuerta de retención: lo que borra es configuración y
-- borradores que la cascada de `companies` iba a borrar de todos modos.
CREATE OR REPLACE FUNCTION public.purgar_empresa_previos(p_company_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_t         record;
  v_hay       boolean;
  v_filas     bigint;
  v_total     integer := 0;
  v_pasada    integer := 0;
  v_avance    boolean;
  v_pendiente boolean;
BEGIN
  LOOP
    v_pasada    := v_pasada + 1;
    v_avance    := false;
    v_pendiente := false;

    FOR v_t IN
      SELECT x.tabla FROM (
        SELECT DISTINCT k.conrelid::regclass AS tabla
          FROM pg_catalog.pg_constraint k
         WHERE k.contype = 'f'
           AND k.confdeltype IN ('a', 'r')
           AND k.connamespace = 'public'::regnamespace
           AND k.conrelid <> k.confrelid
           AND k.conrelid NOT IN ('public.projects'::regclass, 'public.companies'::regclass)
           AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint p
                        WHERE p.contype = 'f' AND p.conrelid = k.confrelid
                          AND p.confrelid = 'public.projects'::regclass AND p.confdeltype = 'c')
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint p
                            WHERE p.contype = 'f' AND p.conrelid = k.conrelid
                              AND p.confrelid = 'public.projects'::regclass AND p.confdeltype = 'c')
           AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                         JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
                        WHERE c.contype = 'f' AND c.conrelid = k.conrelid
                          AND c.confrelid = 'public.companies'::regclass AND c.confdeltype = 'c'
                          AND cardinality(c.conkey) = 1 AND a.attname = 'company_id')
      ) x
      ORDER BY x.tabla::text COLLATE "C"
    LOOP
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE company_id = $1)', v_t.tabla)
        INTO v_hay USING p_company_id;
      CONTINUE WHEN NOT v_hay;

      BEGIN
        EXECUTE format('DELETE FROM %s WHERE company_id = $1', v_t.tabla) USING p_company_id;
        GET DIAGNOSTICS v_filas = ROW_COUNT;
        v_total  := v_total + v_filas;
        v_avance := true;
      EXCEPTION WHEN foreign_key_violation THEN
        v_pendiente := true;
      END;
    END LOOP;

    EXIT WHEN NOT v_pendiente OR NOT v_avance OR v_pasada >= 20;
  END LOOP;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.purgar_empresa_previos(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ── 6. La purga ─────────────────────────────────────────────────────────────
-- Misma firma, mismos códigos y mismo orden que 20261027000000, más:
--   · [compuerta:retencion] — PURGA_RETENCION (55000) con los motivos, ANTES de
--     escribir nada (también en el ensayo, así que el edge no toca Stripe);
--   · [paso:movimientos] — cobros, lecturas y documentos fiscales que quedan
--     (los que no retienen: pendientes, rechazados, sin facturar, borradores),
--     ANTES de `projects`: si no, su SET NULL los dejaba vivos y sin proyecto,
--     y la actualización en cascada choca con los guards de lectura inmutable;
--   · [paso:previos] — purgar_empresa_previos, antes de `projects`.
CREATE OR REPLACE FUNCTION public.purgar_empresa(
  p_company_id             uuid,
  p_actor_id               uuid,
  p_confirm_name           text,
  p_grace_days             integer,
  p_stripe_subscription_id text    DEFAULT NULL,
  p_ensayo                 boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_empresa         public.companies;
  v_proyectos       uuid[];
  v_superadmins     uuid[];
  v_personas        uuid[];
  v_clientes        uuid[];
  v_cuentas_cliente uuid[];
  v_usuarios_auth   uuid[];
  v_retencion       text[];
  v_n_unidades      bigint;
  v_n_pagos         bigint;
  v_n_registros     bigint;
  v_n_desligados    bigint;
  v_filas           bigint;
BEGIN
  -- [compuerta:parametros]
  IF p_company_id IS NULL OR p_actor_id IS NULL OR p_confirm_name IS NULL
     OR p_grace_days IS NULL OR p_grace_days < 1 OR p_ensayo IS NULL THEN
    RAISE EXCEPTION 'PURGA_PARAMETROS: faltan la empresa, el actor o el nombre de confirmación, o los días de gracia no son un entero positivo.'
      USING ERRCODE = '22023';
  END IF;
  -- [/compuerta:parametros]

  -- [compuerta:superadmin]
  IF NOT EXISTS (SELECT 1 FROM public.app_users u
                  WHERE u.id = p_actor_id AND u.role IN ('super_admin', 'superadmin')) THEN
    RAISE EXCEPTION 'PURGA_SOLO_SUPERADMIN: sólo un superadministrador puede purgar una empresa.'
      USING ERRCODE = '42501';
  END IF;
  -- [/compuerta:superadmin]

  SELECT c.* INTO v_empresa FROM public.companies c WHERE c.id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PURGA_EMPRESA_NO_ENCONTRADA: la empresa % no existe.', p_company_id
      USING ERRCODE = 'P0002';
  END IF;

  -- [compuerta:nombre]
  IF p_confirm_name IS DISTINCT FROM v_empresa.nombre THEN
    RAISE EXCEPTION 'PURGA_NOMBRE_NO_COINCIDE: el nombre de confirmación no coincide con el nombre de la empresa.'
      USING ERRCODE = '22023';
  END IF;
  -- [/compuerta:nombre]

  -- [compuerta:suspendida]
  IF v_empresa.activa THEN
    RAISE EXCEPTION 'PURGA_EMPRESA_ACTIVA: la empresa debe estar suspendida antes de eliminarse.'
      USING ERRCODE = '55000';
  END IF;
  -- [/compuerta:suspendida]

  -- [compuerta:gracia]
  IF v_empresa.suspended_at IS NULL
     OR v_empresa.suspended_at + make_interval(days => p_grace_days) > now() THEN
    RAISE EXCEPTION 'PURGA_EN_GRACIA: la empresa debe llevar al menos % días suspendida antes de la purga definitiva.', p_grace_days
      USING ERRCODE = '55000';
  END IF;
  -- [/compuerta:gracia]

  -- [compuerta:actor_ajeno]
  IF EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = p_actor_id AND u.company_id = p_company_id) THEN
    RAISE EXCEPTION 'PURGA_ACTOR_DE_LA_EMPRESA: no puedes eliminar una empresa a la que pertenece tu propia cuenta.'
      USING ERRCODE = '22023';
  END IF;
  -- [/compuerta:actor_ajeno]

  -- ── Quién y qué ──────────────────────────────────────────────────────────
  v_proyectos := ARRAY(SELECT p.id FROM public.projects p WHERE p.company_id = p_company_id ORDER BY p.id);

  v_superadmins := ARRAY(
    SELECT u.id FROM public.app_users u
     WHERE u.role IN ('super_admin', 'superadmin')
       AND (u.company_id = p_company_id OR u.project_id = ANY (v_proyectos))
     ORDER BY u.id);

  v_personas := ARRAY(
    SELECT u.id FROM public.app_users u
     WHERE u.company_id = p_company_id
       AND u.role NOT IN ('super_admin', 'superadmin')
     ORDER BY u.id);

  v_clientes := ARRAY(
    SELECT cl.id FROM public.clientes cl
     WHERE (cl.project_id = ANY (v_proyectos)
            OR EXISTS (SELECT 1 FROM public.company_clientes cc
                        WHERE cc.cliente_id = cl.id AND cc.company_id = p_company_id))
       AND (cl.project_id IS NULL OR cl.project_id = ANY (v_proyectos))
       AND NOT EXISTS (SELECT 1 FROM public.company_clientes cc
                        WHERE cc.cliente_id = cl.id AND cc.company_id <> p_company_id)
     ORDER BY cl.id);

  v_cuentas_cliente := ARRAY(
    SELECT u.id FROM public.app_users u
     WHERE u.role = 'cliente' AND u.cliente_id = ANY (v_clientes)
     ORDER BY u.id);

  v_usuarios_auth := v_personas || v_cuentas_cliente;

  SELECT count(*) INTO v_n_unidades FROM public.unidades un WHERE un.company_id = p_company_id;
  SELECT count(*) INTO v_n_pagos FROM public.pagos pg
   WHERE pg.project_id = ANY (v_proyectos) OR pg.cliente_id = ANY (v_clientes);
  SELECT count(*) INTO v_n_registros FROM public.registros r
   WHERE r.project_id = ANY (v_proyectos) OR (r.project_id IS NULL AND r.cliente_id = ANY (v_clientes));

  -- ── Retención (docs/PURGA_EMPRESA.md › Política de retención y purga) ────
  -- [compuerta:retencion]
  v_retencion := public.purgar_empresa_retencion(p_company_id, v_proyectos, v_clientes);
  IF cardinality(v_retencion) > 0 THEN
    RAISE EXCEPTION 'PURGA_RETENCION: la empresa tiene historia que se conserva: %. Queda suspendida; no se purgó nada.',
      array_to_string(v_retencion, ', ')
      USING ERRCODE = '55000';
  END IF;
  -- [/compuerta:retencion]

  -- Escritura de sistema, sólo en esta transacción (ver 20261027000000).
  -- [paso:escritura_sistema]
  PERFORM set_config('conta.allow_system_write', 'on', true);
  -- [/paso:escritura_sistema]

  -- ── Auditoría: en la misma transacción que todo lo demás ─────────────────
  -- [paso:auditoria]
  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, company_id, before)
  VALUES (
    'companies', p_company_id, 'DELETE', p_actor_id, p_company_id,
    to_jsonb(v_empresa) || jsonb_build_object(
      'deleted_counts', jsonb_build_object(
        'projects',        cardinality(v_proyectos),
        'unidades',        v_n_unidades,
        'usuarios',        cardinality(v_personas),
        'cuentas_cliente', cardinality(v_cuentas_cliente),
        'clientes',        cardinality(v_clientes),
        'pagos',           v_n_pagos,
        'registros',       v_n_registros),
      'grace_days',                   p_grace_days,
      'stripe_subscription_canceled', p_stripe_subscription_id,
      'usuarios_auth',                to_jsonb(v_usuarios_auth),
      'superadmins_desligados',       to_jsonb(v_superadmins)));
  -- [/paso:auditoria]

  -- ── Superadministradores: se desligan, no se borran ──────────────────────
  -- [paso:desligar]
  UPDATE public.app_users u SET company_id = NULL, project_id = NULL
   WHERE u.id = ANY (v_superadmins);
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  IF v_filas <> cardinality(v_superadmins) THEN
    RAISE EXCEPTION 'PURGA_INCOMPLETA: se esperaban % superadministradores por desligar y se desligaron %.',
      cardinality(v_superadmins), v_filas;
  END IF;
  -- [/paso:desligar]

  -- ── Personas y cuentas cliente exclusivas ────────────────────────────────
  -- [paso:personas]
  DELETE FROM public.app_users u WHERE u.id = ANY (v_usuarios_auth);
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  IF v_filas <> cardinality(v_usuarios_auth) THEN
    RAISE EXCEPTION 'PURGA_INCOMPLETA: se esperaban % personas por borrar y se borraron %.',
      cardinality(v_usuarios_auth), v_filas;
  END IF;
  -- [/paso:personas]

  UPDATE public.app_users u SET project_id = NULL WHERE u.project_id = ANY (v_proyectos);
  GET DIAGNOSTICS v_n_desligados = ROW_COUNT;

  -- ── Movimientos que no retienen ──────────────────────────────────────────
  -- Pasaron la compuerta: son cobros pendientes o rechazados, lecturas sin
  -- facturar y documentos fiscales en borrador o rechazados. Primero los
  -- documentos (referencian la lectura con RESTRICT), después los cobros (la
  -- lectura los pondría en NULL) y al final las lecturas. El borrado de un
  -- cobro llama a conta_reversar_automatico, que sólo apaga
  -- conta.allow_system_write si encuentra una póliza publicada que reversar;
  -- la compuerta ya garantizó que no hay ninguna.
  -- [paso:movimientos]
  DELETE FROM public.documentos_fiscales d
   WHERE d.company_id = p_company_id AND d.estado IN ('borrador', 'rechazado');
  DELETE FROM public.pagos pg
   WHERE pg.project_id = ANY (v_proyectos) OR pg.cliente_id = ANY (v_clientes);
  DELETE FROM public.registros r
   WHERE r.project_id = ANY (v_proyectos) OR (r.project_id IS NULL AND r.cliente_id = ANY (v_clientes));
  -- [/paso:movimientos]

  -- ── Datos ────────────────────────────────────────────────────────────────
  -- [paso:previos]
  PERFORM public.purgar_empresa_previos(p_company_id);
  -- [/paso:previos]
  -- [paso:bloqueantes]
  PERFORM public.purgar_empresa_bloqueantes(p_company_id, v_proyectos);
  -- [/paso:bloqueantes]
  DELETE FROM public.projects p WHERE p.company_id = p_company_id;
  PERFORM public.purgar_empresa_bloqueantes(p_company_id, v_proyectos);

  DELETE FROM public.companies c WHERE c.id = p_company_id;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  IF v_filas <> 1 THEN
    RAISE EXCEPTION 'PURGA_INCOMPLETA: la empresa % no se borró.', p_company_id;
  END IF;

  -- Clientes exclusivos: DESPUÉS de la empresa, cuando ya no los referencian
  -- sus cuotas, cargos ni auxiliares contables (que cayeron en cascada).
  -- [paso:clientes]
  DELETE FROM public.clientes cl WHERE cl.id = ANY (v_clientes);
  -- [/paso:clientes]

  -- [paso:ensayo]
  IF p_ensayo THEN
    RAISE EXCEPTION 'PURGA_ENSAYO_OK: la purga de la empresa % se completaría; el ensayo se revierte sin cambios.', p_company_id
      USING ERRCODE = 'P0001';
  END IF;
  -- [/paso:ensayo]

  RETURN jsonb_build_object(
    'company_id',             p_company_id,
    'nombre',                 v_empresa.nombre,
    'logo_url',               v_empresa.logo_url,
    'usuarios_auth',          to_jsonb(v_usuarios_auth),
    'personas',               cardinality(v_personas),
    'cuentas_cliente',        cardinality(v_cuentas_cliente),
    'clientes',               cardinality(v_clientes),
    'proyectos',              cardinality(v_proyectos),
    'unidades',               v_n_unidades,
    'pagos',                  v_n_pagos,
    'registros',              v_n_registros,
    'superadmins_desligados', cardinality(v_superadmins),
    'cuentas_proyecto_desligadas', v_n_desligados);
END;
$$;

REVOKE ALL ON FUNCTION public.purgar_empresa(uuid, uuid, text, integer, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purgar_empresa(uuid, uuid, text, integer, text, boolean) TO service_role;

COMMENT ON FUNCTION public.purgar_empresa(uuid, uuid, text, integer, text, boolean) IS
  'Purga definitiva y atómica de una empresa sin historia que retener (edge delete-company). Todo o nada; PURGA_RETENCION si tiene historia financiera, fiscal o laboral. Devuelve los ids de auth.users que el edge borra tras el COMMIT. Sólo service_role.';
