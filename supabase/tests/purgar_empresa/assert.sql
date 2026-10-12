-- ════════════════════════════════════════════════════════════════════════════
-- purgar_empresa: compuertas, todo-o-nada y la purga completa.
-- Requiere fixture.sql y helpers.sql cargados en la MISMA base (helpers en la
-- misma sesión: run.sh los concatena). Corre igual con la forma de llaves del
-- repositorio y con la de producción.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

-- ── 1. Permisos ─────────────────────────────────────────────────────────────
DO $$
DECLARE f text := 'public.purgar_empresa(uuid, uuid, text, integer, text, boolean)';
        b text := 'public.purgar_empresa_bloqueantes(uuid, uuid[])';
BEGIN
  PERFORM pg_temp.chk(NOT has_function_privilege('anon', f, 'EXECUTE'), 'anon NO ejecuta purgar_empresa');
  PERFORM pg_temp.chk(NOT has_function_privilege('authenticated', f, 'EXECUTE'), 'authenticated NO ejecuta purgar_empresa');
  PERFORM pg_temp.chk(has_function_privilege('service_role', f, 'EXECUTE'), 'service_role (el edge) SÍ ejecuta purgar_empresa');
  PERFORM pg_temp.chk(NOT has_function_privilege('anon', b, 'EXECUTE')
                      AND NOT has_function_privilege('authenticated', b, 'EXECUTE')
                      AND NOT has_function_privilege('service_role', b, 'EXECUTE'),
                      'purgar_empresa_bloqueantes no la ejecuta nadie desde fuera');
  PERFORM pg_temp.chk((SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure), 'purgar_empresa es SECURITY DEFINER');
  PERFORM pg_temp.chk((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = f::regprocedure),
                      'purgar_empresa fija search_path vacío');
END $$;

-- ── 2. Compuertas: cada una rechaza con su código y NO cambia nada ──────────
DO $$
DECLARE
  antes   jsonb := pg_temp.huella_x();
  vecinos jsonb := pg_temp.huella_vecinos();
  caso    record;
  r       text;
BEGIN
  FOR caso IN SELECT * FROM (VALUES
    ('actor company_owner',          pg_temp.purga_x(p_actor => 'a0000000-0000-4000-8000-0000000000a1'), '42501 PURGA_SOLO_SUPERADMIN:'),
    ('actor inexistente',            pg_temp.purga_x(p_actor => 'a0000000-0000-4000-8000-0000000000ff'), '42501 PURGA_SOLO_SUPERADMIN:'),
    ('actor cuenta cliente',         pg_temp.purga_x(p_actor => 'a0000000-0000-4000-8000-0000000000c1'), '42501 PURGA_SOLO_SUPERADMIN:'),
    ('empresa inexistente',          pg_temp.purga_x(p_empresa => 'e9000000-0000-4000-8000-000000000009'), 'P0002 PURGA_EMPRESA_NO_ENCONTRADA:'),
    ('nombre con otra capitalización', pg_temp.purga_x(p_nombre => 'residencial purga'), '22023 PURGA_NOMBRE_NO_COINCIDE:'),
    ('nombre con espacio de más',    pg_temp.purga_x(p_nombre => 'Residencial Purga '), '22023 PURGA_NOMBRE_NO_COINCIDE:'),
    ('empresa activa (Y)',           pg_temp.purga_x(p_empresa => 'e2000000-0000-4000-8000-000000000002', p_nombre => 'Condominio Vecino'), '55000 PURGA_EMPRESA_ACTIVA:'),
    ('empresa en gracia (Z)',        pg_temp.purga_x(p_empresa => 'e3000000-0000-4000-8000-000000000003', p_nombre => 'Recién Suspendida'), '55000 PURGA_EN_GRACIA:'),
    ('gracia mayor que la suspensión', pg_temp.purga_x(p_gracia => 200), '55000 PURGA_EN_GRACIA:'),
    ('actor colgado de la empresa',  pg_temp.purga_x(p_actor => 'a0000000-0000-4000-8000-00000000005a'), '22023 PURGA_ACTOR_DE_LA_EMPRESA:'),
    ('gracia 0',                     pg_temp.purga_x(p_gracia => 0), '22023 PURGA_PARAMETROS:'),
    ('gracia negativa',              pg_temp.purga_x(p_gracia => -5), '22023 PURGA_PARAMETROS:'),
    ('gracia NULL',                  pg_temp.purga_x(p_gracia => NULL), '22023 PURGA_PARAMETROS:'),
    ('nombre NULL',                  pg_temp.purga_x(p_nombre => NULL), '22023 PURGA_PARAMETROS:')
  ) AS t(nombre, sql, esperado)
  LOOP
    r := pg_temp.intento(caso.sql);
    PERFORM pg_temp.chk(r LIKE caso.esperado || '%', format('compuerta «%s» → %s (recibido: %s)', caso.nombre, caso.esperado, left(r, 90)));
  END LOOP;
  PERFORM pg_temp.chk(pg_temp.huella_x() = antes, 'tras las 14 compuertas: X intacta (personas, datos, auditoría)');
  PERFORM pg_temp.chk(pg_temp.huella_vecinos() = vecinos, 'tras las 14 compuertas: Y y Z intactas');
