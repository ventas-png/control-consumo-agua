-- ════════════════════════════════════════════════════════════════════════════
-- CATÁLOGO DE ACTIVIDADES · CARGA MASIVA (CSV / XLSX) Y RECURSOS EN BLOQUE
--
-- QUÉ YA EXISTÍA (se reutiliza el patrón, no se duplica el motor)
--   · El catálogo `plantillas_tarea_cargo` (20260424000060 + 20260904000200) con
--     sus CHECKs (servicio, duración, checklist obligatorio con contenido) y el
--     trigger `trg_plantillas_cargo_controlado` (cargo del catálogo).
--   · Las tablas puente `plantilla_tarea_suministros` y `plantilla_tarea_herramientas`
--     (20260904000300): UNIQUE por par, cantidad > 0, `obligatoria`, trigger DEFINER
--     `plantilla_recurso_coherente` (sella company/project desde la plantilla y
--     aborta ante un recurso de otro tenant) y el sello `creado_por`.
--   · La carga masiva de reservas STR (20261031000100): lote + filas, evaluación
--     por fila, vista previa, aplicar todo o nada, huella del contenido, candado por GUC.
--
-- QUÉ FALTABA
--   1. Cargar de un archivo muchas actividades a la vez, con sus insumos, herramientas
--      y equipo indicados POR NOMBRE.
--   2. Asignar o quitar recursos a varias actividades de una sola vez, de forma atómica.
--
-- FLUJO DE LA CARGA
--   1. `plantillas_importar_previsualizar(proyecto, filas, archivo)` → crea el LOTE y una
--      fila de resultado por fila del archivo (datos normalizados, errores por campo).
--      NO escribe actividades.
--   2. `plantillas_importar_aplicar(lote)` → TODO O NADA: re-evalúa cada fila contra el
--      estado actual; si una sola tiene error no se escribe nada; si todas pasan inserta
--      las actividades y sus puentes en UNA transacción. Reaplicar un lote aplicado
--      devuelve su resultado. El mismo contenido no se importa dos veces mientras sus
--      actividades sigan ahí.
--   3. `plantillas_importar_descartar(lote)`.
--
-- REGLAS QUE ESTE MÓDULO HACE CUMPLIR
--   · `titulo` (2–150), `cargo` y `servicio` obligatorios y del catálogo (se aceptan las
--     etiquetas de pantalla: «Conserje», «Jardinería»…). `duracion_min` entero > 0,
--     obligatoria si el servicio es limpieza (misma regla que la pantalla). `icono` del
--     catálogo o vacío (defecto por servicio). `area` por nombre entre las activas del
--     proyecto. `orden` entero ≥ 0. `requiere_*` si/no. `checklist` con pasos separados
--     por «|»; si `requiere_checklist` = si debe traer al menos un paso.
--   · `insumos`, `herramientas` y `equipo`: nombres separados por «;», cantidad opcional
--     «Nombre x 3» y, en herramientas/equipo, «!» al final = obligatoria. Se resuelven
--     por nombre exacto (sin mayúsculas ni espacios) entre los suministros ACTIVOS y el
--     inventario NO dado de baja del proyecto, por categoría (herramienta / equipo).
--     0 → error, >1 → ambiguo, repetido en la fila → error. NUNCA se crean recursos.
--   · Actividad con el mismo título (sin mayúsculas) y cargo en el proyecto, activa o
--     inactiva, o repetida dentro del archivo → ERROR: la carga solo crea.
--   · Texto plano: un valor que empiece por «=», «+» o «@» se rechaza («-» solo se admite
--     en descripción, instrucciones y checklist). Columnas desconocidas se rechazan.
--   · Máximo 500 filas por carga.
--   · Quien llama necesita lo mismo que «+ Nueva actividad» en pantalla
--     (`canActInCondominiosTab(…, 'plantillas_cargo', 'create')`) y, para resolver
--     insumos por nombre, ver la pestaña Suministros (su RLS); las funciones son
--     SECURITY INVOKER: rigen las RLS del catálogo y de las puentes y los triggers de
--     coherencia y sello. No se amplía ningún permiso.
--
-- RECURSOS EN BLOQUE
--   `plantillas_recursos_en_bloque(proyecto, plantillas[], 'agregar'|'quitar', insumos,
--   inventario)`: exige lo mismo que editar en pantalla (`…, 'edit'`); todas las
--   actividades y los recursos deben ser del proyecto; agregar no toca pares ya
--   existentes (ON CONFLICT DO NOTHING) y quitar solo borra los pares dados. Atómica.
--   Devuelve conteos: agregados / ya_estaban / quitados / no_estaban.
--
-- CÓMO REVERTIR: scripts/reversion-plantillas-importacion.sql
-- IMPACTO EN DATOS PRODUCTIVOS: ninguno; las tablas nacen vacías.
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY/
-- TRIGGER IF EXISTS.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.plantillas_importaciones (
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
CREATE INDEX IF NOT EXISTS idx_plantillas_imp_proyecto
  ON public.plantillas_importaciones (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.plantillas_importacion_filas (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id       uuid        NOT NULL REFERENCES public.plantillas_importaciones(id) ON DELETE CASCADE,
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fila          int         NOT NULL,
  origen        jsonb       NOT NULL,
  datos         jsonb,
  errores       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  advertencias  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT uq_plantillas_imp_fila UNIQUE (lote_id, fila)
);

COMMENT ON TABLE public.plantillas_importaciones IS
  'Lote de carga masiva de actividades del catálogo de un proyecto: quién, cuándo, qué archivo y cómo terminó. Lo escriben solo las RPC plantillas_importar_*.';
COMMENT ON TABLE public.plantillas_importacion_filas IS
  'Resultado por fila de un lote de actividades: datos normalizados (con los recursos resueltos por nombre), errores por campo y advertencias.';

ALTER TABLE public.plantillas_importaciones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plantillas_importacion_filas  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.plantillas_importaciones, public.plantillas_importacion_filas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.plantillas_importaciones, public.plantillas_importacion_filas TO authenticated;

-- Misma puerta que «+ Nueva actividad» / «Editar» en pantalla (canActInCondominiosTab(…,
-- 'plantillas_cargo', 'create' | 'edit'), src/lib/permissions.ts): dueño/admin/super_admin
-- siempre; el resto necesita ver la pestaña Y (la acción en la pestaña O el par legado
-- platform.condominios.view + .<acción>). COALESCE: una sesión sin perfil no pasa por NULL.
CREATE OR REPLACE FUNCTION public.plantillas_import_puede_crear()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    public.is_super_admin() OR (
      public.get_my_company_id() IS NOT NULL
      AND (
        public.current_user_role() IN ('company_owner', 'admin')
        OR (public.user_has_permission('condominios.tab.plantillas_cargo')
            AND (public.user_has_permission('condominios.tab.plantillas_cargo.create')
                 OR (public.user_has_permission('platform.condominios.view')
                     AND public.user_has_permission('platform.condominios.create'))))
      )
    ), false);
$$;
REVOKE EXECUTE ON FUNCTION public.plantillas_import_puede_crear() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.plantillas_import_puede_crear() TO authenticated;

CREATE OR REPLACE FUNCTION public.plantillas_puede_editar()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    public.is_super_admin() OR (
      public.get_my_company_id() IS NOT NULL
      AND (
        public.current_user_role() IN ('company_owner', 'admin')
        OR (public.user_has_permission('condominios.tab.plantillas_cargo')
            AND (public.user_has_permission('condominios.tab.plantillas_cargo.edit')
                 OR (public.user_has_permission('platform.condominios.view')
                     AND public.user_has_permission('platform.condominios.edit'))))
      )
    ), false);
