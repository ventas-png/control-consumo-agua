-- ════════════════════════════════════════════════════════════════════════════
-- Los dos triggers de fill_company_id_from_user() que sólo existían en producción
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ PASÓ, Y DÓNDE SE VIO
-- Producción (nnsqmeigtgewatameexo) tiene dos triggers que NINGUNA migración
-- declara. Se crearon a mano, y por eso una reconstrucción desde cero —una
-- Preview de Supabase, un staging, el Postgres desechable del auditor— nace sin
-- ellos:
--
--   public.fuentes_agua       fuentes_agua_fill_company_id
--   public.registros_calidad  registros_calidad_fill_company_id
--   ambos: BEFORE INSERT · FOR EACH ROW · EXECUTE FUNCTION public.fill_company_id_from_user()
--
-- (pg_trigger de producción, leído el 2026-09-12: tgtype = 7, tgenabled = 'O',
-- sin WHEN, sin argumentos, no deferrable, sin tablas de transición.)
--
-- El auditor de drift lo tenía declarado desde el 2026-09-01 en
-- scripts/schema-drift/drift-conocido.json como `tabla:fuentes_agua/triggers`
-- (producción 2, repositorio 1) y `tabla:registros_calidad/triggers`
-- (producción 4, repositorio 3), y #858 lo volvió a ver en su Preview: 3 de los
-- 5 triggers que dependen de 20260911223000, porque faltaban estos dos.
--
-- QUÉ HACE EL TRIGGER. `fill_company_id_from_user()` rellena `company_id` con
-- el de `app_users` del usuario de la sesión cuando la fila llega sin él. Las
-- policies de INSERT de las dos tablas (20260521000003) exigen
-- `company_id = get_my_company_id()`, y el BEFORE INSERT corre ANTES del
-- WITH CHECK: sin el trigger, una inserción sin `company_id` explícito falla
-- por RLS en cualquier entorno reconstruido y pasa en producción. Ésa es la
-- diferencia de comportamiento que este archivo cierra.
--
-- ESTA MIGRACIÓN NO CAMBIA PRODUCCIÓN. Sobre prod es un no-op: ambos triggers
-- ya existen con esta definición exacta, y el bloque de abajo lo comprueba
-- celda por celda ANTES de decidir no hacer nada. Lo que cambia es la
-- reconstrucción.
--
-- ── SIN DROP/CREATE CIEGO ────────────────────────────────────────────────────
-- Un `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` dejaría el mismo estado final,
-- pero recrearía en producción un objeto que ya está bien (y ocultaría un
-- trigger homónimo con OTRA definición, que es justo lo que hay que ver). Por
-- cada uno de los dos se decide con pg_catalog:
--
--   · ausente en la tabla                → se crea;
--   · presente con la definición exacta  → no-op (NOTICE);
--   · presente con OTRA definición       → EXCEPCIÓN 42710 (nombra el objeto);
--   · homónimo en OTRA tabla             → EXCEPCIÓN 42710.
--
-- «Definición exacta» = mismas celdas de pg_trigger: función (tgfoid), tipo
-- (tgtype = 7: ROW | BEFORE | INSERT), habilitado (tgenabled = 'O'), sin
-- argumentos (tgnargs = 0), sin WHEN (tgqual), no constraint trigger
-- (tgconstraint = 0, no deferrable), sin tablas de transición. Se lee el
-- catálogo y no `pg_get_triggerdef`, cuyo texto depende del search_path.
--
-- ── LO QUE NO TOCA ───────────────────────────────────────────────────────────
-- Ni el cuerpo, ni el SECURITY DEFINER, ni la ACL de fill_company_id_from_user()
-- (la fijó 20260911223000: sólo service_role). No concede EXECUTE a nadie: el
-- CREATE TRIGGER lo ejecuta el dueño de la función, y Postgres verifica ese
-- EXECUTE en el CREATE TRIGGER, no en cada disparo — así `authenticated`
-- inserta y el trigger rellena company_id sin poder invocar la función
-- directamente. Ni tablas, ni policies, ni privilegios por defecto.
--
-- REVERSIÓN (dejaría la reconstrucción como estaba; producción los tenía antes
-- de este archivo y los seguiría teniendo si sólo se revierte el repo):
--   DROP TRIGGER IF EXISTS fuentes_agua_fill_company_id      ON public.fuentes_agua;
--   DROP TRIGGER IF EXISTS registros_calidad_fill_company_id ON public.registros_calidad;
--
-- Verificación ejecutable: supabase/tests/declarar_triggers_fill_company_id/
-- (arnés con fixture, idempotencia, no-op sobre triggers preexistentes,
-- abortos ante homónimos con otra definición, inserciones como authenticated y
-- mutación) y replay.mjs (la cadena entera desde cero con privilegios de
-- Supabase Branch, y las mismas inserciones sobre el esquema real).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Declarar los dos triggers, decidiendo con el catálogo ───────────────────
DO $$
DECLARE
  v_fn        regprocedure := to_regprocedure('public.fill_company_id_from_user()');
  v_esperado  record;
  v_tabla     regclass;
  v_hallado   record;
  v_ajenos    text;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION
      '20260912015504: no existe public.fill_company_id_from_user() — la declara 20260407000002'
      USING ERRCODE = '42883';
  END IF;

  FOR v_esperado IN
    SELECT * FROM (VALUES
      ('public.fuentes_agua',      'fuentes_agua_fill_company_id'),
      ('public.registros_calidad', 'registros_calidad_fill_company_id')
    ) AS t(tabla, trigger)
  LOOP
    v_tabla := to_regclass(v_esperado.tabla);
    IF v_tabla IS NULL THEN
      RAISE EXCEPTION '20260912015504: no existe la tabla %', v_esperado.tabla
        USING ERRCODE = '42P01';
    END IF;

    -- Un trigger con este nombre sobre OTRA tabla no es «el nuestro» y no se
    -- toca; tampoco se sigue como si nada. Se aborta nombrándolo.
    SELECT string_agg(format('%s (%s)', c.oid::regclass, pg_get_triggerdef(t.oid)), '; ')
      INTO v_ajenos
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE t.tgname = v_esperado.trigger
       AND NOT t.tgisinternal
       AND t.tgrelid <> v_tabla;
    IF v_ajenos IS NOT NULL THEN
      RAISE EXCEPTION
        '20260912015504: ya existe un trigger % sobre otra tabla, no sobre %: %',
        v_esperado.trigger, v_esperado.tabla, v_ajenos
        USING ERRCODE = '42710';
    END IF;

    SELECT t.oid,
           t.tgfoid, t.tgtype, t.tgenabled, t.tgnargs,
           (t.tgqual IS NOT NULL)     AS con_when,
           t.tgconstraint, t.tgdeferrable, t.tginitdeferred,
           (t.tgoldtable IS NOT NULL) AS con_oldtable,
           (t.tgnewtable IS NOT NULL) AS con_newtable
      INTO v_hallado
      FROM pg_trigger t
     WHERE t.tgrelid = v_tabla
       AND t.tgname  = v_esperado.trigger
       AND NOT t.tgisinternal;

    IF NOT FOUND THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT ON %s FOR EACH ROW EXECUTE FUNCTION public.fill_company_id_from_user()',
        v_esperado.trigger, v_tabla);
      RAISE NOTICE '20260912015504: creado % ON %', v_esperado.trigger, v_esperado.tabla;

    ELSIF v_hallado.tgfoid = v_fn::oid
      AND v_hallado.tgtype = 7            -- ROW (1) | BEFORE (2) | INSERT (4)
      AND v_hallado.tgenabled = 'O'
      AND v_hallado.tgnargs = 0
      AND NOT v_hallado.con_when
      AND v_hallado.tgconstraint = 0
      AND NOT v_hallado.tgdeferrable
      AND NOT v_hallado.tginitdeferred
      AND NOT v_hallado.con_oldtable
      AND NOT v_hallado.con_newtable
    THEN
      RAISE NOTICE '20260912015504: % ON % ya existe con la definición exacta — no-op',
        v_esperado.trigger, v_esperado.tabla;

    ELSE
      RAISE EXCEPTION
        '20260912015504: % ON % existe con OTRA definición y no se reemplaza a ciegas: % [tgtype=%, tgenabled=%, tgnargs=%, when=%, constraint=%]',
        v_esperado.trigger, v_esperado.tabla, pg_get_triggerdef(v_hallado.oid),
        v_hallado.tgtype, v_hallado.tgenabled, v_hallado.tgnargs, v_hallado.con_when, v_hallado.tgconstraint
        USING ERRCODE = '42710',
              HINT = 'Revisá el trigger existente a mano: si es el que producción tiene, esta migración no debería llegar aquí; si no, decidí cuál de los dos es el correcto antes de tocar nada.';
    END IF;
  END LOOP;