END $$;

-- La suspensión en gracia NO depende del nombre de la columna: sin suspended_at
-- tampoco pasa (una empresa suspendida a mano, sin sello).
DO $$
DECLARE antes jsonb; r text;
BEGIN
  BEGIN
    ALTER TABLE public.companies DISABLE TRIGGER USER;
    UPDATE public.companies SET suspended_at = NULL WHERE id = 'e1000000-0000-4000-8000-000000000001';
    ALTER TABLE public.companies ENABLE TRIGGER USER;
    antes := pg_temp.huella_x();
    r := pg_temp.intento(pg_temp.purga_x());
    PERFORM pg_temp.chk(r LIKE '55000 PURGA_EN_GRACIA:%', 'suspendida SIN suspended_at → PURGA_EN_GRACIA');
    PERFORM pg_temp.chk(pg_temp.huella_x() = antes, 'suspendida sin sello: nada cambió');
    RAISE EXCEPTION 'DESHACER';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'DESHACER' THEN RAISE; END IF;
  END;
END $$;

-- ── 3. TODO O NADA: un fallo en cualquier punto no deja personas borradas ──
-- 3a. Falla el DELETE FINAL de companies (el caso que dejaba la empresa viva y
--     sin personas): para entonces la RPC ya desligó al superadministrador,
--     borró personas, escribió la auditoría y vació los datos.
DO $$
DECLARE antes jsonb := pg_temp.huella_x(); vecinos jsonb := pg_temp.huella_vecinos(); r text;
BEGIN
  CREATE FUNCTION pg_temp.falla_inyectada() RETURNS trigger LANGUAGE plpgsql AS
    $f$ BEGIN RAISE EXCEPTION 'FALLA_INYECTADA en %', TG_TABLE_NAME USING ERRCODE = 'XX000'; END $f$;

  CREATE TRIGGER zz_falla_inyectada BEFORE DELETE ON public.companies
    FOR EACH ROW EXECUTE FUNCTION pg_temp.falla_inyectada();
  r := pg_temp.intento(pg_temp.purga_x());
  DROP TRIGGER zz_falla_inyectada ON public.companies;
  PERFORM pg_temp.chk(r LIKE 'XX000 FALLA_INYECTADA en companies%', 'falla inyectada en el DELETE final de companies → la purga falla');
  PERFORM pg_temp.chk(pg_temp.huella_x() = antes,
    'falla en el DELETE final: personas, superadministrador ligado, clientes, datos y auditoría INTACTOS');
  PERFORM pg_temp.chk(pg_temp.huella_vecinos() = vecinos, 'falla en el DELETE final: vecinos intactos');

  -- 3b. Falla DESPUÉS de borrar la empresa (en los clientes exclusivos).
  CREATE TRIGGER zz_falla_inyectada BEFORE DELETE ON public.clientes
    FOR EACH ROW EXECUTE FUNCTION pg_temp.falla_inyectada();
  r := pg_temp.intento(pg_temp.purga_x());
  DROP TRIGGER zz_falla_inyectada ON public.clientes;
  PERFORM pg_temp.chk(r LIKE 'XX000 FALLA_INYECTADA en clientes%', 'falla inyectada en el último paso (clientes) → la purga falla');
  PERFORM pg_temp.chk(pg_temp.huella_x() = antes, 'falla tras borrar la empresa: la empresa VUELVE a estar, con todo');

  -- 3c. Falla el INSERT de auditoría: antes se ignoraba y la purga seguía.
  CREATE TRIGGER zz_falla_inyectada BEFORE INSERT ON public.audit_log
    FOR EACH ROW EXECUTE FUNCTION pg_temp.falla_inyectada();
  r := pg_temp.intento(pg_temp.purga_x());
  DROP TRIGGER zz_falla_inyectada ON public.audit_log;
  PERFORM pg_temp.chk(r LIKE 'XX000 FALLA_INYECTADA en audit_log%', 'falla el INSERT de auditoría → la purga NO sigue');
  PERFORM pg_temp.chk(pg_temp.huella_x() = antes, 'sin auditoría no se borra nada');

  -- 3d. Falla el UPDATE que desliga al superadministrador: también se ignoraba.
  CREATE TRIGGER zz_falla_inyectada BEFORE UPDATE ON public.app_users
    FOR EACH ROW EXECUTE FUNCTION pg_temp.falla_inyectada();
  r := pg_temp.intento(pg_temp.purga_x());
  DROP TRIGGER zz_falla_inyectada ON public.app_users;
  PERFORM pg_temp.chk(r LIKE 'XX000 FALLA_INYECTADA en app_users%', 'falla el UPDATE del superadministrador → la purga NO sigue');
  PERFORM pg_temp.chk(pg_temp.huella_x() = antes, 'sin desligar al superadministrador no se borra nada');
