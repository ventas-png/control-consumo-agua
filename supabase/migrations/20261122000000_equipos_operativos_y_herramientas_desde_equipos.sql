-- ════════════════════════════════════════════════════════════════════════════
-- Equipos: catálogo operativo junto a Suministros, y fuente de las herramientas
-- de las actividades (plantilla_tarea_herramientas → equipos_comunes)
-- ════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ
-- · El tab Equipos (equipos_comunes) vivía en Instalaciones con una ficha
--   mínima. Pasa a Operaciones, al lado de Suministros, con su misma visual y
--   funcionalidad: cantidad, foto, alertas y carga masiva. Eso pide dos
--   columnas que la tabla no tenía.
-- · El selector «Herramientas y equipo» del catálogo de actividades
--   (plantilla_tarea_herramientas, 20260904000300) tomaba los artículos de
--   inventario_condominio —Inventario: mobiliario, materiales, vehículos—. Lo
--   que compete a una actividad es un EQUIPO: la hidrolavadora, la pulidora, la
--   bomba. Desde aquí la puente apunta a equipos_comunes; lo mismo la carga
--   masiva por nombre y los recursos en bloque.
--
-- LO QUE HACE
--   1. equipos_comunes: `cantidad` (int ≥ 0, defecto 1), `foto_url` (ruta en el
--      bucket condominios-media, el mismo formato que
--      suministros_condominio.foto_url, 20261119000000) y el ancla UNIQUE
--      (id, company_id, project_id) que exige la FK compuesta de la puente.
--   2. plantilla_tarea_herramientas: `equipo_id` con FK COMPUESTA a
--      equipos_comunes (RESTRICT: un equipo vinculado no se borra físicamente,
--      su baja es estado = 'baja'); `inventario_id` pasa a admitir NULL; un
--      CHECK exige exactamente uno de los dos. Las filas legadas (inventario)
--      siguen válidas y visibles; las nuevas nacen con equipo_id. Índice único
--      PARCIAL (plantilla, equipo) para el ON CONFLICT del bloque.
--   3. Trigger de coherencia propio de la puente (plantilla_herramienta_coherente):
--      sella company/project desde la plantilla y valida el recurso en la tabla
--      que corresponda —equipos_comunes, o inventario_condominio en el legado—.
--      Sustituye a plantilla_recurso_coherente SOLO en esta puente; la de
--      insumos sigue igual.
--   4. plantillas_import_evaluar: las columnas `herramientas` y `equipo` se
--      resuelven por nombre contra equipos_comunes (estado <> 'baja'). Ver el
--      catálogo exige condominios.tab.equipos (RLS de equipos_comunes,
--      20260518000010). El resultado va en datos.recursos.equipos con la
--      categoría del equipo.
--   5. plantillas_importar_aplicar: inserta equipo_id desde recursos.equipos.
--   6. plantillas_recursos_en_bloque: `p_equipos` en lugar de `p_inventario`.
--      Cambia el NOMBRE de un parámetro, cosa que CREATE OR REPLACE no admite:
--      se retira la firma anterior y se crea la nueva (mismos tipos).
--   7. El permiso condominios.tab.equipos y sus acciones pasan a la categoría
--      `operaciones`, donde ahora vive el tab (el editor de roles agrupa por
--      categoría).
--
-- LO QUE **NO** HACE: no reescribe las filas legadas con inventario_id (la
-- pantalla las muestra con su nombre de Inventario y se pueden quitar); no
-- toca policies (las de la puente ya exigen plantillas_cargo.create/edit/delete,
-- 20261104000700; las de equipos_comunes, equipos.create/edit/delete,
-- 20261104000300); no borra archivos del bucket.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS; constraints bajo DO $$ IF NOT EXISTS;
-- CREATE INDEX IF NOT EXISTS; DROP TRIGGER IF EXISTS; CREATE OR REPLACE;
-- DROP FUNCTION IF EXISTS antes de la firma nueva. El sandbox
-- supabase/tests/equipos_herramientas la aplica dos veces y compara la huella.
--
-- REVERSA (manual):
--   DROP FUNCTION public.plantillas_recursos_en_bloque(uuid, uuid[], text, jsonb, jsonb);
--   recrear plantillas_recursos_en_bloque, plantillas_importar_aplicar (20261031000200)
--   y plantillas_import_evaluar (20261031000300);
--   DROP TRIGGER trg_pt_her_coherente ON public.plantilla_tarea_herramientas; recrearlo con
--   plantilla_recurso_coherente('inventario_condominio', 'inventario_id');
--   DROP FUNCTION public.plantilla_herramienta_coherente();
--   DELETE FROM public.plantilla_tarea_herramientas WHERE equipo_id IS NOT NULL;
--   ALTER TABLE public.plantilla_tarea_herramientas DROP CONSTRAINT pt_herramienta_recurso_check,
--     DROP CONSTRAINT pt_herramienta_equipo_fk, DROP COLUMN equipo_id, ALTER COLUMN inventario_id SET NOT NULL;
--   ALTER TABLE public.equipos_comunes DROP CONSTRAINT equipos_id_tenant_uq,
--     DROP CONSTRAINT equipos_comunes_cantidad_check, DROP COLUMN cantidad, DROP COLUMN foto_url;
--   UPDATE public.permissions SET category = 'instalaciones' WHERE key LIKE 'condominios.tab.equipos%';
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. equipos_comunes: cantidad, foto y ancla para la FK compuesta
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.equipos_comunes
  ADD COLUMN IF NOT EXISTS cantidad int NOT NULL DEFAULT 1;
