-- ════════════════════════════════════════════════════════════════════════════
-- Asambleas: el residente ve las asambleas de su condominio y el PROPIETARIO
-- vota desde el portal, una vez por unidad y sin poder cambiarlo.
--
-- POR QUÉ
-- El tab «Asambleas» del portal (PortalAsambleasTab) no podía funcionar:
--   · listaba asambleas_digital pero buscaba sus puntos en puntos_asamblea,
--     cuyo asamblea_id es FK a public.asambleas: nunca aparecía un punto;
--   · el voto mandaba una columna asamblea_id que votos_asamblea no tiene, y
--     los valores 'favor'/'contra' en vez de 'a_favor'/'en_contra' del panel;
--   · y aun corregido eso, la RLS no tenía rama para el residente: SELECT de
--     asambleas y puntos_asamblea exige el permiso del tab, y el INSERT de
--     votos_asamblea sólo deja al staff con Votaciones o al admin.
--
-- DECISIÓN DE PRODUCTO (dueño)
--   · El portal usa las asambleas CLÁSICAS (asambleas → puntos_asamblea →
--     votos_asamblea), las mismas que el tab Asambleas del panel: los votos del
--     portal y los que registra el staff caen en el mismo conteo.
--   · Vota el PROPIETARIO de la unidad (mis_unidades_propietario_ids(), la
--     misma regla que registrar inquilinos o rentas). Inquilino, familiar y
--     otros ven la asamblea y el voto de su unidad, pero no votan.
--   · Append-only para el residente: un voto por unidad y punto (el UNIQUE que
--     ya existe), sin UPDATE ni DELETE. El staff puede corregirlo desde el
--     panel con sus permisos de siempre.
--   · Sólo en puntos de tipo 'votacion' de una asamblea 'en_curso' del mismo
--     condominio que la unidad.
--   · Resultados: el residente ve los TOTALES por punto de las asambleas
--     finalizadas, por una función que sólo devuelve conteos. Nunca ve cómo
--     votó otra unidad.
--
-- QUÉ HACE
--   1 · votos_asamblea.voto: CHECK ('a_favor' | 'en_contra' | 'abstencion').
--       Antes se normalizan los alias del portal viejo ('favor', 'contra'),
--       que no deberían existir porque ese insert nunca entró.
--   2 · residente_puede_votar(punto, unidad): SECURITY DEFINER, acotada al
--       llamante por mis_unidades_propietario_ids().
--   3 · SELECT con la rama del residente (se copia LITERAL la del staff):
--       asambleas y puntos_asamblea de los condominios donde tiene unidad
--       (mis_proyectos_ids()); votos_asamblea sólo de sus unidades
--       (mis_unidades_ids()).
--   4 · votos_asamblea_insert: la rama del staff LITERAL, más la del
--       propietario, que además firma el voto (registrado_por = auth.uid()).
--   5 · portal_conteo_votos_asambleas(ids): totales por punto, sólo de
--       asambleas finalizadas de sus condominios.
--   6 · Guarda de postcondición.
--   El candado de plan (votos_asamblea_feature_gate, RESTRICTIVO,
--   20261103000600) no se toca y también aplica al residente: su subconsulta
--   lee puntos_asamblea y asambleas con la RLS de quien inserta, por eso la
--   rama de SELECT del paso 3 es también la que le deja pasar el candado.
--
-- IMPACTO
-- Ningún dato cambia salvo los alias del paso 1 (si los hubiera). El staff
-- sigue viendo y escribiendo exactamente lo mismo: su rama no cambia.
-- UPDATE y DELETE de votos_asamblea no cambian, y el residente no tiene rama
-- ahí. service_role no pasa por RLS.
--
-- COORDINACIÓN
-- La sección «comunidad» de scripts/rls-acciones/generar.mjs reescribe
-- votos_asamblea_insert sustituyendo sólo los átomos de permiso. Generada
-- ANTES de que esto exista, su texto no trae la rama del propietario y la
-- borraría; regenerada encima, la conserva literal. Las dos redes lo atrapan:
-- supabase/tests/rls_acciones/run.mjs exige que la migración sea la generada
-- sobre la cadena, y supabase/tests/voto_residente_asambleas aplica las
-- migraciones posteriores antes de sus invariantes.
--
-- REVERSIÓN
-- Recrear las cuatro policies sin la rama del residente (el texto del staff
-- está literal abajo), DROP FUNCTION de las dos funciones y
-- ALTER TABLE public.votos_asamblea DROP CONSTRAINT votos_asamblea_voto_check.
--
-- IDEMPOTENTE: DROP … IF EXISTS antes de cada CREATE, CREATE OR REPLACE en
-- las funciones.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · Valores de voto ─────────────────────────────────────────────────────
UPDATE public.votos_asamblea
SET voto = CASE voto WHEN 'favor' THEN 'a_favor' WHEN 'contra' THEN 'en_contra' END
WHERE voto IN ('favor', 'contra');

