-- ════════════════════════════════════════════════════════════════════════════
-- Portal residente · Asambleas: el propietario ve las asambleas de su
-- condominio y vota, una vez por unidad, mientras la asamblea está en curso.
--
-- PROBLEMA
-- El tab «Asambleas» del portal (PortalAsambleasTab) no funcionaba por ningún
-- camino:
--   · Listaba `asambleas_digital` y buscaba sus puntos en `puntos_asamblea`
--     por esos ids, pero `puntos_asamblea.asamblea_id` es FK a
--     `public.asambleas` (20260420000003): nunca aparecía un punto.
--   · El voto insertaba en `votos_asamblea` una columna `asamblea_id` que la
--     tabla no tiene: PostgREST lo rechazaba siempre.
--   · Mandaba 'favor' | 'contra' | 'abstencion' mientras el panel guarda
--     'a_favor' | 'en_contra' | 'abstencion'. Sin CHECK, los dos vocabularios
--     se habrían mezclado en silencio y los conteos del panel no los ven.
--   · El RLS de asambleas, puntos y votos no tiene rama de residente: un
--     cliente no lee la asamblea ni puede registrar su voto.
--
-- DECISIÓN DEL DUEÑO
--   · El portal usa las asambleas CLÁSICAS (asambleas + puntos_asamblea +
--     votos_asamblea): un solo registro de votos, el mismo que ve el panel.
--   · Vota sólo el PROPIETARIO de la unidad (mis_unidades_propietario_ids()),
--     como ya decide tabsForRol, que esconde el tab al inquilino. Un voto por
--     unidad.
--   · Se vota sólo con la asamblea `en_curso`, y lo exige la base, no la UI.
--     El voto del residente es definitivo: no se re-vota desde el portal (el
--     staff lo puede corregir en el panel).
--   · En las asambleas finalizadas el residente ve los TOTALES por punto,
--     nunca el voto de otra unidad.
--
-- POR QUÉ RPC Y NO UNA POLICY NUEVA
-- Es el patrón del self-service del portal (solicitud de renta, inquilinos,
-- mascotas): SECURITY DEFINER acotado por mis_unidades_propietario_ids(), con
-- la validación en el servidor. Además, una policy PERMISIVA de INSERT de más
-- en votos_asamblea se uniría con OR a las del staff, que la serie «acciones
-- por permiso» (#975/#979) reescribe y cuenta en su guarda de postcondición.
-- Aquí no se crea, cambia ni borra ninguna policy: el residente sigue sin leer
-- ni escribir estas tablas directamente.
--
-- El RPC salta el RLS, así que repite a mano el candado de plan de
-- 20261103000600 (feature `asambleas_digitales` de la empresa de la asamblea),
-- igual que el FeatureGate del tab.
--
-- CAMBIOS
--   1 · votos_asamblea.voto: se normalizan los sinónimos del portal viejo
--       ('favor', 'contra') y entra el CHECK del vocabulario del panel.
--   2 · portal_asambleas_unidad(p_unidad_id) — asambleas del proyecto de la
--       unidad con sus puntos, el voto de ESA unidad y los totales de los
--       puntos de votación de las finalizadas.
--   3 · portal_votar_punto(p_punto_id, p_unidad_id, p_voto) — el voto.
--   4 · Guarda de postcondición.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · El vocabulario del voto ─────────────────────────────────────────────
UPDATE public.votos_asamblea
   SET voto = CASE voto WHEN 'favor' THEN 'a_favor' WHEN 'contra' THEN 'en_contra' END
 WHERE voto IN ('favor', 'contra');

DO $$
DECLARE
  v_otros text;
BEGIN
  SELECT string_agg(DISTINCT quote_literal(voto), ', ') INTO v_otros
    FROM public.votos_asamblea
   WHERE voto NOT IN ('a_favor', 'en_contra', 'abstencion');
  IF v_otros IS NOT NULL THEN
    RAISE EXCEPTION 'votos_asamblea tiene votos fuera del vocabulario (%): revisarlos antes del CHECK', v_otros;
  END IF;
END $$;

ALTER TABLE public.votos_asamblea DROP CONSTRAINT IF EXISTS votos_asamblea_voto_check;
ALTER TABLE public.votos_asamblea
  ADD CONSTRAINT votos_asamblea_voto_check CHECK (voto IN ('a_favor', 'en_contra', 'abstencion'));

-- ── 2 · Lo que ve el propietario ────────────────────────────────────────────
-- Una fila jsonb por asamblea (como portal_mis_unidades): la forma sigue al
-- esquema sin repuntar la firma. Los totales sólo salen con la asamblea
-- finalizada: mientras se vota, ver el conteo parcial influiría en el voto.
-- El acta, igual: es el documento de cierre.
CREATE OR REPLACE FUNCTION public.portal_asambleas_unidad(p_unidad_id uuid)
RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT jsonb_build_object(
    'id',               a.id,
    'titulo',           a.titulo,
    'tipo',             a.tipo,
    'fecha',            a.fecha,
    'hora_inicio',      a.hora_inicio,
    'hora_fin',         a.hora_fin,
    'lugar',            a.lugar,
    'estado',           a.estado,
    'quorum_requerido', a.quorum_requerido,
    'quorum_alcanzado', a.quorum_alcanzado,
    'acta',             CASE WHEN a.estado = 'finalizada' THEN a.acta END,
    'puntos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id',          p.id,
        'orden',       p.orden,
        'titulo',      p.titulo,
        'descripcion', p.descripcion,
        'tipo',        p.tipo,
        'resultado',   p.resultado,
        'mi_voto',     (SELECT v.voto FROM public.votos_asamblea v
                         WHERE v.punto_id = p.id AND v.unidad_id = p_unidad_id),
        'conteo',      CASE WHEN a.estado = 'finalizada' AND p.tipo = 'votacion' THEN (
                         SELECT jsonb_build_object(
                           'a_favor',    count(*) FILTER (WHERE v.voto = 'a_favor'),
                           'en_contra',  count(*) FILTER (WHERE v.voto = 'en_contra'),
                           'abstencion', count(*) FILTER (WHERE v.voto = 'abstencion'))
                         FROM public.votos_asamblea v WHERE v.punto_id = p.id) END
      ) ORDER BY p.orden, p.created_at)
      FROM public.puntos_asamblea p
      WHERE p.asamblea_id = a.id), '[]'::jsonb)
  )
  FROM public.unidades u
  JOIN public.asambleas a
    ON a.project_id = u.project_id AND a.company_id = u.company_id
  WHERE u.id = p_unidad_id
    AND u.id IN (SELECT public.mis_unidades_propietario_ids())
    AND public.company_has_feature(a.company_id, 'asambleas_digitales')
  ORDER BY a.fecha DESC, a.hora_inicio DESC
  LIMIT 30
