-- ════════════════════════════════════════════════════════════════════════════
-- EL CONTRATO, con la versión que SÍ se entrega: escribir no exige
-- `agua.calidad.view`, y el aislamiento por empresa se conserva.
--
-- Todo como `operator` de la empresa A SIN `agua.calidad.view` (a2a2…), salvo
-- el control final, que es el mismo rol CON el permiso (a3a3…). Transacción
-- revertida.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = public;

SELECT set_config('request.jwt.claim.sub', 'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE v_estado text; v_r record; v_n int;
BEGIN
  PERFORM public.chk_txt(public.current_user_role(), 'operator', 'operator de la empresa A, no administrativo');
  PERFORM public.chk(public.user_has_permission('agua.calidad.view'), false, 'sigue SIN agua.calidad.view');
  PERFORM public.chk((SELECT count(*) FROM public.fuentes_agua), 0,
    'sigue sin ver ni una fila de fuentes_agua: este PR NO abre la tabla');

  -- 1 · lo que el hallazgo pedía: el operador puede guardar su análisis.
  v_estado := public.intentar($q$ INSERT INTO public.registros_calidad (id, fuente_id, parametros, cumplimiento, cumple_total)
    VALUES ('0e0e0e0e-0000-4000-8000-000000000001', 'fa0f0f0f-0000-4000-8000-00000000a001',
            '{"pH": 7.5, "turbiedad": 2}'::jsonb, '{"pH": false}'::jsonb, true) $q$);
  PERFORM public.chk_txt(v_estado, 'OK', '1 · el operador SIN view guarda su análisis (contrato: escribir no exige view)');

  -- 2 · y el cálculo del servidor es el real, no un {} de consolación.
  --     Lo lee la propia función acotada, que sí puede responderle.
  SELECT * INTO v_r FROM public.agua_fuente_de_mi_empresa('fa0f0f0f-0000-4000-8000-00000000a001');
  PERFORM public.chk_txt(v_r.tipo_agua, 'potable', '2 · agua_fuente_de_mi_empresa le resuelve SU fuente (tipo potable)');
  PERFORM public.chk(v_r.company_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, '2 · con el company_id de su empresa');

  -- 3 · la fuente de OTRA empresa sigue siendo invisible y el INSERT se rechaza.
  SELECT count(*) INTO v_n FROM public.agua_fuente_de_mi_empresa('fb0f0f0f-0000-4000-8000-00000000b001');
  PERFORM public.chk(v_n, 0, '3 · agua_fuente_de_mi_empresa NO devuelve nada para la fuente de la empresa B');
  v_estado := public.intentar($q$ INSERT INTO public.registros_calidad (fuente_id, parametros)
    VALUES ('fb0f0f0f-0000-4000-8000-00000000b001', '{"pH": 7.5}'::jsonb) $q$);
  PERFORM public.chk_txt(left(v_estado, 5), '42501', '3 · el INSERT con la fuente de B se rechaza con 42501: ' || v_estado);
  PERFORM public.chk(v_estado LIKE '%no pertenece a la empresa%', true, '3 · y lo rechaza la función acotada, por tenant');

  -- 4 · EDITAR es OTRA historia, y no por culpa de este PR: PostgreSQL aplica
  --     las policies de SELECT a un `UPDATE … WHERE` (la cláusula lee columnas
  --     de la tabla). Como `registros_calidad_select` exige agua.calidad.view,
  --     el UPDATE del operador NO alcanza ninguna fila: no da error, no cambia
  --     nada. Es la asimetría de las policies de hoy, anterior a este PR, y se
  --     deja MEDIDA aquí en vez de taparla.
  v_estado := public.intentar($q$ UPDATE public.registros_calidad SET parametros = '{"pH": 9.5}'::jsonb
    WHERE id = '0e0e0e0e-0000-4000-8000-000000000001' $q$);
  PERFORM public.chk_txt(v_estado, 'OK', '4 · el UPDATE del operador SIN view no da error…');
  UPDATE public.registros_calidad SET parametros = '{"pH": 9.5}'::jsonb
   WHERE id = '0e0e0e0e-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM public.chk(v_n, 0,
    '4 · …pero no alcanza NINGUNA fila: Postgres aplica registros_calidad_select a UPDATE … WHERE, y sin agua.calidad.view la fila es invisible (asimetría previa a este PR)');

  -- 5 · el contrato de LECTURA no se ha ampliado ni un milímetro.
  PERFORM public.chk((SELECT count(*) FROM public.registros_calidad), 0,
    '5 · el operador sigue sin poder LEER registros_calidad (sigue haciendo falta view)');
  PERFORM public.chk((SELECT count(*) FROM public.calidad_tipologias WHERE company_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 0,
    '5 · el operador no ve el override de la empresa B');
END $$;

-- 6 · el servidor guardó lo que calculó él, no lo que mandó el cliente.
RESET ROLE;
DO $$
DECLARE v_r record;
BEGIN
  SELECT * INTO v_r FROM public.registros_calidad WHERE id = '0e0e0e0e-0000-4000-8000-000000000001';
  PERFORM public.chk(v_r.company_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, '6 · la fila del operador quedó en su empresa');
  PERFORM public.chk_txt(v_r.parametros ->> 'pH', '7.5', '6 · la fila conserva los parametros del INSERT: el UPDATE sin view no la tocó');
  PERFORM public.chk_txt(v_r.cumplimiento ->> 'pH', 'true', '6 · con el cálculo del servidor en el INSERT: pH 7.5 cumple el catálogo global');
  PERFORM public.chk(v_r.cumple_total, true, '6 · y cumple_total = true, pisando el false que mandó el cliente');
  PERFORM public.chk(v_r.cumplimiento ? 'coliformes_totales', true,
    '6 · con las 11 claves del catálogo global potable: el operador SIN view obtiene el cálculo real, no {}');
END $$;

-- 7 · control: el MISMO rol operator, pero CON agua.calidad.view, sí ve la
--     fuente. Demuestra que el RBAC del fixture es real y no un false constante.
SELECT set_config('request.jwt.claim.sub', 'a3a3a3a3-a3a3-a3a3-a3a3-a3a3a3a3a3a3', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_estado text;
BEGIN
  PERFORM public.chk_txt(public.current_user_role(), 'operator', '7 · control: también es operator');
  PERFORM public.chk(public.user_has_permission('agua.calidad.view'), true, '7 · control: éste SÍ tiene agua.calidad.view');
  PERFORM public.chk((SELECT count(*) FROM public.fuentes_agua), 2, '7 · control: ve las 2 fuentes de su empresa (y ninguna de B)');
  v_estado := public.intentar($q$ INSERT INTO public.registros_calidad (id, fuente_id, parametros)
    VALUES ('0e0e0e0e-0000-4000-8000-000000000002', 'fa0f0f0f-0000-4000-8000-00000000a001', '{"pH": 7.5}'::jsonb) $q$);
  PERFORM public.chk_txt(v_estado, 'OK', '7 · control: con view también guarda');
  v_estado := public.intentar($q$ UPDATE public.registros_calidad SET parametros = '{"pH": 9.5}'::jsonb
    WHERE id = '0e0e0e0e-0000-4000-8000-000000000002' $q$);
  PERFORM public.chk_txt(v_estado, 'OK', '7 · control: y su UPDATE sí alcanza la fila');
  PERFORM public.chk_txt((SELECT cumplimiento ->> 'pH' FROM public.registros_calidad
                           WHERE id = '0e0e0e0e-0000-4000-8000-000000000002'), 'false',
    '7 · control: el servidor le recalculó pH 9.5 → false (editar SÍ exige agua.calidad.view hoy)');
END $$;
RESET ROLE;

ROLLBACK;
SELECT public.chk((SELECT count(*) FROM public.registros_calidad), 0, 'la transacción se revirtió: registros_calidad queda vacía');
