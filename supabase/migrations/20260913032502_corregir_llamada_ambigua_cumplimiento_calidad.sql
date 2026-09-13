-- ════════════════════════════════════════════════════════════════════════════
-- Corregir la llamada ambigua del cálculo autoritativo de calidad de agua.
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL DEFECTO. `trg_registros_calidad_cumplimiento()` (20260603140000, serv:S22)
-- llama a `public.calcular_cumplimiento_calidad(text, jsonb)` con DOS
-- argumentos. Desde 20260605160000 (serv:S23) existen dos sobrecargas que
-- aceptan esa llamada:
--
--   · calcular_cumplimiento_calidad(p_tipo_agua text, p_parametros jsonb)
--       IMMUTABLE, umbrales embebidos en el cuerpo (la versión S22).
--   · calcular_cumplimiento_calidad(p_tipo_agua text, p_parametros jsonb,
--                                   p_company_id uuid DEFAULT NULL)
--       STABLE, lee public.calidad_tipologias (catálogo global + override por
--       empresa). Es la implementación que S23 quería que usara el trigger.
--
-- Postgres no elige entre «la firma exacta» y «la firma con DEFAULT»: la llamada
-- de dos argumentos es AMBIGUA y cada INSERT en registros_calidad, y cada UPDATE
-- de parametros o fuente_id, muere con
--     SQLSTATE 42725 · function public.calcular_cumplimiento_calidad(text, jsonb)
--                      is not unique
-- Medido en producción (nnsqmeigtgewatameexo) el 2026-09-13 dentro de una
-- transacción revertida, como `postgres` y como `authenticated`. La aplicación
-- no puede guardar un análisis de calidad desde el 2026-06-05.
--
-- QUÉ HACE ESTA MIGRACIÓN (append-only; ninguna migración histórica se toca)
--
--   1. Crea `trg_registros_calidad_cumplimiento_catalogo()`, SECURITY INVOKER
--      y `search_path = ''` como la de S22, que llama a la firma de TRES
--      argumentos —inequívoca— pasando el `company_id` de la fuente, para que
--      el override de la empresa dueña de la fuente prevalezca sobre el
--      catálogo global exactamente como S23 lo diseñó.
--   2. Re-apunta el trigger `registros_calidad_cumplimiento` (mismo nombre,
--      mismo OID: CREATE OR REPLACE TRIGGER no hace DROP/CREATE) a esa función.
--      El nombre importa: los BEFORE ROW disparan en orden alfabético, y así
--      sigue corriendo ANTES de `registros_calidad_fill_company_id` y de
--      `trg_sellar_creado_por`, igual que hoy.
--   3. Concede EXECUTE sobre la firma de tres argumentos a `authenticated`
--      —y sólo a él; PUBLIC y anon siguen sin poder—. Es imprescindible: un
--      trigger SECURITY INVOKER corre como el usuario que inserta, y Postgres
--      comprueba el EXECUTE de una función llamada DESDE el cuerpo en cada
--      llamada (a diferencia del EXECUTE sobre la propia función de trigger,
--      que se comprueba sólo en CREATE TRIGGER). Sin la concesión el fallo
--      cambiaría de 42725 a 42501. No es un privilegio nuevo de verdad: la
--      función es SECURITY INVOKER y STABLE, sólo lee calidad_tipologias
--      —tabla que `authenticated` ya lee bajo su RLS (global + su empresa)—
--      y la firma de dos argumentos ya está expuesta a anon y authenticated
--      desde S22. Ver el bloque 3 para el detalle.
--
-- DOS ENDURECIMIENTOS DELIBERADOS, pequeños y necesarios para que «el servidor
-- es autoritativo» y «aislamiento por empresa» sean verdad, no sólo intención:
--
--   · Una `fuente_id` que el usuario NO puede ver (RLS de fuentes_agua) se
--     rechaza con 42501 en vez de aceptar la fila con cumplimiento `{}`. La FK
--     se comprueba SIN RLS, así que sin este cheque una cuenta podía colgar un
--     análisis de la fuente de otra empresa. Con `fuente_id` NULL se mantiene
--     el comportamiento de S22: `{}` y cumple_total = false.
--   · El trigger dispara también en UPDATE OF cumplimiento, cumple_total. Con
--     S22 un UPDATE que sólo tocara esas dos columnas no disparaba el trigger
--     y el cliente podía fijar `cumple_total = true` a mano.
--
-- QUÉ NO HACE (y por qué)
--
--   · NO modifica ni elimina `trg_registros_calidad_cumplimiento()` ni la
--     sobrecarga de dos argumentos. Las dos están declaradas en
--     scripts/schema-drift/drift-conocido.json: su cuerpo en producción no es
--     el de las migraciones (se editaron a mano; inventario en #826). Un
--     CREATE OR REPLACE o un DROP sobre un objeto cuyo estado real no describe
--     el repositorio es exactamente lo que el auditor de drift clasifica como
--     CAMBIO AMBIGUO, y con razón: se estaría pisando algo que no se conoce.
--     Quedan sin consumidores (ningún trigger apunta a la función vieja; ningún
--     código de src/ ni de Edge Functions llama a calcular_cumplimiento_calidad)
--     y retirarlas es un PR aparte, tras converger la huella.
--   · NO toca el cuerpo, el propietario ni la volatilidad de ninguna de las dos
--     sobrecargas; NO convierte nada en SECURITY DEFINER; NO concede nada a
--     PUBLIC ni a anon; NO toca tablas, policies, ni huella-produccion.json.
--
-- ALTERNATIVAS DESCARTADAS
--   a) CREATE OR REPLACE de la función vieja con la llamada de tres args:
--      cambio ambiguo para el auditor (objeto con drift declarado) y pisa un
--      cuerpo editado a mano en producción.
--   b) DROP de la sobrecarga de dos argumentos: mismo problema, y además
--      cambia una ACL/objeto expuesto sin necesidad para corregir el trigger.
--   c) SECURITY DEFINER en la función de trigger para no conceder EXECUTE:
--      escala privilegios de lectura sobre fuentes_agua y calidad_tipologias
--      (saltaría la RLS de las dos) para ahorrarse un GRANT acotado. Peor.
--   d) Calcular en el propio trigger sin llamar a la función: duplica la
--      lógica del catálogo, que es lo que S23 vino a unificar.
--   → Se elige la de menor alcance: función nueva + re-apuntar + un GRANT a un
--     solo rol, todo declarado y verificable celda por celda en pg_catalog.
--
-- REVERTIR (vuelve el 42725; sólo como marcha atrás de emergencia):
--   CREATE OR REPLACE TRIGGER registros_calidad_cumplimiento
--     BEFORE INSERT OR UPDATE OF parametros, fuente_id ON public.registros_calidad
--     FOR EACH ROW EXECUTE FUNCTION public.trg_registros_calidad_cumplimiento();
--   DROP FUNCTION public.trg_registros_calidad_cumplimiento_catalogo();
--   REVOKE EXECUTE ON FUNCTION public.calcular_cumplimiento_calidad(text, jsonb, uuid)
--     FROM authenticated;
--
-- Pruebas: supabase/tests/cumplimiento_calidad_firma_inequivoca/ (run.sh y
-- replay.mjs, cableados en .github/workflows/coverage.yml).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0. Precondiciones: se aborta sin tocar nada si el mundo no es el esperado ─
DO $$
DECLARE
  v_tabla  oid := to_regclass('public.registros_calidad')::oid;
  v_fn3    oid := to_regprocedure('public.calcular_cumplimiento_calidad(text, jsonb, uuid)')::oid;
  v_fn2    oid := to_regprocedure('public.calcular_cumplimiento_calidad(text, jsonb)')::oid;
  v_vieja  oid := to_regprocedure('public.trg_registros_calidad_cumplimiento()')::oid;
  v_nueva  oid := to_regprocedure('public.trg_registros_calidad_cumplimiento_catalogo()')::oid;
  v_trg    record;
