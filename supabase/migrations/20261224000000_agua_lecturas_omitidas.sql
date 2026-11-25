-- ════════════════════════════════════════════════════════════════════════════
-- Lecturas omitidas: la parada de una ruta que no se pudo leer, con su porqué
-- ════════════════════════════════════════════════════════════════════════════
-- PROBLEMA. En campo hay paradas que no se pueden leer: un carro estacionado
-- sobre el contador, la casa cerrada, un perro suelto, el medidor ilegible. La
-- ruta no tenía cómo decirlo: el lecturista o se quedaba clavado en la parada
-- o la pasaba sin dejar rastro, y la oficina no se enteraba de qué faltó ni
-- por qué hasta que el cobro no salía.
--
-- QUÉ HACE
--   1. Bucket privado `lecturas-omitidas` para la foto de evidencia. Las rutas
--      van por PROYECTO (`<project_id>/<archivo>`) y no por cliente como
--      `registro-fotos`: hay unidades sin cliente y justo esas también se
--      omiten. Lee y escribe el personal de la empresa con acceso al proyecto.
--   2. `lecturas_omitidas`: una fila por contador que quedó sin leer (o una por
--      unidad, si la unidad no tiene contadores activos). Motivo de una lista
--      cerrada, detalle libre, foto, GPS, quién y cuándo.
--   3. `omitir_lectura(...)`: la ÚNICA puerta de escritura. Resuelve empresa y
--      proyecto desde la unidad, exige `agua.lecturas.create` y acceso al
--      proyecto, comprueba que los contadores sean de esa unidad y que la foto
--      esté en la carpeta del proyecto. Si el contador ya tenía una omisión
--      pendiente, la actualiza en vez de duplicarla (la segunda vuelta de la
--      ruta tampoco pudo).
--   4. `descartar_lectura_omitida(id, nota)`: para cerrar una omisión que ya no
--      se va a leer (contador retirado, casa deshabitada). Exige
--      `agua.rutas.edit` y una nota.
--   5. Trigger AFTER INSERT en `registros`: en cuanto entra una lectura del
--      contador, sus omisiones pendientes pasan a `resuelta` y apuntan a ella.
--      Lo hace la base y no la pantalla, para que valga igual si la lectura
--      llega desde Nueva Lectura, la cola offline o la carga masiva.
--
-- PERMISOS. Ver: empresa + (`agua.lecturas.view` o `agua.rutas.view`) +
-- acceso al proyecto, con la misma forma «una vez por consulta» que
-- 20261212000000. Escribir: sólo por las dos RPC (la tabla no tiene policies de
-- escritura y se le quitan los privilegios). MFA: misma compuerta restrictiva
-- que `registros`.
--
-- LO QUE NO HACE. No toca `registrar_lectura` ni la RLS de `registros`; el
-- trigger sólo escribe en la tabla nueva. Una lectura anulada después no
-- reabre la omisión: anular es corregir el cobro, no decir que no se leyó.
--
-- IMPACTO EN DATOS: ninguno (tabla y bucket nuevos).
--
-- REVERSIÓN
--   DROP TRIGGER IF EXISTS trg_registros_resuelve_omitidas ON public.registros;
--   DROP FUNCTION IF EXISTS public.resolver_lecturas_omitidas();
--   DROP FUNCTION IF EXISTS public.descartar_lectura_omitida(uuid, text);
--   DROP FUNCTION IF EXISTS public.omitir_lectura(uuid, uuid[], uuid, text, text, text, jsonb);
--   DROP TABLE IF EXISTS public.lecturas_omitidas;
--   DROP POLICY IF EXISTS lecturas_omitidas_fotos_select ON storage.objects;
--   DROP POLICY IF EXISTS lecturas_omitidas_fotos_insert ON storage.objects;
--   DROP POLICY IF EXISTS lecturas_omitidas_fotos_delete ON storage.objects;
--   -- el bucket se borra desde el dashboard una vez vacío.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Bucket de evidencias ─────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lecturas-omitidas',
  'lecturas-omitidas',
  false,
  10485760,  -- 10 MiB: una foto de teléfono sin comprimir cabe con holgura
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE
  SET public          = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;
      -- allowed_mime_types NO se actualiza: mismo criterio que 20260729000400.

DROP POLICY IF EXISTS lecturas_omitidas_fotos_select ON storage.objects;
DROP POLICY IF EXISTS lecturas_omitidas_fotos_insert ON storage.objects;
DROP POLICY IF EXISTS lecturas_omitidas_fotos_delete ON storage.objects;

