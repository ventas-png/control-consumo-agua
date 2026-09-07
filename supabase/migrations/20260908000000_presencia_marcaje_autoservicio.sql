-- ════════════════════════════════════════════════════════════════════════════
-- El empleado marca su propio turno: foto, ubicación y hora del servidor
-- ════════════════════════════════════════════════════════════════════════════
-- PROBLEMA. `presencia_personal` solo sabe registrar asistencia de UNA forma:
-- alguien con el permiso del tab abre el formulario, elige a un empleado de una
-- lista, teclea la hora de entrada y guarda. Eso deja tres agujeros:
--
--   · La hora la escribe una persona. «Entré a las 6:00» es un campo de texto,
--     no un hecho: se puede teclear a las 9:15 y nadie se entera.
--   · No hay prueba de que la persona estuviera ahí. Ni foto ni ubicación.
--   · El marcaje lo hace un tercero. El guardia no ficha: lo fichan. Cuando el
--     administrador no está, no hay marcaje — o se repone «de memoria» al día
--     siguiente, que es la forma más común de que la planilla mienta.
--
-- QUÉ AGREGA ESTA MIGRACIÓN. La vía de AUTOSERVICIO: el empleado entra con su
-- cuenta, dice «vengo a marcar mi turno», y el sistema —no él— pone la hora, el
-- expediente, el turno planificado y el estado. Él solo aporta lo que únicamente
-- él puede aportar: su cara y dónde está.
--
--   1. Columnas de evidencia en `presencia_personal` (foto, GPS y el timestamp
--      real de cada marcaje). La hora legible (`hora_entrada`, time) NO se toca:
--      es la que lee el cómputo de horas (20260820000300) y todo lo que ya
--      existe. Las nuevas la ACOMPAÑAN, no la sustituyen.
--   2. `presencia-evidencias`: bucket PRIVADO propio para las fotos.
--   3. `presencia_mi_ficha(project)`: qué empleado es la cuenta que llama, qué
--      turno tiene hoy y qué marcó ya. Es lo que rellena el formulario solo.
--   4. `presencia_marcar(project, tipo, foto, gps, obs)`: el marcaje mismo.
--
-- POR QUÉ RPC Y NO UN INSERT DESDE EL NAVEGADOR. Dos razones que no se pueden
-- resolver con una policy:
--
--   (a) LA HORA. Un INSERT trae la hora que el cliente quiera mandar. Todo el
--       valor del autoservicio depende de que la hora la ponga el servidor, y
--       eso solo se garantiza si el cliente no la manda nunca.
--   (b) EL PERMISO. La RLS de `presencia_personal` (20260518000010) exige
--       `condominios.tab.presencia` para escribir — el permiso de quien
--       ADMINISTRA la asistencia de todos. Un conserje no lo tiene ni debe
--       tenerlo: le dejaría editar el marcaje de sus compañeros. La RPC invierte
--       la pregunta: no «¿puede administrar presencia?» sino «¿es esta cuenta el
--       expediente que dice ser, en este condominio?», que es lo que
--       `personal_condominio.user_id` (20260826000000) ya contesta.
--
-- LO QUE ESTA MIGRACIÓN NO HACE. No cambia ninguna policy existente, no siembra
-- permisos y no altera el formulario manual: el administrador sigue pudiendo
-- registrar a quien no tiene cuenta (que es la mayoría del personal operativo).
-- Las dos vías conviven sobre la MISMA fila del día, y por eso `presencia_marcar`
-- completa la fila que ya exista en lugar de crear una segunda.
--
-- REVERSIÓN
--   DROP FUNCTION IF EXISTS public.presencia_marcar(uuid, text, text, jsonb, text);
--   DROP FUNCTION IF EXISTS public.presencia_mi_ficha(uuid);
--   -- Los helpers de RBAC van envueltos en `(SELECT …)` dentro de las policies: así
-- el planificador los evalúa UNA vez (initplan) y no una por objeto listado
-- (20260906000100). Un listado de fotos de fichaje de un mes son cientos de
-- filas y otras tantas llamadas.
DROP POLICY IF EXISTS "presencia_evidencias_select" ON storage.objects;
--   DROP POLICY IF EXISTS "presencia_evidencias_insert" ON storage.objects;
--   DROP POLICY IF EXISTS "presencia_evidencias_delete" ON storage.objects;
--   DROP FUNCTION IF EXISTS public.presencia_ficha_es_propia(text, text);
--   DROP FUNCTION IF EXISTS public.presencia_ficha_de_usuario(uuid);
--   DROP INDEX  IF EXISTS public.presencia_autoservicio_una_por_dia;
--   ALTER TABLE public.presencia_personal
--     DROP COLUMN IF EXISTS origen, DROP COLUMN IF EXISTS foto_entrada,
--     DROP COLUMN IF EXISTS foto_salida, DROP COLUMN IF EXISTS gps_entrada,
--     DROP COLUMN IF EXISTS gps_salida, DROP COLUMN IF EXISTS entrada_marcada_en,
--     DROP COLUMN IF EXISTS salida_marcada_en;
--
-- Idempotente: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
-- CREATE OR REPLACE / DROP POLICY IF EXISTS antes de cada CREATE POLICY /
-- ON CONFLICT DO UPDATE en el bucket.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. La evidencia del marcaje ─────────────────────────────────────────────
-- Todas nullable: el marcaje manual (el que ya existe) no tiene ninguna de
-- estas, y las filas históricas tampoco. `origen` es la única con NOT NULL
-- porque su default describe con exactitud lo que hay hoy en la tabla.
ALTER TABLE public.presencia_personal
  ADD COLUMN IF NOT EXISTS origen             text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS foto_entrada       text,
  ADD COLUMN IF NOT EXISTS foto_salida        text,
  ADD COLUMN IF NOT EXISTS gps_entrada        jsonb,
  ADD COLUMN IF NOT EXISTS gps_salida         jsonb,
  ADD COLUMN IF NOT EXISTS entrada_marcada_en timestamptz,
  ADD COLUMN IF NOT EXISTS salida_marcada_en  timestamptz;

