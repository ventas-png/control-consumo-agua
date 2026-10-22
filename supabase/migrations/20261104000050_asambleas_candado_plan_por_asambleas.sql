-- ════════════════════════════════════════════════════════════════════════════
-- Asambleas: el candado de plan de puntos y votos resuelve la empresa por
-- `asambleas`, no por `asambleas_digital`.
--
-- POR QUÉ
-- 20260602000010 (plat:P36c) instaló dos policies RESTRICTIVAS de INSERT que
-- exigen la feature `asambleas_digitales` del plan:
--   puntos_asamblea_feature_gate
--     company_has_feature((SELECT company_id FROM asambleas_digital
--                           WHERE id = asamblea_id), …)
--   votos_asamblea_feature_gate
--     lo mismo, pasando por puntos_asamblea.
-- Pero `puntos_asamblea.asamblea_id` es FK a public.asambleas
-- (20260420000003), no a asambleas_digital. Como asambleas_digital no tiene
-- columna `asamblea_id`, Postgres la liga a la fila de afuera (pg_policies la
-- muestra como `asambleas_digital.id = puntos_asamblea.asamblea_id`): la
-- subconsulta nunca encuentra fila, company_has_feature(NULL, …) es false y,
-- por ser RESTRICTIVA, se combina con AND con todas las permisivas. Ningún
-- INSERT autenticado entraba en puntos_asamblea ni en votos_asamblea, tampoco
-- el del admin de una empresa cuyo plan SÍ incluye la feature: en el tab
-- Asambleas del panel, «+ Punto» y los botones de voto fallaban siempre.
--
-- DECISIÓN DE PRODUCTO
-- Las asambleas clásicas SÍ van detrás de `asambleas_digitales`: así lo
-- declara el encabezado de P36c y así lo hace el FeatureGate del tab
-- «Asambleas» del portal del residente. Sólo se corrige la tabla por la que se
-- resuelve la empresa; la feature y el tipo de policy no cambian.
--
-- QUÉ HACE
--   1 · puntos_asamblea_feature_gate: la empresa sale de public.asambleas.
--   2 · votos_asamblea_feature_gate: la empresa sale de
--       puntos_asamblea → asambleas.
--       Las dos siguen RESTRICTIVAS, FOR INSERT, TO authenticated. Las
--       columnas de la fila nueva van calificadas con el nombre de su tabla y
--       las de la subconsulta con su alias: una columna que no exista ya no
--       puede ligarse en silencio a otra tabla, falla al crear la policy.
--   3 · Guarda de postcondición.
--
-- IMPACTO
-- Ningún dato cambia. Las empresas cuyo plan incluye la feature
-- (condominios_only, bundle y el trial, que es bundle) vuelven a agregar
-- puntos y registrar votos, con los permisos del tab que ya exigen las
-- policies permisivas, que no se tocan. Una empresa cuyo plan no la incluye
-- (agua_only, o sin suscripción vigente) sigue sin poder. SELECT, UPDATE y
-- DELETE no cambian; service_role no pasa por RLS.
-- Las subconsultas leen puntos_asamblea y asambleas con la RLS de quien
-- inserta, igual que el EXISTS de las permisivas de INSERT: si la permisiva ve
-- la asamblea, el candado también.
--
-- REVERSIÓN
-- DROP POLICY de las dos deja puntos y votos sin candado de plan. Recrearlas
-- con el texto de 20260602000010 vuelve a bloquear TODO alta autenticada.
--
-- IDEMPOTENTE: DROP POLICY IF EXISTS antes de cada CREATE.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · puntos_asamblea: la empresa de la asamblea clásica ───────────────────
DROP POLICY IF EXISTS puntos_asamblea_feature_gate ON public.puntos_asamblea;
CREATE POLICY puntos_asamblea_feature_gate ON public.puntos_asamblea
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.company_has_feature(
      (SELECT a.company_id
         FROM public.asambleas a
        WHERE a.id = puntos_asamblea.asamblea_id),
      'asambleas_digitales'
    )
  );

COMMENT ON POLICY puntos_asamblea_feature_gate ON public.puntos_asamblea IS
  'plat:P36c — bloquea INSERT si el plan de la empresa de la asamblea (public.asambleas) no incluye asambleas_digitales. RESTRICTIVE.';

-- ── 2 · votos_asamblea: punto → asamblea clásica → empresa ───────────────────
DROP POLICY IF EXISTS votos_asamblea_feature_gate ON public.votos_asamblea;
CREATE POLICY votos_asamblea_feature_gate ON public.votos_asamblea
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.company_has_feature(
      (SELECT a.company_id
         FROM public.puntos_asamblea p
         JOIN public.asambleas a ON a.id = p.asamblea_id
        WHERE p.id = votos_asamblea.punto_id),
      'asambleas_digitales'
    )
  );

COMMENT ON POLICY votos_asamblea_feature_gate ON public.votos_asamblea IS
  'plat:P36c — bloquea INSERT si el plan de la empresa de la asamblea (votos → puntos_asamblea → asambleas) no incluye asambleas_digitales. RESTRICTIVE.';

-- ── 3 · Guarda de postcondición ──────────────────────────────────────────────
-- Una RESTRICTIVA se combina con AND: cualquier otra que todavía resuelva la
-- empresa por asambleas_digital (con otro nombre, creada a mano) seguiría
-- rechazando todas las altas aunque estas dos estén bien. Se mira lo que QUEDA.
-- `asambleas_digital\M` no confunde la tabla con el código 'asambleas_digitales'.
DO $$
DECLARE
  v_tabla  text;
  v_policy text;
  v_n      int;
  v_cmd    text;
  v_roles  name[];
  v_check  text;
BEGIN
  SELECT count(*), string_agg(tablename || '.' || policyname, ', ') INTO v_n, v_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('puntos_asamblea', 'votos_asamblea')
    AND permissive = 'RESTRICTIVE'
    AND coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ 'asambleas_digital\M';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'candado de plan de asambleas: % policy(s) RESTRICTIVA(s) siguen resolviendo la empresa por asambleas_digital: %', v_n, v_policy;
  END IF;

  FOR v_tabla, v_policy IN
    VALUES ('puntos_asamblea', 'puntos_asamblea_feature_gate'),
           ('votos_asamblea',  'votos_asamblea_feature_gate')
  LOOP
    SELECT cmd, roles, with_check INTO v_cmd, v_roles, v_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = v_tabla AND policyname = v_policy
      AND permissive = 'RESTRICTIVE';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'candado de plan de asambleas: falta la policy RESTRICTIVA %.%', v_tabla, v_policy;
    END IF;
    IF v_cmd <> 'INSERT' OR v_roles <> ARRAY['authenticated']::name[] THEN
      RAISE EXCEPTION 'candado de plan de asambleas: %.% es % para %, se esperaba INSERT para {authenticated}', v_tabla, v_policy, v_cmd, v_roles;
    END IF;
    IF position('company_has_feature(' IN v_check) = 0
       OR position('''asambleas_digitales''' IN v_check) = 0
       OR v_check !~ '\masambleas a\M' THEN
      RAISE EXCEPTION 'candado de plan de asambleas: %.% no resuelve la empresa por public.asambleas: %', v_tabla, v_policy, v_check;
    END IF;
  END LOOP;
END $$;