END $$;

-- ── Postcondición: la definición exacta, celda por celda, en pg_catalog ─────
-- Una migración que declara triggers y no comprueba el resultado es una
-- declaración de intenciones. Se lee pg_trigger otra vez —no la variable del
-- bloque anterior— y se exige, para cada uno: exactamente UN trigger con ese
-- nombre en todo el catálogo, sobre la tabla esperada, con cada celda igual a
-- la de producción. Y que este archivo no haya movido lo que no le toca: la
-- función sigue siendo SECURITY DEFINER y ni PUBLIC, ni anon, ni authenticated
-- ganaron EXECUTE (los roles ausentes en un Postgres pelado no cuentan).
DO $$
DECLARE
  v_fn       regprocedure := to_regprocedure('public.fill_company_id_from_user()');
  v_esperado record;
  v_n        int;
  v_r        record;
  v_rol      text;
BEGIN
  FOR v_esperado IN
    SELECT * FROM (VALUES
      ('public.fuentes_agua',      'fuentes_agua_fill_company_id'),
      ('public.registros_calidad', 'registros_calidad_fill_company_id')
    ) AS t(tabla, trigger)
  LOOP
    SELECT count(*) INTO v_n
      FROM pg_trigger t
     WHERE t.tgname = v_esperado.trigger AND NOT t.tgisinternal;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '20260912015504: postcondición — hay % trigger(s) llamados % y debe haber exactamente 1',
        v_n, v_esperado.trigger;
    END IF;

    SELECT t.tgrelid, t.tgfoid, t.tgtype, t.tgenabled, t.tgnargs,
           (t.tgqual IS NOT NULL) AS con_when, t.tgconstraint, t.tgdeferrable, t.tginitdeferred,
           (t.tgoldtable IS NOT NULL OR t.tgnewtable IS NOT NULL) AS con_transicion
      INTO v_r
      FROM pg_trigger t
     WHERE t.tgname = v_esperado.trigger AND NOT t.tgisinternal;

    IF v_r.tgrelid <> to_regclass(v_esperado.tabla)
       OR v_r.tgfoid <> v_fn::oid
       OR v_r.tgtype <> 7
       OR v_r.tgenabled <> 'O'
       OR v_r.tgnargs <> 0
       OR v_r.con_when
       OR v_r.tgconstraint <> 0
       OR v_r.tgdeferrable
       OR v_r.tginitdeferred
       OR v_r.con_transicion
    THEN
      RAISE EXCEPTION
        '20260912015504: postcondición — % no quedó como BEFORE INSERT FOR EACH ROW EXECUTE FUNCTION public.fill_company_id_from_user() sobre % [tabla=%, fn=%, tgtype=%, tgenabled=%, tgnargs=%, when=%, constraint=%]',
        v_esperado.trigger, v_esperado.tabla, v_r.tgrelid::regclass, v_r.tgfoid::regprocedure,
        v_r.tgtype, v_r.tgenabled, v_r.tgnargs, v_r.con_when, v_r.tgconstraint;
    END IF;
  END LOOP;

  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn::oid) THEN
    RAISE EXCEPTION '20260912015504: postcondición — fill_company_id_from_user() dejó de ser SECURITY DEFINER';
  END IF;
  FOREACH v_rol IN ARRAY ARRAY['public', 'anon', 'authenticated'] LOOP
    CONTINUE WHEN v_rol <> 'public' AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_rol);
    IF has_function_privilege(v_rol, v_fn::oid, 'EXECUTE') THEN
      RAISE EXCEPTION '20260912015504: postcondición — % tiene EXECUTE sobre fill_company_id_from_user(); 20260911223000 lo dejó sólo para service_role',
        v_rol USING ERRCODE = '42501';
    END IF;
  END LOOP;
END $$;