$fn$;

REVOKE ALL ON FUNCTION public.portal_asambleas_unidad(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_asambleas_unidad(uuid) TO authenticated;

COMMENT ON FUNCTION public.portal_asambleas_unidad(uuid) IS
  'Portal: asambleas del condominio de una unidad PROPIA (propietario), con sus puntos, el voto de la unidad y los totales de las finalizadas.';

-- ── 3 · El voto ─────────────────────────────────────────────────────────────
-- 42501 para todo lo que es «no le corresponde» (sin distinguir si el punto
-- existe en otra empresa); 23505 para «la unidad ya votó», que la UI reconoce.
CREATE OR REPLACE FUNCTION public.portal_votar_punto(p_punto_id uuid, p_unidad_id uuid, p_voto text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_tipo    text;
  v_estado  text;
  v_empresa uuid;
BEGIN
  IF p_voto IS NULL OR p_voto NOT IN ('a_favor', 'en_contra', 'abstencion') THEN
    RAISE EXCEPTION 'Voto inválido: %', coalesce(p_voto, 'NULL') USING ERRCODE = '22023';
  END IF;

  IF p_unidad_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.mis_unidades_propietario_ids() x WHERE x = p_unidad_id) THEN
    RAISE EXCEPTION 'Solo el propietario de la unidad puede votar.' USING ERRCODE = '42501';
  END IF;

  SELECT p.tipo, a.estado, a.company_id INTO v_tipo, v_estado, v_empresa
    FROM public.puntos_asamblea p
    JOIN public.asambleas a ON a.id = p.asamblea_id
    JOIN public.unidades u  ON u.id = p_unidad_id
   WHERE p.id = p_punto_id
     AND a.project_id = u.project_id
     AND a.company_id = u.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El punto no es de una asamblea de su condominio.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.company_has_feature(v_empresa, 'asambleas_digitales') THEN
    RAISE EXCEPTION 'El plan del condominio no incluye asambleas digitales.' USING ERRCODE = '42501';
  END IF;

  IF v_tipo <> 'votacion' THEN
    RAISE EXCEPTION 'Este punto no se somete a votación.' USING ERRCODE = '22023';
  END IF;

  IF v_estado <> 'en_curso' THEN
    RAISE EXCEPTION 'La votación sólo está abierta mientras la asamblea está en curso.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto, registrado_por)
  VALUES (p_punto_id, p_unidad_id, p_voto, auth.uid())
  ON CONFLICT (punto_id, unidad_id) DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta unidad ya votó en este punto.' USING ERRCODE = '23505';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.portal_votar_punto(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_votar_punto(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.portal_votar_punto(uuid, uuid, text) IS
  'Portal: el propietario registra el voto de su unidad en un punto de votación de una asamblea en curso. Un voto por unidad, definitivo desde el portal.';

-- ── 4 · Guarda de postcondición ─────────────────────────────────────────────
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.portal_asambleas_unidad(uuid)', 'public.portal_votar_punto(uuid,uuid,text)'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn::regprocedure) THEN
      RAISE EXCEPTION 'portal asambleas: % no es SECURITY DEFINER', v_fn;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'portal asambleas: anon puede ejecutar %', v_fn;
    END IF;
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'portal asambleas: authenticated no puede ejecutar %', v_fn;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.votos_asamblea'::regclass
                    AND conname = 'votos_asamblea_voto_check' AND convalidated) THEN
    RAISE EXCEPTION 'portal asambleas: falta el CHECK validado de votos_asamblea.voto';
  END IF;
END $$;
