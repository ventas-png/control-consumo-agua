-- ════════════════════════════════════════════════════════════════════════════
-- STR · CARGA MASIVA DE RESERVAS DESDE UNA PLANTILLA PROPIA (CSV / XLSX)
--
-- QUÉ YA EXISTÍA (se reutiliza el patrón, no se duplica el motor)
--   · La carga masiva de renglones de compras (`compras_lineas_importar_*`,
--     20261022000100): lote + filas, evaluación por fila, vista previa, aplicar
--     todo o nada, idempotencia por huella del contenido, candado por GUC.
--   · El lector de archivos del navegador (`src/domain/proveedores/importacion.ts`).
--   · Las RLS de `reservas_str` (20260519000003: exigen `condominios.tab.str`) y
--     el sello `creado_por` (20260731000000).
--
-- QUÉ FALTABA
--   Cargar de un archivo las reservas de corto plazo de un proyecto (en curso,
--   cargadas o futuras) sin teclearlas una a una, con validación y vista previa.
--
-- FLUJO
--   1. `str_reservas_importar_previsualizar(proyecto, filas, archivo)` → crea el LOTE
--      y una fila de resultado por fila del archivo (datos normalizados, errores por
--      campo, advertencias). NO escribe reservas.
--   2. `str_reservas_importar_aplicar(lote)` → TODO O NADA: si una sola fila tiene
--      error no se escribe ninguna; si todas pasan se insertan en UNA transacción.
--      Se RE-EVALÚA cada fila contra el estado actual antes de escribir. Reaplicar un
--      lote aplicado devuelve su resultado sin escribir nada. Cargar OTRA VEZ el mismo
--      contenido en el mismo proyecto se rechaza mientras sus reservas sigan ahí.
--   3. `str_reservas_importar_descartar(lote)`.
--
-- REGLAS QUE ESTE MÓDULO HACE CUMPLIR
--   · La unidad se resuelve por NOMBRE exacto (sin mayúsculas ni espacios) entre
--     las unidades activas del proyecto; 0 → error, >1 → ambigua. Nunca se crea.
--   · Fechas AAAA-MM-DD con salida > entrada; horas HH:MM; adultos ≥ 1; plataforma
--     y política del catálogo (por omisión directo / na); montos con punto decimal;
--     `monto_total` vacío = noches × `monto_noche`; mascotas si/no; correo básico.
--   · `codigo_confirmacion` repetido en una reserva NO cancelada del proyecto, o
--     repetido dentro del archivo → ERROR (la fila bloquea el lote).
--   · Solape con otra reserva no cancelada de la misma unidad → ADVERTENCIA.
--   · Texto plano: un valor que empiece por `=`, `+`, `-` o `@` se rechaza.
--   · Columnas desconocidas (estado, id, company_id…) se rechazan: el archivo no
--     decide eso. Toda reserva importada nace `confirmada`.
--   · Máximo 500 filas por carga.
--   · Quien llama necesita lo mismo que para crear una reserva en pantalla
--     (`canActInCondominiosTab(…, 'str', 'create')`) y las funciones son SECURITY
--     INVOKER: las RLS y el sello `creado_por` de `reservas_str` rigen igual que con
--     un INSERT directo. No se amplía ningún permiso.
--   · El lote y sus filas solo los escriben estas RPC (candado por GUC de sesión).
--
-- CÓMO REVERTIR: scripts/reversion-str-importacion.sql
-- IMPACTO EN DATOS PRODUCTIVOS: ninguno; las tablas nacen vacías.
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY/
-- TRIGGER IF EXISTS.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.str_importaciones (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id        uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  archivo_nombre    text,
  contenido_sha256  text        NOT NULL,
  estado            text        NOT NULL DEFAULT 'previsualizado'
                    CHECK (estado IN ('previsualizado', 'aplicado', 'descartado')),
  resumen           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  resultado         jsonb,
  created_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  aplicado_por      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  aplicado_at       timestamptz
);
CREATE INDEX IF NOT EXISTS idx_str_imp_proyecto
  ON public.str_importaciones (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.str_importacion_filas (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id       uuid        NOT NULL REFERENCES public.str_importaciones(id) ON DELETE CASCADE,
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fila          int         NOT NULL,
  origen        jsonb       NOT NULL,
  datos         jsonb,
  errores       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  advertencias  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT uq_str_imp_fila UNIQUE (lote_id, fila)
);

COMMENT ON TABLE public.str_importaciones IS
  'Lote de carga masiva de reservas STR de un proyecto: quién, cuándo, qué archivo y cómo terminó. Lo escriben solo las RPC str_reservas_importar_*.';
COMMENT ON TABLE public.str_importacion_filas IS
  'Resultado por fila de un lote de reservas STR: datos normalizados, errores por campo y advertencias.';

ALTER TABLE public.str_importaciones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.str_importacion_filas  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.str_importaciones, public.str_importacion_filas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.str_importaciones, public.str_importacion_filas TO authenticated;

-- Misma puerta que «+ Nueva Reserva» en pantalla (canActInCondominiosTab(…, 'str', 'create'),
-- src/lib/permissions.ts): dueño/admin/super_admin siempre; el resto necesita ver la pestaña
-- Y (crear en la pestaña O el par legado platform.condominios.view + .create).
-- COALESCE: una sesión sin perfil no pasa por NULL (regla de 20261029000000).
CREATE OR REPLACE FUNCTION public.str_import_puede_crear()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    public.is_super_admin() OR (
      public.get_my_company_id() IS NOT NULL
      AND (
        public.current_user_role() IN ('company_owner', 'admin')
        OR (public.user_has_permission('condominios.tab.str')
            AND (public.user_has_permission('condominios.tab.str.create')
                 OR (public.user_has_permission('platform.condominios.view')
                     AND public.user_has_permission('platform.condominios.create'))))
      )
    ), false);