BEGIN
  IF v_tabla IS NULL THEN
    RAISE EXCEPTION 'falta public.registros_calidad' USING ERRCODE = 'undefined_table';
  END IF;
  IF to_regclass('public.fuentes_agua') IS NULL OR to_regclass('public.calidad_tipologias') IS NULL THEN
    RAISE EXCEPTION 'faltan public.fuentes_agua o public.calidad_tipologias (20260605160000)'
      USING ERRCODE = 'undefined_table';
  END IF;
  IF v_fn3 IS NULL THEN
    RAISE EXCEPTION 'falta public.calcular_cumplimiento_calidad(text, jsonb, uuid) (20260605160000)'
      USING ERRCODE = 'undefined_function';
  END IF;
  -- Esta migración presupone que la firma de tres argumentos es SECURITY
  -- INVOKER (lo es desde S23): el GRANT del bloque 3 no expone nada que la
  -- RLS de calidad_tipologias no filtre ya. Si alguien la hubiera convertido
  -- en DEFINER, ese GRANT sí sería una escalada, y se corta aquí.
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_fn3) THEN
    RAISE EXCEPTION 'public.calcular_cumplimiento_calidad(text, jsonb, uuid) es SECURITY DEFINER; '
                    'esta migración presupone SECURITY INVOKER y no concede EXECUTE sobre una DEFINER'
      USING ERRCODE = 'invalid_function_definition';
  END IF;
  IF v_fn2 IS NULL THEN
    RAISE NOTICE 'la sobrecarga (text, jsonb) no existe: la llamada ya no sería ambigua, pero se re-apunta igual a la firma de tres argumentos';
  END IF;

  -- Homónimo en OTRA tabla: no se pisa.
  FOR v_trg IN
    SELECT t.oid, c.relname, n.nspname
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE t.tgname = 'registros_calidad_cumplimiento' AND NOT t.tgisinternal AND t.tgrelid <> v_tabla
  LOOP
    RAISE EXCEPTION 'ya existe un trigger registros_calidad_cumplimiento sobre %.%, no sobre registros_calidad; no se toca nada',
      v_trg.nspname, v_trg.relname USING ERRCODE = 'duplicate_object';
  END LOOP;

  -- Si ya existe sobre registros_calidad, tiene que ser el de S22 (BEFORE ROW
  -- INSERT/UPDATE ejecutando la función vieja) o el de esta migración (re-
  -- aplicación). Cualquier otra forma es un homónimo desconocido: se aborta.
  SELECT t.tgtype, t.tgfoid, t.tgenabled::text AS tgenabled, t.tgnargs, (t.tgqual IS NOT NULL) AS con_when,
         t.tgconstraint::bigint AS tgconstraint
    INTO v_trg
    FROM pg_trigger t WHERE t.tgrelid = v_tabla AND t.tgname = 'registros_calidad_cumplimiento' AND NOT t.tgisinternal;
  IF FOUND THEN
    IF v_trg.tgtype <> 23 OR v_trg.tgnargs <> 0 OR v_trg.con_when OR v_trg.tgconstraint <> 0
       OR v_trg.tgfoid NOT IN (SELECT o FROM unnest(ARRAY[v_vieja, v_nueva]) AS o WHERE o IS NOT NULL) THEN
      RAISE EXCEPTION 'registros_calidad_cumplimiento existe con OTRA definición (tgtype=%, fn=%, args=%, when=%, constraint=%); no se toca nada',
        v_trg.tgtype, v_trg.tgfoid::regprocedure, v_trg.tgnargs, v_trg.con_when, v_trg.tgconstraint
        USING ERRCODE = 'duplicate_object';
    END IF;
  END IF;