$$;
REVOKE EXECUTE ON FUNCTION public.plantillas_puede_editar() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.plantillas_puede_editar() TO authenticated;

DROP POLICY IF EXISTS plantillas_imp_select ON public.plantillas_importaciones;
CREATE POLICY plantillas_imp_select ON public.plantillas_importaciones FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin()) OR (company_id = (SELECT public.get_my_company_id())
         AND public.can_access_project(project_id)));
DROP POLICY IF EXISTS plantillas_imp_insert ON public.plantillas_importaciones;
CREATE POLICY plantillas_imp_insert ON public.plantillas_importaciones FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.plantillas_import_puede_crear())
              AND public.can_access_project(project_id));
DROP POLICY IF EXISTS plantillas_imp_update ON public.plantillas_importaciones;
CREATE POLICY plantillas_imp_update ON public.plantillas_importaciones FOR UPDATE TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.plantillas_import_puede_crear())
         AND public.can_access_project(project_id))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()));

DROP POLICY IF EXISTS plantillas_impf_select ON public.plantillas_importacion_filas;
CREATE POLICY plantillas_impf_select ON public.plantillas_importacion_filas FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.plantillas_importaciones l WHERE l.id = lote_id));
DROP POLICY IF EXISTS plantillas_impf_insert ON public.plantillas_importacion_filas;
CREATE POLICY plantillas_impf_insert ON public.plantillas_importacion_filas FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.plantillas_import_puede_crear())
              AND EXISTS (SELECT 1 FROM public.plantillas_importaciones l WHERE l.id = lote_id));

DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'mfa_requirement_met') THEN
    FOREACH t IN ARRAY ARRAY['plantillas_importaciones', 'plantillas_importacion_filas'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS mfa_gate_aal2 ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY mfa_gate_aal2 ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        || 'USING (public.mfa_requirement_met()) WITH CHECK (public.mfa_requirement_met())', t);
    END LOOP;
  END IF;
END $$;