-- foldername(name)[1] es el proyecto. Se compara contra los proyectos de MI
-- empresa a los que tengo acceso, calculados una vez por consulta.
CREATE POLICY lecturas_omitidas_fotos_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'lecturas-omitidas'
    AND (
      (SELECT public.is_super_admin())
      OR (storage.foldername(name))[1] IN (
        SELECT p.id::text FROM public.projects p
        WHERE p.company_id = (SELECT public.get_my_company_id())
          AND public.can_access_project(p.id)
      )
    )
  );

CREATE POLICY lecturas_omitidas_fotos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'lecturas-omitidas'
    AND (
      (SELECT public.is_super_admin())
      OR (
        (SELECT public.user_has_permission('agua.lecturas.create'))
        AND (storage.foldername(name))[1] IN (
          SELECT p.id::text FROM public.projects p
          WHERE p.company_id = (SELECT public.get_my_company_id())
            AND public.can_access_project(p.id)
        )
      )
    )
  );

-- Borrar: sólo para limpiar una foto subida cuya omisión no llegó a guardarse.
CREATE POLICY lecturas_omitidas_fotos_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'lecturas-omitidas'
    AND (
      (SELECT public.is_super_admin())
      OR (
        (SELECT public.user_has_permission('agua.lecturas.create'))
        AND (storage.foldername(name))[1] IN (
          SELECT p.id::text FROM public.projects p
          WHERE p.company_id = (SELECT public.get_my_company_id())
            AND public.can_access_project(p.id)
        )
      )
    )
  );

-- ── 2) Tabla ────────────────────────────────────────────────────────────────
CREATE TABLE public.lecturas_omitidas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id         uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  unidad_id          uuid NOT NULL REFERENCES public.unidades(id) ON DELETE CASCADE,
  -- NULL sólo cuando la unidad no tenía contadores activos que leer.
  contador_id        uuid REFERENCES public.contadores(id) ON DELETE CASCADE,
  -- La ruta en la que se omitió; borrar la ruta no borra el pendiente.
  ruta_id            uuid REFERENCES public.rutas(id) ON DELETE SET NULL,
  motivo             text NOT NULL CHECK (motivo IN (
                       'acceso_obstruido',     -- vehículo u objeto encima del contador
                       'propiedad_cerrada',    -- sin acceso a la propiedad
                       'contador_ilegible',    -- vidrio empañado, sucio, dañado
                       'riesgo_seguridad',     -- perro suelto, zona insegura
                       'contador_no_encontrado',
                       'otro'
                     )),
  detalle            text CHECK (detalle IS NULL OR length(detalle) <= 1000),
  foto_path          text CHECK (foto_path IS NULL OR length(foto_path) <= 400),
  gps                jsonb,
  omitida_por        uuid,
  omitida_por_nombre text,
  omitida_at         timestamptz NOT NULL DEFAULT now(),
  estado             text NOT NULL DEFAULT 'pendiente'
                       CHECK (estado IN ('pendiente', 'resuelta', 'descartada')),
  -- La lectura que la resolvió.
  registro_id        uuid REFERENCES public.registros(id) ON DELETE SET NULL,
  cerrada_at         timestamptz,
  cerrada_por        uuid,
  nota_cierre        text CHECK (nota_cierre IS NULL OR length(nota_cierre) <= 1000),
  -- «Otro» sin explicación no le dice nada a la oficina.
  CONSTRAINT lecturas_omitidas_otro_con_detalle
    CHECK (motivo <> 'otro' OR length(btrim(COALESCE(detalle, ''))) >= 5),
  -- Una omisión abierta no tiene cierre, y una cerrada siempre lo tiene.
  CONSTRAINT lecturas_omitidas_cierre_coherente
    CHECK ((estado = 'pendiente') = (cerrada_at IS NULL))
);

COMMENT ON TABLE public.lecturas_omitidas IS
  'Paradas de una ruta de lecturas que no se pudieron leer, con motivo y evidencia. Se escribe sólo por omitir_lectura / descartar_lectura_omitida; una lectura nueva del contador la resuelve sola (trigger en registros).';

-- Un solo pendiente por contador (y por unidad sin contador): omitir dos veces
-- la misma parada actualiza el pendiente, no lo duplica.
CREATE UNIQUE INDEX lecturas_omitidas_pendiente_contador
  ON public.lecturas_omitidas (contador_id)
  WHERE estado = 'pendiente' AND contador_id IS NOT NULL;
CREATE UNIQUE INDEX lecturas_omitidas_pendiente_unidad
  ON public.lecturas_omitidas (unidad_id)
  WHERE estado = 'pendiente' AND contador_id IS NULL;
-- La pantalla lista por empresa y estado, lo más reciente primero.
CREATE INDEX lecturas_omitidas_company_estado
  ON public.lecturas_omitidas (company_id, estado, omitida_at DESC);
CREATE INDEX lecturas_omitidas_ruta ON public.lecturas_omitidas (ruta_id);