ALTER TABLE public.equipos_comunes
  ADD COLUMN IF NOT EXISTS foto_url text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'equipos_comunes_cantidad_check' AND conrelid = 'public.equipos_comunes'::regclass) THEN
    ALTER TABLE public.equipos_comunes
      ADD CONSTRAINT equipos_comunes_cantidad_check CHECK (cantidad >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'equipos_id_tenant_uq' AND conrelid = 'public.equipos_comunes'::regclass) THEN
    ALTER TABLE public.equipos_comunes
      ADD CONSTRAINT equipos_id_tenant_uq UNIQUE (id, company_id, project_id);
  END IF;
END;
$$;

COMMENT ON COLUMN public.equipos_comunes.cantidad IS
  'Unidades de este equipo en el condominio (p. ej. 3 hidrolavadoras iguales). Entero ≥ 0; 1 por defecto.';
COMMENT ON COLUMN public.equipos_comunes.foto_url IS
  'Ruta de la foto del equipo en el bucket condominios-media (<project_id>/equipos/...). NULL = sin foto.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. plantilla_tarea_herramientas: la herramienta es un equipo
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.plantilla_tarea_herramientas
  ADD COLUMN IF NOT EXISTS equipo_id uuid;
ALTER TABLE public.plantilla_tarea_herramientas
  ALTER COLUMN inventario_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'pt_herramienta_recurso_check' AND conrelid = 'public.plantilla_tarea_herramientas'::regclass) THEN
    ALTER TABLE public.plantilla_tarea_herramientas
      ADD CONSTRAINT pt_herramienta_recurso_check CHECK ((inventario_id IS NULL) <> (equipo_id IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'pt_herramienta_equipo_fk' AND conrelid = 'public.plantilla_tarea_herramientas'::regclass) THEN
    ALTER TABLE public.plantilla_tarea_herramientas
      ADD CONSTRAINT pt_herramienta_equipo_fk
      FOREIGN KEY (equipo_id, company_id, project_id)
      REFERENCES public.equipos_comunes(id, company_id, project_id) ON DELETE RESTRICT;
  END IF;
END;
$$;

-- El UNIQUE (plantilla_tarea_id, inventario_id) de 20260904000300 no cubre a
-- las filas nuevas (inventario_id NULL): este índice parcial es su gemelo y la
-- cláusula de conflicto del bloque.
CREATE UNIQUE INDEX IF NOT EXISTS pt_herramienta_equipo_unica
  ON public.plantilla_tarea_herramientas (plantilla_tarea_id, equipo_id)
  WHERE equipo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pt_herramientas_equipo
  ON public.plantilla_tarea_herramientas (equipo_id);

COMMENT ON TABLE public.plantilla_tarea_herramientas IS
  'Herramientas/equipo planificados por actividad (plantillas_tarea_cargo ↔ equipos_comunes). Las filas anteriores a 20261122000000 apuntan a inventario_condominio (inventario_id) y siguen vigentes; las nuevas llevan equipo_id.';
COMMENT ON COLUMN public.plantilla_tarea_herramientas.equipo_id IS
  'Equipo del catálogo operativo (equipos_comunes). Exactamente uno de equipo_id / inventario_id.';
COMMENT ON COLUMN public.plantilla_tarea_herramientas.inventario_id IS
  'LEGADO: artículo de inventario_condominio vinculado antes de 20261122000000. Las filas nuevas usan equipo_id.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Coherencia de tenant: sellar desde la plantilla, validar el recurso real
-- ────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER por el mismo motivo que plantilla_recurso_coherente
-- (20260904000300): distinguir «no existe» de «es de otro tenant» aunque la RLS
-- del recurso ajeno lo oculte al llamador.
CREATE OR REPLACE FUNCTION public.plantilla_herramienta_coherente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plantilla   record;
  v_tabla       text;
  v_recurso     uuid;
  v_rec_company uuid;
  v_rec_project uuid;
BEGIN
  SELECT company_id, project_id INTO v_plantilla
  FROM public.plantillas_tarea_cargo
  WHERE id = NEW.plantilla_tarea_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLANTILLA_RECURSO: la plantilla % no existe', NEW.plantilla_tarea_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- El tenant lo define la plantilla; lo que mande el cliente se ignora.
  NEW.company_id := v_plantilla.company_id;
  NEW.project_id := v_plantilla.project_id;

  IF NEW.equipo_id IS NOT NULL THEN
    v_tabla := 'equipos_comunes';
    v_recurso := NEW.equipo_id;
    SELECT e.company_id, e.project_id INTO v_rec_company, v_rec_project
      FROM public.equipos_comunes e WHERE e.id = NEW.equipo_id;
  ELSIF NEW.inventario_id IS NOT NULL THEN
    v_tabla := 'inventario_condominio';
    v_recurso := NEW.inventario_id;
    SELECT i.company_id, i.project_id INTO v_rec_company, v_rec_project
      FROM public.inventario_condominio i WHERE i.id = NEW.inventario_id;
  ELSE
    RAISE EXCEPTION 'PLANTILLA_RECURSO: la herramienta necesita equipo_id'
      USING ERRCODE = 'check_violation';
  END IF;

  -- company_id es NOT NULL en ambos catálogos: NULL aquí = la fila no existe.
  IF v_rec_company IS NULL THEN
    RAISE EXCEPTION 'PLANTILLA_RECURSO: %.id = % no existe', v_tabla, v_recurso
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_rec_company IS DISTINCT FROM v_plantilla.company_id
     OR v_rec_project IS DISTINCT FROM v_plantilla.project_id THEN
    RAISE EXCEPTION 'PLANTILLA_RECURSO: el recurso % de % pertenece a otra empresa o a otro proyecto que la plantilla %',
      v_recurso, v_tabla, NEW.plantilla_tarea_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Regla (e) del migrations-guard: toda SECURITY DEFINER nueva revoca PUBLIC.
-- Solo la invoca el trigger; nadie la llama directo.
REVOKE EXECUTE ON FUNCTION public.plantilla_herramienta_coherente() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pt_her_coherente ON public.plantilla_tarea_herramientas;
CREATE TRIGGER trg_pt_her_coherente
  BEFORE INSERT OR UPDATE OF plantilla_tarea_id, inventario_id, equipo_id, company_id, project_id
  ON public.plantilla_tarea_herramientas
  FOR EACH ROW EXECUTE FUNCTION public.plantilla_herramienta_coherente();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. plantillas_import_evaluar: herramientas y equipo salen de Equipos
-- ────────────────────────────────────────────────────────────────────────────
-- Cuerpo íntegro de 20261031000300 con un solo cambio: el bucle de
-- `herramientas` / `equipo` resuelve contra equipos_comunes (estado <> 'baja'),
-- exige condominios.tab.equipos y devuelve datos.recursos.equipos.
CREATE OR REPLACE FUNCTION public.plantillas_import_evaluar(p_company uuid, p_project uuid, p_fila jsonb, p_n int)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_ok_cols  constant text[] := ARRAY['titulo', 'cargo', 'servicio', 'descripcion', 'instrucciones_seguridad',
                                      'duracion_min', 'icono', 'area', 'orden', 'requiere_foto', 'requiere_comentario',
                                      'requiere_checklist', 'checklist', 'insumos', 'herramientas', 'equipo'];
  v_libres   constant text[] := ARRAY['descripcion', 'instrucciones_seguridad', 'checklist'];
  v_cargos   text[];
  v_cargo_cod text;
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
  v_eq       jsonb := '[]'::jsonb;
  v_sum_ids  uuid[] := ARRAY[]::uuid[];
  v_eq_ids   uuid[] := ARRAY[]::uuid[];
  v_col      text;
  v_cat      text;
  v_label    text;
BEGIN
  -- Cargos ACTIVOS del condominio (bajo la RLS de quien importa).
  SELECT COALESCE(array_agg(c.codigo ORDER BY c.orden, c.nombre), ARRAY[]::text[]) INTO v_cargos
    FROM public.rrhh_cargos c
   WHERE c.company_id = p_company AND c.project_id = p_project AND c.activo;

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

  -- Cargo: del catálogo ACTIVO del condominio, por código o por nombre de pantalla
  -- (se guarda el código). Servicio: del catálogo fijo; se aceptan las etiquetas.
  v_serv := translate(COALESCE(v_serv, ''), 'áéíóú', 'aeiou');
  IF v_cargo IS NOT NULL AND NOT (v_cargo = ANY (v_cargos)) THEN
    SELECT c.codigo INTO v_cargo_cod FROM public.rrhh_cargos c
     WHERE c.company_id = p_company AND c.project_id = p_project AND c.activo
       AND lower(btrim(c.nombre)) = v_cargo
     LIMIT 1;
    IF v_cargo_cod IS NOT NULL THEN v_cargo := v_cargo_cod; END IF;
  END IF;
  IF cardinality(v_cargos) = 0 THEN
    v_err := v_err || jsonb_build_object('campo', 'cargo', 'mensaje', 'Este condominio no tiene cargos activos: configúralos en Recursos Humanos → Configuración.');
  ELSIF v_cargo IS NULL THEN
    v_err := v_err || jsonb_build_object('campo', 'cargo', 'mensaje', format('El cargo es obligatorio: %s.', array_to_string(v_cargos, ', ')));
  ELSIF NOT (v_cargo = ANY (v_cargos)) THEN
    v_err := v_err || jsonb_build_object('campo', 'cargo', 'mensaje', format('Cargo inválido «%s» (o inactivo): usa %s.', v_cargo, array_to_string(v_cargos, ', ')));
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

  -- Herramientas y equipo: EQUIPOS del proyecto (equipos_comunes) que no estén de baja, por
  -- nombre; cantidad entera > 0 (vacío = 1); «!» = obligatoria. Las dos columnas resuelven
  -- contra el mismo catálogo y la categoría del equipo viaja en el resultado. Ver Equipos
  -- exige condominios.tab.equipos (RLS de equipos_comunes): sin él, mensaje claro en vez
  -- de «no existe».
  FOR v_col, v_label IN SELECT * FROM (VALUES ('herramientas', 'La herramienta'), ('equipo', 'El equipo')) t(c, l) LOOP
    v_items := public.plantillas_import_partir_recursos(p_fila->>v_col);
    IF jsonb_array_length(v_items) > 0 AND NOT COALESCE(public.user_has_permission('condominios.tab.equipos'), false) THEN
      v_err := v_err || jsonb_build_object('campo', v_col, 'mensaje', 'Para vincular herramientas o equipo por nombre necesitas permiso para ver la pestaña Equipos.');
      CONTINUE;
    END IF;
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
      SELECT count(*), (array_agg(e.id ORDER BY e.id))[1], (array_agg(e.categoria ORDER BY e.id))[1] INTO v_n, v_id, v_cat
        FROM public.equipos_comunes e
       WHERE e.company_id = p_company AND e.project_id = p_project AND e.estado <> 'baja'
         AND lower(btrim(e.nombre)) = lower(v_nombre);
      IF v_n = 0 THEN
        v_err := v_err || jsonb_build_object('campo', v_col, 'mensaje', format('%s «%s» no existe en este proyecto (o está de baja). La importación no crea equipos: regístralo en Operaciones → Equipos.', v_label, v_nombre));
      ELSIF v_n > 1 THEN
        v_err := v_err || jsonb_build_object('campo', v_col, 'mensaje', format('Hay %s equipos llamados «%s» en el proyecto: el nombre es ambiguo. Renombra uno en Equipos.', v_n, v_nombre));
      ELSIF v_id = ANY (v_eq_ids) THEN
        v_err := v_err || jsonb_build_object('campo', v_col, 'mensaje', format('«%s» se repite en la misma fila.', v_nombre));
      ELSE
        v_eq_ids := v_eq_ids || v_id;
        v_eq := v_eq || jsonb_build_object('id', v_id, 'nombre', v_nombre, 'categoria', v_cat,
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
      'recursos', jsonb_build_object('suministros', v_sum, 'equipos', v_eq),
      'n_recursos', jsonb_array_length(v_sum) + jsonb_array_length(v_eq)),
    'errores', v_err, 'advertencias', v_adv);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.plantillas_import_evaluar(uuid, uuid, jsonb, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.plantillas_import_evaluar(uuid, uuid, jsonb, int) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. plantillas_importar_aplicar: la puente nace con equipo_id
-- ────────────────────────────────────────────────────────────────────────────
-- Cuerpo íntegro de 20261031000200 con un solo cambio: los recursos de
-- `recursos.equipos` se insertan en plantilla_tarea_herramientas.equipo_id.
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
    FOR rec IN SELECT value FROM jsonb_array_elements(COALESCE(d->'recursos'->'equipos', '[]'::jsonb)) LOOP
      INSERT INTO public.plantilla_tarea_herramientas (company_id, project_id, plantilla_tarea_id, equipo_id, cantidad, obligatoria)
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

-- ────────────────────────────────────────────────────────────────────────────
-- 6. plantillas_recursos_en_bloque: p_equipos
-- ────────────────────────────────────────────────────────────────────────────
-- Cambia el nombre del último parámetro (p_inventario → p_equipos): CREATE OR
-- REPLACE no lo permite, así que se retira la firma anterior (mismos tipos) y
-- se vuelve a conceder el EXECUTE. SECURITY INVOKER como antes.
-- p_suministros: [{id, cantidad?}] · p_equipos: [{id, cantidad?, obligatoria?}]
DROP FUNCTION IF EXISTS public.plantillas_recursos_en_bloque(uuid, uuid[], text, jsonb, jsonb);
CREATE OR REPLACE FUNCTION public.plantillas_recursos_en_bloque(
  p_project_id uuid, p_plantilla_ids uuid[], p_accion text,
  p_suministros jsonb DEFAULT '[]'::jsonb, p_equipos jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_company   uuid;
  v_pl        uuid[];
  v_n_pl      int;
  v_sum       jsonb := '[]'::jsonb;
  v_eq        jsonb := '[]'::jsonb;
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
  IF p_equipos IS NOT NULL AND jsonb_typeof(p_equipos) = 'array' THEN
    FOR it IN SELECT value FROM jsonb_array_elements(p_equipos) LOOP
      BEGIN v_id := (it->>'id')::uuid; EXCEPTION WHEN OTHERS THEN v_id := NULL; END;
      v_cant := COALESCE(NULLIF(it->>'cantidad', '')::numeric, 1);
      IF v_id IS NULL OR v_cant <= 0 OR v_cant <> trunc(v_cant) THEN
        RAISE EXCEPTION 'PLANTILLAS_BLOQUE_RECURSO: cada herramienta o equipo lleva id y cantidad entera mayor que cero.' USING ERRCODE = 'check_violation';
      END IF;
      IF NOT (v_eq @> jsonb_build_array(jsonb_build_object('id', v_id))) THEN
        v_eq := v_eq || jsonb_build_object('id', v_id, 'cantidad', v_cant::int, 'obligatoria', COALESCE((it->>'obligatoria')::boolean, false));
      END IF;
    END LOOP;
  END IF;
  v_n_rec := jsonb_array_length(v_sum) + jsonb_array_length(v_eq);
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
  IF jsonb_array_length(v_eq) > 0 AND NOT COALESCE(public.user_has_permission('condominios.tab.equipos'), false) THEN
    RAISE EXCEPTION 'PLANTILLAS_BLOQUE_PERMISO: para asignar herramientas o equipo necesitas permiso para ver la pestaña Equipos.' USING ERRCODE = 'insufficient_privilege';
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
  SELECT count(*) INTO v_n FROM public.equipos_comunes e
   WHERE e.id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(v_eq) x)
     AND e.company_id = v_company AND e.project_id = p_project_id AND (p_accion = 'quitar' OR e.estado <> 'baja');
  IF v_n <> jsonb_array_length(v_eq) THEN
    RAISE EXCEPTION 'PLANTILLAS_BLOQUE_ALCANCE: % de las herramientas o equipos no existen en este proyecto (o están de baja).', jsonb_array_length(v_eq) - v_n USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('plantillas_recursos:' || p_project_id::text, 0));
  v_pares := v_n_pl * v_n_rec;

  IF p_accion = 'agregar' THEN
    INSERT INTO public.plantilla_tarea_suministros (company_id, project_id, plantilla_tarea_id, suministro_id, cantidad)
    SELECT v_company, p_project_id, pl, (x->>'id')::uuid, (x->>'cantidad')::numeric
      FROM unnest(v_pl) pl CROSS JOIN jsonb_array_elements(v_sum) x
    ON CONFLICT (plantilla_tarea_id, suministro_id) DO NOTHING;
    GET DIAGNOSTICS v_tmp = ROW_COUNT; v_agreg := v_agreg + v_tmp;
    INSERT INTO public.plantilla_tarea_herramientas (company_id, project_id, plantilla_tarea_id, equipo_id, cantidad, obligatoria)
    SELECT v_company, p_project_id, pl, (x->>'id')::uuid, (x->>'cantidad')::int, (x->>'obligatoria')::boolean
      FROM unnest(v_pl) pl CROSS JOIN jsonb_array_elements(v_eq) x
    ON CONFLICT (plantilla_tarea_id, equipo_id) WHERE equipo_id IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_tmp = ROW_COUNT; v_agreg := v_agreg + v_tmp;
  ELSE
    DELETE FROM public.plantilla_tarea_suministros
     WHERE plantilla_tarea_id = ANY (v_pl)
       AND suministro_id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(v_sum) x);
    GET DIAGNOSTICS v_tmp = ROW_COUNT; v_quit := v_quit + v_tmp;
    DELETE FROM public.plantilla_tarea_herramientas
     WHERE plantilla_tarea_id = ANY (v_pl)
       AND equipo_id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(v_eq) x);
    GET DIAGNOSTICS v_tmp = ROW_COUNT; v_quit := v_quit + v_tmp;
  END IF;

  RETURN jsonb_build_object('accion', p_accion, 'plantillas', v_n_pl, 'recursos', v_n_rec, 'pares', v_pares,
                            'agregados', v_agreg, 'ya_estaban', CASE WHEN p_accion = 'agregar' THEN v_pares - v_agreg ELSE 0 END,
                            'quitados', v_quit, 'no_estaban', CASE WHEN p_accion = 'quitar' THEN v_pares - v_quit ELSE 0 END);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.plantillas_recursos_en_bloque(uuid, uuid[], text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.plantillas_recursos_en_bloque(uuid, uuid[], text, jsonb, jsonb) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. El permiso del tab Equipos pasa a la categoría Operaciones
-- ────────────────────────────────────────────────────────────────────────────
-- 20260518000005 lo sembró como `instalaciones`; 20260703000000 derivó sus
-- acciones copiando la categoría. El editor de roles agrupa por categoría, así
-- que las claves acompañan al tab a su nueva sección.
UPDATE public.permissions
   SET category = 'operaciones'
 WHERE (key = 'condominios.tab.equipos' OR key LIKE 'condominios.tab.equipos.%')
   AND category IS DISTINCT FROM 'operaciones';

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Comentarios
-- ────────────────────────────────────────────────────────────────────────────
COMMENT ON FUNCTION public.plantilla_herramienta_coherente() IS
  'Trigger de plantilla_tarea_herramientas: sella company/project desde la plantilla y valida que el recurso (equipos_comunes por equipo_id; inventario_condominio por inventario_id en el legado) exista y sea del mismo tenant. SECURITY DEFINER para distinguir «no existe» de «ajeno».';
COMMENT ON FUNCTION public.plantillas_import_evaluar(uuid, uuid, jsonb, int) IS
  'Evalúa una fila de la carga masiva de actividades. El cargo se resuelve contra los cargos ACTIVOS del condominio (rrhh_cargos); las columnas herramientas/equipo, contra equipos_comunes (no de baja) y exigen ver la pestaña Equipos; el resultado va en datos.recursos.equipos.';
COMMENT ON FUNCTION public.plantillas_importar_aplicar(uuid) IS
  'Aplica un lote previsualizado: re-evalúa cada fila, todo o nada, inserta actividades y sus recursos (insumos por suministro_id; herramientas y equipo por equipo_id) bajo la RLS y los triggers del llamador. Idempotente: un lote aplicado devuelve su resultado; el mismo contenido no se importa dos veces mientras sus actividades sigan.';
COMMENT ON FUNCTION public.plantillas_recursos_en_bloque(uuid, uuid[], text, jsonb, jsonb) IS
  'Agrega (sin tocar pares existentes) o quita insumos (p_suministros) y herramientas/equipo (p_equipos, de equipos_comunes) a varias actividades del proyecto en una sola transacción. Exige el permiso de editar el catálogo y acceso al proyecto. Devuelve conteos.';
