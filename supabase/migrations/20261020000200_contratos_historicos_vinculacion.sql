-- ════════════════════════════════════════════════════════════════════════════
-- CONTRATOS HISTÓRICOS SIN PROVEEDOR · VISTA PREVIA, VÍNCULO Y REVERSIÓN
-- (PR A, entrega 3 de 4)
--
-- POR QUÉ EXISTE
-- Los contratos anteriores a esta cadena tienen el proveedor en TEXTO LIBRE.
-- Vincularlos al catálogo compartido permite llegar desde el proveedor a sus
-- contratos, pero hacerlo MAL —fusionando por parecido de nombre, inventando
-- una autorización, borrando el texto original— sería peor que no hacerlo.
--
-- LO QUE ESTA MIGRACIÓN DA (y lo que NO ejecuta)
-- Solo FUNCIONES. No toca ninguna fila: el saneamiento de producción es una
-- decisión posterior y de una persona.
--
--   proveedor_normalizar_nombre / proveedor_nombre_base
--       Normalización de nombres (mayúsculas, acentos, puntuación). La segunda
--       además quita la forma societaria. Solo sirven para PROPONER candidatos.
--   contratos_sin_proveedor_vista_previa()
--       Por cada contrato sin proveedor vinculado: 'inequivoca' (exactamente un
--       proveedor con el MISMO nombre normalizado y ninguna otra señal
--       contradictoria), 'ambigua' (varios candidatos, o candidatos solo por
--       forma societaria o por correo: exige selección manual) o
--       'sin_coincidencia'. Solo lectura.
--   contratos_vinculacion_resumen()
--       Conteos ANTES y DESPUÉS de aplicar los inequívocos.
--   contrato_vincular_proveedor(contrato, proveedor, motivo)
--       Vínculo manual (el camino de los ambiguos) con constancia en el
--       historial. Conserva `proveedor_nombre` y demás textos: no se reescriben.
--   contratos_vincular_inequivocos(dry_run := true)
--       Aplica SOLO los inequívocos, en un lote identificable. Por defecto es
--       simulación.
--   contratos_vinculos_revertir(lote, motivo)
--       Deshace un lote: deja `proveedor_id` en NULL otra vez. Omite (y
--       informa) los contratos que ya tienen órdenes de compra vinculadas.
--
-- LO QUE NUNCA HACE: borrar o fusionar proveedores, tocar su autorización,
-- inventar datos fiscales, ni cambiar el texto histórico del contrato.
--
-- ESTRATEGIA DE REVERSIÓN: cada vínculo deja un evento `vinculo_proveedor` con
-- el lote; `contratos_vinculos_revertir(lote)` lo deshace. Antes de aplicar en
-- un entorno real: ejecutar la vista previa, guardar su salida (conteos) y
-- aplicar con dry_run := false.
--
-- CÓMO REVERTIR LA MIGRACIÓN: DROP de las seis funciones (no hay datos).
-- IMPACTO EN DATOS PRODUCTIVOS: ninguno.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Normalización de nombres ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.proveedor_normalizar_nombre(p_nombre text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(
             translate(lower(coalesce(p_nombre, '')),
                       'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'),
             '[^a-z0-9]+', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.proveedor_nombre_base(p_nombre text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT btrim(regexp_replace(
           public.proveedor_normalizar_nombre(p_nombre),
           '( (sa|s a|sas|srl|s r l|s de rl|ltda|limitada|cia|compania|cv|c v|sociedad anonima|inc|llc|corp))+$',
           '', 'g'))
$$;

REVOKE EXECUTE ON FUNCTION public.proveedor_normalizar_nombre(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.proveedor_nombre_base(text)       FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.proveedor_normalizar_nombre(text) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.proveedor_nombre_base(text)       TO authenticated, service_role;

COMMENT ON FUNCTION public.proveedor_normalizar_nombre(text) IS
  'Nombre en minúsculas, sin acentos ni puntuación y con espacios colapsados. Solo para PROPONER coincidencias: nunca decide una fusión.';
COMMENT ON FUNCTION public.proveedor_nombre_base(text) IS
  'Como proveedor_normalizar_nombre pero sin la forma societaria final (S.A., Ltda., …). Una coincidencia solo por este criterio es AMBIGUA.';

-- ── 2. Vista previa (solo lectura) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.contratos_sin_proveedor_vista_previa()
RETURNS TABLE (
  contrato_id           uuid,
  project_id            uuid,
  proyecto_nombre       text,
  proveedor_nombre_texto text,
  estado                text,
  servicio              text,
  fecha_inicio          date,
  clasificacion         text,
  motivo                text,
  candidatos            jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
BEGIN
  IF v_company IS NULL OR NOT public.user_has_permission('condominios.tab.proveedores') THEN
    RAISE EXCEPTION 'No autorizado para revisar contratos de proveedores.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT c.id, c.project_id AS pid, pr.nombre AS proyecto, c.proveedor_nombre AS texto,
           c.estado AS est, c.servicio AS serv, c.fecha_inicio AS inicio,
           public.proveedor_normalizar_nombre(c.proveedor_nombre) AS n,
           public.proveedor_nombre_base(c.proveedor_nombre)       AS nb,
           lower(btrim(COALESCE(c.proveedor_email, '')))          AS em
      FROM public.contratos_proveedores c
      JOIN public.projects pr ON pr.id = c.project_id
     WHERE c.company_id = v_company
       AND c.proveedor_id IS NULL
       AND public.can_access_project(c.project_id)
  ),
  prov AS (
    SELECT p.id, p.codigo, p.nombre, p.estado,
           public.proveedor_normalizar_nombre(p.nombre) AS pn,
           public.proveedor_nombre_base(p.nombre)       AS pnb,
           lower(btrim(COALESCE(p.email, '')))          AS pem
      FROM public.proveedores p
     WHERE p.company_id = v_company
  ),
  cand AS (
    SELECT b.id AS cid, p.id AS pid2, p.codigo AS p_codigo, p.nombre AS p_nombre, p.estado AS p_estado,
           CASE
             WHEN b.n <> '' AND p.pn = b.n                 THEN 'nombre_exacto'
             WHEN b.nb <> '' AND p.pnb = b.nb              THEN 'forma_societaria'
             WHEN b.em <> '' AND p.pem = b.em              THEN 'mismo_correo'
           END AS criterio
      FROM base b
      JOIN prov p
        ON (b.n  <> '' AND p.pn  = b.n)
        OR (b.nb <> '' AND p.pnb = b.nb)
        OR (b.em <> '' AND p.pem = b.em)
  ),
  agg AS (
    SELECT cid,
           count(*) FILTER (WHERE criterio = 'nombre_exacto') AS n_exactos,
           count(*) FILTER (WHERE criterio <> 'nombre_exacto') AS n_otros,
           jsonb_agg(jsonb_build_object('id', pid2, 'codigo', p_codigo, 'nombre', p_nombre,
                                        'estado', p_estado, 'criterio', criterio)
                     ORDER BY criterio, p_nombre) AS lista
      FROM cand
     GROUP BY cid
  )
  SELECT b.id, b.pid, b.proyecto, b.texto, b.est, b.serv, b.inicio,
         CASE
           WHEN a.cid IS NULL                           THEN 'sin_coincidencia'
           WHEN a.n_exactos = 1 AND a.n_otros = 0       THEN 'inequivoca'
           ELSE 'ambigua'
         END,
         CASE
           WHEN a.cid IS NULL                           THEN 'Ningún proveedor del catálogo coincide.'
           WHEN a.n_exactos = 1 AND a.n_otros = 0       THEN 'Un único proveedor con el mismo nombre normalizado y ninguna otra señal.'
           WHEN a.n_exactos > 1                         THEN 'Varios proveedores con el mismo nombre normalizado.'
           WHEN a.n_exactos = 1                         THEN 'Coincide un proveedor por nombre, pero hay otros candidatos por forma societaria o correo.'
           ELSE 'Solo hay candidatos por forma societaria o por correo: elige manualmente.'
         END,
         COALESCE(a.lista, '[]'::jsonb)
    FROM base b
    LEFT JOIN agg a ON a.cid = b.id
   ORDER BY b.proyecto, b.texto, b.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.contratos_sin_proveedor_vista_previa() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.contratos_sin_proveedor_vista_previa() TO authenticated;

COMMENT ON FUNCTION public.contratos_sin_proveedor_vista_previa() IS
  'Contratos de la empresa (y proyectos visibles) sin proveedor vinculado, con su clasificación: inequivoca / ambigua / sin_coincidencia. Solo lectura; no vincula nada.';

-- ── 3. Conteos antes / después ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.contratos_vinculacion_resumen()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company     uuid := public.get_my_company_id();
  v_total       int;
  v_vinculados  int;
  v_inequ       int;
  v_ambig       int;
  v_sin         int;
BEGIN
  IF v_company IS NULL OR NOT public.user_has_permission('condominios.tab.proveedores') THEN
    RAISE EXCEPTION 'No autorizado para revisar contratos de proveedores.'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE c.proveedor_id IS NOT NULL)
    INTO v_total, v_vinculados
    FROM public.contratos_proveedores c
   WHERE c.company_id = v_company AND public.can_access_project(c.project_id);

  SELECT count(*) FILTER (WHERE clasificacion = 'inequivoca'),
         count(*) FILTER (WHERE clasificacion = 'ambigua'),
         count(*) FILTER (WHERE clasificacion = 'sin_coincidencia')
    INTO v_inequ, v_ambig, v_sin
    FROM public.contratos_sin_proveedor_vista_previa();

  RETURN jsonb_build_object(
    'antes', jsonb_build_object(
      'total_contratos', v_total,
      'vinculados',      v_vinculados,
      'sin_proveedor',   v_total - v_vinculados),
    'propuesta', jsonb_build_object(
      'inequivocos',      v_inequ,
      'ambiguos',         v_ambig,
      'sin_coincidencia', v_sin),
    'despues_de_aplicar_inequivocos', jsonb_build_object(
      'total_contratos', v_total,
      'vinculados',      v_vinculados + v_inequ,
      'sin_proveedor',   v_total - v_vinculados - v_inequ));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.contratos_vinculacion_resumen() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.contratos_vinculacion_resumen() TO authenticated;

-- ── 4. Vínculo de UN contrato (el camino manual y el de cada inequívoco) ─────
-- Interna: la llaman las dos RPC públicas. No es ejecutable por authenticated.
CREATE OR REPLACE FUNCTION public.contrato_vincular_proveedor_interno(
  p_contrato_id uuid, p_proveedor_id uuid, p_lote uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('proveedores.vinculando_contrato', 'on', true);
  PERFORM set_config('proveedores.lote_vinculacion', COALESCE(p_lote::text, ''), true);
  UPDATE public.contratos_proveedores
     SET proveedor_id = p_proveedor_id
   WHERE id = p_contrato_id AND proveedor_id IS NULL;
  PERFORM set_config('proveedores.vinculando_contrato', 'off', true);
  PERFORM set_config('proveedores.lote_vinculacion', '', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.contrato_vincular_proveedor_interno(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contrato_vincular_proveedor(
  p_contrato_id uuid, p_proveedor_id uuid, p_motivo text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_c       record;
  v_lote    uuid := gen_random_uuid();
BEGIN
  IF v_company IS NULL OR NOT public.user_has_permission('condominios.tab.proveedores') THEN
    RAISE EXCEPTION 'No autorizado para vincular contratos a proveedores.'
      USING ERRCODE = '42501';
  END IF;

  SELECT c.id, c.project_id, c.proveedor_id INTO v_c
    FROM public.contratos_proveedores c
   WHERE c.id = p_contrato_id AND c.company_id = v_company;
  IF NOT FOUND OR NOT public.can_access_project(v_c.project_id) THEN
    RAISE EXCEPTION 'CONTRATO_INEXISTENTE: el contrato no existe o no pertenece a tu empresa/proyecto.'
      USING ERRCODE = '42501';
  END IF;
  IF v_c.proveedor_id IS NOT NULL THEN
    RAISE EXCEPTION 'CONTRATO_YA_VINCULADO: el contrato ya tiene proveedor; para cambiarlo se termina y se crea uno nuevo.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.proveedores p WHERE p.id = p_proveedor_id AND p.company_id = v_company) THEN
    RAISE EXCEPTION 'PROVEEDOR_AJENO: el proveedor no existe en tu empresa.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.contrato_vincular_proveedor_interno(p_contrato_id, p_proveedor_id, v_lote);
  RETURN v_lote;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.contrato_vincular_proveedor(uuid, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.contrato_vincular_proveedor(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.contrato_vincular_proveedor(uuid, uuid, text) IS
  'Vincula UN contrato histórico a un proveedor del catálogo (selección manual). No modifica los textos del contrato; deja el evento vinculo_proveedor con su lote. Devuelve el lote.';

-- ── 5. Vínculo masivo SOLO de los inequívocos ────────────────────────────────
CREATE OR REPLACE FUNCTION public.contratos_vincular_inequivocos(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_lote    uuid := gen_random_uuid();
  v_fila    record;
  v_n       int := 0;
  v_lista   jsonb := '[]'::jsonb;
BEGIN
  IF v_company IS NULL OR NOT public.user_has_permission('condominios.tab.proveedores') THEN
    RAISE EXCEPTION 'No autorizado para vincular contratos a proveedores.'
      USING ERRCODE = '42501';
  END IF;

  FOR v_fila IN
    SELECT vp.contrato_id, vp.proveedor_nombre_texto,
           (vp.candidatos -> 0 ->> 'id')::uuid AS proveedor_id,
           vp.candidatos -> 0 ->> 'nombre'     AS proveedor_nombre
      FROM public.contratos_sin_proveedor_vista_previa() vp
     WHERE vp.clasificacion = 'inequivoca'
  LOOP
    v_lista := v_lista || jsonb_build_array(jsonb_build_object(
      'contrato_id', v_fila.contrato_id, 'texto_original', v_fila.proveedor_nombre_texto,
      'proveedor_id', v_fila.proveedor_id, 'proveedor_nombre', v_fila.proveedor_nombre));
    v_n := v_n + 1;

    IF NOT p_dry_run THEN
      PERFORM public.contrato_vincular_proveedor_interno(v_fila.contrato_id, v_fila.proveedor_id, v_lote);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'simulacion', p_dry_run,
    'lote',       CASE WHEN p_dry_run THEN NULL ELSE v_lote END,
    'vinculados', CASE WHEN p_dry_run THEN 0 ELSE v_n END,
    'propuestos', v_n,
    'detalle',    v_lista);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.contratos_vincular_inequivocos(boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.contratos_vincular_inequivocos(boolean) TO authenticated;

COMMENT ON FUNCTION public.contratos_vincular_inequivocos(boolean) IS
  'Vincula SOLO los contratos con coincidencia inequívoca. p_dry_run = true (por defecto) solo simula. Los ambiguos y los sin coincidencia no se tocan. Devuelve el lote para poder revertir.';

-- ── 6. Reversión de un lote ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.contratos_vinculos_revertir(p_lote uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company  uuid := public.get_my_company_id();
  v_ev       record;
  v_revert   int := 0;
  v_omitidos jsonb := '[]'::jsonb;
BEGIN
  IF v_company IS NULL OR NOT public.user_has_permission('condominios.tab.proveedores') THEN
    RAISE EXCEPTION 'No autorizado para revertir vínculos de contratos.'
      USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(p_motivo, '')) = '' THEN
    RAISE EXCEPTION 'MOTIVO_REQUERIDO: indica por qué se revierte el lote.'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR v_ev IN
    SELECT e.contrato_id, (e.detalle ->> 'proveedor_id')::uuid AS proveedor_id,
           c.proveedor_id AS actual, c.project_id
      FROM public.contrato_proveedor_eventos e
      JOIN public.contratos_proveedores c ON c.id = e.contrato_id
     WHERE e.lote_vinculacion = p_lote
       AND e.tipo = 'vinculo_proveedor'
       AND e.company_id = v_company
  LOOP
    IF NOT public.can_access_project(v_ev.project_id) THEN
      v_omitidos := v_omitidos || jsonb_build_array(jsonb_build_object(
        'contrato_id', v_ev.contrato_id, 'motivo', 'sin acceso al proyecto'));
    ELSIF v_ev.actual IS DISTINCT FROM v_ev.proveedor_id THEN
      v_omitidos := v_omitidos || jsonb_build_array(jsonb_build_object(
        'contrato_id', v_ev.contrato_id, 'motivo', 'el vínculo ya no es el del lote'));
    ELSIF EXISTS (SELECT 1 FROM public.ordenes_compra o WHERE o.contrato_id = v_ev.contrato_id) THEN
      v_omitidos := v_omitidos || jsonb_build_array(jsonb_build_object(
        'contrato_id', v_ev.contrato_id, 'motivo', 'ya tiene órdenes de compra vinculadas'));
    ELSE
      PERFORM set_config('proveedores.vinculando_contrato', 'on', true);
      PERFORM set_config('proveedores.lote_vinculacion', p_lote::text, true);
      UPDATE public.contratos_proveedores SET proveedor_id = NULL WHERE id = v_ev.contrato_id;
      PERFORM set_config('proveedores.vinculando_contrato', 'off', true);
      PERFORM set_config('proveedores.lote_vinculacion', '', true);
      v_revert := v_revert + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('lote', p_lote, 'revertidos', v_revert, 'omitidos', v_omitidos,
                            'motivo', btrim(p_motivo));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.contratos_vinculos_revertir(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.contratos_vinculos_revertir(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.contratos_vinculos_revertir(uuid, text) IS
  'Deshace un lote de vínculos (proveedor_id vuelve a NULL; los textos históricos nunca se tocaron). Omite e informa los contratos cuyo vínculo cambió o que ya tienen órdenes de compra.';