$$;
REVOKE EXECUTE ON FUNCTION public.str_import_puede_crear() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.str_import_puede_crear() TO authenticated;

DROP POLICY IF EXISTS str_imp_select ON public.str_importaciones;
CREATE POLICY str_imp_select ON public.str_importaciones FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin()) OR (company_id = (SELECT public.get_my_company_id())
         AND public.can_access_project(project_id)));
DROP POLICY IF EXISTS str_imp_insert ON public.str_importaciones;
CREATE POLICY str_imp_insert ON public.str_importaciones FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.str_import_puede_crear())
              AND public.can_access_project(project_id));
DROP POLICY IF EXISTS str_imp_update ON public.str_importaciones;
CREATE POLICY str_imp_update ON public.str_importaciones FOR UPDATE TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.str_import_puede_crear())
         AND public.can_access_project(project_id))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()));

DROP POLICY IF EXISTS str_impf_select ON public.str_importacion_filas;
CREATE POLICY str_impf_select ON public.str_importacion_filas FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.str_importaciones l WHERE l.id = lote_id));
DROP POLICY IF EXISTS str_impf_insert ON public.str_importacion_filas;
CREATE POLICY str_impf_insert ON public.str_importacion_filas FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.str_import_puede_crear())
              AND EXISTS (SELECT 1 FROM public.str_importaciones l WHERE l.id = lote_id));

DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'mfa_requirement_met') THEN
    FOREACH t IN ARRAY ARRAY['str_importaciones', 'str_importacion_filas'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS mfa_gate_aal2 ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY mfa_gate_aal2 ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        || 'USING (public.mfa_requirement_met()) WITH CHECK (public.mfa_requirement_met())', t);
    END LOOP;
  END IF;
END $$;

