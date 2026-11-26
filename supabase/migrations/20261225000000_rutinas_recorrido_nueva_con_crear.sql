-- ════════════════════════════════════════════════════════════════════════════
-- Rutinas: quien sólo puede CREAR guarda el recorrido de la rutina que acaba de
-- crear
-- ════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ
-- Crear una rutina en el editor son dos escrituras: la cabecera
-- (INSERT en rutinas_limpieza, policy INSERT = prog_limpieza.create) y su
-- recorrido (guardar_recorrido_rutina). El mapa de 20261104000700
-- (supabase/rls-acciones/recursos_humanos.json) lo declara así: «Guardar el
-- recorrido de una rutina —nueva con canCreate, existente con canEdit—», y las
-- policies INSERT de rutina_areas / rutina_actividades ya aceptan `create`.
--
-- Pero guardar_recorrido_rutina (SECURITY INVOKER, 20261102000000) empieza con
-- `SELECT … FROM rutinas_limpieza … FOR UPDATE`, y bajo RLS un FOR UPDATE pide
-- la policy UPDATE de la rutina: prog_limpieza.edit. Un rol con crear y sin
-- editar insertaba la cabecera y el recorrido moría en
-- `P0002 RUTINA_RECORRIDO: la rutina … no existe`: la rutina quedaba creada,
-- vacía, y el rol no podía hacer nada más con ella.
--
-- QUÉ HACE
--   1 · rutina_bloquear_si_nueva(p_rutina_id) — SECURITY DEFINER. Bloquea
--       (FOR UPDATE, sin la RLS) la rutina sólo si quien llama
--         · puede CREAR en Programación de limpieza
--           (condominios_puede_actuar('prog_limpieza', 'create')),
--         · la creó él (creado_por, que la base sella al insertar y no deja
--           cambiar: trg_sellar_creado_por, 20260907000200),
--         · es de su empresa,
--         · y la rutina sigue SIN recorrido: ni paradas ni pasos.
--       Lo último se mira DESPUÉS de bloquear, en otra sentencia: si alguien con
--       editar estaba guardando la misma rutina, se espera a que termine y se ve
--       lo que dejó. Evaluado junto con el bloqueo, se leería con la foto de
--       antes de esperar y se mezclarían los dos recorridos.
--       Devuelve si la bloqueó; no escribe nada.
--   2 · guardar_recorrido_rutina — mismo cuerpo, con una sola diferencia: si el
--       FOR UPDATE bajo la RLS no encuentra la rutina, pregunta a (1). Si (1) la
--       bloqueó, lee la cabecera bajo la RLS de SELECT y sigue igual que
--       siempre; si no, la respuesta es la de siempre (P0002). Todas las
--       escrituras siguen bajo la RLS de quien llama: con crear sólo se puede
--       INSERTAR paradas y pasos, y como la rutina está vacía no hay nada que
--       borrar ni que actualizar.
--
-- QUÉ NO CAMBIA
--   · Con editar, el camino es el de 20261102000000 (FOR UPDATE bajo la RLS).
--   · Con crear y sin editar, el recorrido de una rutina que YA lo tiene, o de
--     una que creó otra persona, sigue siendo «no existe»: cambiarlo es editar.
--   · Ninguna policy cambia.
--
-- IMPACTO EN DATOS: ninguno. Ninguna fila se reescribe. Las rutinas que un rol
-- con crear y sin editar dejó vacías por este fallo se pueden completar ahora
-- desde el editor (el error ya avisaba «La rutina quedó creada: volvé a guardar
-- para reintentar el recorrido»), o con editar, como antes.
--
-- REVERSIÓN: volver a ejecutar el §5 de 20261102000000 (desde
-- `CREATE OR REPLACE FUNCTION public.guardar_recorrido_rutina(` hasta su GRANT,
-- inclusive) y después
--   DROP FUNCTION IF EXISTS public.rutina_bloquear_si_nueva(uuid);
--
-- IDEMPOTENTE: CREATE OR REPLACE en las dos funciones; REVOKE/GRANT repetibles.
-- Probado en supabase/tests/rutinas_recorrido_crear/ (cadena completa, control
-- negativo, dos sesiones a la vez y mutantes).
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1 · rutina_bloquear_si_nueva — el bloqueo de la rutina recién creada
-- ────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER sólo para BLOQUEAR: con INVOKER, el FOR UPDATE volvería a
-- pedir la policy UPDATE. Lo que decide si puede, lo decide sobre quien llama
-- (auth.uid(), su empresa y sus permisos), nunca sobre el id que le pasan.
CREATE OR REPLACE FUNCTION public.rutina_bloquear_si_nueva(p_rutina_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.condominios_puede_actuar('prog_limpieza', 'create') THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM public.rutinas_limpieza r
  WHERE r.id = p_rutina_id
    AND r.company_id = public.get_my_company_id()
    AND r.creado_por = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Ya bloqueada: esta sentencia ve lo que dejó quien la tenía antes.
  IF EXISTS (SELECT 1 FROM public.rutina_areas WHERE rutina_id = p_rutina_id)
     OR EXISTS (SELECT 1 FROM public.rutina_actividades WHERE rutina_id = p_rutina_id) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.rutina_bloquear_si_nueva(uuid) IS
  'Para guardar_recorrido_rutina: bloquea (FOR UPDATE) la rutina de limpieza si quien llama puede crear en Programación de limpieza, la creó él, es de su empresa y todavía no tiene recorrido. Devuelve si la bloqueó. SECURITY DEFINER sólo para bloquear sin la policy UPDATE; no escribe nada.';

-- Regla (e) del migrations-guard: toda SECURITY DEFINER nueva revoca PUBLIC.
-- authenticated la necesita porque guardar_recorrido_rutina es INVOKER.
REVOKE EXECUTE ON FUNCTION public.rutina_bloquear_si_nueva(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rutina_bloquear_si_nueva(uuid) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 2 · guardar_recorrido_rutina — la rutina nueva de quien sólo crea
-- ────────────────────────────────────────────────────────────────────────────
-- El cuerpo de 20261102000000 (ver allí la forma de p_recorrido y por qué es
-- SECURITY INVOKER); cambia sólo el bloqueo, marcado «(nueva con crear)».
CREATE OR REPLACE FUNCTION public.guardar_recorrido_rutina(
  p_rutina_id  uuid,
  p_recorrido  jsonb
)
RETURNS TABLE (paradas int, pasos int)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_rutina   record;
  v_dup      text;
BEGIN
  IF p_recorrido IS NULL OR jsonb_typeof(p_recorrido) <> 'array' THEN
    RAISE EXCEPTION 'RUTINA_RECORRIDO: el recorrido debe ser un arreglo de paradas'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_recorrido) e
    WHERE jsonb_typeof(e) <> 'object'
       OR (e ? 'actividades' AND jsonb_typeof(e->'actividades') NOT IN ('array', 'null'))
  ) THEN
    RAISE EXCEPTION 'RUTINA_RECORRIDO: cada parada es un objeto con un arreglo «actividades»'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- La RLS decide si la rutina «existe» para quien llama: sin permiso, o de otra
  -- empresa, no hay fila que bloquear y la respuesta es la misma. FOR UPDATE
  -- exige la policy UPDATE de rutinas_limpieza: es el camino de quien EDITA.
  SELECT r.id, r.company_id, r.project_id INTO v_rutina
  FROM public.rutinas_limpieza r
  WHERE r.id = p_rutina_id
  FOR UPDATE;

  -- (nueva con crear) Quien sólo puede CREAR no pasa esa policy, pero el primer
  -- recorrido de la rutina que acaba de crear es parte de crearla. La bloquea
  -- rutina_bloquear_si_nueva, que exige crear, que la rutina sea suya y que
  -- siga sin recorrido; la cabecera se lee aquí, bajo la RLS de SELECT.
  -- Si no la bloquea, FOUND sigue en false y la respuesta es la de siempre.
  IF NOT FOUND THEN
    IF public.rutina_bloquear_si_nueva(p_rutina_id) THEN
      SELECT r.id, r.company_id, r.project_id INTO v_rutina
      FROM public.rutinas_limpieza r
      WHERE r.id = p_rutina_id;
    END IF;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RUTINA_RECORRIDO: la rutina % no existe', p_rutina_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Errores de forma ANTES de escribir nada, con un mensaje que se puede
  -- accionar (el 23505 crudo no dice qué área está repetida).
  SELECT e->>'area_id' INTO v_dup
  FROM jsonb_array_elements(p_recorrido) e
  GROUP BY e->>'area_id'
  HAVING count(*) > 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'RUTINA_RECORRIDO: el área % aparece dos veces en el recorrido',
      COALESCE(v_dup, '(sin área)')
      USING ERRCODE = 'unique_violation';
  END IF;

  SELECT a->>'plantilla_tarea_id' INTO v_dup
  FROM jsonb_array_elements(p_recorrido) WITH ORDINALITY AS z(e, n)
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(NULLIF(z.e->'actividades', 'null'::jsonb), '[]'::jsonb)) a
  GROUP BY z.n, a->>'plantilla_tarea_id'
  HAVING count(*) > 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'RUTINA_RECORRIDO: la actividad % aparece dos veces en la misma parada', v_dup
      USING ERRCODE = 'unique_violation';
  END IF;

  -- 1 · Paradas que ya no están: se van, y por CASCADE sus pasos.
  DELETE FROM public.rutina_areas ra
  WHERE ra.rutina_id = p_rutina_id
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_recorrido) e
      WHERE (e->>'area_id')::uuid = ra.area_id
    );

  -- 2 · Paradas nuevas o que cambian de lugar. company/project los sella el
  -- trigger desde la rutina; van igual porque son NOT NULL.
  INSERT INTO public.rutina_areas (company_id, project_id, rutina_id, area_id, orden)
  SELECT v_rutina.company_id, v_rutina.project_id, p_rutina_id,
         (z.e->>'area_id')::uuid, (z.n - 1)::int
  FROM jsonb_array_elements(p_recorrido) WITH ORDINALITY AS z(e, n)
  WHERE z.e->>'area_id' IS NOT NULL
  ON CONFLICT ON CONSTRAINT rutina_areas_unica
  DO UPDATE SET orden = EXCLUDED.orden
  WHERE public.rutina_areas.orden IS DISTINCT FROM EXCLUDED.orden;

  -- 3 · Pasos que ya no están (en su parada): se van.
  DELETE FROM public.rutina_actividades ra
  WHERE ra.rutina_id = p_rutina_id
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_recorrido) e
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(NULLIF(e->'actividades', 'null'::jsonb), '[]'::jsonb)) a
      LEFT JOIN public.rutina_areas rz
        ON rz.rutina_id = p_rutina_id AND rz.area_id = (e->>'area_id')::uuid
      WHERE (a->>'plantilla_tarea_id')::uuid = ra.plantilla_tarea_id
        AND rz.id IS NOT DISTINCT FROM ra.rutina_area_id
    );

  -- 4 · Pasos nuevos, o que cambian de lugar o de obligatoriedad.
  INSERT INTO public.rutina_actividades (
    company_id, project_id, rutina_id, rutina_area_id, plantilla_tarea_id, orden, obligatoria
  )
  SELECT v_rutina.company_id, v_rutina.project_id, p_rutina_id, rz.id,
         (a.e->>'plantilla_tarea_id')::uuid, (a.n - 1)::int,
         COALESCE((a.e->>'obligatoria')::boolean, true)
  FROM jsonb_array_elements(p_recorrido) z
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(NULLIF(z->'actividades', 'null'::jsonb), '[]'::jsonb))
    WITH ORDINALITY AS a(e, n)
  LEFT JOIN public.rutina_areas rz
    ON rz.rutina_id = p_rutina_id AND rz.area_id = (z->>'area_id')::uuid
  ON CONFLICT ON CONSTRAINT rutina_act_unica_parada
  DO UPDATE SET orden = EXCLUDED.orden, obligatoria = EXCLUDED.obligatoria
  WHERE (public.rutina_actividades.orden, public.rutina_actividades.obligatoria)
        IS DISTINCT FROM (EXCLUDED.orden, EXCLUDED.obligatoria);

  RETURN QUERY
  SELECT (SELECT count(*) FROM public.rutina_areas WHERE rutina_id = p_rutina_id)::int,
         (SELECT count(*) FROM public.rutina_actividades WHERE rutina_id = p_rutina_id)::int;
END;
$$;
COMMENT ON FUNCTION public.guardar_recorrido_rutina(uuid, jsonb) IS
  'Guarda el recorrido COMPLETO de una rutina (paradas en orden y las actividades de cada una) en una transacción: conserva lo que sigue, crea lo nuevo y borra lo que ya no viene. SECURITY INVOKER: escribe bajo la RLS de quien llama. Con editar, cualquier rutina visible; con crear y sin editar, sólo el primer recorrido de la rutina que creó (rutina_bloquear_si_nueva). Devuelve cuántas paradas y pasos quedaron.';

REVOKE EXECUTE ON FUNCTION public.guardar_recorrido_rutina(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.guardar_recorrido_rutina(uuid, jsonb) TO authenticated, service_role;