ALTER TABLE public.lecturas_omitidas ENABLE ROW LEVEL SECURITY;

-- Sin policies de escritura y sin privilegios: sólo las RPC escriben.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.lecturas_omitidas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.lecturas_omitidas FROM anon;
GRANT SELECT ON public.lecturas_omitidas TO authenticated;

CREATE POLICY lecturas_omitidas_select ON public.lecturas_omitidas
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (
      company_id = (SELECT public.get_my_company_id())
      AND (
        (SELECT public.user_has_permission('agua.lecturas.view'))
        OR (SELECT public.user_has_permission('agua.rutas.view'))
      )
      AND project_id IN (
        SELECT p.id FROM public.projects p
        WHERE p.company_id = (SELECT public.get_my_company_id())
          AND public.can_access_project(p.id)
      )
    )
  );

CREATE POLICY mfa_gate_aal2 ON public.lecturas_omitidas
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.mfa_requirement_met()))
  WITH CHECK ((SELECT public.mfa_requirement_met()));

-- ── 3) omitir_lectura ───────────────────────────────────────────────────────
-- SECURITY DEFINER porque escribe en una tabla sin privilegios de escritura; por
-- eso mismo repite aquí, explícitas, todas las comprobaciones de acceso.
CREATE OR REPLACE FUNCTION public.omitir_lectura(
  p_unidad_id    uuid,
  p_contador_ids uuid[],
  p_ruta_id      uuid,
  p_motivo       text,
  p_detalle      text,
  p_foto_path    text,
  p_gps          jsonb
)
RETURNS SETOF public.lecturas_omitidas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_company   uuid;
  v_project   uuid;
  v_nombre    text;
  v_detalle   text := NULLIF(btrim(COALESCE(p_detalle, '')), '');
  v_ids       uuid[];
  v_validos   int;
  v_cid       uuid;
  v_fila      public.lecturas_omitidas;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT u.company_id, u.project_id INTO v_company, v_project
    FROM public.unidades u WHERE u.id = p_unidad_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Unidad inexistente' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_super_admin() THEN
    IF v_company IS DISTINCT FROM public.get_my_company_id() THEN
      RAISE EXCEPTION 'La unidad no es de su empresa' USING ERRCODE = '42501';
    END IF;
    IF NOT public.user_has_permission('agua.lecturas.create') THEN
      RAISE EXCEPTION 'No tiene permiso para registrar lecturas' USING ERRCODE = '42501';
    END IF;
    IF NOT public.can_access_project(v_project) THEN
      RAISE EXCEPTION 'No tiene acceso a este proyecto' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- La foto tiene que estar en la carpeta del proyecto de la UNIDAD, no en la
  -- que diga el navegador: si no, la evidencia podría colgarse de otro.
  IF p_foto_path IS NOT NULL THEN
    IF p_foto_path NOT LIKE v_project::text || '/%'
       OR position('..' IN p_foto_path) > 0
       OR length(p_foto_path) > 400 THEN
      RAISE EXCEPTION 'La foto no pertenece al proyecto de la unidad' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_ruta_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.rutas r
    WHERE r.id = p_ruta_id
      AND r.company_id = v_company
      AND (r.project_id IS NULL OR r.project_id = v_project)
  ) THEN
    RAISE EXCEPTION 'La ruta no corresponde a la unidad' USING ERRCODE = '22023';
  END IF;

  -- Contadores: todos tienen que ser de esta unidad. Sin contadores, una sola
  -- fila por la unidad.
  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO v_ids
    FROM unnest(COALESCE(p_contador_ids, '{}')) AS x WHERE x IS NOT NULL;
  IF cardinality(v_ids) > 0 THEN
    SELECT count(*) INTO v_validos
      FROM public.contadores c
     WHERE c.id = ANY (v_ids) AND c.unidad_id = p_unidad_id;
    IF v_validos <> cardinality(v_ids) THEN
      RAISE EXCEPTION 'Algún contador no pertenece a la unidad' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT NULLIF(btrim(a.full_name), '') INTO v_nombre
    FROM public.app_users a WHERE a.id = v_uid;

  IF cardinality(v_ids) = 0 THEN
    INSERT INTO public.lecturas_omitidas AS lo (
      company_id, project_id, unidad_id, contador_id, ruta_id,
      motivo, detalle, foto_path, gps, omitida_por, omitida_por_nombre
    ) VALUES (
      v_company, v_project, p_unidad_id, NULL, p_ruta_id,
      p_motivo, v_detalle, p_foto_path, p_gps, v_uid, v_nombre
    )
    ON CONFLICT (unidad_id) WHERE estado = 'pendiente' AND contador_id IS NULL
    DO UPDATE SET
      ruta_id = EXCLUDED.ruta_id, motivo = EXCLUDED.motivo, detalle = EXCLUDED.detalle,
      foto_path = EXCLUDED.foto_path, gps = EXCLUDED.gps, omitida_por = EXCLUDED.omitida_por,
      omitida_por_nombre = EXCLUDED.omitida_por_nombre, omitida_at = now()
    RETURNING lo.* INTO v_fila;
    RETURN NEXT v_fila;
    RETURN;
  END IF;

  FOREACH v_cid IN ARRAY v_ids LOOP
    INSERT INTO public.lecturas_omitidas AS lo (
      company_id, project_id, unidad_id, contador_id, ruta_id,
      motivo, detalle, foto_path, gps, omitida_por, omitida_por_nombre
    ) VALUES (
      v_company, v_project, p_unidad_id, v_cid, p_ruta_id,
      p_motivo, v_detalle, p_foto_path, p_gps, v_uid, v_nombre
    )
    ON CONFLICT (contador_id) WHERE estado = 'pendiente' AND contador_id IS NOT NULL
    DO UPDATE SET
      unidad_id = EXCLUDED.unidad_id, ruta_id = EXCLUDED.ruta_id, motivo = EXCLUDED.motivo,
      detalle = EXCLUDED.detalle, foto_path = EXCLUDED.foto_path, gps = EXCLUDED.gps,
      omitida_por = EXCLUDED.omitida_por, omitida_por_nombre = EXCLUDED.omitida_por_nombre,
      omitida_at = now()
    RETURNING lo.* INTO v_fila;
    RETURN NEXT v_fila;
  END LOOP;