DO $$
DECLARE
  v_otros text;
BEGIN
  SELECT string_agg(DISTINCT quote_literal(voto), ', ') INTO v_otros
  FROM public.votos_asamblea
  WHERE voto IS NULL OR voto NOT IN ('a_favor', 'en_contra', 'abstencion');
  IF v_otros IS NOT NULL THEN
    RAISE EXCEPTION 'votos_asamblea tiene valores de voto fuera del catálogo: %', v_otros;
  END IF;
END $$;

ALTER TABLE public.votos_asamblea DROP CONSTRAINT IF EXISTS votos_asamblea_voto_check;
ALTER TABLE public.votos_asamblea
  ADD CONSTRAINT votos_asamblea_voto_check
  CHECK (voto IN ('a_favor', 'en_contra', 'abstencion'));

-- ── 2 · ¿Puede el llamante votar por esta unidad en este punto? ─────────────
-- SECURITY DEFINER: lee puntos, asambleas y unidades sin depender de la RLS de
-- quien llama; la identidad la acota mis_unidades_propietario_ids()
-- (auth.uid() → su cliente → unidades donde es propietario).
CREATE OR REPLACE FUNCTION public.residente_puede_votar(p_punto_id uuid, p_unidad_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.puntos_asamblea p
    JOIN public.asambleas a ON a.id = p.asamblea_id
    JOIN public.unidades u ON u.id = p_unidad_id
    WHERE p.id = p_punto_id
      AND p.tipo = 'votacion'
      AND a.estado = 'en_curso'
      AND u.project_id = a.project_id
      AND p_unidad_id IN (SELECT public.mis_unidades_propietario_ids())
  )
$fn$;

REVOKE ALL ON FUNCTION public.residente_puede_votar(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.residente_puede_votar(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.residente_puede_votar(uuid, uuid) IS
  'Rama del propietario en votos_asamblea_insert: la unidad es suya (propietario), el punto es de votación, la asamblea está en curso y es del condominio de la unidad.';

-- ── 3 · Lectura del residente ───────────────────────────────────────────────
DROP POLICY IF EXISTS asambleas_select ON public.asambleas;
CREATE POLICY asambleas_select ON public.asambleas
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.asambleas'))
    OR (project_id IN (SELECT public.mis_proyectos_ids()))
  );

DROP POLICY IF EXISTS puntos_asamblea_select ON public.puntos_asamblea;
CREATE POLICY puntos_asamblea_select ON public.puntos_asamblea
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM asambleas a
      WHERE a.id = puntos_asamblea.asamblea_id
        AND a.company_id = get_my_company_id()
        AND (
          user_has_permission('condominios.tab.asambleas')
          OR (current_user_role() = ANY (ARRAY['company_owner', 'admin']))
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.asambleas ar
      WHERE ar.id = puntos_asamblea.asamblea_id
        AND ar.project_id IN (SELECT public.mis_proyectos_ids())
    )
  );

DROP POLICY IF EXISTS votos_asamblea_select ON public.votos_asamblea;
CREATE POLICY votos_asamblea_select ON public.votos_asamblea
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM puntos_asamblea p
      JOIN asambleas a ON a.id = p.asamblea_id
      WHERE p.id = votos_asamblea.punto_id
        AND a.company_id = get_my_company_id()
        AND (
          user_has_permission('condominios.tab.votaciones')
          OR (current_user_role() = ANY (ARRAY['company_owner', 'admin']))
        )
    )
    OR (unidad_id IN (SELECT public.mis_unidades_ids()))
  );

-- ── 4 · Alta del voto: staff (literal) o el propietario, firmando ───────────
DROP POLICY IF EXISTS votos_asamblea_insert ON public.votos_asamblea;
CREATE POLICY votos_asamblea_insert ON public.votos_asamblea
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM puntos_asamblea p
      JOIN asambleas a ON a.id = p.asamblea_id
      WHERE p.id = votos_asamblea.punto_id
        AND a.company_id = get_my_company_id()
        AND (
          user_has_permission('condominios.tab.votaciones')
          OR (current_user_role() = ANY (ARRAY['company_owner', 'admin']))
        )
    )
    OR (registrado_por = (SELECT auth.uid())
        AND public.residente_puede_votar(votos_asamblea.punto_id, votos_asamblea.unidad_id))
  );