-- CHECK en DO $$ con guard: ADD CONSTRAINT no tiene IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'presencia_personal_origen_check'
      AND conrelid = 'public.presencia_personal'::regclass
  ) THEN
    ALTER TABLE public.presencia_personal
      ADD CONSTRAINT presencia_personal_origen_check
      CHECK (origen IN ('manual', 'autoservicio'));
  END IF;
END $$;

COMMENT ON COLUMN public.presencia_personal.origen IS
  'Cómo se creó la fila: "manual" (alguien la tecleó desde el tab) o "autoservicio" (el propio empleado marcó con presencia_marcar, con hora de servidor). Es lo que distingue un marcaje con evidencia de uno reconstruido.';
COMMENT ON COLUMN public.presencia_personal.foto_entrada IS
  'Path en el bucket privado presencia-evidencias (<project_id>/<personal_id>/<archivo>) de la foto tomada al marcar entrada. NULL = sin foto (marcaje manual, o cámara no disponible).';
COMMENT ON COLUMN public.presencia_personal.foto_salida IS
  'Igual que foto_entrada, para el marcaje de salida.';
COMMENT ON COLUMN public.presencia_personal.gps_entrada IS
  'Ubicación al marcar entrada: {"lat": number, "lng": number, "exactitud_m": number|null}. La normaliza presencia_marcar; NULL si el dispositivo no la dio.';
COMMENT ON COLUMN public.presencia_personal.gps_salida IS
  'Igual que gps_entrada, para el marcaje de salida.';
COMMENT ON COLUMN public.presencia_personal.entrada_marcada_en IS
  'Instante EXACTO (timestamptz de servidor) en que se registró la entrada. hora_entrada es su hora local recortada a time, que es lo que lee el cómputo de horas; esta columna es la que no se puede discutir.';
COMMENT ON COLUMN public.presencia_personal.salida_marcada_en IS
  'Igual que entrada_marcada_en, para la salida.';

