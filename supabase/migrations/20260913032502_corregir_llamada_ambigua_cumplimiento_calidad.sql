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
-- ════════════════════════════════════════════════════════════════════════════
-- EL CONTRATO DE RBAC: CREAR NO EXIGE `agua.calidad.view`
-- ════════════════════════════════════════════════════════════════════════════
-- Las policies de hoy NO son simétricas, y esta migración las respeta tal cual:
--
--   registros_calidad_insert/update · un `operator`/`operador` de la empresa
--       puede escribir POR SU ROL, sin ninguna fila en user_roles/role_permissions.
--   fuentes_agua_select            · sólo ve fuentes quien es super_admin o
--       tiene `agua.calidad.view` (y `user_has_permission` sólo regala el true a
--       super_admin/company_owner/admin).
--
-- Un `operator` sin `agua.calidad.view` pasa la policy de INSERT y NO puede leer
-- la fuente. Si el trigger —que es SECURITY INVOKER— resolviera `tipo_agua` con
-- un SELECT amplio sobre `fuentes_agua`, ese usuario recibiría 42501 al guardar
-- un análisis que la policy sí le autoriza. Ese rechazo está MEDIDO en
-- supabase/tests/cumplimiento_calidad_firma_inequivoca (paso 4/12).
--
-- DECISIÓN: opción (b). CREAR sigue funcionando sin `view`.
-- Alinear las policies para exigir `view` al crear/editar sería recortar, dentro
-- de una corrección de un 42725, una capacidad que los operadores tienen hoy en
-- producción; y la necesidad de conocer `tipo_agua` es un detalle interno del
-- servidor que no debe filtrarse al contrato de permisos del usuario.
--
-- Así que la resolución de la fuente NO usa el SELECT amplio: usa
-- `public.agua_fuente_de_mi_empresa(uuid)`, una función acotada que responde
-- UNA sola pregunta —«¿esta fuente es de mi empresa y de qué tipo de agua es?»—
-- y no devuelve nada para una fuente ajena. Es SECURITY DEFINER (tiene que
-- saltarse la RLS de fuentes_agua para poder responder sin `view`), pero:
--   · lleva `search_path = ''` y todo cualificado por esquema;
--   · re-implementa el aislamiento por empresa en su propio WHERE
--     (`company_id = get_my_company_id()` o `is_super_admin()`), que es la misma
--     condición de tenant de `fuentes_agua_select` MENOS el permiso `view`;
--   · devuelve dos escalares (tipo_agua, company_id) de una fuente de la PROPIA
--     empresa: nada que ese usuario no pudiera ver si tuviera `view`;
--   · no acepta company_id del cliente, así que no hay parámetro que falsear;
--   · sin EXECUTE para PUBLIC ni anon.
-- El trigger sigue siendo SECURITY INVOKER: `fuentes_agua` NO se abre y
-- `calidad_tipologias` se sigue leyendo bajo la RLS del usuario.
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL CONTRATO PRIVILEGIADO: postgres, service_role y supabase_admin
-- ════════════════════════════════════════════════════════════════════════════
-- La función acotada responde «¿esta fuente es de MI empresa?», y «mi empresa»
-- sale del JWT: `get_my_company_id()` e `is_super_admin()` dependen de
-- `auth.uid()`. Un actor sin JWT —una sesión SQL administrativa, un backfill,
-- una Edge Function con la service key— no tiene empresa, así que la acotada no
-- le devolvería NINGUNA fuente y todo INSERT/UPDATE con `fuente_id` no nula
-- moriría con 42501. Eso NO es aceptable: rompería seeds, backfills y cualquier
-- operación de servicio, que antes de este PR funcionaban.
--
-- Por eso el trigger tiene DOS caminos, y la decisión se toma donde se puede
-- tomar con seguridad:
--
--   · La pregunta «¿a quien está insertando le aplica la RLS?» se resuelve
--     DENTRO de la función de trigger, que es SECURITY INVOKER. Ahí, y sólo
--     ahí, `CURRENT_USER` es de verdad el rol que ejecuta la sentencia. Dentro
--     de la acotada —SECURITY DEFINER— `CURRENT_USER` sería el DUEÑO de la
--     función, así que preguntárselo allí no identificaría al invocador: sería
--     un bypass disfrazado. Por eso el cheque NO vive en la DEFINER.
--   · El predicado es `rolsuper OR rolbypassrls` sobre `pg_catalog.pg_roles`,
--     que es exactamente el que usa Postgres para saltarse la RLS, y que NO se
--     hereda por pertenencia a otro rol. En producción: `postgres` y
--     `service_role` lo cumplen (rolbypassrls), `supabase_admin` también
--     (rolsuper); `anon` y `authenticated` no lo cumplen. Un usuario de la API
--     no puede fabricárselo: tendría que ser miembro de uno de esos roles.
--   · Quien lo cumple resuelve la fuente con un SELECT sobre `fuentes_agua`
--     bajo SUS PROPIOS permisos. No es una concesión: a quien la RLS no le
--     aplica, la acotada no le protegía nada que no pudiera leer ya con un
--     SELECT directo sobre la tabla. Una `fuente_id` inexistente se rechaza con
--     23503 (foreign_key_violation), no con 42501: para él no hay nada oculto.
--   · Quien NO lo cumple (anon, authenticated) va por la acotada, con el
--     aislamiento por empresa intacto.
--
-- Consecuencia de ACL: `service_role` se queda SIN EXECUTE sobre la acotada.
-- No es un recorte de soporte, es lo contrario: para él la acotada siempre
-- devolvería cero filas, y dejarle el GRANT anunciaría un camino que no
-- funciona. Su camino es el privilegiado, y no necesita esa función.
--
-- NOTA para operaciones administrativas: el trigger `registros_calidad_fill_
-- company_id` (20260911223000) rellena `company_id` desde `auth.uid()`, que
-- tampoco existe sin JWT. Un backfill como postgres o service_role tiene que
-- pasar `company_id` explícitamente, igual que antes de este PR.
--
-- EDITAR, EN CAMBIO, SÍ EXIGE HOY `agua.calidad.view`, Y NO POR ESTE PR.
-- PostgreSQL aplica las policies de SELECT a un `UPDATE … WHERE` porque la
-- cláusula lee columnas de la tabla. Como `registros_calidad_select` exige
-- `agua.calidad.view`, el UPDATE de un `operator` sin ese permiso no alcanza
-- NINGUNA fila: no da error y no cambia nada. Es una asimetría de las policies
-- (20260521000003 + 20260519000009) anterior a esta migración, que ni la causa
-- ni la corrige. Se deja MEDIDA, no tapada, en el arnés (paso 5/12, caso 4):
-- el operador sin `view` no toca la fila y el mismo `operator` CON `view` sí la
-- edita y el servidor le recalcula. Alinearlas —dar `view` al que edita, o
-- exigir `view` también al crear— cambia el contrato de permisos del producto
-- y es una decisión humana: va en un PR aparte, no dentro de la corrección de
-- un 42725.
--
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ HACE (append-only; ninguna migración histórica se toca)
-- ════════════════════════════════════════════════════════════════════════════
--   1. Crea `public.agua_fuente_de_mi_empresa(uuid)` (arriba), el camino de
--      anon/authenticated. Sin EXECUTE para PUBLIC, anon ni service_role.
--   2. Crea `trg_registros_calidad_cumplimiento_catalogo()`, SECURITY INVOKER y
--      `search_path = ''` como la de S22, que llama a la firma de TRES
--      argumentos —inequívoca— pasando el `company_id` de la fuente, para que el
--      override de la empresa dueña de la fuente prevalezca sobre el catálogo
--      global exactamente como S23 lo diseñó.
--   3. Re-apunta el trigger `registros_calidad_cumplimiento` (mismo nombre,
--      mismo OID: CREATE OR REPLACE TRIGGER no hace DROP/CREATE) a esa función.
--      El nombre importa: los BEFORE ROW disparan en orden alfabético, y así
--      sigue corriendo ANTES de `registros_calidad_fill_company_id` y de
--      `trg_sellar_creado_por`, igual que hoy.
--   4. Concede EXECUTE sobre la firma de tres argumentos a `authenticated`
--      —y sólo a él; PUBLIC y anon siguen sin poder—. Es imprescindible: un
--      trigger SECURITY INVOKER corre como el usuario que inserta, y Postgres
--      comprueba el EXECUTE de una función llamada DESDE el cuerpo en cada
--      llamada (a diferencia del EXECUTE sobre la propia función de trigger,
--      que se comprueba sólo en CREATE TRIGGER). Sin la concesión el fallo
--      cambiaría de 42725 a 42501. No es un privilegio nuevo de verdad: la
--      función es SECURITY INVOKER y STABLE, sólo lee calidad_tipologias
--      —tabla que `authenticated` ya lee bajo su RLS (global + su empresa)— y
--      la firma de dos argumentos ya está expuesta a anon y authenticated desde
--      S22.
--
-- DOS ENDURECIMIENTOS DELIBERADOS, pequeños y necesarios para que «el servidor
-- es autoritativo» y «aislamiento por empresa» sean verdad, no sólo intención:
--
--   · Una `fuente_id` que no es de la empresa del usuario se rechaza con 42501
--     en vez de aceptar la fila con cumplimiento `{}`. La FK se comprueba SIN
--     RLS, así que sin este cheque una cuenta podía colgar un análisis de la
--     fuente de otra empresa. Con `fuente_id` NULL se mantiene el
--     comportamiento de S22: `{}` y cumple_total = false.
--   · El trigger dispara también en UPDATE OF cumplimiento, cumple_total. Con
--     S22 un UPDATE que sólo tocara esas dos columnas no disparaba el trigger
--     y el cliente podía fijar `cumple_total = true` a mano.
--
-- ════════════════════════════════════════════════════════════════════════════
-- FAIL-CLOSED: SE APLICA SOBRE UN MUNDO CONOCIDO O NO SE APLICA
-- ════════════════════════════════════════════════════════════════════════════
-- El bloque 0 aborta sin tocar NADA si el catálogo no está en uno de los dos
-- estados que esta migración sabe leer:
--
--   · `registros_calidad_cumplimiento` tiene que existir sobre
--     public.registros_calidad y ser, celda por celda, o bien el de S22
--     (fn vieja, UPDATE OF {fuente_id, parametros}) o bien el de esta migración
--     (fn nueva, UPDATE OF {cumple_total, cumplimiento, fuente_id, parametros}).
--     Se comprueban tgtype, tgenabled, tgnargs, WHEN, constraint Y tgattr: un
--     trigger DESHABILITADO o con otro UPDATE OF aborta.
--   · si las funciones que esta migración crea YA existen (reaplicación), su
--     cuerpo, lenguaje, volatilidad, SECURITY, search_path, PROPIETARIO y ACL
--     tienen que coincidir EXACTAMENTE con lo que aquí se declara. Un homónimo
--     con otro cuerpo o con otra ACL aborta en vez de que CREATE OR REPLACE lo
--     pise (que además conservaría la ACL y el dueño ajenos en silencio).
--
--   · ANTES de concederle EXECUTE a `authenticated`, se valida ENTERA la firma
--     `calcular_cumplimiento_calidad(text, jsonb, uuid)`: lenguaje plpgsql,
--     STABLE, SECURITY INVOKER, `search_path = ''`, propietario, argumentos
--     exactos, retorno `jsonb`, no SETOF, 3 argumentos con 1 DEFAULT, y la ACL
--     PREVIA (la de S23, o la que deja esta misma migración al reaplicarse).
--     Conceder EXECUTE sobre una función que no se ha mirado es firmar en
--     blanco.
--     El CUERPO sólo puede ser una de DOS variantes exactas, por md5: la de
--     producción y la de 20260605160000 (difieren; es drift declarado en #826).
--     Además se comprueba de qué están hechas: las dos leen
--     public.calidad_tipologias y ninguna otra relación de public, ninguna
--     escribe y ninguna usa SQL dinámico. Si el cuerpo cambia, hay que mirarlo
--     y declarar su md5 en una migración posterior.
--   · Y se comprueba la RLS de la que depende su aislamiento: como la función
--     es SECURITY INVOKER, lo único que impide que `authenticated` vea el
--     override de otra empresa es la RLS de `calidad_tipologias` y su policy
--     `calidad_tipologias_select`. Se exige `relrowsecurity` y esa policy
--     exacta (FOR SELECT TO authenticated USING (company_id IS NULL OR
--     company_id = get_my_company_id())). Sin eso, el GRANT no se hace.
--
-- Los cuerpos viven UNA sola vez, en las constantes del bloque, y se instalan
-- con EXECUTE format(..., %L): lo que se compara es literalmente lo que se
-- instala, sin una segunda copia que se pueda desincronizar.
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
--     sobrecargas; NO abre `fuentes_agua` (ninguna policy se toca); NO convierte
--     la función de trigger en SECURITY DEFINER; NO concede nada a PUBLIC ni a
--     anon; NO toca tablas, policies, ni huella-produccion.json.
--
-- ALTERNATIVAS DESCARTADAS
--   a) CREATE OR REPLACE de la función vieja con la llamada de tres args:
--      cambio ambiguo para el auditor (objeto con drift declarado) y pisa un
--      cuerpo editado a mano en producción.
--   b) DROP de la sobrecarga de dos argumentos: mismo problema, y además
--      cambia una ACL/objeto expuesto sin necesidad para corregir el trigger.
--   c) SECURITY DEFINER en TODA la función de trigger: se saltaría también la
--      RLS de calidad_tipologias, así que el override de otra empresa pasaría a
--      ser alcanzable. La versión acotada sólo resuelve la fuente.
--   d) Exigir `agua.calidad.view` para crear/editar (alinear las policies):
--      recorta permisos vigentes de los operadores. Ver EL CONTRATO DE RBAC.
--   e) Calcular en el propio trigger sin llamar a la función: duplica la
--      lógica del catálogo, que es lo que S23 vino a unificar.
--   f) Detectar al actor privilegiado DENTRO de la acotada (SECURITY DEFINER)
--      mirando `current_user`: allí `current_user` es el dueño de la función,
--      no el invocador, así que el cheque daría true SIEMPRE y convertiría la
--      acotada en un lector sin filtro de fuentes_agua para cualquiera.
--   g) Quitar los GRANT y declarar no soportados a service_role y a las
--      sesiones administrativas: rompe seeds, backfills y Edge Functions con la
--      service key, que hoy funcionan.
--
-- REVERTIR (vuelve el 42725; sólo como marcha atrás de emergencia):
--   CREATE OR REPLACE TRIGGER registros_calidad_cumplimiento
--     BEFORE INSERT OR UPDATE OF parametros, fuente_id ON public.registros_calidad
--     FOR EACH ROW EXECUTE FUNCTION public.trg_registros_calidad_cumplimiento();
--   DROP FUNCTION public.trg_registros_calidad_cumplimiento_catalogo();
--   DROP FUNCTION public.agua_fuente_de_mi_empresa(uuid);
--   REVOKE EXECUTE ON FUNCTION public.calcular_cumplimiento_calidad(text, jsonb, uuid)
--     FROM authenticated;
--
-- Pruebas: supabase/tests/cumplimiento_calidad_firma_inequivoca/ (run.sh y
-- replay.mjs, cableados en .github/workflows/coverage.yml).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0 · Precondiciones, cuerpos canónicos y creación de las dos funciones ────
DO $mig$
DECLARE
  -- Los cuerpos, UNA sola vez: se comparan y se instalan desde aquí.
  c_cuerpo_fuente constant text := $cuerpo_fuente$
  SELECT fa.tipo_agua, fa.company_id
    FROM public.fuentes_agua fa
   WHERE fa.id = p_fuente_id
     AND (fa.company_id = public.get_my_company_id() OR public.is_super_admin())
