-- ════════════════════════════════════════════════════════════════════════════
-- Estado INTERMEDIO: tras 20260907001200 y ANTES de 20260907001400.
--
-- Existe para conservar un control negativo que de otro modo se perdería.
-- `condominios.tab.tareas_personal` comparte prefijo con `tareas_cond`, así que
-- un `LIKE 'condominios.tab.tareas%'` en la primera migración se lo llevaría
-- por delante. Ese vecino ya no sirve como control en el assert final —la
-- segunda tanda lo muda legítimamente—, pero el arrastre seguiría siendo un
-- fallo real de la PRIMERA. Aquí es donde se puede ver.
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $$
DECLARE cat text; falta text;
BEGIN
  SELECT category INTO cat FROM public.permissions WHERE key = 'condominios.tab.tareas_personal';
  IF cat <> 'seguridad' THEN
    RAISE EXCEPTION
      'I1: la primera tanda arrastró tareas_personal a % — comparte prefijo con tareas_cond', cat;
  END IF;

  -- Y ninguno de los nueve de la jornada se adelanta: son de la segunda tanda.
  FOREACH falta IN ARRAY ARRAY[
    'condominios.tab.turnos', 'condominios.tab.plantillas_cargo',
    'condominios.tab.ausencias', 'condominios.tab.horas_extra',
    'condominios.tab.presencia', 'condominios.tab.panel_turno',
    'condominios.tab.rutas_ronda', 'condominios.tab.desempeno_personal'
  ] LOOP
    SELECT category INTO cat FROM public.permissions WHERE key = falta;
    IF cat <> 'seguridad' THEN
      RAISE EXCEPTION 'I1: % se movió a % antes de tiempo', falta, cat;
    END IF;
  END LOOP;

  RAISE NOTICE 'I1  OK  la primera tanda no tocó a sus vecinos de Seguridad';
END $$;
