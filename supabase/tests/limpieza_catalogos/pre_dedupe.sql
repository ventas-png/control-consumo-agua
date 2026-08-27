\set ON_ERROR_STOP on

-- ════════════════════════════════════════════════════════════════════════════
-- La cuarta FK entrante, que el escenario natural no produce
-- ════════════════════════════════════════════════════════════════════════════
-- Las otras tres —puntos_control_ruta, tareas_bloque, plantillas_tarea_cargo—
-- cuelgan del área perdedora desde el fixture. `programacion_limpieza` no
-- puede: su `area_id` ni siquiera existe cuando el fixture corre —la crea
-- 20260904000100— y el backfill de esa migración sólo vincula los nombres con
-- coincidencia ÚNICA. 'Lobby' es ambiguo, así que esa clase queda en NULL y
-- ninguna programación llega a apuntar a una perdedora.
--
-- Sin esta fila el cuarto UPDATE de la fusión se verificaría en vacío: se
-- podría borrar entero y todas las invariantes seguirían en verde.
--
-- Se ata a la INACTIVA (…0006), que pierde por `activo DESC` antes de que se
-- cuente ninguna referencia: sumarle filas no puede cambiar quién gana, así
-- que el escenario de desempate del fixture se mantiene intacto. Y se INSERTA
-- una fila nueva en vez de reusar una existente para no alterar ninguna de las
-- que ya prueban otra cosa.
INSERT INTO public.programacion_limpieza (id, company_id, project_id, area, area_id) VALUES
  ('b0000000-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'LOBBY', 'a0000000-0000-0000-0000-000000000006');

DO $$
DECLARE v_area uuid;
BEGIN
  SELECT area_id INTO v_area FROM public.programacion_limpieza
   WHERE id = 'b0000000-0000-0000-0000-000000000009';
  IF v_area IS DISTINCT FROM 'a0000000-0000-0000-0000-000000000006'::uuid THEN
    RAISE EXCEPTION 'pre_dedupe: la programación no quedó atada a la perdedora (%)', v_area;
  END IF;
END;
$$;