-- El lote y sus filas SOLO se escriben desde las RPC (candado por GUC de sesión, como
-- `compras.import_rpc`): un INSERT/UPDATE directo no los fabrica ni los marca «aplicado».
CREATE OR REPLACE FUNCTION public.str_tg_imp_solo_rpc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(current_setting('str.import_rpc', true), 'off') <> 'on'
     AND COALESCE(current_setting('conta.allow_system_write', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'STR_IMPORT_SOLO_RPC: los lotes de carga masiva los escriben solo las funciones str_reservas_importar_*.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.str_tg_imp_solo_rpc() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_str_imp_solo_rpc ON public.str_importaciones;
CREATE TRIGGER trg_str_imp_solo_rpc BEFORE INSERT OR UPDATE ON public.str_importaciones
  FOR EACH ROW EXECUTE FUNCTION public.str_tg_imp_solo_rpc();
DROP TRIGGER IF EXISTS trg_str_impf_solo_rpc ON public.str_importacion_filas;
CREATE TRIGGER trg_str_impf_solo_rpc BEFORE INSERT OR UPDATE ON public.str_importacion_filas
  FOR EACH ROW EXECUTE FUNCTION public.str_tg_imp_solo_rpc();

-- ── Evaluación de UNA fila (la misma en la vista previa y al aplicar) ───────
-- SECURITY INVOKER: las unidades y las reservas con las que se compara son las
-- que la RLS deja ver a quien importa (las de su empresa/proyecto).
CREATE OR REPLACE FUNCTION public.str_import_evaluar(p_company uuid, p_project uuid, p_fila jsonb, p_n int)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_ok_cols  constant text[] := ARRAY['unidad', 'huesped_nombre', 'huesped_email', 'huesped_telefono',
                                      'fecha_entrada', 'fecha_salida', 'hora_llegada_estimada', 'hora_salida_estimada',
                                      'num_adultos', 'num_ninos', 'num_bebes', 'plataforma', 'codigo_confirmacion',
                                      'fecha_reservacion', 'monto_noche', 'monto_total', 'politica_cancelacion',
                                      'mascotas', 'notas'];
  v_plats    constant text[] := ARRAY['airbnb', 'booking', 'vrbo', 'directo', 'otro'];
  v_pols     constant text[] := ARRAY['flexible', 'moderada', 'estricta', 'no_reembolsable', 'na', 'otra'];
  v_err      jsonb := '[]'::jsonb;
  v_adv      jsonb := '[]'::jsonb;
  k          text;
  v_unidad   text;
  v_nombre   text;
  v_email    text;
  v_tel      text;
  v_fe_t     text;  v_fe date;
  v_fs_t     text;  v_fs date;
  v_fr_t     text;  v_fr date;
  v_hl_t     text;  v_hl time;
  v_hs_t     text;  v_hs time;
  v_ad_t     text;  v_ad int;
  v_ni_t     text;  v_ni int := 0;
  v_be_t     text;  v_be int := 0;
  v_plat     text;
  v_cod      text;
  v_mn_t     text;  v_mn numeric;
  v_mt_t     text;  v_mt numeric;
  v_pol      text;
  v_masc_t   text;  v_masc boolean := false;
  v_notas    text;
  v_n_uni    int;
  v_uni_id   uuid;
  v_noches   int;
BEGIN
  IF jsonb_typeof(p_fila) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('datos', NULL,
      'errores', jsonb_build_array(jsonb_build_object('campo', 'fila', 'mensaje', 'La fila no es un registro de columnas.')),
      'advertencias', '[]'::jsonb);
  END IF;

  FOR k IN SELECT jsonb_object_keys(p_fila) LOOP
    IF NOT (k = ANY (v_ok_cols)) THEN
      v_err := v_err || jsonb_build_object('campo', k,
        'mensaje', format('La columna «%s» no se admite: este archivo solo trae reservas (no decide estado, empresa ni identificadores).', k));
    END IF;
  END LOOP;

  -- Texto plano: nada que parezca fórmula. El teléfono puede empezar por «+» (prefijo
  -- internacional); ahí solo se rechazan «=» y «@».
  FOR k IN SELECT unnest(v_ok_cols) LOOP
    IF COALESCE(p_fila->>k, '') ~ (CASE WHEN k = 'huesped_telefono' THEN '^\s*[=@]' ELSE '^\s*[=+@-]' END) THEN
      v_err := v_err || jsonb_build_object('campo', k, 'mensaje', 'Un valor que empieza con =, +, - o @ se rechaza (posible fórmula): pega valores de texto.');
    END IF;
  END LOOP;

  v_unidad := NULLIF(btrim(COALESCE(p_fila->>'unidad', '')), '');
  v_nombre := NULLIF(btrim(COALESCE(p_fila->>'huesped_nombre', '')), '');
  v_email  := NULLIF(btrim(COALESCE(p_fila->>'huesped_email', '')), '');
  v_tel    := NULLIF(btrim(COALESCE(p_fila->>'huesped_telefono', '')), '');
  v_fe_t   := btrim(COALESCE(p_fila->>'fecha_entrada', ''));
  v_fs_t   := btrim(COALESCE(p_fila->>'fecha_salida', ''));
  v_fr_t   := btrim(COALESCE(p_fila->>'fecha_reservacion', ''));
  v_hl_t   := btrim(COALESCE(p_fila->>'hora_llegada_estimada', ''));
  v_hs_t   := btrim(COALESCE(p_fila->>'hora_salida_estimada', ''));
  v_ad_t   := COALESCE(NULLIF(btrim(COALESCE(p_fila->>'num_adultos', '')), ''), '1');
  v_ni_t   := COALESCE(NULLIF(btrim(COALESCE(p_fila->>'num_ninos', '')), ''), '0');
  v_be_t   := COALESCE(NULLIF(btrim(COALESCE(p_fila->>'num_bebes', '')), ''), '0');
  v_plat   := lower(COALESCE(NULLIF(btrim(COALESCE(p_fila->>'plataforma', '')), ''), 'directo'));
  v_cod    := NULLIF(btrim(COALESCE(p_fila->>'codigo_confirmacion', '')), '');
  v_mn_t   := replace(btrim(COALESCE(p_fila->>'monto_noche', '')), ',', '.');
  v_mt_t   := replace(btrim(COALESCE(p_fila->>'monto_total', '')), ',', '.');
  v_pol    := lower(COALESCE(NULLIF(btrim(COALESCE(p_fila->>'politica_cancelacion', '')), ''), 'na'));
  v_masc_t := lower(btrim(COALESCE(p_fila->>'mascotas', '')));
  v_notas  := NULLIF(btrim(COALESCE(p_fila->>'notas', '')), '');

  -- Unidad: por nombre, entre las activas del proyecto; nunca se crea.
  IF v_unidad IS NULL THEN
    v_err := v_err || jsonb_build_object('campo', 'unidad', 'mensaje', 'La unidad es obligatoria (nombre exacto como aparece en Unidades).');
  ELSE
    SELECT count(*) INTO v_n_uni FROM public.unidades u
     WHERE u.company_id = p_company AND u.project_id = p_project AND u.activo
       AND lower(btrim(u.nombre)) = lower(v_unidad);
    IF v_n_uni = 0 THEN
      v_err := v_err || jsonb_build_object('campo', 'unidad', 'mensaje', format('La unidad «%s» no existe (o está inactiva) en este proyecto. La importación no crea unidades.', v_unidad));
    ELSIF v_n_uni > 1 THEN
      v_err := v_err || jsonb_build_object('campo', 'unidad', 'mensaje', format('Hay %s unidades llamadas «%s» en el proyecto: el nombre es ambiguo. Renombra una en Unidades.', v_n_uni, v_unidad));
    ELSE
      SELECT u.id INTO v_uni_id FROM public.unidades u
       WHERE u.company_id = p_company AND u.project_id = p_project AND u.activo
         AND lower(btrim(u.nombre)) = lower(v_unidad);
    END IF;
  END IF;

  IF v_nombre IS NULL OR length(v_nombre) < 2 THEN
    v_err := v_err || jsonb_build_object('campo', 'huesped_nombre', 'mensaje', 'El nombre del huésped es obligatorio (2–150 caracteres).');
  ELSIF length(v_nombre) > 150 THEN
    v_err := v_err || jsonb_build_object('campo', 'huesped_nombre', 'mensaje', 'El nombre del huésped excede 150 caracteres.');
  END IF;
  IF v_email IS NOT NULL AND v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    v_err := v_err || jsonb_build_object('campo', 'huesped_email', 'mensaje', 'El correo del huésped no es válido.');
  END IF;
  IF v_tel IS NOT NULL AND length(v_tel) > 30 THEN
    v_err := v_err || jsonb_build_object('campo', 'huesped_telefono', 'mensaje', 'El teléfono excede 30 caracteres.');
  END IF;

  -- Fechas AAAA-MM-DD reales.
  IF v_fe_t !~ '^\d{4}-\d{2}-\d{2}$' THEN
    v_err := v_err || jsonb_build_object('campo', 'fecha_entrada', 'mensaje', 'La fecha de entrada es obligatoria, en formato AAAA-MM-DD.');
  ELSE
    BEGIN v_fe := v_fe_t::date; EXCEPTION WHEN OTHERS THEN
      v_err := v_err || jsonb_build_object('campo', 'fecha_entrada', 'mensaje', format('La fecha de entrada «%s» no existe.', v_fe_t));
    END;
  END IF;
  IF v_fs_t !~ '^\d{4}-\d{2}-\d{2}$' THEN
    v_err := v_err || jsonb_build_object('campo', 'fecha_salida', 'mensaje', 'La fecha de salida es obligatoria, en formato AAAA-MM-DD.');
  ELSE
    BEGIN v_fs := v_fs_t::date; EXCEPTION WHEN OTHERS THEN
      v_err := v_err || jsonb_build_object('campo', 'fecha_salida', 'mensaje', format('La fecha de salida «%s» no existe.', v_fs_t));
    END;
  END IF;
  IF v_fe IS NOT NULL AND v_fs IS NOT NULL AND v_fs <= v_fe THEN
    v_err := v_err || jsonb_build_object('campo', 'fecha_salida', 'mensaje', 'La salida debe ser posterior a la entrada (al menos una noche).');
  END IF;
  IF v_fr_t <> '' THEN
    IF v_fr_t !~ '^\d{4}-\d{2}-\d{2}$' THEN
      v_err := v_err || jsonb_build_object('campo', 'fecha_reservacion', 'mensaje', 'La fecha de reservación va en formato AAAA-MM-DD (o vacía).');
    ELSE
      BEGIN v_fr := v_fr_t::date; EXCEPTION WHEN OTHERS THEN
        v_err := v_err || jsonb_build_object('campo', 'fecha_reservacion', 'mensaje', format('La fecha de reservación «%s» no existe.', v_fr_t));
      END;
    END IF;
  END IF;

  -- Horas HH:MM (o HH:MM:SS).
  IF v_hl_t <> '' THEN
    IF v_hl_t !~ '^\d{1,2}:\d{2}(:\d{2})?$' THEN
      v_err := v_err || jsonb_build_object('campo', 'hora_llegada_estimada', 'mensaje', 'La hora de llegada va en formato HH:MM (o vacía).');
    ELSE
      BEGIN v_hl := v_hl_t::time; EXCEPTION WHEN OTHERS THEN
        v_err := v_err || jsonb_build_object('campo', 'hora_llegada_estimada', 'mensaje', format('La hora de llegada «%s» no existe.', v_hl_t));
      END;
    END IF;
  END IF;
  IF v_hs_t <> '' THEN
    IF v_hs_t !~ '^\d{1,2}:\d{2}(:\d{2})?$' THEN
      v_err := v_err || jsonb_build_object('campo', 'hora_salida_estimada', 'mensaje', 'La hora de salida va en formato HH:MM (o vacía).');
    ELSE
      BEGIN v_hs := v_hs_t::time; EXCEPTION WHEN OTHERS THEN
        v_err := v_err || jsonb_build_object('campo', 'hora_salida_estimada', 'mensaje', format('La hora de salida «%s» no existe.', v_hs_t));
      END;
    END IF;
  END IF;

  -- Personas.
  IF v_ad_t !~ '^[0-9]{1,3}$' OR v_ad_t::int < 1 THEN
    v_err := v_err || jsonb_build_object('campo', 'num_adultos', 'mensaje', 'Los adultos deben ser un entero mayor o igual a 1 (vacío = 1).');
  ELSE
    v_ad := v_ad_t::int;
  END IF;
  IF v_ni_t !~ '^[0-9]{1,3}$' THEN
    v_err := v_err || jsonb_build_object('campo', 'num_ninos', 'mensaje', 'Los niños deben ser un entero mayor o igual a 0 (vacío = 0).');
  ELSE
    v_ni := v_ni_t::int;
  END IF;
  IF v_be_t !~ '^[0-9]{1,3}$' THEN
    v_err := v_err || jsonb_build_object('campo', 'num_bebes', 'mensaje', 'Los bebés deben ser un entero mayor o igual a 0 (vacío = 0).');
  ELSE
    v_be := v_be_t::int;
  END IF;

  -- Catálogos.
  IF NOT (v_plat = ANY (v_plats)) THEN
    v_err := v_err || jsonb_build_object('campo', 'plataforma', 'mensaje', format('Plataforma inválida «%s»: usa %s (vacío = directo).', v_plat, array_to_string(v_plats, ', ')));
  END IF;
  v_pol := replace(v_pol, ' ', '_');
  IF NOT (v_pol = ANY (v_pols)) THEN
    v_err := v_err || jsonb_build_object('campo', 'politica_cancelacion', 'mensaje', format('Política inválida «%s»: usa %s (vacío = na).', v_pol, array_to_string(v_pols, ', ')));
  END IF;
  IF v_masc_t IN ('', 'no', 'false', '0', 'n') THEN
    v_masc := false;
  ELSIF v_masc_t IN ('si', 'sí', 'true', '1', 's', 'yes') THEN
    v_masc := true;
  ELSE
    v_err := v_err || jsonb_build_object('campo', 'mascotas', 'mensaje', 'Mascotas: si o no (vacío = no).');
  END IF;

  -- Montos con punto decimal; el total vacío se calcula.
  IF v_mn_t <> '' THEN
    IF v_mn_t !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' THEN
      v_err := v_err || jsonb_build_object('campo', 'monto_noche', 'mensaje', 'El monto por noche debe ser un número mayor o igual a 0 con punto decimal (hasta 2 decimales).');
    ELSE
      v_mn := v_mn_t::numeric;
    END IF;
  END IF;
  IF v_mt_t <> '' THEN
    IF v_mt_t !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' THEN
      v_err := v_err || jsonb_build_object('campo', 'monto_total', 'mensaje', 'El monto total debe ser un número mayor o igual a 0 con punto decimal (hasta 2 decimales).');
    ELSE
      v_mt := v_mt_t::numeric;
    END IF;
  END IF;
  IF v_fe IS NOT NULL AND v_fs IS NOT NULL AND v_fs > v_fe THEN
    v_noches := v_fs - v_fe;
    IF v_mt IS NULL AND v_mn IS NOT NULL THEN
      v_mt := round(v_mn * v_noches, 2);
    END IF;
  END IF;

  IF v_cod IS NOT NULL AND length(v_cod) > 60 THEN
    v_err := v_err || jsonb_build_object('campo', 'codigo_confirmacion', 'mensaje', 'El código de confirmación excede 60 caracteres.');
  END IF;
  IF v_notas IS NOT NULL AND length(v_notas) > 1000 THEN
    v_err := v_err || jsonb_build_object('campo', 'notas', 'mensaje', 'Las notas exceden 1000 caracteres.');
  END IF;

  -- Código de confirmación repetido en una reserva NO cancelada del proyecto → ERROR.
  IF v_cod IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.reservas_str r
     WHERE r.company_id = p_company AND r.project_id = p_project AND r.estado <> 'cancelada'
       AND lower(btrim(COALESCE(r.codigo_confirmacion, ''))) = lower(v_cod)) THEN
    v_err := v_err || jsonb_build_object('campo', 'codigo_confirmacion', 'mensaje', format('Ya hay una reserva con el código «%s» en este proyecto (no cancelada). La fila no se importa.', v_cod));
  END IF;

  -- Solape con otra reserva no cancelada de la misma unidad → ADVERTENCIA.
  IF v_uni_id IS NOT NULL AND v_fe IS NOT NULL AND v_fs IS NOT NULL AND v_fs > v_fe AND EXISTS (
    SELECT 1 FROM public.reservas_str r
     WHERE r.unidad_id = v_uni_id AND r.estado <> 'cancelada'
       AND r.fecha_entrada < v_fs AND r.fecha_salida > v_fe) THEN
    v_adv := v_adv || jsonb_build_object('campo', 'fecha_entrada', 'mensaje', 'Se solapa con otra reserva no cancelada de la misma unidad.');
  END IF;

  IF jsonb_array_length(v_err) > 0 THEN
    RETURN jsonb_build_object('datos', NULL, 'errores', v_err, 'advertencias', v_adv);
  END IF;

  RETURN jsonb_build_object(
    'datos', jsonb_build_object(
      'unidad_id', v_uni_id, 'unidad', v_unidad, 'huesped_nombre', v_nombre, 'huesped_email', v_email,
      'huesped_telefono', v_tel, 'fecha_entrada', v_fe, 'fecha_salida', v_fs, 'noches', v_noches,
      'hora_llegada_estimada', v_hl, 'hora_salida_estimada', v_hs,
      'num_adultos', v_ad, 'num_ninos', v_ni, 'num_bebes', v_be, 'plataforma', v_plat,
      'codigo_confirmacion', v_cod, 'fecha_reservacion', v_fr, 'monto_noche', v_mn, 'monto_total', v_mt,
      'politica_cancelacion', v_pol, 'mascotas', v_masc, 'notas', v_notas, 'estado', 'confirmada'),
    'errores', v_err, 'advertencias', v_adv);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.str_import_evaluar(uuid, uuid, jsonb, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.str_import_evaluar(uuid, uuid, jsonb, int) TO authenticated;

-- ── Vista previa ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.str_reservas_importar_previsualizar(
  p_project_id uuid, p_filas jsonb, p_archivo text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_company   uuid;
  v_lote      public.str_importaciones%ROWTYPE;
  v_n         int;
  v_i         int := 0;
  r           jsonb;
  v_ev        jsonb;
  v_err       jsonb;
  v_adv       jsonb;
  v_codigos   text[] := ARRAY[]::text[];
  v_claves    text[] := ARRAY[]::text[];
  v_cod       text;
  v_clave     text;
  v_hash      text;
  v_validas   int := 0;
  v_conerr    int := 0;
  v_resultado jsonb := '[]'::jsonb;
  v_ya        boolean := false;
BEGIN
  IF NOT public.str_import_puede_crear() THEN
    RAISE EXCEPTION 'STR_IMPORT_PERMISO: no tienes permiso para crear reservas en este módulo.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL OR v_company IS DISTINCT FROM public.get_my_company_id()
     OR NOT COALESCE(public.can_access_project(p_project_id), false) THEN
    RAISE EXCEPTION 'STR_IMPORT_PROYECTO: el proyecto no existe en tu empresa o no tienes acceso a él.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_filas IS NULL OR jsonb_typeof(p_filas) <> 'array' OR jsonb_array_length(p_filas) = 0 THEN
    RAISE EXCEPTION 'STR_IMPORT_VACIA: el archivo no trae filas.' USING ERRCODE = 'check_violation';
  END IF;
  v_n := jsonb_array_length(p_filas);
  IF v_n > 500 THEN
    RAISE EXCEPTION 'STR_IMPORT_LIMITE: % filas; el máximo es 500 por carga. Divide el archivo.', v_n USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('str.import_rpc', 'on', true);

  -- La huella del contenido la calcula el SERVIDOR sobre las filas tal cual llegaron.
  v_hash := encode(sha256(convert_to(p_filas::text, 'UTF8')), 'hex');
  SELECT EXISTS (
    SELECT 1 FROM public.str_importaciones l
     WHERE l.project_id = p_project_id AND l.contenido_sha256 = v_hash AND l.estado = 'aplicado'
       AND EXISTS (SELECT 1 FROM public.reservas_str rs
                    WHERE rs.id::text IN (SELECT jsonb_array_elements_text(l.resultado->'reserva_ids')))
  ) INTO v_ya;

  INSERT INTO public.str_importaciones (company_id, project_id, archivo_nombre, contenido_sha256, created_by)
  VALUES (v_company, p_project_id, left(p_archivo, 200), v_hash, auth.uid())
  RETURNING * INTO v_lote;

  FOR r IN SELECT value FROM jsonb_array_elements(p_filas) LOOP
    v_i := v_i + 1;
    v_ev := public.str_import_evaluar(v_company, p_project_id, r, v_i);
    v_err := v_ev->'errores';
    v_adv := v_ev->'advertencias';
    -- Código repetido DENTRO del archivo → error en la fila posterior.
    v_cod := lower(NULLIF(btrim(COALESCE(r->>'codigo_confirmacion', '')), ''));
    IF v_cod IS NOT NULL THEN
      IF v_cod = ANY (v_codigos) THEN
        v_err := v_err || jsonb_build_object('campo', 'codigo_confirmacion', 'mensaje', 'Este código de confirmación se repite en otra fila del archivo. La fila no se importa.');
      END IF;
      v_codigos := v_codigos || v_cod;
    END IF;
    IF jsonb_array_length(v_err) = 0 THEN
      v_clave := lower(concat_ws('|', v_ev->'datos'->>'unidad_id', v_ev->'datos'->>'fecha_entrada',
                                 v_ev->'datos'->>'fecha_salida', v_ev->'datos'->>'huesped_nombre'));
      IF v_clave = ANY (v_claves) THEN
        v_adv := v_adv || jsonb_build_object('campo', 'fila', 'mensaje', 'Esta fila repite otra del mismo archivo (misma unidad, fechas y huésped).');
      END IF;
      v_claves := v_claves || v_clave;
      v_validas := v_validas + 1;
    ELSE
      v_conerr := v_conerr + 1;
    END IF;
    INSERT INTO public.str_importacion_filas (lote_id, company_id, fila, origen, datos, errores, advertencias)
    VALUES (v_lote.id, v_company, v_i, r, CASE WHEN jsonb_array_length(v_err) = 0 THEN v_ev->'datos' END, v_err, v_adv);
    v_resultado := v_resultado || jsonb_build_object('fila', v_i, 'origen', r,
                                                     'datos', CASE WHEN jsonb_array_length(v_err) = 0 THEN v_ev->'datos' ELSE 'null'::jsonb END,
                                                     'errores', v_err, 'advertencias', v_adv);
  END LOOP;

  UPDATE public.str_importaciones
     SET resumen = jsonb_build_object('total', v_n, 'validas', v_validas, 'con_error', v_conerr, 'duplicado_de_lote_aplicado', v_ya)
   WHERE id = v_lote.id;

  RETURN jsonb_build_object('lote_id', v_lote.id, 'project_id', p_project_id,
    'resumen', jsonb_build_object('total', v_n, 'validas', v_validas, 'con_error', v_conerr, 'duplicado_de_lote_aplicado', v_ya),
    'filas', v_resultado);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.str_reservas_importar_previsualizar(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.str_reservas_importar_previsualizar(uuid, jsonb, text) TO authenticated;

-- ── Aplicar: todo o nada, idempotente ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.str_reservas_importar_aplicar(p_lote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_lote   public.str_importaciones%ROWTYPE;
  f        record;
  v_ev     jsonb;
  d        jsonb;
  v_ids    uuid[] := ARRAY[]::uuid[];
  v_id     uuid;
  v_k      int := 0;
  v_errs   int := 0;
  v_dup    int := 0;
  v_res    jsonb;
BEGIN
  IF NOT public.str_import_puede_crear() THEN
    RAISE EXCEPTION 'STR_IMPORT_PERMISO: no tienes permiso para crear reservas en este módulo.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_lote FROM public.str_importaciones WHERE id = p_lote_id;
  IF NOT FOUND OR v_lote.company_id IS DISTINCT FROM public.get_my_company_id() THEN
    RAISE EXCEPTION 'STR_IMPORT_LOTE: el lote no existe.' USING ERRCODE = 'check_violation';
  END IF;

  -- Todo lo que importe a este proyecto se serializa: dos aplicaciones simultáneas del
  -- mismo lote (o del mismo contenido) se ejecutan de una en una.
  PERFORM pg_advisory_xact_lock(hashtextextended('str_reservas_import:' || v_lote.project_id::text, 0));
  SELECT * INTO v_lote FROM public.str_importaciones WHERE id = p_lote_id;

  IF v_lote.estado = 'aplicado' THEN
    RETURN COALESCE(v_lote.resultado, '{}'::jsonb) || jsonb_build_object('reutilizada', true);
  END IF;
  IF v_lote.estado <> 'previsualizado' THEN
    RAISE EXCEPTION 'STR_IMPORT_LOTE: el lote está "%" y ya no se puede aplicar.', v_lote.estado USING ERRCODE = 'check_violation';
  END IF;
  IF NOT COALESCE(public.can_access_project(v_lote.project_id), false) THEN
    RAISE EXCEPTION 'STR_IMPORT_PROYECTO: el proyecto no existe en tu empresa o no tienes acceso a él.' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.str_importaciones l
     WHERE l.project_id = v_lote.project_id AND l.contenido_sha256 = v_lote.contenido_sha256
       AND l.estado = 'aplicado' AND l.id <> v_lote.id
       AND EXISTS (SELECT 1 FROM public.reservas_str rs
                    WHERE rs.id::text IN (SELECT jsonb_array_elements_text(l.resultado->'reserva_ids')))) THEN
    RAISE EXCEPTION 'STR_IMPORT_DUPLICADO: este mismo contenido ya se importó a este proyecto y sus reservas siguen ahí. No se importa dos veces.'
      USING ERRCODE = 'unique_violation';
  END IF;

  PERFORM set_config('str.import_rpc', 'on', true);

  -- Se RE-EVALÚA cada fila contra el estado de HOY: si la unidad cambió o alguien ya cargó
  -- ese código desde la vista previa, esa fila no se aplica a ciegas. Una con error frena todo.
  FOR f IN SELECT fila, origen FROM public.str_importacion_filas WHERE lote_id = p_lote_id ORDER BY fila LOOP
    v_ev := public.str_import_evaluar(v_lote.company_id, v_lote.project_id, f.origen, f.fila);
    IF jsonb_array_length(v_ev->'errores') > 0 THEN
      v_errs := v_errs + 1;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_dup FROM (
    SELECT lower(btrim(origen->>'codigo_confirmacion')) AS c FROM public.str_importacion_filas
     WHERE lote_id = p_lote_id AND NULLIF(btrim(COALESCE(origen->>'codigo_confirmacion', '')), '') IS NOT NULL
     GROUP BY 1 HAVING count(*) > 1) x;
  IF v_errs > 0 OR v_dup > 0 THEN
    RAISE EXCEPTION 'STR_IMPORT_CON_ERRORES: % fila(s) con error; la carga es todo o nada y no se escribió ninguna reserva. Corrige el archivo y vuelve a cargarlo.', v_errs + v_dup
      USING ERRCODE = 'check_violation';
  END IF;

  FOR f IN SELECT fila, origen FROM public.str_importacion_filas WHERE lote_id = p_lote_id ORDER BY fila LOOP
    d := (public.str_import_evaluar(v_lote.company_id, v_lote.project_id, f.origen, f.fila))->'datos';
    v_k := v_k + 1;
    INSERT INTO public.reservas_str
      (company_id, project_id, unidad_id, huesped_nombre, huesped_email, huesped_telefono,
       fecha_entrada, fecha_salida, hora_llegada_estimada, hora_salida_estimada,
       num_adultos, num_ninos, num_bebes, plataforma, codigo_confirmacion, fecha_reservacion,
       monto_noche, monto_total, politica_cancelacion, mascotas, notas, estado)
    VALUES
      (v_lote.company_id, v_lote.project_id, (d->>'unidad_id')::uuid, d->>'huesped_nombre', d->>'huesped_email', d->>'huesped_telefono',
       (d->>'fecha_entrada')::date, (d->>'fecha_salida')::date, (d->>'hora_llegada_estimada')::time, (d->>'hora_salida_estimada')::time,
       (d->>'num_adultos')::int, (d->>'num_ninos')::int, (d->>'num_bebes')::int, d->>'plataforma', d->>'codigo_confirmacion',
       (d->>'fecha_reservacion')::date, (d->>'monto_noche')::numeric, (d->>'monto_total')::numeric, d->>'politica_cancelacion',
       (d->>'mascotas')::boolean, d->>'notas', 'confirmada')
    RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
  END LOOP;

  v_res := jsonb_build_object('lote_id', v_lote.id, 'project_id', v_lote.project_id, 'reservas_creadas', v_k,
                              'reserva_ids', to_jsonb(v_ids), 'reutilizada', false);
  UPDATE public.str_importaciones
     SET estado = 'aplicado', resultado = v_res, aplicado_por = auth.uid(), aplicado_at = now()
   WHERE id = v_lote.id;
  RETURN v_res;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.str_reservas_importar_aplicar(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.str_reservas_importar_aplicar(uuid) TO authenticated;

-- ── Descartar ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.str_reservas_importar_descartar(p_lote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_estado text;
BEGIN
  IF NOT public.str_import_puede_crear() THEN
    RAISE EXCEPTION 'STR_IMPORT_PERMISO: no tienes permiso para crear reservas en este módulo.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT estado INTO v_estado FROM public.str_importaciones
   WHERE id = p_lote_id AND company_id = public.get_my_company_id() FOR UPDATE;
  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'STR_IMPORT_LOTE: el lote no existe.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_estado = 'aplicado' THEN
    RAISE EXCEPTION 'STR_IMPORT_LOTE: un lote aplicado no se descarta; las reservas se cancelan o eliminan en la pestaña.' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('str.import_rpc', 'on', true);
  UPDATE public.str_importaciones SET estado = 'descartado' WHERE id = p_lote_id AND estado = 'previsualizado';
  RETURN jsonb_build_object('lote_id', p_lote_id, 'estado', 'descartado');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.str_reservas_importar_descartar(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.str_reservas_importar_descartar(uuid) TO authenticated;

COMMENT ON FUNCTION public.str_reservas_importar_previsualizar(uuid, jsonb, text) IS
  'Carga masiva de reservas STR: crea el lote y evalúa cada fila (unidad por nombre, fechas, horas, personas, catálogos, montos, código repetido = error, solape = aviso). No escribe reservas. Exige el mismo permiso que crear una reserva y acceso al proyecto.';
COMMENT ON FUNCTION public.str_reservas_importar_aplicar(uuid) IS
  'Aplica un lote previsualizado: re-evalúa cada fila, todo o nada, inserta reservas confirmadas bajo la RLS y el sello creado_por del llamador. Idempotente: un lote aplicado devuelve su resultado; el mismo contenido no se importa dos veces mientras sus reservas sigan.';