-- Un empleado no puede tener dos marcajes de autoservicio el mismo día en el
-- mismo condominio. La RPC ya comprueba y completa la fila existente; el índice
-- es lo que hace imposible la carrera de dos toques simultáneos (el móvil que
-- reenvía porque la red tardó). Parcial: no toca al marcaje manual, que sigue
-- pudiendo tener varias filas por persona y día si así lo necesita la operación.
CREATE UNIQUE INDEX IF NOT EXISTS presencia_autoservicio_una_por_dia
  ON public.presencia_personal (project_id, personal_id, fecha)
  WHERE origen = 'autoservicio' AND personal_id IS NOT NULL;

-- ── 2. La zona horaria del tenant ───────────────────────────────────────────
-- El marcaje tiene que caer en el DÍA correcto y con la HORA correcta, y las dos
-- cosas dependen de la zona del tenant (`companies.timezone`, 20260717110000).
-- Una zona inválida por un typo en configuración no puede impedir que alguien
-- fiche: se cae al default y se sigue, igual que hace `agua_cerrar_ciclo`.
CREATE OR REPLACE FUNCTION public.presencia_zona_horaria(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tz text;
BEGIN
  SELECT COALESCE(c.timezone, 'America/Guatemala') INTO v_tz
  FROM public.companies c WHERE c.id = p_company_id;
  v_tz := COALESCE(v_tz, 'America/Guatemala');
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    v_tz := 'America/Guatemala';
  END;
  RETURN v_tz;
END;
$$;

COMMENT ON FUNCTION public.presencia_zona_horaria(uuid) IS
  'Zona IANA del tenant para fechar el marcaje, con fallback a America/Guatemala si companies.timezone falta o es inválida. Un typo en configuración no puede impedir fichar.';

-- SIN grant a `authenticated`, a propósito. Sus únicos llamadores son los
-- cuerpos de presencia_mi_ficha y presencia_marcar, que son SECURITY DEFINER y
-- corren como el dueño: no necesitan el privilegio del invocante. Y expuesta
-- toma un company_id ajeno y contesta igual — trivial, pero es una lectura
-- cross-tenant que nada necesita. Es el remedio que el propio
-- scripts/migrations-guard.allowlist.json prescribe para esta clase de helper:
-- «el remedio correcto no es un guard sino REVOKE EXECUTE … FROM authenticated».
REVOKE EXECUTE ON FUNCTION public.presencia_zona_horaria(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Quién es esta cuenta AQUÍ ────────────────────────────────────────────
-- SECURITY DEFINER porque tiene que leer `personal_condominio`, cuya RLS exige
-- `condominios.tab.personal` (20260518000010): el conserje no puede leer NI SU
-- PROPIO expediente, así que con SECURITY INVOKER esto devolvería siempre NULL
-- justo para las cuentas a las que sirve. Lee un solo id por (usuario, proyecto)
-- —el índice único de 20260826000000 garantiza que no hay más de uno— y no
-- expone ningún otro campo de la ficha.
CREATE OR REPLACE FUNCTION public.presencia_ficha_de_usuario(p_project_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pc.id
  FROM public.personal_condominio pc
  WHERE pc.project_id = p_project_id
    AND pc.user_id = (SELECT auth.uid())
    AND COALESCE(pc.estado, '') <> 'inactivo'
  LIMIT 1
$$;

COMMENT ON FUNCTION public.presencia_ficha_de_usuario(uuid) IS
  'Expediente (personal_condominio.id) de la cuenta que llama en ese condominio, o NULL si no tiene o está inactiva. SECURITY DEFINER porque la RLS de personal_condominio exige el permiso del tab Personal, que el personal operativo no tiene sobre su propia ficha.';

-- Tampoco se le concede a `authenticated`: la llaman presencia_mi_ficha,
-- presencia_marcar y presencia_ficha_es_propia, las tres SECURITY DEFINER. La
-- que SÍ se evalúa dentro de una policy —y por tanto con el rol invocante— es
-- `presencia_ficha_es_propia`, que va justo abajo con su grant.
REVOKE EXECUTE ON FUNCTION public.presencia_ficha_de_usuario(uuid) FROM PUBLIC, anon, authenticated;

-- Variante en text para las policies de storage, donde los segmentos del path
-- son text y un cast inválido en un WITH CHECK aborta la petición entera en vez
-- de denegarla. Devuelve false ante cualquier basura en el path.
CREATE OR REPLACE FUNCTION public.presencia_ficha_es_propia(p_personal text, p_project text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project uuid;
  v_ficha   uuid;
BEGIN
  BEGIN
    v_project := p_project::uuid;
    v_ficha   := p_personal::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
  RETURN v_ficha IS NOT NULL
     AND v_ficha = public.presencia_ficha_de_usuario(v_project);
END;
$$;

COMMENT ON FUNCTION public.presencia_ficha_es_propia(text, text) IS
  'true si <personal_id> es el expediente de quien llama en <project_id>. Para las policies de storage de presencia-evidencias: un uuid mal formado devuelve false en vez de romper la petición.';

REVOKE EXECUTE ON FUNCTION public.presencia_ficha_es_propia(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.presencia_ficha_es_propia(text, text) TO authenticated;

-- ── 4. El bucket de las fotos ───────────────────────────────────────────────
-- NO van a `condominios-media`. Ese bucket autoriza por proyecto y nada más
-- (20260603220000 / 20260822020000): cualquier residente del condominio podría
-- listar y descargar las fotos de fichaje de todo el personal — una serie
-- temporal de la cara y la ubicación de cada trabajador. Es el mismo hallazgo
-- que sacó de ahí las evidencias de recepción (20260831000000), y aquí pesa más
-- porque el sujeto del dato es una persona identificada.
--
-- 4 MiB: son selfies comprimidas a 1280 px por el cliente, no documentos.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'presencia-evidencias', 'presencia-evidencias', false, 4194304,
  ARRAY['image/jpeg','image/png','image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Los helpers de RBAC van envueltos en `(SELECT …)` dentro de las policies: así
-- el planificador los evalúa UNA vez (initplan) y no una por objeto listado
-- (20260906000100). Un listado de fotos de fichaje de un mes son cientos de
-- filas y otras tantas llamadas.
DROP POLICY IF EXISTS "presencia_evidencias_select" ON storage.objects;
DROP POLICY IF EXISTS "presencia_evidencias_insert" ON storage.objects;
DROP POLICY IF EXISTS "presencia_evidencias_update" ON storage.objects;
DROP POLICY IF EXISTS "presencia_evidencias_delete" ON storage.objects;

-- SELECT — dos ramas, y ninguna es «el proyecto»:
--   · la persona ve SUS propias fotos (para eso está la primera);
--   · quien administra la asistencia del condominio las ve todas, que es el
--     único uso legítimo de la evidencia de un tercero.
CREATE POLICY "presencia_evidencias_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'presencia-evidencias'
    AND (
      (SELECT public.is_super_admin())
      OR public.presencia_ficha_es_propia(
           (storage.foldername(name))[2], (storage.foldername(name))[1])
      OR (
        (SELECT public.user_has_permission('condominios.tab.presencia'))
        AND EXISTS (
          SELECT 1 FROM public.projects pr
          WHERE pr.id::text = (storage.foldername(name))[1]
            AND pr.company_id = (SELECT public.get_my_company_id())
            AND public.can_access_project(pr.id)
        )
      )
    )
  );

-- INSERT — la foto se sube ANTES de llamar a presencia_marcar (la RPC recibe el
-- path ya subido y comprueba que empiece por <project>/<ficha propia>/). Aquí se
-- cierra la otra mitad: que nadie pueda colgar un archivo bajo el expediente de
-- otra persona, ni siquiera si nunca llama a la RPC.
--
-- La rama del permiso existe para el marcaje que hace el administrador POR un
-- empleado (reposición con foto), y exige `.create`, que es el permiso de
-- escribir asistencia — no basta con ver el tab.
CREATE POLICY "presencia_evidencias_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'presencia-evidencias'
    AND (
      (SELECT public.is_super_admin())
      OR (
        -- Ruta exacta <project>/<personal>/<archivo>: sin las dos carpetas no
        -- hay forma de decidir después quién puede leer el objeto.
        array_length(storage.foldername(name), 1) = 2
        AND (storage.foldername(name))[2] <> ''
        AND (
          public.presencia_ficha_es_propia(
            (storage.foldername(name))[2], (storage.foldername(name))[1])
          OR (
            (SELECT public.user_has_permission('condominios.tab.presencia.create'))
            AND EXISTS (
              SELECT 1 FROM public.projects pr
              WHERE pr.id::text = (storage.foldername(name))[1]
                AND pr.company_id = (SELECT public.get_my_company_id())
                AND public.can_access_project(pr.id)
            )
          )
        )
      )
    )
  );

-- UPDATE — deliberadamente SIN policy. Sustituir el archivo de un fichaje es
-- falsificar la prueba; se sube con upsert:false y punto.

-- DELETE — solo la administración de la empresa. Ni siquiera el dueño de la
-- foto: borrar la propia evidencia es exactamente lo que un marcaje discutido
-- necesitaría impedir. La retención se gestiona desde la empresa, no desde el
-- móvil de quien fichó.
CREATE POLICY "presencia_evidencias_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'presencia-evidencias'
    AND (
      (SELECT public.is_super_admin())
      OR (
        (SELECT public.current_user_role()) = ANY(ARRAY['company_owner','admin'])
        AND EXISTS (
          SELECT 1 FROM public.projects pr
          WHERE pr.id::text = (storage.foldername(name))[1]
            AND pr.company_id = (SELECT public.get_my_company_id())
            AND public.can_access_project(pr.id)
        )
      )
    )
  );

-- ── 5. Lo que el formulario ya no tiene que preguntar ───────────────────────
-- Una sola llamada contesta las cuatro preguntas de la pantalla de marcaje:
-- quién soy aquí, qué turno tengo hoy, qué marqué ya y qué me toca ahora.
--
-- `fecha_operativa` la calcula el SERVIDOR en la zona del tenant: el móvil puede
-- tener la fecha mal (o estar en otro huso) y ese desfase movería el marcaje de
-- día — el error más caro posible en una planilla.
CREATE OR REPLACE FUNCTION public.presencia_mi_ficha(p_project_id uuid)
RETURNS TABLE (
  personal_id       uuid,
  nombre            text,
  cargo             text,
  foto_url          text,
  fecha_operativa   date,
  hora_servidor     time,
  bloque_id         uuid,
  turno             text,
  turno_inicio      time,
  turno_fin         time,
  registro_id       uuid,
  hora_entrada      time,
  hora_salida       time,
  estado            text,
  origen            text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company uuid;
  v_ficha   uuid;
  v_tz      text;
  v_local   timestamp;
BEGIN
  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Proyecto inexistente' USING ERRCODE = '42501';
  END IF;
  -- El super admin no tiene expediente en ningún condominio: no hay nada que
  -- devolverle, y devolver cero filas es la respuesta correcta (la pantalla de
  -- marcaje se oculta sola).
  IF NOT public.is_super_admin() AND v_company IS DISTINCT FROM public.get_my_company_id() THEN
    RAISE EXCEPTION 'Proyecto fuera de la empresa' USING ERRCODE = '42501';
  END IF;

  v_ficha := public.presencia_ficha_de_usuario(p_project_id);
  IF v_ficha IS NULL THEN
    RETURN;  -- sin ficha vinculada no hay autoservicio; no es un error.
  END IF;

  v_tz := public.presencia_zona_horaria(v_company);
  v_local := (now() AT TIME ZONE v_tz);

  RETURN QUERY
  SELECT
    pc.id,
    pc.nombre,
    pc.cargo,
    pc.foto_url,
    v_local::date,
    v_local::time,
    bt.id,
    bt.turno,
    bt.hora_inicio,
    bt.hora_fin,
    pp.id,
    pp.hora_entrada,
    pp.hora_salida,
    pp.estado,
    pp.origen
  FROM public.personal_condominio pc
  LEFT JOIN public.bloques_turno bt
    ON bt.personal_id = pc.id
   AND bt.project_id  = p_project_id
   AND bt.fecha       = v_local::date
  LEFT JOIN public.presencia_personal pp
    ON pp.personal_id = pc.id
   AND pp.project_id  = p_project_id
   AND pp.fecha       = v_local::date
  WHERE pc.id = v_ficha;
END;
$$;

COMMENT ON FUNCTION public.presencia_mi_ficha(uuid) IS
  'Datos con los que se rellena solo el marcaje de autoservicio: expediente de quien llama en ese condominio, fecha y hora del SERVIDOR en la zona del tenant, turno planificado de hoy y el marcaje que ya exista. Cero filas = la cuenta no tiene expediente aquí (no es error). SECURITY DEFINER porque el personal operativo no tiene permiso sobre personal_condominio ni sobre presencia_personal.';

REVOKE EXECUTE ON FUNCTION public.presencia_mi_ficha(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.presencia_mi_ficha(uuid) TO authenticated;

-- ── 6. El marcaje ───────────────────────────────────────────────────────────
-- Recibe lo que SOLO puede aportar el dispositivo (la foto ya subida y la
-- ubicación) y pone todo lo demás: fecha, hora, expediente, turno y estado.
--
-- LA HORA NO ES UN PARÁMETRO, y esa ausencia es el diseño entero: `hora_entrada`
-- sale de `now()` en la zona del tenant, no de nada que el cliente mande. Por lo
-- mismo la foto se valida contra el path que le corresponde a QUIEN LLAMA y se
-- comprueba que el objeto exista de verdad en el bucket: un path inventado
-- dejaría una fila que dice tener evidencia y no la tiene.
--
-- ENTRADA — completa la fila del día si ya existe (el administrador pudo dejarla
-- creada) y la crea si no. Marcar dos veces no es un error silencioso: se
-- rechaza diciendo a qué hora se marcó la primera.
--
-- SALIDA — cierra la última entrada abierta de las últimas 48 horas, no «la de
-- hoy»: el turno de noche entra el día 5 y sale el día 6, y buscar solo la fecha
-- de hoy dejaría abierta la fila de ayer para siempre.
CREATE OR REPLACE FUNCTION public.presencia_marcar(
  p_project_id    uuid,
  p_tipo          text,
  p_foto          text    DEFAULT NULL,
  p_gps           jsonb   DEFAULT NULL,
  p_observaciones text    DEFAULT NULL
)
RETURNS TABLE (
  registro_id  uuid,
  fecha        date,
  hora         time,
  estado       text,
  tipo         text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company    uuid;
  v_ficha      uuid;
  v_nombre     text;
  v_cargo      text;
  v_tz         text;
  v_local      timestamp;
  v_fecha      date;
  v_hora       time;
  v_tipo       text := lower(btrim(COALESCE(p_tipo, '')));
  v_foto       text;
  v_gps        jsonb;
  v_lat        numeric;
  v_lng        numeric;
  v_exactitud  numeric;
  v_bloque_id  uuid;
  v_inicio     time;
  v_tolerancia int;
  v_retraso    numeric;
  v_estado     text := 'presente';
  v_obs        text := NULLIF(btrim(COALESCE(p_observaciones, '')), '');
  v_reg        public.presencia_personal%ROWTYPE;
BEGIN
  IF v_tipo NOT IN ('entrada', 'salida') THEN
    RAISE EXCEPTION 'Tipo de marcaje inválido (esperado entrada o salida)'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Proyecto inexistente' USING ERRCODE = '42501';
  END IF;
  IF v_company IS DISTINCT FROM public.get_my_company_id() THEN
    RAISE EXCEPTION 'Proyecto fuera de la empresa' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access_project(p_project_id) THEN
    RAISE EXCEPTION 'No tienes acceso a este condominio' USING ERRCODE = '42501';
  END IF;

  v_ficha := public.presencia_ficha_de_usuario(p_project_id);
  IF v_ficha IS NULL THEN
    RAISE EXCEPTION 'Tu cuenta no está vinculada a un expediente de personal en este condominio. Pídele al administrador que la vincule desde el tab Personal.'
      USING ERRCODE = '42501';
  END IF;
  SELECT pc.nombre, pc.cargo INTO v_nombre, v_cargo
  FROM public.personal_condominio pc WHERE pc.id = v_ficha;

  v_tz    := public.presencia_zona_horaria(v_company);
  v_local := (now() AT TIME ZONE v_tz);
  v_fecha := v_local::date;
  -- A segundos: `time` guarda microsegundos y la asistencia no se discute en
  -- fracciones de segundo. Además hace legible el dato en la lista del día.
  v_hora  := date_trunc('second', v_local)::time;

  -- ── La foto tiene que ser SUYA y tiene que existir ────────────────────────
  v_foto := NULLIF(btrim(COALESCE(p_foto, '')), '');
  IF v_foto IS NOT NULL THEN
    IF v_foto <> p_project_id::text || '/' || v_ficha::text || '/' ||
                 split_part(v_foto, '/', 3)
       OR array_length(string_to_array(v_foto, '/'), 1) <> 3
       OR split_part(v_foto, '/', 3) = ''
    THEN
      RAISE EXCEPTION 'La foto no corresponde a tu expediente en este condominio'
        USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM storage.objects o
      WHERE o.bucket_id = 'presencia-evidencias' AND o.name = v_foto
    ) THEN
      RAISE EXCEPTION 'La foto no llegó a subirse. Intentá de nuevo.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ── La ubicación, normalizada o nada ─────────────────────────────────────
  -- Se guarda solo si es un par de coordenadas plausible. Una cadena vacía o un
  -- número fuera de rango no es "ubicación aproximada": es ruido que después se
  -- lee como si fuera un dato.
  IF p_gps IS NOT NULL AND jsonb_typeof(p_gps) = 'object' THEN
    BEGIN
      v_lat := (p_gps->>'lat')::numeric;
      v_lng := (p_gps->>'lng')::numeric;
      v_exactitud := NULLIF(p_gps->>'exactitud_m', '')::numeric;
      IF v_lat BETWEEN -90 AND 90 AND v_lng BETWEEN -180 AND 180 THEN
        v_gps := jsonb_build_object('lat', v_lat, 'lng', v_lng, 'exactitud_m', v_exactitud);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_gps := NULL;
    END;
  END IF;

  -- ══ ENTRADA ══════════════════════════════════════════════════════════════
  IF v_tipo = 'entrada' THEN
    -- Turno planificado de hoy: de él salen `bloque_id` (que es lo que ata el
    -- marcaje al cómputo de horas) y la vara para la tardanza.
    SELECT bt.id, bt.hora_inicio,
           COALESCE(ph.tolerancia_entrada_min, 10)
      INTO v_bloque_id, v_inicio, v_tolerancia
    FROM public.bloques_turno bt
    LEFT JOIN public.plantillas_horario ph ON ph.id = bt.plantilla_horario_id
    WHERE bt.personal_id = v_ficha
      AND bt.project_id  = p_project_id
      AND bt.fecha       = v_fecha
    ORDER BY bt.hora_inicio NULLS LAST
    LIMIT 1;

    -- TARDANZA: solo cuando hay un turno planificado con hora y el retraso cae
    -- en una ventana razonable. Pasadas 4 horas ya no se está midiendo ese
    -- turno —lo más probable es que se marcara contra el bloque equivocado— y
    -- el sistema deja el estado neutro para que lo resuelva quien administra.
    -- La tolerancia es la de la plantilla de horario (tolerancia_entrada_min),
    -- que ya existía para el cómputo de horas: no se inventa una segunda vara.
    IF v_inicio IS NOT NULL THEN
      v_retraso := EXTRACT(EPOCH FROM (v_hora - v_inicio)) / 60;
      IF v_retraso > v_tolerancia AND v_retraso <= 240 THEN
        v_estado := 'tardanza';
      END IF;
    END IF;

    SELECT * INTO v_reg
    FROM public.presencia_personal pp
    WHERE pp.project_id  = p_project_id
      AND pp.personal_id = v_ficha
      AND pp.fecha       = v_fecha
    ORDER BY pp.created_at
    LIMIT 1
    FOR UPDATE;

    IF FOUND AND v_reg.hora_entrada IS NOT NULL THEN
      RAISE EXCEPTION 'Ya marcaste tu entrada hoy a las %', to_char(v_reg.hora_entrada, 'HH24:MI')
        USING ERRCODE = '23505';
    END IF;

    IF FOUND THEN
      UPDATE public.presencia_personal pp
         SET hora_entrada       = v_hora,
             estado             = v_estado,
             origen             = 'autoservicio',
             bloque_id          = COALESCE(pp.bloque_id, v_bloque_id),
             cargo              = COALESCE(pp.cargo, v_cargo),
             foto_entrada       = v_foto,
             gps_entrada        = v_gps,
             entrada_marcada_en = now(),
             observaciones      = NULLIF(
               btrim(concat_ws(' · ', NULLIF(btrim(COALESCE(pp.observaciones, '')), ''), v_obs)), '')
       WHERE pp.id = v_reg.id;
    ELSE
      INSERT INTO public.presencia_personal (
        company_id, project_id, personal_id, bloque_id, nombre, cargo, fecha,
        hora_entrada, estado, observaciones, origen, foto_entrada, gps_entrada,
        entrada_marcada_en
      ) VALUES (
        v_company, p_project_id, v_ficha, v_bloque_id, v_nombre, v_cargo, v_fecha,
        v_hora, v_estado, v_obs, 'autoservicio', v_foto, v_gps,
        now()
      )
      RETURNING id INTO v_reg.id;
    END IF;

    RETURN QUERY SELECT v_reg.id, v_fecha, v_hora, v_estado, 'entrada'::text;
    RETURN;
  END IF;

  -- ══ SALIDA ═══════════════════════════════════════════════════════════════
  SELECT * INTO v_reg
  FROM public.presencia_personal pp
  WHERE pp.project_id   = p_project_id
    AND pp.personal_id  = v_ficha
    AND pp.hora_entrada IS NOT NULL
    AND pp.hora_salida  IS NULL
    AND pp.fecha       >= v_fecha - 1
  ORDER BY pp.fecha DESC, pp.hora_entrada DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay una entrada abierta que cerrar. Marcá primero tu entrada.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.presencia_personal pp
     SET hora_salida       = v_hora,
         foto_salida       = v_foto,
         gps_salida        = v_gps,
         salida_marcada_en = now(),
         observaciones     = NULLIF(
           btrim(concat_ws(' · ', NULLIF(btrim(COALESCE(pp.observaciones, '')), ''), v_obs)), '')
   WHERE pp.id = v_reg.id;

  RETURN QUERY SELECT v_reg.id, v_reg.fecha, v_hora, v_reg.estado, 'salida'::text;
END;
$$;

COMMENT ON FUNCTION public.presencia_marcar(uuid, text, text, jsonb, text) IS
  'Marcaje de asistencia por el propio empleado. La HORA y la FECHA las pone el servidor en la zona del tenant (nunca el cliente); el expediente sale de personal_condominio.user_id; el turno y la tardanza, del bloque planificado. La foto debe estar ya subida a presencia-evidencias bajo <project>/<ficha propia>/. Entrada: completa la fila del día o la crea, y rechaza el doble marcaje. Salida: cierra la última entrada abierta de las últimas 48 h (turno nocturno). No exige el permiso del tab Presencia: exige SER el empleado.';

-- CREATE FUNCTION concede EXECUTE a PUBLIC por defecto y `anon` lo hereda
-- (clase cerrada en 20260825010000): se revoca aquí mismo y se otorga solo a
-- `authenticated`, que es quien marca.
REVOKE EXECUTE ON FUNCTION public.presencia_marcar(uuid, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.presencia_marcar(uuid, text, text, jsonb, text) TO authenticated;