$cuerpo_fuente$;

  c_cuerpo_trg constant text := $cuerpo_trg$
DECLARE
  v_tipo_agua  text;
  v_company_id uuid;
  v_result     jsonb;
  v_sin_rls    boolean;
BEGIN
  IF NEW.fuente_id IS NOT NULL THEN
    -- ¿A quien esta insertando le aplica la RLS? La pregunta se resuelve AQUI,
    -- dentro de una funcion SECURITY INVOKER, que es el unico sitio donde
    -- CURRENT_USER es de verdad el rol que ejecuta la sentencia. Dentro de una
    -- SECURITY DEFINER (la acotada) CURRENT_USER seria el DUENO de la funcion y
    -- preguntarselo ahi seria un bypass, no una identificacion.
    -- rolsuper / rolbypassrls no se heredan por pertenencia: es exactamente el
    -- mismo predicado que usa el planificador para saltarse la RLS.
    SELECT (r.rolsuper OR r.rolbypassrls) INTO v_sin_rls
      FROM pg_catalog.pg_roles r WHERE r.rolname = CURRENT_USER;

    IF COALESCE(v_sin_rls, false) THEN
      -- CONTRATO PRIVILEGIADO: postgres, service_role y supabase_admin. No hay
      -- JWT del que derivar la empresa, asi que get_my_company_id() seria NULL y
      -- la acotada no devolveria ninguna fuente. Leen fuentes_agua con sus
      -- propios permisos: la RLS no les aplica, de modo que la acotada no
      -- protegeria de ellos nada que no puedan ver ya con un SELECT directo.
      SELECT fa.tipo_agua, fa.company_id
        INTO v_tipo_agua, v_company_id
        FROM public.fuentes_agua fa WHERE fa.id = NEW.fuente_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'registros_calidad: la fuente % no existe', NEW.fuente_id
          USING ERRCODE = 'foreign_key_violation';
      END IF;
    ELSE
      -- CONTRATO DE USUARIO (anon/authenticated): la fuente se resuelve con la
      -- funcion acotada, no con un SELECT sobre fuentes_agua, para que un
      -- `operator` sin `agua.calidad.view` —que la policy de INSERT si autoriza
      -- a escribir— pueda guardar su analisis; una fuente de otra empresa sigue
      -- siendo invisible, porque la acotada no devuelve fila.
      SELECT f.tipo_agua, f.company_id
        INTO v_tipo_agua, v_company_id
        FROM public.agua_fuente_de_mi_empresa(NEW.fuente_id) f;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'registros_calidad: la fuente % no existe o no pertenece a la empresa del usuario actual', NEW.fuente_id
          USING ERRCODE = 'insufficient_privilege',
                HINT = 'Solo se pueden registrar analisis de fuentes de la propia empresa.';
      END IF;
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
$cuerpo_trg$;

  -- Los DOS unicos cuerpos aceptados de calcular_cumplimiento_calidad(text,
  -- jsonb, uuid). Produccion y la cadena del repo difieren (drift declarado en
  -- #826, grupo «funcion:calcular_cumplimiento_calidad(..., p_company_id uuid)»),
  -- asi que se listan las dos variantes exactas y ninguna mas.
  c_md5_fn3 constant text[] := ARRAY[
    'd5c8752a1fab4f6d740b5b92e8f243e0',  -- produccion nnsqmeigtgewatameexo (1618 bytes)
    '892fa2f9e3702fee72b280434fb3aad8'   -- 20260605160000 del repo: Preview, replay y arnes (2321 bytes)
  ];
  c_args_fn3 constant text := 'p_tipo_agua text, p_parametros jsonb, p_company_id uuid';
  -- La policy de SELECT de calidad_tipologias, identica en produccion y en el
  -- repo. El aislamiento de la firma INVOKER depende de ella.
  c_qual_tip constant text := '((company_id IS NULL) OR (company_id = get_my_company_id()))';

  v_tabla   oid := to_regclass('public.registros_calidad')::oid;
  v_fn3     oid := to_regprocedure('public.calcular_cumplimiento_calidad(text, jsonb, uuid)')::oid;
  v_fn2     oid := to_regprocedure('public.calcular_cumplimiento_calidad(text, jsonb)')::oid;
  v_vieja   oid := to_regprocedure('public.trg_registros_calidad_cumplimiento()')::oid;
  v_nueva   oid := to_regprocedure('public.trg_registros_calidad_cumplimiento_catalogo()')::oid;
  v_fuente  oid := to_regprocedure('public.agua_fuente_de_mi_empresa(uuid)')::oid;
  v_dueno   text := current_user;
  v_trg     record;
  v_cols    text[];
  v_p       record;
  v_acl     text[];
  v_esp     text[];
  v_src     text;
  v_pol     record;
  v_n1      int;
  v_n2      int;
BEGIN
  -- ── 0.1 · El mundo mínimo que S22 y S23 dejaron ───────────────────────────
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
  IF to_regprocedure('public.get_my_company_id()') IS NULL
     OR to_regprocedure('public.is_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'faltan los helpers de tenant get_my_company_id() / is_super_admin()'
      USING ERRCODE = 'undefined_function';
  END IF;
  -- El GRANT del bloque 3 presupone que la firma de tres argumentos es SECURITY
  -- INVOKER (lo es desde S23): sobre una DEFINER ese mismo GRANT sería una
  -- escalada, así que se corta aquí.
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_fn3) THEN
    RAISE EXCEPTION 'public.calcular_cumplimiento_calidad(text, jsonb, uuid) es SECURITY DEFINER; '
                    'esta migración presupone SECURITY INVOKER y no concede EXECUTE sobre una DEFINER'
      USING ERRCODE = 'invalid_function_definition';
  END IF;
  IF v_fn2 IS NULL THEN
    RAISE NOTICE 'la sobrecarga (text, jsonb) no existe: la llamada ya no sería ambigua, pero se re-apunta igual a la firma de tres argumentos';
  END IF;

  -- ── 0.2 · La firma de TRES argumentos, ENTERA, antes de concederle EXECUTE ─
  -- El bloque 2 le da EXECUTE a `authenticated`. Conceder EXECUTE sobre una
  -- funcion cuya definicion no se ha mirado es firmar en blanco: aqui se
  -- comprueba TODO lo que hace que ese GRANT sea seguro y, si algo no cuadra, la
  -- migracion aborta sin crear funciones, sin re-apuntar el trigger y sin
  -- conceder nada.
  SELECT p.prosrc, p.prosecdef, p.provolatile::text AS volatil, p.proconfig,
         pg_get_userbyid(p.proowner) AS dueno, l.lanname, p.proretset,
         p.pronargs, p.pronargdefaults,
         pg_get_function_identity_arguments(p.oid) AS args,
         pg_get_function_result(p.oid) AS retorno
    INTO v_p FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = v_fn3;

  IF v_p.lanname <> 'plpgsql' OR v_p.volatil <> 's' OR v_p.prosecdef
     OR v_p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
     OR v_p.dueno <> v_dueno
     OR v_p.args <> c_args_fn3 OR v_p.retorno <> 'jsonb'
     OR v_p.proretset OR v_p.pronargs <> 3 OR v_p.pronargdefaults <> 1
  THEN
    RAISE EXCEPTION 'calcular_cumplimiento_calidad(text, jsonb, uuid) no es la función que esta migración sabe exponer (lenguaje=%, volatilidad=%, definer=%, search_path=%, dueño=%, args=%, retorno=%, setof=%, nargs=%, defaults=%); no se concede EXECUTE ni se toca nada',
      v_p.lanname, v_p.volatil, v_p.prosecdef,
      coalesce(array_to_string(v_p.proconfig, ','), '(ninguno)'), v_p.dueno,
      v_p.args, v_p.retorno, v_p.proretset, v_p.pronargs, v_p.pronargdefaults
      USING ERRCODE = 'invalid_function_definition',
            HINT = 'Se espera plpgsql, STABLE, SECURITY INVOKER, search_path vacío, del mismo dueño que aplica la migración, (text, jsonb, uuid DEFAULT NULL) → jsonb.';
  END IF;

  -- Cuerpo: sólo las dos variantes conocidas, y además se comprueba DE QUÉ están
  -- hechas. Las dos leen public.calidad_tipologias y ninguna otra relación de
  -- public; ninguna escribe y ninguna usa SQL dinámico. Eso es lo que hace que
  -- exponerla a `authenticated` bajo RLS sea seguro.
  v_src := v_p.prosrc;
  v_n1 := (length(v_src) - length(replace(v_src, 'public.', ''))) / length('public.');
  v_n2 := (length(v_src) - length(replace(v_src, 'public.calidad_tipologias', ''))) / length('public.calidad_tipologias');
  IF NOT (md5(v_src) = ANY (c_md5_fn3)) OR v_n2 = 0 OR v_n1 <> v_n2
     OR v_src ~* '\m(execute|insert|update|delete|truncate|create|drop|alter|grant|revoke|copy|dblink|pg_read)\M'
  THEN
    RAISE EXCEPTION 'el cuerpo de calcular_cumplimiento_calidad(text, jsonb, uuid) no es ninguna de las dos variantes autorizadas (md5=%, referencias a public.=%, de ellas a calidad_tipologias=%); no se concede EXECUTE ni se toca nada',
      md5(v_src), v_n1, v_n2
      USING ERRCODE = 'invalid_function_definition',
            HINT = 'Autorizadas: la variante de producción y la de 20260605160000. Si el cuerpo cambió a propósito, hay que revisarlo y declarar su md5 en una migración posterior.';
  END IF;

  -- ACL ANTERIOR: la de S23 (dueño + service_role) o la que deja esta misma
  -- migración al reaplicarse (+ authenticated). Ninguna otra: si alguien ya le
  -- hubiera dado EXECUTE a anon o a PUBLIC, esta migración no lo bendice.
  SELECT array_agg(x ORDER BY x) INTO v_acl FROM (
    SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS x
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_fn3 AND a.privilege_type = 'EXECUTE') s;
  SELECT array_agg(x ORDER BY x) INTO v_esp FROM unnest(ARRAY[v_dueno, 'service_role']) x;
  IF v_acl IS DISTINCT FROM v_esp THEN
    SELECT array_agg(x ORDER BY x) INTO v_esp FROM unnest(ARRAY[v_dueno, 'authenticated', 'service_role']) x;
    IF v_acl IS DISTINCT FROM v_esp THEN
      RAISE EXCEPTION 'la ACL previa de calcular_cumplimiento_calidad(text, jsonb, uuid) es {%} y no una de las dos esperadas ({%} antes de esta migración, {%} al reaplicarla); no se concede EXECUTE ni se toca nada',
        coalesce(array_to_string(v_acl, ','), 'vacía'),
        v_dueno || ',service_role', v_dueno || ',authenticated,service_role'
        USING ERRCODE = 'invalid_grant_operation';
    END IF;
  END IF;

  -- El aislamiento de una función INVOKER es la RLS de lo que lee. Sin la RLS de
  -- calidad_tipologias, o con otra policy de SELECT, `authenticated` pasaría a
  -- ver por esta función los overrides de otras empresas.
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.calidad_tipologias')) THEN
    RAISE EXCEPTION 'public.calidad_tipologias no tiene ENABLE ROW LEVEL SECURITY; el aislamiento de la firma de tres argumentos (SECURITY INVOKER) depende de esa RLS'
      USING ERRCODE = 'invalid_table_definition';
  END IF;
  SELECT pol.polcmd::text AS cmd, pol.polpermissive,
         replace(pg_get_expr(pol.polqual, pol.polrelid), 'public.', '') AS qual,
         (SELECT array_agg(r.rolname::text ORDER BY r.rolname)
            FROM unnest(pol.polroles) rr JOIN pg_roles r ON r.oid = rr) AS roles
    INTO v_pol
    FROM pg_policy pol
   WHERE pol.polrelid = to_regclass('public.calidad_tipologias')
     AND pol.polname = 'calidad_tipologias_select';
  IF NOT FOUND OR v_pol.cmd <> 'r' OR NOT v_pol.polpermissive
     OR v_pol.qual IS DISTINCT FROM c_qual_tip
     OR v_pol.roles IS DISTINCT FROM ARRAY['authenticated']
  THEN
    RAISE EXCEPTION 'la policy calidad_tipologias_select no es la esperada (cmd=%, permisiva=%, roles={%}, USING=%); no se concede EXECUTE ni se toca nada',
      coalesce(v_pol.cmd, '(no existe)'), v_pol.polpermissive,
      coalesce(array_to_string(v_pol.roles, ','), 'ninguno'), coalesce(v_pol.qual, '(ninguna)')
      USING ERRCODE = 'invalid_table_definition',
            HINT = 'Se espera FOR SELECT TO authenticated USING (company_id IS NULL OR company_id = get_my_company_id()), la de 20260605160000.';
  END IF;

  -- ── 0.3 · El trigger: homónimo en otra tabla ──────────────────────────────
  FOR v_trg IN
    SELECT c.relname, n.nspname
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE t.tgname = 'registros_calidad_cumplimiento' AND NOT t.tgisinternal AND t.tgrelid <> v_tabla
  LOOP
    RAISE EXCEPTION 'ya existe un trigger registros_calidad_cumplimiento sobre %.%, no sobre registros_calidad; no se toca nada',
      v_trg.nspname, v_trg.relname USING ERRCODE = 'duplicate_object';
  END LOOP;

  -- ── 0.4 · El trigger sobre la tabla: uno de DOS estados exactos ───────────
  -- Se leen TODAS las celdas, tgenabled y tgattr incluidos. Un trigger
  -- deshabilitado ('D', 'R' o 'A') o con otro UPDATE OF no es ninguno de los
  -- dos estados que esta migración sabe leer: aborta sin tocar nada.
  SELECT t.tgfoid, t.tgtype, t.tgenabled::text AS tgenabled, t.tgnargs,
         (t.tgqual IS NOT NULL) AS con_when, t.tgconstraint::bigint AS tgconstraint,
         (SELECT array_agg(a.attname::text ORDER BY a.attname)
            FROM unnest(t.tgattr::int2[]) k JOIN pg_attribute a ON a.attrelid = v_tabla AND a.attnum = k) AS cols
    INTO v_trg
    FROM pg_trigger t WHERE t.tgrelid = v_tabla AND t.tgname = 'registros_calidad_cumplimiento' AND NOT t.tgisinternal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no existe el trigger registros_calidad_cumplimiento sobre public.registros_calidad (lo crea 20260603140000); no se crea a ciegas'
      USING ERRCODE = 'undefined_object';
  END IF;

  v_cols := v_trg.cols;
  IF NOT (
       -- Estado VIEJO: el de S22.
       (v_vieja IS NOT NULL AND v_trg.tgfoid = v_vieja
        AND v_cols IS NOT DISTINCT FROM ARRAY['fuente_id', 'parametros'])
       -- Estado NUEVO: el de esta migración (reaplicación).
    OR (v_nueva IS NOT NULL AND v_trg.tgfoid = v_nueva
        AND v_cols IS NOT DISTINCT FROM ARRAY['cumple_total', 'cumplimiento', 'fuente_id', 'parametros'])
     )
     OR v_trg.tgtype <> 23 OR v_trg.tgenabled <> 'O' OR v_trg.tgnargs <> 0
     OR v_trg.con_when OR v_trg.tgconstraint <> 0
  THEN
    RAISE EXCEPTION 'registros_calidad_cumplimiento no está en un estado conocido (fn=%, tgtype=%, enabled=%, args=%, when=%, constraint=%, UPDATE OF=%); no se toca nada',
      v_trg.tgfoid::regprocedure, v_trg.tgtype, v_trg.tgenabled, v_trg.tgnargs,
      v_trg.con_when, v_trg.tgconstraint, coalesce(array_to_string(v_cols, ','), '(todas)')
      USING ERRCODE = 'duplicate_object',
            HINT = 'Se esperaba el trigger de 20260603140000 (UPDATE OF fuente_id, parametros) o el de esta migración, habilitado (tgenabled = O).';
  END IF;

  -- ── 0.5 · Las funciones que esta migración crea: o no existen, o son EXACTAS
  IF v_fuente IS NOT NULL THEN
    SELECT p.prosrc, p.prosecdef, p.provolatile::text AS volatil, p.proconfig,
           pg_get_userbyid(p.proowner) AS dueno, l.lanname,
           pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_function_result(p.oid) AS retorno
      INTO v_p FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = v_fuente;
    SELECT array_agg(x ORDER BY x) INTO v_acl FROM (
      SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS x
        FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       WHERE p.oid = v_fuente AND a.privilege_type = 'EXECUTE') s;
    SELECT array_agg(x ORDER BY x) INTO v_esp FROM unnest(ARRAY[v_dueno, 'authenticated']) x;
    IF v_p.prosrc IS DISTINCT FROM c_cuerpo_fuente OR NOT v_p.prosecdef OR v_p.volatil <> 's'
       OR v_p.lanname <> 'sql' OR v_p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
       OR v_p.dueno <> v_dueno OR v_acl IS DISTINCT FROM v_esp
       OR v_p.args <> 'p_fuente_id uuid' OR v_p.retorno <> 'TABLE(tipo_agua text, company_id uuid)'
    THEN
      RAISE EXCEPTION 'ya existe public.agua_fuente_de_mi_empresa(uuid) con OTRA definición (lenguaje=%, volatilidad=%, definer=%, search_path=%, dueño=%, ACL=%, cuerpo idéntico=%); no se toca nada',
        v_p.lanname, v_p.volatil, v_p.prosecdef, coalesce(array_to_string(v_p.proconfig, ','), '(ninguno)'),
        v_p.dueno, coalesce(array_to_string(v_acl, ','), '(vacía)'),
        (v_p.prosrc IS NOT DISTINCT FROM c_cuerpo_fuente)
        USING ERRCODE = 'duplicate_function',
              HINT = 'Reaplicar sólo está permitido si la función es byte a byte la que esta migración declara, con su dueño y su ACL.';
    END IF;
  END IF;

  IF v_nueva IS NOT NULL THEN
    SELECT p.prosrc, p.prosecdef, p.provolatile::text AS volatil, p.proconfig,
           pg_get_userbyid(p.proowner) AS dueno, l.lanname,
           pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_function_result(p.oid) AS retorno
      INTO v_p FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = v_nueva;
    SELECT array_agg(x ORDER BY x) INTO v_acl FROM (
      SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS x
        FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       WHERE p.oid = v_nueva AND a.privilege_type = 'EXECUTE') s;
    SELECT array_agg(x ORDER BY x) INTO v_esp FROM unnest(ARRAY[v_dueno, 'service_role']) x;
    IF v_p.prosrc IS DISTINCT FROM c_cuerpo_trg OR v_p.prosecdef OR v_p.volatil <> 'v'
       OR v_p.lanname <> 'plpgsql' OR v_p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
       OR v_p.dueno <> v_dueno OR v_acl IS DISTINCT FROM v_esp
       OR v_p.args <> '' OR v_p.retorno <> 'trigger'
    THEN
      RAISE EXCEPTION 'ya existe public.trg_registros_calidad_cumplimiento_catalogo() con OTRA definición (lenguaje=%, volatilidad=%, definer=%, search_path=%, dueño=%, ACL=%, cuerpo idéntico=%); no se toca nada',
        v_p.lanname, v_p.volatil, v_p.prosecdef, coalesce(array_to_string(v_p.proconfig, ','), '(ninguno)'),
        v_p.dueno, coalesce(array_to_string(v_acl, ','), '(vacía)'),
        (v_p.prosrc IS NOT DISTINCT FROM c_cuerpo_trg)
        USING ERRCODE = 'duplicate_function',
              HINT = 'Reaplicar sólo está permitido si la función es byte a byte la que esta migración declara, con su dueño y su ACL.';
    END IF;
  END IF;

  -- ── 0.6 · Instalación (lo que se instala es lo que se acaba de comparar) ──
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.agua_fuente_de_mi_empresa(p_fuente_id uuid) '
    'RETURNS TABLE(tipo_agua text, company_id uuid) LANGUAGE sql STABLE SECURITY DEFINER '
    'SET search_path = %L AS %L', '', c_cuerpo_fuente);
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.trg_registros_calidad_cumplimiento_catalogo() '
    'RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER '
    'SET search_path = %L AS %L', '', c_cuerpo_trg);

  -- La acotada la invoca el trigger INVOKER, o sea el usuario que inserta: hace
  -- falta EXECUTE para `authenticated`. Nunca para PUBLIC ni anon. Y TAMPOCO
  -- para service_role: la acotada responde «mi empresa», que se deriva del JWT,
  -- y service_role no tiene JWT, asi que para el siempre devolveria cero filas.
  -- Los actores privilegiados no pasan por aqui: el trigger los manda por la
  -- rama que lee fuentes_agua con sus propios permisos. Dejarle el GRANT seria
  -- anunciar un soporte que no existe.
  REVOKE EXECUTE ON FUNCTION public.agua_fuente_de_mi_empresa(uuid) FROM PUBLIC, anon, service_role;
  GRANT  EXECUTE ON FUNCTION public.agua_fuente_de_mi_empresa(uuid) TO authenticated;
  -- Una función de trigger no se invoca directamente (sólo la dispara Postgres,
  -- que comprueba el EXECUTE en CREATE TRIGGER y no en cada disparo). Misma ACL
  -- que sellar_actor(): sin PUBLIC, anon ni authenticated.
  REVOKE EXECUTE ON FUNCTION public.trg_registros_calidad_cumplimiento_catalogo() FROM PUBLIC, anon, authenticated;
  GRANT  EXECUTE ON FUNCTION public.trg_registros_calidad_cumplimiento_catalogo() TO service_role;

  -- Lo instalado es, byte a byte, la constante declarada arriba.
  IF (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.agua_fuente_de_mi_empresa(uuid)'))
       IS DISTINCT FROM c_cuerpo_fuente
     OR (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.trg_registros_calidad_cumplimiento_catalogo()'))
       IS DISTINCT FROM c_cuerpo_trg THEN
    RAISE EXCEPTION 'postcondición: el cuerpo instalado no coincide con el declarado en esta migración';
  END IF;
END $mig$;

-- ── 1 · Re-apuntar el trigger: mismo nombre, mismo OID, sin DROP ─────────────
-- UPDATE OF incluye cumplimiento y cumple_total: un UPDATE que sólo toque esas
-- dos columnas también se recalcula (con S22 no disparaba el trigger).
CREATE OR REPLACE TRIGGER registros_calidad_cumplimiento
  BEFORE INSERT OR UPDATE OF parametros, fuente_id, cumplimiento, cumple_total
  ON public.registros_calidad
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_registros_calidad_cumplimiento_catalogo();

-- ── 2 · EXECUTE sobre la firma de tres argumentos para authenticated ─────────
-- Ver el bloque 4 de la cabecera. PUBLIC y anon siguen SIN EXECUTE (se
-- re-declara el REVOKE, idempotente).
REVOKE EXECUTE ON FUNCTION public.calcular_cumplimiento_calidad(text, jsonb, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.calcular_cumplimiento_calidad(text, jsonb, uuid) TO authenticated, service_role;

-- ── 3 · Postcondición: se lee pg_catalog y se aborta si algo no quedó igual ──
DO $$
DECLARE
  v_tabla  oid := to_regclass('public.registros_calidad')::oid;
  v_fn3    oid := to_regprocedure('public.calcular_cumplimiento_calidad(text, jsonb, uuid)')::oid;
  v_vieja  oid := to_regprocedure('public.trg_registros_calidad_cumplimiento()')::oid;
  v_nueva  oid := to_regprocedure('public.trg_registros_calidad_cumplimiento_catalogo()')::oid;
  v_fuente oid := to_regprocedure('public.agua_fuente_de_mi_empresa(uuid)')::oid;
  v_trg    record;
  v_cols   text[];
  v_n      int;
  v_rol    text;
  v_aclp   text[];
  v_espp   text[];
BEGIN
  IF v_nueva IS NULL OR v_fuente IS NULL THEN
    RAISE EXCEPTION 'postcondición: falta trg_registros_calidad_cumplimiento_catalogo() o agua_fuente_de_mi_empresa(uuid)';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_nueva) THEN
    RAISE EXCEPTION 'postcondición: trg_registros_calidad_cumplimiento_catalogo() quedó SECURITY DEFINER';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fuente) THEN
    RAISE EXCEPTION 'postcondición: agua_fuente_de_mi_empresa(uuid) no quedó SECURITY DEFINER';
  END IF;
  FOREACH v_rol IN ARRAY ARRAY['trg', 'fuente'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p, unnest(p.proconfig) c
       WHERE p.oid = CASE v_rol WHEN 'trg' THEN v_nueva ELSE v_fuente END AND c = 'search_path=""'
    ) THEN
      RAISE EXCEPTION 'postcondición: la función % no tiene search_path = ''''', v_rol;
    END IF;
  END LOOP;

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
  IF has_function_privilege('public', v_fn3, 'EXECUTE')
     OR has_function_privilege('public', v_nueva, 'EXECUTE')
     OR has_function_privilege('public', v_fuente, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondición: PUBLIC puede ejecutar alguna de las funciones declaradas';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    IF has_function_privilege('anon', v_fn3, 'EXECUTE')
       OR has_function_privilege('anon', v_nueva, 'EXECUTE')
       OR has_function_privilege('anon', v_fuente, 'EXECUTE') THEN
      RAISE EXCEPTION 'postcondición: anon puede ejecutar alguna de las funciones declaradas';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF NOT has_function_privilege('authenticated', v_fn3, 'EXECUTE') THEN
      RAISE EXCEPTION 'postcondición: authenticated NO puede ejecutar calcular_cumplimiento_calidad(text, jsonb, uuid)';
    END IF;
    IF NOT has_function_privilege('authenticated', v_fuente, 'EXECUTE') THEN
      RAISE EXCEPTION 'postcondición: authenticated NO puede ejecutar agua_fuente_de_mi_empresa(uuid)';
    END IF;
    IF has_function_privilege('authenticated', v_nueva, 'EXECUTE') THEN
      RAISE EXCEPTION 'postcondición: authenticated puede ejecutar trg_registros_calidad_cumplimiento_catalogo()';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    IF NOT has_function_privilege('service_role', v_fn3, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_nueva, 'EXECUTE') THEN
      RAISE EXCEPTION 'postcondición: service_role NO puede ejecutar calcular_cumplimiento_calidad(text, jsonb, uuid) o la función de trigger';
    END IF;
    IF has_function_privilege('service_role', v_fuente, 'EXECUTE') THEN
      RAISE EXCEPTION 'postcondición: service_role conserva EXECUTE sobre agua_fuente_de_mi_empresa(uuid); para él siempre devolvería cero filas y no es su camino';
    END IF;
  END IF;

  -- ACL POSTERIOR de la firma de tres argumentos: el conjunto exacto de quienes
  -- pueden ejecutarla, ni uno más.
  SELECT array_agg(x ORDER BY x) INTO v_aclp FROM (
    SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS x
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_fn3 AND a.privilege_type = 'EXECUTE') s;
  SELECT array_agg(x ORDER BY x) INTO v_espp
    FROM unnest(ARRAY[(SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = v_fn3),
                      'authenticated', 'service_role']) x;
  IF v_aclp IS DISTINCT FROM v_espp THEN
    RAISE EXCEPTION 'postcondición: la ACL de calcular_cumplimiento_calidad(text, jsonb, uuid) quedó en {%} y debía ser {%}',
      coalesce(array_to_string(v_aclp, ','), 'vacía'), array_to_string(v_espp, ',');
  END IF;

  -- Y la RLS de la que depende su aislamiento sigue en pie.
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.calidad_tipologias')) THEN
    RAISE EXCEPTION 'postcondición: public.calidad_tipologias se quedó sin RLS';
  END IF;

  -- La forma exacta de la llamada que hace el trigger resuelve sin 42725.
  PERFORM public.calcular_cumplimiento_calidad(''::text, '{}'::jsonb, NULL::uuid);

  RAISE NOTICE 'registros_calidad_cumplimiento → trg_registros_calidad_cumplimiento_catalogo() · BEFORE INSERT OR UPDATE OF cumple_total, cumplimiento, fuente_id, parametros · fuente resuelta con agua_fuente_de_mi_empresa(uuid) · calcular_cumplimiento_calidad(text, jsonb, uuid): authenticated=sí anon=no PUBLIC=no service_role=sí';
END $$;