END
$$;

COMMENT ON FUNCTION public.omitir_lectura(uuid, uuid[], uuid, text, text, text, jsonb) IS
  'Registra que una parada de ruta no se pudo leer (motivo, detalle, foto, GPS). Una fila por contador; si ya había un pendiente para ese contador, lo actualiza.';

REVOKE EXECUTE ON FUNCTION public.omitir_lectura(uuid, uuid[], uuid, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omitir_lectura(uuid, uuid[], uuid, text, text, text, jsonb) TO authenticated;

-- ── 4) descartar_lectura_omitida ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.descartar_lectura_omitida(p_id uuid, p_nota text)
RETURNS public.lecturas_omitidas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nota text := NULLIF(btrim(COALESCE(p_nota, '')), '');
  v_fila public.lecturas_omitidas;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_fila FROM public.lecturas_omitidas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Omisión inexistente' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_super_admin() THEN
    IF v_fila.company_id IS DISTINCT FROM public.get_my_company_id()
       OR NOT public.can_access_project(v_fila.project_id) THEN
      RAISE EXCEPTION 'Omisión inexistente' USING ERRCODE = '22023';
    END IF;
    IF NOT public.user_has_permission('agua.rutas.edit') THEN
      RAISE EXCEPTION 'No tiene permiso para descartar lecturas pendientes' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_fila.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Esta lectura ya no está pendiente' USING ERRCODE = '22023';
  END IF;
  IF v_nota IS NULL OR length(v_nota) < 5 THEN
    RAISE EXCEPTION 'Escriba por qué se descarta (mínimo 5 caracteres)' USING ERRCODE = '22023';
  END IF;

  UPDATE public.lecturas_omitidas
     SET estado = 'descartada', cerrada_at = now(), cerrada_por = v_uid, nota_cierre = v_nota
   WHERE id = p_id
  RETURNING * INTO v_fila;
  RETURN v_fila;
END
$$;

REVOKE EXECUTE ON FUNCTION public.descartar_lectura_omitida(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.descartar_lectura_omitida(uuid, text) TO authenticated;

-- ── 5) Una lectura nueva del contador resuelve sus omisiones ────────────────
-- AFTER: la fila de `registros` ya pasó todas sus validaciones. SECURITY
-- DEFINER porque quien registra la lectura no tiene privilegio de UPDATE sobre
-- la tabla nueva.
CREATE OR REPLACE FUNCTION public.resolver_lecturas_omitidas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.lecturas_omitidas
     SET estado = 'resuelta', registro_id = NEW.id, cerrada_at = now(), cerrada_por = auth.uid()
   WHERE contador_id = NEW.contador_id
     AND estado = 'pendiente';
  RETURN NULL;
END
$$;

REVOKE EXECUTE ON FUNCTION public.resolver_lecturas_omitidas() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_registros_resuelve_omitidas ON public.registros;
CREATE TRIGGER trg_registros_resuelve_omitidas
  AFTER INSERT ON public.registros
  FOR EACH ROW
  WHEN (NEW.contador_id IS NOT NULL AND NEW.deleted_at IS NULL)
  EXECUTE FUNCTION public.resolver_lecturas_omitidas();