END $$;

-- 3e. Historia que la purga no rodea: una bitácora inmutable de la pasarela
--     que referencia (RESTRICT) una solicitud de pago de X. Desde
--     20261030000000 la detiene la compuerta de retención, antes de escribir
--     nada, con el nombre de la bitácora (antes: 23503 a mitad de la purga).
DO $$
DECLARE antes jsonb; r text;
BEGIN
  BEGIN
    INSERT INTO public.pasarela_eventos (company_id, payment_request_id, provider, clave_evento, estado_informado, origen)
    SELECT company_id, id, 'sandbox', 'evt-purga-1', 'aprobado', 'webhook'
      FROM public.payment_requests WHERE company_id = 'e1000000-0000-4000-8000-000000000001';
    antes := pg_temp.huella_x();
    r := pg_temp.intento(pg_temp.purga_x());
    PERFORM pg_temp.chk(r LIKE '55000 PURGA_RETENCION:%pasarela_eventos (1)%',
      format('bitácora inmutable de la pasarela → PURGA_RETENCION que la nombra (recibido: %s)', left(r, 140)));
    PERFORM pg_temp.chk(pg_temp.huella_x() = antes, 'historia inmutable: nada cambió');
    RAISE EXCEPTION 'DESHACER';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'DESHACER' THEN RAISE; END IF;
  END;
END $$;

-- ── 4. Ensayo: hace todo y lo revierte ─────────────────────────────────────
DO $$
DECLARE antes jsonb := pg_temp.huella_x(); r text;
BEGIN
  r := pg_temp.intento(pg_temp.purga_x(p_ensayo => true));
  PERFORM pg_temp.chk(r LIKE 'P0001 PURGA_ENSAYO_OK:%', 'el ensayo llega al final y lo señala con PURGA_ENSAYO_OK');
  PERFORM pg_temp.chk(pg_temp.huella_x() = antes, 'el ensayo no deja rastro');
END $$;

-- ── 5. La purga, como la llama el edge (service_role) ──────────────────────
CREATE TEMP TABLE resultado_purga (r jsonb);
GRANT ALL ON resultado_purga TO service_role;
CREATE TEMP TABLE vecinos_antes AS SELECT pg_temp.huella_vecinos() AS h, (SELECT count(*) FROM auth.users) AS auth_users;
SET ROLE service_role;
INSERT INTO resultado_purga
SELECT public.purgar_empresa('e1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a',
                             'Residencial Purga', 90, 'sub_123');
RESET ROLE;

DO $$
DECLARE
  X  constant uuid := 'e1000000-0000-4000-8000-000000000001';
  r  jsonb := (SELECT r FROM resultado_purga);
  a  record;
