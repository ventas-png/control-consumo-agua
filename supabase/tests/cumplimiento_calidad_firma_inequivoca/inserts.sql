-- ════════════════════════════════════════════════════════════════════════════
-- Comportamiento REAL, como `authenticated`, dentro de una transacción que se
-- revierte. Cada bloque es una de las pruebas obligatorias del PR:
--
--   1. INSERT real como authenticated termina bien y calcula en el servidor.
--   2. UPDATE de parametros y de fuente_id recalcula cumplimiento/cumple_total.
--   3. cumplimiento y cumple_total que mande el cliente se pisan: en el INSERT
--      y en un UPDATE que sólo toque esas columnas.
--   4. Override de la empresa correcta (B) y fallback al global (A, cuyo
--      override de piscina está apagado).
--   5. company_id ajeno y fuente ajena siguen rechazados (42501).
--   6. anon y authenticated no ganan una RPC privilegiada: anon sigue sin poder
--      llamar a la firma de tres argumentos; authenticated puede, pero con el
--      company_id de otra empresa obtiene el catálogo global (RLS), no el
--      override ajeno; y la función de trigger no es invocable.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = public;

-- ── Como admin de la empresa A ──────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE v_r record; v_estado text;
BEGIN
  PERFORM public.chk_txt(current_user::text, 'authenticated', 'la sesión corre como authenticated (admin de A)');

  -- 1 + 3 · INSERT con basura del cliente en las columnas calculadas.
  INSERT INTO public.registros_calidad (id, fuente_id, parametros, cumplimiento, cumple_total)
  VALUES ('0a0a0a0a-0000-4000-8000-000000000001', 'fa0f0f0f-0000-4000-8000-00000000a001',
          '{"pH": 7.5, "turbiedad": 2}'::jsonb, '{"pH": false, "inventado": true}'::jsonb, false);
  SELECT * INTO v_r FROM public.registros_calidad WHERE id = '0a0a0a0a-0000-4000-8000-000000000001';
  PERFORM public.chk(v_r.company_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, '1 · INSERT como authenticated: la fila entra y company_id es el de A');
  PERFORM public.chk_txt(v_r.cumplimiento ->> 'pH', 'true', '3 · INSERT: el cliente mandó pH=false y el servidor lo pisó con true');
  PERFORM public.chk(v_r.cumplimiento ? 'inventado', false, '3 · INSERT: la clave inventada por el cliente no sobrevive');
  PERFORM public.chk(v_r.cumplimiento ? 'coliformes_totales', true, '1 · INSERT: el cumplimiento tiene las claves del catálogo potable');
  PERFORM public.chk(v_r.cumple_total, true, '1 · INSERT: pH 7.5 y turbiedad 2 cumplen el catálogo global potable → cumple_total = true');

  -- 2 · UPDATE de parametros.
  UPDATE public.registros_calidad SET parametros = '{"pH": 9.5, "turbiedad": 2}'::jsonb WHERE id = '0a0a0a0a-0000-4000-8000-000000000001';
  SELECT * INTO v_r FROM public.registros_calidad WHERE id = '0a0a0a0a-0000-4000-8000-000000000001';
  PERFORM public.chk_txt(v_r.cumplimiento ->> 'pH', 'false', '2 · UPDATE de parametros: pH 9.5 → pH = false');
  PERFORM public.chk(v_r.cumple_total, false, '2 · UPDATE de parametros: cumple_total = false');

  -- 3 · UPDATE que sólo toca las columnas calculadas: se recalcula igual.
  UPDATE public.registros_calidad SET cumple_total = true WHERE id = '0a0a0a0a-0000-4000-8000-000000000001';
  SELECT * INTO v_r FROM public.registros_calidad WHERE id = '0a0a0a0a-0000-4000-8000-000000000001';
  PERFORM public.chk(v_r.cumple_total, false, '3 · UPDATE SET cumple_total = true a mano: el servidor lo vuelve a false');
  UPDATE public.registros_calidad SET cumplimiento = '{"pH": true}'::jsonb WHERE id = '0a0a0a0a-0000-4000-8000-000000000001';
  SELECT * INTO v_r FROM public.registros_calidad WHERE id = '0a0a0a0a-0000-4000-8000-000000000001';
  PERFORM public.chk_txt(v_r.cumplimiento ->> 'pH', 'false', '3 · UPDATE SET cumplimiento a mano: el servidor lo recalcula');

  -- 2 · UPDATE de fuente_id: cambia la tipología (piscina) y las claves.
  UPDATE public.registros_calidad SET fuente_id = 'fa0f0f0f-0000-4000-8000-00000000a002' WHERE id = '0a0a0a0a-0000-4000-8000-000000000001';
  SELECT * INTO v_r FROM public.registros_calidad WHERE id = '0a0a0a0a-0000-4000-8000-000000000001';
  PERFORM public.chk(v_r.cumplimiento ? 'cloro_libre', true, '2 · UPDATE de fuente_id: ahora las claves son las de piscina');
  PERFORM public.chk(v_r.cumplimiento ? 'coliformes_totales', false, '2 · UPDATE de fuente_id: las claves de potable desaparecen');
  PERFORM public.chk_txt(v_r.cumplimiento ->> 'turbiedad', 'false', '2 · UPDATE de fuente_id: turbiedad 2 no cumple piscina (máx 0.5)');

  -- 4 · Fallback al global: A tiene un override de piscina APAGADO con pH [9,10].
  UPDATE public.registros_calidad SET parametros = '{"pH": 7.5, "turbiedad": 0.3}'::jsonb WHERE id = '0a0a0a0a-0000-4000-8000-000000000001';
  SELECT * INTO v_r FROM public.registros_calidad WHERE id = '0a0a0a0a-0000-4000-8000-000000000001';
  PERFORM public.chk(v_r.cumple_total, true, '4 · fallback global: el override apagado de A no se usa, piscina pH 7.5 cumple');

  -- 5 · Fuente de OTRA empresa: invisible por RLS → 42501 con el mensaje de la función.
  v_estado := public.intentar($q$ INSERT INTO public.registros_calidad (fuente_id, parametros)
    VALUES ('fb0f0f0f-0000-4000-8000-00000000b001', '{"pH": 7.5}'::jsonb) $q$);
  PERFORM public.chk_txt(left(v_estado, 5), '42501', '5 · fuente de otra empresa: rechazada con 42501: ' || v_estado);
  PERFORM public.chk(v_estado LIKE '%no es visible%', true, '5 · fuente de otra empresa: la rechaza la función de trigger, no la RLS de la tabla');
  -- 5 · company_id de OTRA empresa con fuente propia: lo rechaza la RLS.
  v_estado := public.intentar($q$ INSERT INTO public.registros_calidad (fuente_id, parametros, company_id)
    VALUES ('fa0f0f0f-0000-4000-8000-00000000a001', '{"pH": 7.5}'::jsonb, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') $q$);
  PERFORM public.chk_txt(left(v_estado, 5), '42501', '5 · company_id de otra empresa: rechazado por RLS con 42501: ' || v_estado);
  -- 5 · UPDATE moviendo la fila a una fuente ajena: mismo rechazo.
  v_estado := public.intentar($q$ UPDATE public.registros_calidad SET fuente_id = 'fb0f0f0f-0000-4000-8000-00000000b001'
    WHERE id = '0a0a0a0a-0000-4000-8000-000000000001' $q$);
  PERFORM public.chk_txt(left(v_estado, 5), '42501', '5 · UPDATE hacia una fuente ajena: rechazado con 42501');

  -- 6 · RPC directa: con el company_id de B, A obtiene el GLOBAL (el override
  --     de B es invisible bajo su RLS); con el suyo, también el global (A no
  --     tiene override activo de potable).
  PERFORM public.chk_txt(
    (public.calcular_cumplimiento_calidad('potable', '{"pH": 7.5}'::jsonb, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') ->> 'cumple_total'),
    'true', '6 · A pide el override de B por RPC: la RLS no se lo muestra y cae al global (true)');
  PERFORM public.chk_txt(
    (public.calcular_cumplimiento_calidad('potable', '{"pH": 7.5}'::jsonb, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') ->> 'cumple_total'),
    'true', '6 · A con su propio company_id: global (no tiene override activo de potable)');
  PERFORM public.chk((SELECT count(*) FROM public.calidad_tipologias WHERE company_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 0,
    '6 · A no ve el override de B en calidad_tipologias');
  -- 6 · La función de trigger no es invocable directamente.
  v_estado := public.intentar($q$ SELECT public.trg_registros_calidad_cumplimiento_catalogo() $q$);
  PERFORM public.chk(left(v_estado, 5) IN ('42501', '0A000'), true, '6 · authenticated no puede invocar la función de trigger: ' || v_estado);
  -- 6 · La llamada de dos argumentos SIGUE siendo ambigua para quien la haga a
  --     mano: el PR arregla el trigger, no borra la sobrecarga.
  v_estado := public.intentar($q$ SELECT public.calcular_cumplimiento_calidad('potable', '{}'::jsonb) $q$);
  PERFORM public.chk_txt(left(v_estado, 5), '42725', '6 · la llamada de dos argumentos sigue ambigua (nadie la usa ya): ' || v_estado);
END $$;

-- ── Como admin de la empresa B: el override de B manda ──────────────────────
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE v_r record;
BEGIN
  INSERT INTO public.registros_calidad (id, fuente_id, parametros)
  VALUES ('0b0b0b0b-0000-4000-8000-000000000001', 'fb0f0f0f-0000-4000-8000-00000000b001', '{"pH": 7.5, "turbiedad": 2}'::jsonb);
  SELECT * INTO v_r FROM public.registros_calidad WHERE id = '0b0b0b0b-0000-4000-8000-000000000001';
  PERFORM public.chk(v_r.company_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true, '4 · B inserta y company_id es el de B');
  PERFORM public.chk_txt(v_r.cumplimiento ->> 'pH', 'false', '4 · override de B: pH 7.5 NO cumple [7.0, 7.2]');
  PERFORM public.chk(v_r.cumplimiento ? 'coliformes_totales', false, '4 · override de B: las claves son las del override (2), no las del global (11)');
  PERFORM public.chk(v_r.cumple_total, false, '4 · override de B: cumple_total = false');
  UPDATE public.registros_calidad SET parametros = '{"pH": 7.1, "turbiedad": 2}'::jsonb WHERE id = '0b0b0b0b-0000-4000-8000-000000000001';
  SELECT * INTO v_r FROM public.registros_calidad WHERE id = '0b0b0b0b-0000-4000-8000-000000000001';
  PERFORM public.chk(v_r.cumple_total, true, '4 · override de B: pH 7.1 sí cumple → cumple_total = true');
  PERFORM public.chk_txt(
    (public.calcular_cumplimiento_calidad('potable', '{"pH": 7.5}'::jsonb, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') ->> 'cumple_total'),
    'false', '6 · B con su propio company_id por RPC: su override (false)');
  PERFORM public.chk((SELECT count(*) FROM public.registros_calidad), 1, '5 · B sólo ve su propia fila de registros_calidad');
END $$;

-- ── Como anon: nada nuevo ───────────────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
DECLARE v_estado text;
BEGIN
  v_estado := public.intentar($q$ SELECT public.calcular_cumplimiento_calidad('potable', '{}'::jsonb, NULL::uuid) $q$);
  PERFORM public.chk_txt(left(v_estado, 5), '42501', '6 · anon NO puede llamar a calcular_cumplimiento_calidad(text, jsonb, uuid): ' || v_estado);
  v_estado := public.intentar($q$ SELECT public.trg_registros_calidad_cumplimiento_catalogo() $q$);
  PERFORM public.chk(left(v_estado, 5) IN ('42501', '0A000'), true, '6 · anon no puede invocar la función de trigger: ' || v_estado);
END $$;
RESET ROLE;

ROLLBACK;
SELECT public.chk((SELECT count(*) FROM public.registros_calidad), 0, 'la transacción se revirtió: registros_calidad queda vacía');