END $$;

-- ── 1. La función de trigger, con la llamada inequívoca ──────────────────────
-- SECURITY INVOKER a propósito: la lectura de fuentes_agua y de
-- calidad_tipologias queda bajo la RLS del usuario que inserta. Es lo que hace
-- que «la fuente de otra empresa» no sea visible y que el override de otra
-- empresa no se pueda usar aunque se conozca su company_id.
CREATE OR REPLACE FUNCTION public.trg_registros_calidad_cumplimiento_catalogo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_tipo_agua  text;
  v_company_id uuid;
  v_result     jsonb;
BEGIN
  -- El tipo de agua y la empresa se derivan de la fuente. Se lee bajo RLS: una
  -- fuente que el usuario no ve es, para él, una fuente que no existe, y la FK
  -- no lo cubre porque las FK se comprueban sin RLS.
  IF NEW.fuente_id IS NOT NULL THEN
    SELECT fa.tipo_agua, fa.company_id
      INTO v_tipo_agua, v_company_id
      FROM public.fuentes_agua fa
     WHERE fa.id = NEW.fuente_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'registros_calidad: la fuente % no existe o no es visible para el usuario actual', NEW.fuente_id
        USING ERRCODE = 'insufficient_privilege',
              HINT = 'Sólo se pueden registrar análisis de fuentes de la propia empresa.';
    END IF;
  END IF;

  -- Tres argumentos, siempre: es la única forma de llamada que no es ambigua
  -- mientras convivan las dos sobrecargas, y es la implementación de S23
  -- (catálogo calidad_tipologias: override de la empresa de la fuente, y si
  -- no hay, el global). Con fuente NULL: tipo '' → {} y cumple_total = false,
  -- como en S22.
  v_result := public.calcular_cumplimiento_calidad(
    COALESCE(v_tipo_agua, ''),
    COALESCE(NEW.parametros, '{}'::jsonb),
    v_company_id
  );

  -- El servidor es autoritativo: lo que mande el cliente en estas dos columnas
  -- se pisa, en INSERT y en cualquier UPDATE que las toque.
  NEW.cumplimiento := COALESCE(v_result -> 'cumplimiento', '{}'::jsonb);
  NEW.cumple_total := COALESCE((v_result ->> 'cumple_total')::boolean, false);
  RETURN NEW;