BEGIN
  -- Respuesta
  PERFORM pg_temp.chk(r->'usuarios_auth' = '["a0000000-0000-4000-8000-0000000000a1","a0000000-0000-4000-8000-0000000000a2","a0000000-0000-4000-8000-0000000000a3","a0000000-0000-4000-8000-0000000000c1"]'::jsonb,
    'usuarios_auth = owner, admin y operador de X + la cuenta del cliente exclusivo (ni superadmins ni la cuenta compartida)');
  PERFORM pg_temp.chk((r->>'personas')::int = 3 AND (r->>'cuentas_cliente')::int = 1 AND (r->>'clientes')::int = 2
                      AND (r->>'proyectos')::int = 2 AND (r->>'unidades')::int = 1 AND (r->>'superadmins_desligados')::int = 1
                      AND (r->>'pagos')::int = 3 AND (r->>'registros')::int = 1,
    'conteos devueltos: 3 personas, 1 cuenta cliente, 2 clientes, 2 proyectos, 1 unidad, 1 superadmin desligado, 3 cobros, 1 lectura');
  PERFORM pg_temp.chk(r->>'logo_url' = 'logos/x.png', 'devuelve el logo para que el edge lo borre de storage');

  -- La empresa y sus datos
  PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM public.companies WHERE id = X), 'la empresa ya no existe');
  PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM public.projects WHERE company_id = X), 'sus proyectos tampoco');
  PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM public.unidades WHERE company_id = X), 'ni sus unidades');
  PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM public.conta_cuentas WHERE company_id = X),
    'ni su catálogo contable, cuentas de sistema incluidas (conta.allow_system_write en la transacción)');
  PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM public.subscriptions WHERE company_id = X), 'ni su suscripción');
  PERFORM pg_temp.chk(pg_temp.huella_x()->'bloqueantes' = '[0,0,0,0,0,0,0,0,0]'::jsonb,
    'las 9 tablas con FK NO ACTION hacia companies/projects quedaron vacías para X');
  PERFORM pg_temp.chk(current_setting('conta.allow_system_write', true) IS DISTINCT FROM 'on',
    'conta.allow_system_write NO queda encendido fuera de la transacción de la purga');

  -- Personas
  PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM public.app_users WHERE id IN (
      'a0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000a2',
      'a0000000-0000-4000-8000-0000000000a3', 'a0000000-0000-4000-8000-0000000000c1')),
    'owner, admin, operador y la cuenta del cliente exclusivo, fuera de app_users');
  PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = 'a0000000-0000-4000-8000-0000000000a1')
                      AND NOT EXISTS (SELECT 1 FROM public.roles WHERE user_override_for = 'a0000000-0000-4000-8000-0000000000a2'),
    'con ellos, sus user_roles y su rol de ajustes');
  SELECT * INTO a FROM public.app_users WHERE id = 'a0000000-0000-4000-8000-00000000005a';
  PERFORM pg_temp.chk(FOUND AND a.company_id IS NULL AND a.project_id IS NULL AND a.role = 'superadmin',
    'el superadministrador colgado se DESLIGA (company_id y project_id a NULL), no se borra');
  PERFORM pg_temp.chk(EXISTS (SELECT 1 FROM public.app_users WHERE id = 'a0000000-0000-4000-8000-00000000000a' AND role = 'super_admin'),
    'el actor sigue intacto');
  SELECT * INTO a FROM public.app_users WHERE id = 'a0000000-0000-4000-8000-0000000000c2';
  PERFORM pg_temp.chk(FOUND AND a.cliente_id = 'c1000000-0000-4000-8000-000000000002' AND a.project_id IS NULL,
    'la cuenta del cliente compartido con Y se conserva; sólo pierde el project_id de X');
  SELECT * INTO a FROM public.app_users WHERE id = 'a0000000-0000-4000-8000-0000000000b2';
  PERFORM pg_temp.chk(FOUND AND a.company_id = 'e2000000-0000-4000-8000-000000000002' AND a.project_id IS NULL,
    'una persona de Y que apuntaba a un proyecto de X conserva su empresa y pierde ese project_id');
  PERFORM pg_temp.chk((SELECT count(*) FROM auth.users) = (SELECT auth_users FROM vecinos_antes),
    'auth.users intacto: lo borra el edge DESPUÉS del COMMIT, no la RPC');

  -- Clientes
  PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM public.clientes WHERE id IN
      ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000003')),
    'clientes exclusivos de X (con y sin proyecto) borrados: no quedan datos personales huérfanos');
  PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM public.pagos WHERE cliente_id = 'c1000000-0000-4000-8000-000000000001'),
    'y su pago, en cascada');
  PERFORM pg_temp.chk(EXISTS (SELECT 1 FROM public.clientes WHERE id = 'c1000000-0000-4000-8000-000000000002' AND project_id IS NULL)
                      AND EXISTS (SELECT 1 FROM public.company_clientes WHERE cliente_id = 'c1000000-0000-4000-8000-000000000002'
                                     AND company_id = 'e2000000-0000-4000-8000-000000000002')
                      AND NOT EXISTS (SELECT 1 FROM public.company_clientes WHERE company_id = X),
    'el cliente compartido se conserva con su vínculo a Y; los vínculos con X desaparecen');

  -- Auditoría
  SELECT * INTO a FROM public.audit_log WHERE table_name = 'companies' AND record_id = X;
  PERFORM pg_temp.chk((SELECT count(*) FROM public.audit_log WHERE table_name = 'companies' AND record_id = X) = 1,
    'exactamente UNA fila de auditoría de la purga');
  PERFORM pg_temp.chk(a.action = 'DELETE' AND a.actor_id = 'a0000000-0000-4000-8000-00000000000a' AND a.company_id = X,
    'auditoría: DELETE, actor y empresa correctos');
  PERFORM pg_temp.chk(a.before->>'nombre' = 'Residencial Purga' AND a.before->>'suspended_reason' = 'impago'
                      AND (a.before->>'grace_days')::int = 90 AND a.before->>'stripe_subscription_canceled' = 'sub_123',
    'auditoría: fila de la empresa, gracia y suscripción cancelada');
  PERFORM pg_temp.chk(a.before->'usuarios_auth' = r->'usuarios_auth'
                      AND a.before->'superadmins_desligados' = '["a0000000-0000-4000-8000-00000000005a"]'::jsonb
                      AND a.before->'deleted_counts' = '{"projects":2,"unidades":1,"usuarios":3,"cuentas_cliente":1,"clientes":2,"pagos":3,"registros":1}'::jsonb,
    'auditoría: identidades a borrar de auth, superadmins desligados y conteos');

  -- Vecinos
  PERFORM pg_temp.chk(pg_temp.huella_vecinos() = (SELECT h FROM vecinos_antes), 'Y y Z: ni una fila tocada');

  -- Repetir no hace nada a medias.
  PERFORM pg_temp.chk(pg_temp.intento(pg_temp.purga_x()) LIKE 'P0002 PURGA_EMPRESA_NO_ENCONTRADA:%',
    'una segunda purga responde «no encontrada»');