-- ── 5 · Resultados para el portal: sólo totales ─────────────────────────────
-- Asambleas finalizadas de los condominios donde el llamante tiene unidad; un
-- id ajeno, o de una asamblea sin finalizar, no devuelve filas. Cada punto de
-- votación sale aunque no tenga votos (en cero).
CREATE OR REPLACE FUNCTION public.portal_conteo_votos_asambleas(p_asamblea_ids uuid[])
RETURNS TABLE (punto_id uuid, a_favor integer, en_contra integer, abstencion integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT p.id,
         (count(v.id) FILTER (WHERE v.voto = 'a_favor'))::integer,
         (count(v.id) FILTER (WHERE v.voto = 'en_contra'))::integer,
         (count(v.id) FILTER (WHERE v.voto = 'abstencion'))::integer
  FROM public.asambleas a
  JOIN public.puntos_asamblea p ON p.asamblea_id = a.id
  LEFT JOIN public.votos_asamblea v ON v.punto_id = p.id
  WHERE a.id = ANY (p_asamblea_ids)
    AND a.estado = 'finalizada'
    AND p.tipo = 'votacion'
    AND a.project_id IN (SELECT public.mis_proyectos_ids())
  GROUP BY p.id
$fn$;

REVOKE ALL ON FUNCTION public.portal_conteo_votos_asambleas(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_conteo_votos_asambleas(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.portal_conteo_votos_asambleas(uuid[]) IS
  'Portal: votos a favor / en contra / abstención por punto de las asambleas finalizadas de los condominios del llamante. Sólo totales, nunca el voto de cada unidad.';

-- ── 6 · Guarda de postcondición ─────────────────────────────────────────────
-- Una permisiva de más se uniría con OR (otra rama del residente, más ancha);
-- una de UPDATE o DELETE que lo dejara pasar rompería el append-only. Se mira
-- lo que QUEDA.
DO $$
DECLARE
  v_tabla  text;
  v_rama   text;
  v_n      int;
  v_texto  text;
  v_mal    text;
BEGIN
  -- Una sola permisiva de SELECT por tabla, con su rama del residente.
  FOR v_tabla, v_rama IN
    VALUES ('asambleas',       'mis_proyectos_ids()'),
           ('puntos_asamblea', 'mis_proyectos_ids()'),
           ('votos_asamblea',  'mis_unidades_ids()')
  LOOP
    SELECT count(*), max(qual) INTO v_n, v_texto
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = v_tabla
      AND cmd = 'SELECT' AND permissive = 'PERMISSIVE';
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'voto del residente: % tiene % policies permisivas de SELECT (se esperaba 1)', v_tabla, v_n;
    END IF;
    IF position(v_rama IN v_texto) = 0 THEN
      RAISE EXCEPTION 'voto del residente: el SELECT de % no tiene la rama del residente (%)', v_tabla, v_rama;
    END IF;
  END LOOP;

  -- Una sola permisiva de INSERT en votos, con la rama del propietario firmada.
  -- El candado de plan no cuenta: que siga RESTRICTIVO lo exige la guarda de
  -- 20261103000600, y su arnés lo vuelve permisivo a propósito en un mutante
  -- que tiene que caer en sus invariantes, no aquí.
  SELECT count(*), max(with_check) INTO v_n, v_texto
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'votos_asamblea'
    AND cmd = 'INSERT' AND permissive = 'PERMISSIVE'
    AND policyname <> 'votos_asamblea_feature_gate';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'voto del residente: votos_asamblea tiene % policies permisivas de INSERT (se esperaba 1)', v_n;
  END IF;
  IF position('residente_puede_votar(' IN v_texto) = 0
     OR position('registrado_por = ( SELECT auth.uid()' IN v_texto) = 0 THEN
    RAISE EXCEPTION 'voto del residente: votos_asamblea_insert no tiene la rama del propietario firmada: %', v_texto;
  END IF;

  -- Append-only: ninguna policy de UPDATE o DELETE de votos deja pasar al residente.
  SELECT string_agg(policyname, ', ') INTO v_mal
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'votos_asamblea' AND cmd IN ('UPDATE', 'DELETE', 'ALL')
    AND coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ 'mis_unidades|mis_proyectos|residente_puede_votar|get_my_cliente_id';
  IF v_mal IS NOT NULL THEN
    RAISE EXCEPTION 'voto del residente: % deja al residente cambiar o borrar votos', v_mal;
  END IF;

  -- Vota el propietario, no cualquier residente de la unidad.
  IF position('mis_unidades_propietario_ids()' IN pg_get_functiondef('public.residente_puede_votar(uuid, uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'voto del residente: residente_puede_votar no se acota a las unidades donde el llamante es propietario';
  END IF;

  -- Las dos funciones son SECURITY DEFINER y anon no las ejecuta.
  SELECT string_agg(f, ', ') INTO v_mal
  FROM unnest(ARRAY['public.residente_puede_votar(uuid, uuid)', 'public.portal_conteo_votos_asambleas(uuid[])']) AS f
  WHERE NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure)
     OR has_function_privilege('anon', f, 'EXECUTE');
  IF v_mal IS NOT NULL THEN
    RAISE EXCEPTION 'voto del residente: % no es SECURITY DEFINER o anon puede ejecutarla', v_mal;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.votos_asamblea'::regclass AND conname = 'votos_asamblea_voto_check'
      AND contype = 'c' AND convalidated
  ) THEN
    RAISE EXCEPTION 'voto del residente: falta el CHECK votos_asamblea_voto_check';
  END IF;
END $$;