END;
$$;

-- Una función de trigger no se invoca directamente (sólo la dispara Postgres,
-- que comprueba el EXECUTE en CREATE TRIGGER y no en cada disparo). Se deja
-- con la misma ACL que sellar_actor(): sin PUBLIC, anon ni authenticated.
REVOKE EXECUTE ON FUNCTION public.trg_registros_calidad_cumplimiento_catalogo() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.trg_registros_calidad_cumplimiento_catalogo() TO service_role;

-- ── 2. Re-apuntar el trigger: mismo nombre, mismo OID, sin DROP ──────────────
-- UPDATE OF incluye cumplimiento y cumple_total: un UPDATE que sólo toque esas
-- dos columnas también se recalcula (con S22 no disparaba el trigger).
CREATE OR REPLACE TRIGGER registros_calidad_cumplimiento
  BEFORE INSERT OR UPDATE OF parametros, fuente_id, cumplimiento, cumple_total
  ON public.registros_calidad
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_registros_calidad_cumplimiento_catalogo();

-- ── 3. EXECUTE sobre la firma de tres argumentos para authenticated ──────────
-- Por qué hace falta: el trigger es SECURITY INVOKER, así que dentro de él
-- current_user es quien inserta (`authenticated` desde la app) y Postgres
-- comprueba el EXECUTE de calcular_cumplimiento_calidad(text, jsonb, uuid) en
-- ESA llamada. S23 la dejó sólo para service_role creyendo que «el trigger corre
-- como el dueño de la tabla»; no es así para un trigger INVOKER.
--
-- Por qué no es una escalada: la función es SECURITY INVOKER y STABLE; sólo
-- lee calidad_tipologias, cuya policy de SELECT ya deja a `authenticated` ver
-- el catálogo global y los overrides de SU empresa (y ninguno más). Con el
-- company_id de otra empresa, la consulta interna no ve el override ajeno y
-- cae al global: no hay nada que leer que no pudiera leer ya con un SELECT.
-- PUBLIC y anon siguen SIN EXECUTE (se re-declara el REVOKE, idempotente).
REVOKE EXECUTE ON FUNCTION public.calcular_cumplimiento_calidad(text, jsonb, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.calcular_cumplimiento_calidad(text, jsonb, uuid) TO authenticated, service_role;

-- ── 4. Postcondición: se lee pg_catalog y se aborta si algo no quedó como se dijo
DO $$
DECLARE
  v_tabla  oid := to_regclass('public.registros_calidad')::oid;
  v_fn3    oid := to_regprocedure('public.calcular_cumplimiento_calidad(text, jsonb, uuid)')::oid;
  v_vieja  oid := to_regprocedure('public.trg_registros_calidad_cumplimiento()')::oid;
  v_nueva  oid := to_regprocedure('public.trg_registros_calidad_cumplimiento_catalogo()')::oid;
  v_trg    record;
  v_cols   text[];
  v_n      int;
  v_rol    text;
BEGIN
  IF v_nueva IS NULL THEN
    RAISE EXCEPTION 'postcondición: no existe trg_registros_calidad_cumplimiento_catalogo()';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_nueva) THEN
    RAISE EXCEPTION 'postcondición: trg_registros_calidad_cumplimiento_catalogo() quedó SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) c WHERE p.oid = v_nueva AND c = 'search_path=""') THEN
    RAISE EXCEPTION 'postcondición: trg_registros_calidad_cumplimiento_catalogo() no tiene search_path = ''''';
  END IF;

  -- Exactamente UN trigger con ese nombre en todo el catálogo, sobre la tabla,
  -- BEFORE ROW INSERT/UPDATE, habilitado, sin args ni WHEN, ejecutando la nueva.
  SELECT count(*) INTO v_n FROM pg_trigger WHERE tgname = 'registros_calidad_cumplimiento' AND NOT tgisinternal;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'postcondición: hay % trigger(s) llamados registros_calidad_cumplimiento y debía haber 1', v_n;
  END IF;
  SELECT t.tgrelid, t.tgfoid, t.tgtype, t.tgenabled::text AS tgenabled, t.tgnargs,
         (t.tgqual IS NOT NULL) AS con_when, t.tgconstraint::bigint AS tgconstraint, t.tgattr
    INTO v_trg
    FROM pg_trigger t WHERE t.tgname = 'registros_calidad_cumplimiento' AND NOT t.tgisinternal;
  IF v_trg.tgrelid <> v_tabla OR v_trg.tgfoid <> v_nueva OR v_trg.tgtype <> 23 OR v_trg.tgenabled <> 'O'
     OR v_trg.tgnargs <> 0 OR v_trg.con_when OR v_trg.tgconstraint <> 0 THEN
    RAISE EXCEPTION 'postcondición: registros_calidad_cumplimiento no quedó como se declaró (tabla=%, fn=%, tgtype=%, enabled=%, args=%, when=%, constraint=%)',
      v_trg.tgrelid::regclass, v_trg.tgfoid::regprocedure, v_trg.tgtype, v_trg.tgenabled, v_trg.tgnargs, v_trg.con_when, v_trg.tgconstraint;
  END IF;
  SELECT array_agg(a.attname::text ORDER BY a.attname) INTO v_cols
    FROM unnest(v_trg.tgattr::int2[]) AS k JOIN pg_attribute a ON a.attrelid = v_tabla AND a.attnum = k;
  IF v_cols IS DISTINCT FROM ARRAY['cumple_total', 'cumplimiento', 'fuente_id', 'parametros'] THEN
    RAISE EXCEPTION 'postcondición: UPDATE OF quedó en % y debía ser {cumple_total,cumplimiento,fuente_id,parametros}', v_cols;
  END IF;

  -- Ningún trigger sigue apuntando a la función vieja (que NO se toca).
  IF v_vieja IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM pg_trigger WHERE tgfoid = v_vieja;
    IF v_n <> 0 THEN
      RAISE EXCEPTION 'postcondición: % trigger(s) siguen ejecutando trg_registros_calidad_cumplimiento()', v_n;
    END IF;
  END IF;

  -- La firma de tres argumentos: sigue INVOKER, y la ACL es exactamente la
  -- declarada. Los roles pueden no existir en un Postgres de laboratorio.
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_fn3) THEN
    RAISE EXCEPTION 'postcondición: calcular_cumplimiento_calidad(text, jsonb, uuid) quedó SECURITY DEFINER';
  END IF;
  IF has_function_privilege('public', v_fn3, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondición: PUBLIC puede ejecutar calcular_cumplimiento_calidad(text, jsonb, uuid)';
  END IF;
  FOREACH v_rol IN ARRAY ARRAY['anon'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_rol) AND has_function_privilege(v_rol, v_fn3, 'EXECUTE') THEN
      RAISE EXCEPTION 'postcondición: % puede ejecutar calcular_cumplimiento_calidad(text, jsonb, uuid)', v_rol;
    END IF;
  END LOOP;
  FOREACH v_rol IN ARRAY ARRAY['authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_rol) AND NOT has_function_privilege(v_rol, v_fn3, 'EXECUTE') THEN
      RAISE EXCEPTION 'postcondición: % NO puede ejecutar calcular_cumplimiento_calidad(text, jsonb, uuid)', v_rol;
    END IF;
  END LOOP;
  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_rol) AND has_function_privilege(v_rol, v_nueva, 'EXECUTE') THEN
      RAISE EXCEPTION 'postcondición: % puede ejecutar trg_registros_calidad_cumplimiento_catalogo()', v_rol;
    END IF;
  END LOOP;

  -- La forma exacta de la llamada que hace el trigger resuelve sin 42725.
  PERFORM public.calcular_cumplimiento_calidad(''::text, '{}'::jsonb, NULL::uuid);

  RAISE NOTICE 'registros_calidad_cumplimiento → trg_registros_calidad_cumplimiento_catalogo() · BEFORE INSERT OR UPDATE OF cumple_total, cumplimiento, fuente_id, parametros · calcular_cumplimiento_calidad(text, jsonb, uuid): authenticated=sí anon=no PUBLIC=no service_role=sí';
END $$;