END $$;

-- ── 6. La única empresa elegible de producción (forma medida el 2026-10-12) ──
DO $$
DECLARE Q constant uuid := 'e4000000-0000-4000-8000-000000000004'; r text;
BEGIN
  PERFORM pg_temp.chk((SELECT count(*) FROM public.conta_cuentas WHERE company_id = Q AND es_sistema) = 49
                      AND (SELECT count(*) FROM public.conta_mapeo_cuentas WHERE company_id = Q) = 31
                      AND (SELECT count(*) FROM public.subscriptions WHERE company_id = Q) = 1
                      AND NOT EXISTS (SELECT 1 FROM public.projects WHERE company_id = Q)
                      AND NOT EXISTS (SELECT 1 FROM public.app_users WHERE company_id = Q),
    'Q reproduce la empresa elegible de producción: 49 cuentas de sistema, 31 mapeos, 1 suscripción, 0 proyectos, 0 personas');
  -- Lo que hacía el edge anterior al final: un DELETE directo. Nunca podía pasar.
  r := pg_temp.intento(format('DELETE FROM public.companies WHERE id = %L', Q));
  PERFORM pg_temp.chk(r LIKE '23514 CUENTA_DE_SISTEMA:%',
    format('el DELETE directo de la purga anterior falla en las cuentas de sistema (recibido: %s)', left(r, 80)));
  r := pg_temp.intento(pg_temp.purga_x(p_empresa => Q::text, p_nombre => 'Solo Catálogo'));
  PERFORM pg_temp.chk(r = 'OK', format('purgar_empresa sí la purga (recibido: %s)', left(r, 120)));
  PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM public.companies WHERE id = Q)
                      AND NOT EXISTS (SELECT 1 FROM public.conta_cuentas WHERE company_id = Q)
                      AND NOT EXISTS (SELECT 1 FROM public.conta_mapeo_cuentas WHERE company_id = Q)
                      AND NOT EXISTS (SELECT 1 FROM public.subscriptions WHERE company_id = Q),
    'Q: empresa, catálogo, mapeos y suscripción borrados');
  PERFORM pg_temp.chk((SELECT count(*) FROM public.audit_log WHERE table_name = 'companies' AND record_id = Q AND action = 'DELETE') = 1,
    'Q: con su fila de auditoría');
END $$;