-- El lote y sus filas SOLO se escriben desde las RPC (candado por GUC de sesión, como
-- `str.import_rpc`): un INSERT/UPDATE directo no los fabrica ni los marca «aplicado».
CREATE OR REPLACE FUNCTION public.plantillas_tg_imp_solo_rpc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(current_setting('plantillas.import_rpc', true), 'off') <> 'on'
     AND COALESCE(current_setting('conta.allow_system_write', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'PLANTILLAS_IMPORT_SOLO_RPC: los lotes de carga masiva los escriben solo las funciones plantillas_importar_*.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.plantillas_tg_imp_solo_rpc() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_plantillas_imp_solo_rpc ON public.plantillas_importaciones;
CREATE TRIGGER trg_plantillas_imp_solo_rpc BEFORE INSERT OR UPDATE ON public.plantillas_importaciones
  FOR EACH ROW EXECUTE FUNCTION public.plantillas_tg_imp_solo_rpc();
DROP TRIGGER IF EXISTS trg_plantillas_impf_solo_rpc ON public.plantillas_importacion_filas;
CREATE TRIGGER trg_plantillas_impf_solo_rpc BEFORE INSERT OR UPDATE ON public.plantillas_importacion_filas
  FOR EACH ROW EXECUTE FUNCTION public.plantillas_tg_imp_solo_rpc();

-- ── Recursos de una celda: «Nombre x 3; Otro!; Tercero x 2.5» ───────────────
-- Devuelve un arreglo JSON de {nombre, cantidad (texto o null), obligatoria}. La
-- resolución contra el catálogo la hace `plantillas_import_evaluar`.
CREATE OR REPLACE FUNCTION public.plantillas_import_partir_recursos(p_celda text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_out   jsonb := '[]'::jsonb;
  v_item  text;
  v_obl   boolean;
  v_cant  text;
  v_m     text[];
BEGIN
  IF p_celda IS NULL OR btrim(p_celda) = '' THEN RETURN v_out; END IF;
  FOREACH v_item IN ARRAY string_to_array(p_celda, ';') LOOP
    v_item := btrim(v_item);
    IF v_item = '' THEN CONTINUE; END IF;
    v_obl := v_item ~ '!\s*$';
    v_item := btrim(regexp_replace(v_item, '\s*!\s*$', ''));
    v_m := regexp_match(v_item, '\s+[xX×]\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*$');
    IF v_m IS NOT NULL THEN
      v_cant := replace(v_m[1], ',', '.');
      v_item := btrim(regexp_replace(v_item, '\s+[xX×]\s*[0-9]+(?:[.,][0-9]{1,2})?\s*$', ''));
    ELSE
      v_cant := NULL;
    END IF;
    v_out := v_out || jsonb_build_object('nombre', v_item, 'cantidad', v_cant, 'obligatoria', v_obl);
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.plantillas_import_partir_recursos(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.plantillas_import_partir_recursos(text) TO authenticated;

-- ── Evaluación de UNA fila (la misma en la vista previa y al aplicar) ───────
-- SECURITY INVOKER: el catálogo, las áreas y los recursos con los que se compara son
-- los que la RLS deja ver a quien importa (los de su empresa/proyecto).
CREATE OR REPLACE FUNCTION public.plantillas_import_evaluar(p_company uuid, p_project uuid, p_fila jsonb, p_n int)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_ok_cols  constant text[] := ARRAY['titulo', 'cargo', 'servicio', 'descripcion', 'instrucciones_seguridad',
                                      'duracion_min', 'icono', 'area', 'orden', 'requiere_foto', 'requiere_comentario',
                                      'requiere_checklist', 'checklist', 'insumos', 'herramientas', 'equipo'];
  v_libres   constant text[] := ARRAY['descripcion', 'instrucciones_seguridad', 'checklist'];
  v_cargos   constant text[] := ARRAY['conserje', 'guardia', 'jardinero', 'mantenimiento', 'administrador', 'otro'];
  v_servs    constant text[] := ARRAY['limpieza', 'mantenimiento', 'seguridad', 'jardineria', 'administracion', 'otro'];
  v_iconos   constant text[] := ARRAY['✅','🧹','🔧','🌿','💡','🚿','🪟','🚪','🏊','🗑','🧴','🔑','📦','🛗','⚡','💧','🖨','🪣','🧽','🔐','📋','🏋️','🎭','🌊','🛠'];
  v_err      jsonb := '[]'::jsonb;
  v_adv      jsonb := '[]'::jsonb;
  k          text;
  v_titulo   text;
  v_cargo    text;
  v_serv     text;
  v_desc     text;
  v_instr    text;
  v_dur_t    text;  v_dur int;
  v_icono    text;
  v_area     text;  v_area_id uuid;  v_n_area int;
  v_orden_t  text;  v_orden int := 0;
  v_rf       boolean := false;
  v_rc       boolean := false;
  v_rk       boolean := false;
  v_chk_t    text;  v_chk jsonb := '[]'::jsonb;
  v_items    jsonb;
  it         jsonb;
  v_nombre   text;
  v_cant_t   text;
  v_cant     numeric;
  v_n        int;
  v_id       uuid;
  v_sum      jsonb := '[]'::jsonb;
  v_inv      jsonb := '[]'::jsonb;
  v_sum_ids  uuid[] := ARRAY[]::uuid[];
  v_inv_ids  uuid[] := ARRAY[]::uuid[];
  v_col      text;
  v_cat      text;
  v_label    text;
BEGIN
  IF jsonb_typeof(p_fila) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('datos', NULL,
      'errores', jsonb_build_array(jsonb_build_object('campo', 'fila', 'mensaje', 'La fila no es un registro de columnas.')),
      'advertencias', '[]'::jsonb);
  END IF;

  FOR k IN SELECT jsonb_object_keys(p_fila) LOOP
    IF NOT (k = ANY (v_ok_cols)) THEN
      v_err := v_err || jsonb_build_object('campo', k,
        'mensaje', format('La columna «%s» no se admite: este archivo solo trae actividades (no decide estado, empresa ni identificadores).', k));
    END IF;
  END LOOP;

  -- Texto plano: nada que parezca fórmula. En los campos libres se admite «-» al inicio
  -- (viñetas); en el resto se rechaza también.
  FOR k IN SELECT unnest(v_ok_cols) LOOP
    IF COALESCE(p_fila->>k, '') ~ (CASE WHEN k = ANY (v_libres) THEN '^\s*[=+@]' ELSE '^\s*[=+@-]' END) THEN
      v_err := v_err || jsonb_build_object('campo', k, 'mensaje', 'Un valor que empieza con =, +, - o @ se rechaza (posible fórmula): pega valores de texto.');
    END IF;
  END LOOP;

  v_titulo  := NULLIF(btrim(COALESCE(p_fila->>'titulo', '')), '');
  v_cargo   := lower(NULLIF(btrim(COALESCE(p_fila->>'cargo', '')), ''));
  v_serv    := lower(NULLIF(btrim(COALESCE(p_fila->>'servicio', '')), ''));
  v_desc    := NULLIF(btrim(COALESCE(p_fila->>'descripcion', '')), '');
  v_instr   := NULLIF(btrim(COALESCE(p_fila->>'instrucciones_seguridad', '')), '');
  v_dur_t   := btrim(COALESCE(p_fila->>'duracion_min', ''));
  v_icono   := NULLIF(btrim(COALESCE(p_fila->>'icono', '')), '');
  v_area    := NULLIF(btrim(COALESCE(p_fila->>'area', '')), '');
  v_orden_t := COALESCE(NULLIF(btrim(COALESCE(p_fila->>'orden', '')), ''), '0');
  v_chk_t   := btrim(COALESCE(p_fila->>'checklist', ''));

  IF v_titulo IS NULL OR length(v_titulo) < 2 THEN
    v_err := v_err || jsonb_build_object('campo', 'titulo', 'mensaje', 'El título es obligatorio (2–150 caracteres).');
  ELSIF length(v_titulo) > 150 THEN
    v_err := v_err || jsonb_build_object('campo', 'titulo', 'mensaje', 'El título excede 150 caracteres.');
  END IF;

  -- Cargo y servicio: del catálogo; se aceptan las etiquetas de pantalla.
  v_serv := translate(COALESCE(v_serv, ''), 'áéíóú', 'aeiou');
  IF v_cargo IS NULL THEN
    v_err := v_err || jsonb_build_object('campo', 'cargo', 'mensaje', format('El cargo es obligatorio: %s.', array_to_string(v_cargos, ', ')));
  ELSIF NOT (v_cargo = ANY (v_cargos)) THEN
    v_err := v_err || jsonb_build_object('campo', 'cargo', 'mensaje', format('Cargo inválido «%s»: usa %s.', v_cargo, array_to_string(v_cargos, ', ')));
  END IF;
  IF v_serv = '' THEN
    v_err := v_err || jsonb_build_object('campo', 'servicio', 'mensaje', format('El servicio es obligatorio: %s.', array_to_string(v_servs, ', ')));
  ELSIF NOT (v_serv = ANY (v_servs)) THEN
    v_err := v_err || jsonb_build_object('campo', 'servicio', 'mensaje', format('Servicio inválido «%s»: usa %s.', v_serv, array_to_string(v_servs, ', ')));
  END IF;

  -- Duración: entero > 0; obligatoria en limpieza (regla de la pantalla).
  IF v_dur_t <> '' THEN
    IF v_dur_t !~ '^[0-9]{1,5}$' OR v_dur_t::int < 1 THEN
      v_err := v_err || jsonb_build_object('campo', 'duracion_min', 'mensaje', 'La duración estimada debe ser un entero de minutos mayor que cero (o vacía).');
    ELSE
      v_dur := v_dur_t::int;
    END IF;
  ELSIF v_serv = 'limpieza' THEN
    v_err := v_err || jsonb_build_object('campo', 'duracion_min', 'mensaje', 'Las actividades de limpieza requieren duración estimada en minutos.');
  END IF;

  -- Ícono: del catálogo de la pantalla o vacío (defecto por servicio).
  IF v_icono IS NULL THEN
    v_icono := CASE v_serv WHEN 'limpieza' THEN '🧹' WHEN 'mantenimiento' THEN '🔧' WHEN 'seguridad' THEN '🔐'
                           WHEN 'jardineria' THEN '🌿' WHEN 'administracion' THEN '📋' ELSE '✅' END;
  ELSIF NOT (v_icono = ANY (v_iconos)) THEN
    v_err := v_err || jsonb_build_object('campo', 'icono', 'mensaje', format('Ícono «%s» fuera del catálogo: déjalo vacío o usa uno de los de la pantalla.', v_icono));
  END IF;

  -- Área: por nombre, entre las activas del proyecto; opcional; nunca se crea.
  IF v_area IS NOT NULL THEN
    SELECT count(*), (array_agg(a.id ORDER BY a.id))[1] INTO v_n_area, v_area_id FROM public.areas_condominio a
     WHERE a.company_id = p_company AND a.project_id = p_project AND a.activo
       AND lower(btrim(a.nombre)) = lower(v_area);
    IF v_n_area = 0 THEN
      v_err := v_err || jsonb_build_object('campo', 'area', 'mensaje', format('El área «%s» no existe (o está inactiva) en este proyecto. La importación no crea áreas.', v_area));
    ELSIF v_n_area > 1 THEN
      v_err := v_err || jsonb_build_object('campo', 'area', 'mensaje', format('Hay %s áreas llamadas «%s» en el proyecto: el nombre es ambiguo. Renombra una en Áreas.', v_n_area, v_area));
      v_area_id := NULL;
    END IF;
  END IF;

  IF v_orden_t !~ '^[0-9]{1,5}$' THEN
    v_err := v_err || jsonb_build_object('campo', 'orden', 'mensaje', 'El orden debe ser un entero mayor o igual a 0 (vacío = 0).');
  ELSE
    v_orden := v_orden_t::int;
  END IF;

  -- si/no.
  FOR k IN SELECT unnest(ARRAY['requiere_foto', 'requiere_comentario', 'requiere_checklist']) LOOP
    v_col := lower(btrim(COALESCE(p_fila->>k, '')));
    IF v_col IN ('', 'no', 'false', '0', 'n') THEN
      NULL;
    ELSIF v_col IN ('si', 'sí', 'true', '1', 's', 'yes') THEN
      IF k = 'requiere_foto' THEN v_rf := true; ELSIF k = 'requiere_comentario' THEN v_rc := true; ELSE v_rk := true; END IF;
    ELSE
      v_err := v_err || jsonb_build_object('campo', k, 'mensaje', format('%s: si o no (vacío = no).', k));
    END IF;
  END LOOP;

  -- Checklist: pasos separados por «|», sin vacíos.
  IF v_chk_t <> '' THEN
    SELECT COALESCE(jsonb_agg(btrim(paso)), '[]'::jsonb) INTO v_chk
      FROM unnest(string_to_array(v_chk_t, '|')) paso WHERE btrim(paso) <> '';
    IF jsonb_array_length(v_chk) > 50 THEN
      v_err := v_err || jsonb_build_object('campo', 'checklist', 'mensaje', 'El checklist admite hasta 50 pasos.');
    END IF;
  END IF;
  IF v_rk AND jsonb_array_length(v_chk) = 0 THEN
    v_err := v_err || jsonb_build_object('campo', 'checklist', 'mensaje', 'El checklist está marcado como obligatorio pero no trae pasos (sepáralos con «|»).');
  END IF;

  IF v_desc IS NOT NULL AND length(v_desc) > 2000 THEN
    v_err := v_err || jsonb_build_object('campo', 'descripcion', 'mensaje', 'La descripción excede 2000 caracteres.');
  END IF;
  IF v_instr IS NOT NULL AND length(v_instr) > 2000 THEN
    v_err := v_err || jsonb_build_object('campo', 'instrucciones_seguridad', 'mensaje', 'Las instrucciones de seguridad exceden 2000 caracteres.');
  END IF;

  -- Insumos: suministros ACTIVOS del proyecto, por nombre; cantidad decimal > 0 (vacío = 1).
  -- La RLS de suministros_condominio exige ver la pestaña Suministros: sin ese permiso el
  -- catálogo está vacío para quien importa, y se dice tal cual (no «no existe»).
  v_items := public.plantillas_import_partir_recursos(p_fila->>'insumos');
  IF jsonb_array_length(v_items) > 0 AND NOT COALESCE(public.user_has_permission('condominios.tab.suministros'), false) THEN
    v_err := v_err || jsonb_build_object('campo', 'insumos', 'mensaje', 'Para vincular insumos por nombre necesitas permiso para ver la pestaña Suministros.');
    v_items := '[]'::jsonb;
  END IF;
  FOR it IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_nombre := it->>'nombre';
    v_cant_t := COALESCE(it->>'cantidad', '1');
    IF v_nombre IS NULL OR length(v_nombre) < 2 THEN
      v_err := v_err || jsonb_build_object('campo', 'insumos', 'mensaje', 'Cada insumo va como «Nombre» o «Nombre x cantidad», separados por «;».');
      CONTINUE;
    END IF;
    IF (it->>'obligatoria')::boolean THEN
      v_err := v_err || jsonb_build_object('campo', 'insumos', 'mensaje', format('«%s»: los insumos no llevan «!» (obligatoria aplica a herramientas y equipo).', v_nombre));
    END IF;
    IF v_cant_t !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' OR v_cant_t::numeric <= 0 THEN
      v_err := v_err || jsonb_build_object('campo', 'insumos', 'mensaje', format('«%s»: la cantidad debe ser un número mayor que cero (hasta 2 decimales).', v_nombre));
      CONTINUE;
    END IF;
    v_cant := v_cant_t::numeric;
    SELECT count(*), (array_agg(s.id ORDER BY s.id))[1] INTO v_n, v_id FROM public.suministros_condominio s
     WHERE s.company_id = p_company AND s.project_id = p_project AND s.activo
       AND lower(btrim(s.nombre)) = lower(v_nombre);
    IF v_n = 0 THEN
      v_err := v_err || jsonb_build_object('campo', 'insumos', 'mensaje', format('El insumo «%s» no existe (o está inactivo) en este proyecto. La importación no crea insumos.', v_nombre));
    ELSIF v_n > 1 THEN
      v_err := v_err || jsonb_build_object('campo', 'insumos', 'mensaje', format('Hay %s insumos llamados «%s» en el proyecto: el nombre es ambiguo. Renombra uno en Suministros.', v_n, v_nombre));
    ELSIF v_id = ANY (v_sum_ids) THEN
      v_err := v_err || jsonb_build_object('campo', 'insumos', 'mensaje', format('El insumo «%s» se repite en la misma fila.', v_nombre));
    ELSE
      v_sum_ids := v_sum_ids || v_id;
      v_sum := v_sum || jsonb_build_object('id', v_id, 'nombre', v_nombre, 'cantidad', v_cant);
    END IF;
  END LOOP;

  -- Herramientas y equipo: inventario NO dado de baja del proyecto, por nombre y categoría;
  -- cantidad entera > 0 (vacío = 1); «!» = obligatoria.
  FOR v_col, v_cat, v_label IN SELECT * FROM (VALUES ('herramientas', 'herramienta', 'La herramienta'), ('equipo', 'equipo', 'El equipo')) t(c, cat, l) LOOP
    v_items := public.plantillas_import_partir_recursos(p_fila->>v_col);
    FOR it IN SELECT value FROM jsonb_array_elements(v_items) LOOP
      v_nombre := it->>'nombre';
      v_cant_t := COALESCE(it->>'cantidad', '1');
      IF v_nombre IS NULL OR length(v_nombre) < 2 THEN
        v_err := v_err || jsonb_build_object('campo', v_col, 'mensaje', 'Cada recurso va como «Nombre», «Nombre x cantidad» o «Nombre!» (obligatoria), separados por «;».');
        CONTINUE;
      END IF;
      IF v_cant_t !~ '^[0-9]{1,6}$' OR v_cant_t::int <= 0 THEN
        v_err := v_err || jsonb_build_object('campo', v_col, 'mensaje', format('«%s»: la cantidad debe ser un entero mayor que cero.', v_nombre));
        CONTINUE;
      END IF;
      SELECT count(*), (array_agg(i.id ORDER BY i.id))[1] INTO v_n, v_id FROM public.inventario_condominio i
       WHERE i.company_id = p_company AND i.project_id = p_project AND i.estado <> 'dado_de_baja'
         AND i.categoria = v_cat AND lower(btrim(i.nombre)) = lower(v_nombre);
      IF v_n = 0 THEN
        v_err := v_err || jsonb_build_object('campo', v_col, 'mensaje', format('%s «%s» no existe en este proyecto con categoría «%s» (o está dado de baja). La importación no crea inventario; revisa la categoría en Inventario.', v_label, v_nombre, v_cat));
      ELSIF v_n > 1 THEN
        v_err := v_err || jsonb_build_object('campo', v_col, 'mensaje', format('Hay %s artículos de inventario llamados «%s» con categoría «%s»: el nombre es ambiguo. Renombra uno en Inventario.', v_n, v_nombre, v_cat));
      ELSIF v_id = ANY (v_inv_ids) THEN
        v_err := v_err || jsonb_build_object('campo', v_col, 'mensaje', format('«%s» se repite en la misma fila.', v_nombre));
      ELSE
        v_inv_ids := v_inv_ids || v_id;
        v_inv := v_inv || jsonb_build_object('id', v_id, 'nombre', v_nombre, 'categoria', v_cat,
                                             'cantidad', v_cant_t::int, 'obligatoria', (it->>'obligatoria')::boolean);
      END IF;
    END LOOP;
  END LOOP;

  -- Actividad ya existente con el mismo título y cargo en el proyecto (activa o inactiva) → ERROR.
  IF v_titulo IS NOT NULL AND v_cargo = ANY (v_cargos) AND EXISTS (
    SELECT 1 FROM public.plantillas_tarea_cargo p
     WHERE p.company_id = p_company AND p.project_id = p_project
       AND lower(btrim(p.titulo)) = lower(v_titulo) AND lower(btrim(p.cargo)) = v_cargo) THEN
    v_err := v_err || jsonb_build_object('campo', 'titulo', 'mensaje', format('Ya existe una actividad «%s» para el cargo %s en este proyecto (activa o inactiva). La carga no sobrescribe: edítala en el catálogo o cambia el título.', v_titulo, v_cargo));
  END IF;

  IF jsonb_array_length(v_err) > 0 THEN
    RETURN jsonb_build_object('datos', NULL, 'errores', v_err, 'advertencias', v_adv);
  END IF;

  RETURN jsonb_build_object(
    'datos', jsonb_build_object(
      'titulo', v_titulo, 'cargo', v_cargo, 'servicio', v_serv, 'descripcion', v_desc,
      'instrucciones_seguridad', v_instr, 'duracion_estimada_min', v_dur, 'icono', v_icono,
      'area', v_area, 'area_id', v_area_id, 'orden', v_orden,
      'requiere_foto', v_rf, 'requiere_comentario', v_rc, 'requiere_checklist', v_rk, 'checklist', v_chk,
      'recursos', jsonb_build_object('suministros', v_sum, 'inventario', v_inv),
      'n_recursos', jsonb_array_length(v_sum) + jsonb_array_length(v_inv)),
    'errores', v_err, 'advertencias', v_adv);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.plantillas_import_evaluar(uuid, uuid, jsonb, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.plantillas_import_evaluar(uuid, uuid, jsonb, int) TO authenticated;

-- ── Vista previa ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.plantillas_importar_previsualizar(
  p_project_id uuid, p_filas jsonb, p_archivo text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_company   uuid;
  v_lote      public.plantillas_importaciones%ROWTYPE;
  v_n         int;
  v_i         int := 0;
  r           jsonb;
  v_ev        jsonb;
  v_err       jsonb;
  v_adv       jsonb;
  v_claves    text[] := ARRAY[]::text[];
  v_clave     text;
  v_hash      text;
  v_validas   int := 0;
  v_conerr    int := 0;
  v_resultado jsonb := '[]'::jsonb;
  v_ya        boolean := false;
BEGIN
  IF NOT public.plantillas_import_puede_crear() THEN
    RAISE EXCEPTION 'PLANTILLAS_IMPORT_PERMISO: no tienes permiso para crear actividades en el catálogo.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL OR v_company IS DISTINCT FROM public.get_my_company_id()
     OR NOT COALESCE(public.can_access_project(p_project_id), false) THEN
    RAISE EXCEPTION 'PLANTILLAS_IMPORT_PROYECTO: el proyecto no existe en tu empresa o no tienes acceso a él.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_filas IS NULL OR jsonb_typeof(p_filas) <> 'array' OR jsonb_array_length(p_filas) = 0 THEN
    RAISE EXCEPTION 'PLANTILLAS_IMPORT_VACIA: el archivo no trae filas.' USING ERRCODE = 'check_violation';
  END IF;
  v_n := jsonb_array_length(p_filas);
  IF v_n > 500 THEN
    RAISE EXCEPTION 'PLANTILLAS_IMPORT_LIMITE: % filas; el máximo es 500 por carga. Divide el archivo.', v_n USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('plantillas.import_rpc', 'on', true);

  v_hash := encode(sha256(convert_to(p_filas::text, 'UTF8')), 'hex');
  SELECT EXISTS (
    SELECT 1 FROM public.plantillas_importaciones l
     WHERE l.project_id = p_project_id AND l.contenido_sha256 = v_hash AND l.estado = 'aplicado'
       AND EXISTS (SELECT 1 FROM public.plantillas_tarea_cargo pt
                    WHERE pt.id::text IN (SELECT jsonb_array_elements_text(l.resultado->'plantilla_ids')))
  ) INTO v_ya;

  INSERT INTO public.plantillas_importaciones (company_id, project_id, archivo_nombre, contenido_sha256, created_by)
  VALUES (v_company, p_project_id, left(p_archivo, 200), v_hash, auth.uid())
  RETURNING * INTO v_lote;

  FOR r IN SELECT value FROM jsonb_array_elements(p_filas) LOOP
    v_i := v_i + 1;
    v_ev := public.plantillas_import_evaluar(v_company, p_project_id, r, v_i);
    v_err := v_ev->'errores';
    v_adv := v_ev->'advertencias';
    -- Título + cargo repetidos DENTRO del archivo → error en la fila posterior.
    IF jsonb_array_length(v_err) = 0 THEN
      v_clave := lower(v_ev->'datos'->>'titulo') || '|' || (v_ev->'datos'->>'cargo');
      IF v_clave = ANY (v_claves) THEN
        v_err := v_err || jsonb_build_object('campo', 'titulo', 'mensaje', 'Esta actividad (mismo título y cargo) se repite en otra fila del archivo. La fila no se importa.');
      END IF;
      v_claves := v_claves || v_clave;
    END IF;
    IF jsonb_array_length(v_err) = 0 THEN
      v_validas := v_validas + 1;
    ELSE
      v_conerr := v_conerr + 1;
    END IF;
    INSERT INTO public.plantillas_importacion_filas (lote_id, company_id, fila, origen, datos, errores, advertencias)
    VALUES (v_lote.id, v_company, v_i, r, CASE WHEN jsonb_array_length(v_err) = 0 THEN v_ev->'datos' END, v_err, v_adv);
    v_resultado := v_resultado || jsonb_build_object('fila', v_i, 'origen', r,
                                                     'datos', CASE WHEN jsonb_array_length(v_err) = 0 THEN v_ev->'datos' ELSE 'null'::jsonb END,
                                                     'errores', v_err, 'advertencias', v_adv);
  END LOOP;

  UPDATE public.plantillas_importaciones
     SET resumen = jsonb_build_object('total', v_n, 'validas', v_validas, 'con_error', v_conerr, 'duplicado_de_lote_aplicado', v_ya)
   WHERE id = v_lote.id;

  RETURN jsonb_build_object('lote_id', v_lote.id, 'project_id', p_project_id,
    'resumen', jsonb_build_object('total', v_n, 'validas', v_validas, 'con_error', v_conerr, 'duplicado_de_lote_aplicado', v_ya),
    'filas', v_resultado);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.plantillas_importar_previsualizar(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.plantillas_importar_previsualizar(uuid, jsonb, text) TO authenticated;

-- ── Aplicar: todo o nada, idempotente ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.plantillas_importar_aplicar(p_lote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_lote   public.plantillas_importaciones%ROWTYPE;
  f        record;
  v_ev     jsonb;
  d        jsonb;
  rec      jsonb;
  v_ids    uuid[] := ARRAY[]::uuid[];
  v_id     uuid;
  v_k      int := 0;
  v_ns     int := 0;
  v_nh     int := 0;
  v_errs   int := 0;
  v_dup    int := 0;
  v_claves text[] := ARRAY[]::text[];
  v_clave  text;
  v_res    jsonb;
BEGIN
  IF NOT public.plantillas_import_puede_crear() THEN
    RAISE EXCEPTION 'PLANTILLAS_IMPORT_PERMISO: no tienes permiso para crear actividades en el catálogo.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_lote FROM public.plantillas_importaciones WHERE id = p_lote_id;
  IF NOT FOUND OR v_lote.company_id IS DISTINCT FROM public.get_my_company_id() THEN
    RAISE EXCEPTION 'PLANTILLAS_IMPORT_LOTE: el lote no existe.' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('plantillas_import:' || v_lote.project_id::text, 0));
  SELECT * INTO v_lote FROM public.plantillas_importaciones WHERE id = p_lote_id;

  IF v_lote.estado = 'aplicado' THEN
    RETURN COALESCE(v_lote.resultado, '{}'::jsonb) || jsonb_build_object('reutilizada', true);
  END IF;
  IF v_lote.estado <> 'previsualizado' THEN
    RAISE EXCEPTION 'PLANTILLAS_IMPORT_LOTE: el lote está "%" y ya no se puede aplicar.', v_lote.estado USING ERRCODE = 'check_violation';
  END IF;
  IF NOT COALESCE(public.can_access_project(v_lote.project_id), false) THEN
    RAISE EXCEPTION 'PLANTILLAS_IMPORT_PROYECTO: el proyecto no existe en tu empresa o no tienes acceso a él.' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.plantillas_importaciones l
     WHERE l.project_id = v_lote.project_id AND l.contenido_sha256 = v_lote.contenido_sha256
       AND l.estado = 'aplicado' AND l.id <> v_lote.id
       AND EXISTS (SELECT 1 FROM public.plantillas_tarea_cargo pt
                    WHERE pt.id::text IN (SELECT jsonb_array_elements_text(l.resultado->'plantilla_ids')))) THEN
    RAISE EXCEPTION 'PLANTILLAS_IMPORT_DUPLICADO: este mismo contenido ya se importó a este proyecto y sus actividades siguen ahí. No se importa dos veces.'
      USING ERRCODE = 'unique_violation';
  END IF;

  PERFORM set_config('plantillas.import_rpc', 'on', true);

  -- Se RE-EVALÚA cada fila contra el estado de HOY (recursos renombrados, actividades
  -- creadas a mano desde la vista previa…). Una con error frena todo.
  FOR f IN SELECT fila, origen FROM public.plantillas_importacion_filas WHERE lote_id = p_lote_id ORDER BY fila LOOP
    v_ev := public.plantillas_import_evaluar(v_lote.company_id, v_lote.project_id, f.origen, f.fila);
    IF jsonb_array_length(v_ev->'errores') > 0 THEN
      v_errs := v_errs + 1;
    ELSE
      v_clave := lower(v_ev->'datos'->>'titulo') || '|' || (v_ev->'datos'->>'cargo');
      IF v_clave = ANY (v_claves) THEN v_dup := v_dup + 1; END IF;
      v_claves := v_claves || v_clave;
    END IF;
  END LOOP;
  IF v_errs > 0 OR v_dup > 0 THEN
    RAISE EXCEPTION 'PLANTILLAS_IMPORT_CON_ERRORES: % fila(s) con error; la carga es todo o nada y no se escribió ninguna actividad. Corrige el archivo y vuelve a cargarlo.', v_errs + v_dup
      USING ERRCODE = 'check_violation';
  END IF;

  FOR f IN SELECT fila, origen FROM public.plantillas_importacion_filas WHERE lote_id = p_lote_id ORDER BY fila LOOP
    d := (public.plantillas_import_evaluar(v_lote.company_id, v_lote.project_id, f.origen, f.fila))->'datos';
    v_k := v_k + 1;
    INSERT INTO public.plantillas_tarea_cargo
      (company_id, project_id, cargo, titulo, descripcion, icono, orden, area_id, requiere_foto,
       servicio, duracion_estimada_min, checklist, instrucciones_seguridad, requiere_comentario, requiere_checklist, activo)
    VALUES
      (v_lote.company_id, v_lote.project_id, d->>'cargo', d->>'titulo', d->>'descripcion', d->>'icono', (d->>'orden')::int,
       (d->>'area_id')::uuid, (d->>'requiere_foto')::boolean, d->>'servicio', (d->>'duracion_estimada_min')::int,
       COALESCE(d->'checklist', '[]'::jsonb), d->>'instrucciones_seguridad', (d->>'requiere_comentario')::boolean,
       (d->>'requiere_checklist')::boolean, true)
    RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
    FOR rec IN SELECT value FROM jsonb_array_elements(COALESCE(d->'recursos'->'suministros', '[]'::jsonb)) LOOP
      INSERT INTO public.plantilla_tarea_suministros (company_id, project_id, plantilla_tarea_id, suministro_id, cantidad)
      VALUES (v_lote.company_id, v_lote.project_id, v_id, (rec->>'id')::uuid, (rec->>'cantidad')::numeric);
      v_ns := v_ns + 1;
    END LOOP;
    FOR rec IN SELECT value FROM jsonb_array_elements(COALESCE(d->'recursos'->'inventario', '[]'::jsonb)) LOOP
      INSERT INTO public.plantilla_tarea_herramientas (company_id, project_id, plantilla_tarea_id, inventario_id, cantidad, obligatoria)
      VALUES (v_lote.company_id, v_lote.project_id, v_id, (rec->>'id')::uuid, (rec->>'cantidad')::int, COALESCE((rec->>'obligatoria')::boolean, false));
      v_nh := v_nh + 1;
    END LOOP;
  END LOOP;

  v_res := jsonb_build_object('lote_id', v_lote.id, 'project_id', v_lote.project_id, 'actividades_creadas', v_k,
                              'plantilla_ids', to_jsonb(v_ids), 'insumos_vinculados', v_ns, 'herramientas_vinculadas', v_nh,
                              'reutilizada', false);
  UPDATE public.plantillas_importaciones
     SET estado = 'aplicado', resultado = v_res, aplicado_por = auth.uid(), aplicado_at = now()
   WHERE id = v_lote.id;
  RETURN v_res;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.plantillas_importar_aplicar(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.plantillas_importar_aplicar(uuid) TO authenticated;

-- ── Descartar ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.plantillas_importar_descartar(p_lote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_estado text;
BEGIN
  IF NOT public.plantillas_import_puede_crear() THEN
    RAISE EXCEPTION 'PLANTILLAS_IMPORT_PERMISO: no tienes permiso para crear actividades en el catálogo.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT estado INTO v_estado FROM public.plantillas_importaciones
   WHERE id = p_lote_id AND company_id = public.get_my_company_id() FOR UPDATE;
  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'PLANTILLAS_IMPORT_LOTE: el lote no existe.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_estado = 'aplicado' THEN
    RAISE EXCEPTION 'PLANTILLAS_IMPORT_LOTE: un lote aplicado no se descarta; las actividades se desactivan o eliminan en el catálogo.' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('plantillas.import_rpc', 'on', true);
  UPDATE public.plantillas_importaciones SET estado = 'descartado' WHERE id = p_lote_id AND estado = 'previsualizado';
  RETURN jsonb_build_object('lote_id', p_lote_id, 'estado', 'descartado');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.plantillas_importar_descartar(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.plantillas_importar_descartar(uuid) TO authenticated;

-- ── Recursos en bloque: agregar o quitar insumos/herramientas/equipo a varias actividades ──
-- SECURITY INVOKER: rigen las RLS de las puentes (condominios.tab.plantillas_cargo) y los
-- triggers de coherencia y sello; además se espeja el permiso de EDITAR de la pantalla.
-- p_suministros: [{id, cantidad?}] · p_inventario: [{id, cantidad?, obligatoria?}]
CREATE OR REPLACE FUNCTION public.plantillas_recursos_en_bloque(
  p_project_id uuid, p_plantilla_ids uuid[], p_accion text,
  p_suministros jsonb DEFAULT '[]'::jsonb, p_inventario jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_company   uuid;
  v_pl        uuid[];
  v_n_pl      int;
  v_sum       jsonb := '[]'::jsonb;
  v_inv       jsonb := '[]'::jsonb;
  it          jsonb;
  v_id        uuid;
  v_cant      numeric;
  v_n_rec     int;
  v_n         int;
  v_pares     int;
  v_agreg     int := 0;
  v_quit      int := 0;
  v_tmp       int;
BEGIN
  IF NOT public.plantillas_puede_editar() THEN
    RAISE EXCEPTION 'PLANTILLAS_BLOQUE_PERMISO: no tienes permiso para editar el catálogo de actividades.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL OR v_company IS DISTINCT FROM public.get_my_company_id()
     OR NOT COALESCE(public.can_access_project(p_project_id), false) THEN
    RAISE EXCEPTION 'PLANTILLAS_BLOQUE_PROYECTO: el proyecto no existe en tu empresa o no tienes acceso a él.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_accion IS NULL OR p_accion NOT IN ('agregar', 'quitar') THEN
    RAISE EXCEPTION 'PLANTILLAS_BLOQUE_ACCION: la acción debe ser «agregar» o «quitar».' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::uuid[]) INTO v_pl FROM unnest(COALESCE(p_plantilla_ids, ARRAY[]::uuid[])) x WHERE x IS NOT NULL;
  v_n_pl := COALESCE(array_length(v_pl, 1), 0);
  IF v_n_pl = 0 THEN
    RAISE EXCEPTION 'PLANTILLAS_BLOQUE_VACIO: elige al menos una actividad.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_n_pl > 200 THEN
    RAISE EXCEPTION 'PLANTILLAS_BLOQUE_LIMITE: hasta 200 actividades por operación.' USING ERRCODE = 'check_violation';
  END IF;

  -- Recursos pedidos: forma y valores.
  IF p_suministros IS NOT NULL AND jsonb_typeof(p_suministros) = 'array' THEN
    FOR it IN SELECT value FROM jsonb_array_elements(p_suministros) LOOP
      BEGIN v_id := (it->>'id')::uuid; EXCEPTION WHEN OTHERS THEN v_id := NULL; END;
      v_cant := COALESCE(NULLIF(it->>'cantidad', '')::numeric, 1);
      IF v_id IS NULL OR v_cant <= 0 OR v_cant <> round(v_cant, 2) THEN
        RAISE EXCEPTION 'PLANTILLAS_BLOQUE_RECURSO: cada insumo lleva id y cantidad mayor que cero (hasta 2 decimales).' USING ERRCODE = 'check_violation';
      END IF;
      IF NOT (v_sum @> jsonb_build_array(jsonb_build_object('id', v_id))) THEN
        v_sum := v_sum || jsonb_build_object('id', v_id, 'cantidad', v_cant);
      END IF;
    END LOOP;
  END IF;
  IF p_inventario IS NOT NULL AND jsonb_typeof(p_inventario) = 'array' THEN
    FOR it IN SELECT value FROM jsonb_array_elements(p_inventario) LOOP
      BEGIN v_id := (it->>'id')::uuid; EXCEPTION WHEN OTHERS THEN v_id := NULL; END;
      v_cant := COALESCE(NULLIF(it->>'cantidad', '')::numeric, 1);
      IF v_id IS NULL OR v_cant <= 0 OR v_cant <> trunc(v_cant) THEN
        RAISE EXCEPTION 'PLANTILLAS_BLOQUE_RECURSO: cada herramienta o equipo lleva id y cantidad entera mayor que cero.' USING ERRCODE = 'check_violation';
      END IF;
      IF NOT (v_inv @> jsonb_build_array(jsonb_build_object('id', v_id))) THEN
        v_inv := v_inv || jsonb_build_object('id', v_id, 'cantidad', v_cant::int, 'obligatoria', COALESCE((it->>'obligatoria')::boolean, false));
      END IF;
    END LOOP;
  END IF;
  v_n_rec := jsonb_array_length(v_sum) + jsonb_array_length(v_inv);
  IF v_n_rec = 0 THEN
    RAISE EXCEPTION 'PLANTILLAS_BLOQUE_VACIO: elige al menos un insumo, herramienta o equipo.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_n_rec > 50 THEN
    RAISE EXCEPTION 'PLANTILLAS_BLOQUE_LIMITE: hasta 50 recursos por operación.' USING ERRCODE = 'check_violation';
  END IF;

  -- Alcance: todas las actividades y todos los recursos deben ser de ESTE proyecto (lo que
  -- la RLS no deje ver cuenta como inexistente). Al agregar, los recursos deben estar vigentes.
  IF jsonb_array_length(v_sum) > 0 AND NOT COALESCE(public.user_has_permission('condominios.tab.suministros'), false) THEN
    RAISE EXCEPTION 'PLANTILLAS_BLOQUE_PERMISO: para asignar insumos necesitas permiso para ver la pestaña Suministros.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO v_n FROM public.plantillas_tarea_cargo p
   WHERE p.id = ANY (v_pl) AND p.company_id = v_company AND p.project_id = p_project_id;
  IF v_n <> v_n_pl THEN
    RAISE EXCEPTION 'PLANTILLAS_BLOQUE_ALCANCE: % de las actividades no existen en este proyecto.', v_n_pl - v_n USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO v_n FROM public.suministros_condominio s
   WHERE s.id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(v_sum) x)
     AND s.company_id = v_company AND s.project_id = p_project_id AND (p_accion = 'quitar' OR s.activo);
  IF v_n <> jsonb_array_length(v_sum) THEN
    RAISE EXCEPTION 'PLANTILLAS_BLOQUE_ALCANCE: % de los insumos no existen en este proyecto (o están inactivos).', jsonb_array_length(v_sum) - v_n USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO v_n FROM public.inventario_condominio i
   WHERE i.id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(v_inv) x)
     AND i.company_id = v_company AND i.project_id = p_project_id AND (p_accion = 'quitar' OR i.estado <> 'dado_de_baja');
  IF v_n <> jsonb_array_length(v_inv) THEN
    RAISE EXCEPTION 'PLANTILLAS_BLOQUE_ALCANCE: % de las herramientas o equipos no existen en este proyecto (o están dados de baja).', jsonb_array_length(v_inv) - v_n USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('plantillas_recursos:' || p_project_id::text, 0));
  v_pares := v_n_pl * v_n_rec;

  IF p_accion = 'agregar' THEN
    INSERT INTO public.plantilla_tarea_suministros (company_id, project_id, plantilla_tarea_id, suministro_id, cantidad)
    SELECT v_company, p_project_id, pl, (x->>'id')::uuid, (x->>'cantidad')::numeric
      FROM unnest(v_pl) pl CROSS JOIN jsonb_array_elements(v_sum) x
    ON CONFLICT (plantilla_tarea_id, suministro_id) DO NOTHING;
    GET DIAGNOSTICS v_tmp = ROW_COUNT; v_agreg := v_agreg + v_tmp;
    INSERT INTO public.plantilla_tarea_herramientas (company_id, project_id, plantilla_tarea_id, inventario_id, cantidad, obligatoria)
    SELECT v_company, p_project_id, pl, (x->>'id')::uuid, (x->>'cantidad')::int, (x->>'obligatoria')::boolean
      FROM unnest(v_pl) pl CROSS JOIN jsonb_array_elements(v_inv) x
    ON CONFLICT (plantilla_tarea_id, inventario_id) DO NOTHING;
    GET DIAGNOSTICS v_tmp = ROW_COUNT; v_agreg := v_agreg + v_tmp;
  ELSE
    DELETE FROM public.plantilla_tarea_suministros
     WHERE plantilla_tarea_id = ANY (v_pl)
       AND suministro_id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(v_sum) x);
    GET DIAGNOSTICS v_tmp = ROW_COUNT; v_quit := v_quit + v_tmp;
    DELETE FROM public.plantilla_tarea_herramientas
     WHERE plantilla_tarea_id = ANY (v_pl)
       AND inventario_id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(v_inv) x);
    GET DIAGNOSTICS v_tmp = ROW_COUNT; v_quit := v_quit + v_tmp;
  END IF;

  RETURN jsonb_build_object('accion', p_accion, 'plantillas', v_n_pl, 'recursos', v_n_rec, 'pares', v_pares,
                            'agregados', v_agreg, 'ya_estaban', CASE WHEN p_accion = 'agregar' THEN v_pares - v_agreg ELSE 0 END,
                            'quitados', v_quit, 'no_estaban', CASE WHEN p_accion = 'quitar' THEN v_pares - v_quit ELSE 0 END);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.plantillas_recursos_en_bloque(uuid, uuid[], text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.plantillas_recursos_en_bloque(uuid, uuid[], text, jsonb, jsonb) TO authenticated;

COMMENT ON FUNCTION public.plantillas_importar_previsualizar(uuid, jsonb, text) IS
  'Carga masiva de actividades: crea el lote y evalúa cada fila (cargo, servicio, duración, área, checklist, insumos/herramientas/equipo por nombre, título repetido = error). No escribe actividades. Exige el mismo permiso que crear una actividad y acceso al proyecto.';
COMMENT ON FUNCTION public.plantillas_importar_aplicar(uuid) IS
  'Aplica un lote previsualizado: re-evalúa cada fila, todo o nada, inserta actividades y sus recursos bajo la RLS y los triggers del llamador. Idempotente: un lote aplicado devuelve su resultado; el mismo contenido no se importa dos veces mientras sus actividades sigan.';
COMMENT ON FUNCTION public.plantillas_recursos_en_bloque(uuid, uuid[], text, jsonb, jsonb) IS
  'Agrega (sin tocar pares existentes) o quita insumos, herramientas y equipo a varias actividades del proyecto en una sola transacción. Exige el permiso de editar el catálogo y acceso al proyecto. Devuelve conteos.';
