-- ════════════════════════════════════════════════════════════════════════════
-- EL HALLAZGO, REPRODUCIDO: resolver la fuente con un SELECT AMPLIO sobre
-- fuentes_agua rompe al `operator` que la policy de INSERT sí autoriza.
--
-- Este archivo NO prueba la versión que se entrega: instala a propósito la
-- variante «SELECT amplio» dentro de una transacción que se revierte y mide el
-- 42501. Es la demostración de por qué la migración usa
-- `agua_fuente_de_mi_empresa(uuid)` y no un SELECT sobre la tabla.
--
-- Orden de la demostración:
--   1. la policy `registros_calidad_insert` SÍ autoriza al operador (se evalúa
--      su predicado, como el operador);
--   2. el operador NO ve la fuente (`fuentes_agua_select` exige
--      `agua.calidad.view`, que no tiene);
--   3. con la variante de SELECT amplio, su INSERT muere con 42501 DENTRO del
--      trigger (el mensaje lo dice);
--   4. y la culpa es del trigger, no de la policy: con ese trigger apagado, el
--      mismo INSERT entra.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = public;

-- La variante que NO se entrega: resuelve la fuente leyendo fuentes_agua bajo
-- la RLS del que inserta. Es lo que tenía este PR antes del hallazgo.
CREATE OR REPLACE FUNCTION public.trg_registros_calidad_cumplimiento_catalogo()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $variante$
DECLARE
  v_tipo_agua  text;
  v_company_id uuid;
  v_result     jsonb;
BEGIN
  IF NEW.fuente_id IS NOT NULL THEN
    SELECT fa.tipo_agua, fa.company_id INTO v_tipo_agua, v_company_id
      FROM public.fuentes_agua fa WHERE fa.id = NEW.fuente_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'registros_calidad: la fuente % no existe o no es visible para el usuario actual', NEW.fuente_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  v_result := public.calcular_cumplimiento_calidad(
    COALESCE(v_tipo_agua, ''), COALESCE(NEW.parametros, '{}'::jsonb), v_company_id);
  NEW.cumplimiento := COALESCE(v_result -> 'cumplimiento', '{}'::jsonb);
  NEW.cumple_total := COALESCE((v_result ->> 'cumple_total')::boolean, false);
  RETURN NEW;
END;
$variante$;

SELECT set_config('request.jwt.claim.sub', 'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE v_estado text;
BEGIN
  PERFORM public.chk_txt(public.current_user_role(), 'operator', '1 · el usuario es un operator de la empresa A, no un administrativo');
  PERFORM public.chk(public.is_super_admin(), false, '1 · no es super_admin');
  PERFORM public.chk(public.user_has_permission('agua.calidad.view'), false, '1 · NO tiene agua.calidad.view');

  -- 1 · el predicado de registros_calidad_insert, evaluado como el operador.
  PERFORM public.chk(
    (public.current_user_role() = ANY (ARRAY['super_admin', 'superadmin']))
    OR ((public.current_user_role() = ANY (ARRAY['company_owner', 'admin', 'operator', 'operador']))
        AND 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid = public.get_my_company_id())
    OR (('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid = (SELECT public.get_my_company_id()))
        AND (SELECT public.user_has_permission('agua.calidad.create'))),
    true, '1 · registros_calidad_insert SÍ autoriza a este operador (rama por rol)');

  -- 2 · pero no ve ni una fuente.
  PERFORM public.chk((SELECT count(*) FROM public.fuentes_agua), 0,
    '2 · el operador NO ve ninguna fila de fuentes_agua (falta agua.calidad.view)');

  -- 3 · con el SELECT amplio dentro del trigger, su INSERT muere con 42501.
  v_estado := public.intentar($q$ INSERT INTO public.registros_calidad (fuente_id, parametros)
    VALUES ('fa0f0f0f-0000-4000-8000-00000000a001', '{"pH": 7.5}'::jsonb) $q$);
  PERFORM public.chk_txt(left(v_estado, 5), '42501',
    '3 · con el SELECT amplio el operador recibe 42501 al guardar: ' || v_estado);
  PERFORM public.chk(v_estado LIKE '%no es visible%', true,
    '3 · y el 42501 sale DEL TRIGGER (su mensaje), no de la policy de INSERT');
END $$;

-- 4 · la policy no es la que rechaza: con ese trigger apagado, el mismo INSERT entra.
RESET ROLE;
ALTER TABLE public.registros_calidad DISABLE TRIGGER registros_calidad_cumplimiento;
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_estado text;
BEGIN
  v_estado := public.intentar($q$ INSERT INTO public.registros_calidad (id, fuente_id, parametros)
    VALUES ('0d0d0d0d-0000-4000-8000-000000000001', 'fa0f0f0f-0000-4000-8000-00000000a001', '{"pH": 7.5}'::jsonb) $q$);
  PERFORM public.chk_txt(v_estado, 'OK',
    '4 · con el trigger apagado el mismo INSERT pasa: la policy autorizaba y el rechazo era del trigger');
END $$;
RESET ROLE;
ALTER TABLE public.registros_calidad ENABLE TRIGGER registros_calidad_cumplimiento;

ROLLBACK;
SELECT public.chk((SELECT count(*) FROM public.registros_calidad), 0, 'la demostración se revirtió: registros_calidad queda vacía');
SELECT public.chk_txt(
  (SELECT CASE WHEN prosrc LIKE '%agua_fuente_de_mi_empresa%' THEN 'acotada' ELSE 'amplia' END
     FROM pg_proc WHERE oid = 'public.trg_registros_calidad_cumplimiento_catalogo()'::regprocedure),
  'acotada', 'la variante amplia se revirtió con la transacción: sigue instalada la acotada');
