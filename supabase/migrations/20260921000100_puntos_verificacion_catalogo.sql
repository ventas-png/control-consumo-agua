-- ════════════════════════════════════════════════════════════════════════════
-- Catálogo de puntos de verificación de ronda
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL PROBLEMA
-- Hasta hoy un punto de control SOLO existía dentro de una ruta: la fila de
-- `puntos_control_ruta` es (ruta, área, orden, instrucciones). Eso tiene tres
-- consecuencias que se pagan en el uso diario:
--
--   1. NO HAY CATÁLOGO. El área es lo único reutilizable, y un área no es un
--      punto: "Estacionamiento B2" tiene la puerta peatonal, la rampa y el
--      tablero de tableros eléctricos. Quien arma la ruta escribe a mano las
--      instrucciones de cada uno, cada vez.
--   2. NO SE CARGA MASIVAMENTE. Armar la ronda nocturna de un condominio de 60
--      áreas es abrir el formulario 60 veces, una por punto.
--   3. NO SE PUEDE REUSAR. La ronda diurna y la nocturna pasan por los mismos
--      sitios con las mismas instrucciones, y no hay forma de decirlo: se
--      vuelven a escribir, y a la tercera ya no coinciden entre rutas.
--
-- LO QUE HACE ESTA MIGRACIÓN
--   1. `puntos_verificacion`: el catálogo. Una fila por sitio verificable del
--      condominio, colgada del área (`areas_condominio`, el catálogo que ya
--      comparten rondas, limpieza y tareas). Se da de alta una vez, con sus
--      instrucciones y su tiempo, y se ASIGNA a las rutas que lo recorran.
--   2. `puntos_control_ruta.punto_id`: la asignación. La ruta deja de describir
--      el punto y pasa a referenciarlo. `area_id` se queda —NOT NULL, como
--      estaba— porque es el único filtro de proyecto que tiene esta tabla (no
--      tiene project_id ni company_id propios; ver PR-27 y sectionData.ts), y
--      una FK COMPUESTA (punto_id, area_id) → puntos_verificacion (id, area_id)
--      impide que se separe del área de su punto.
--   3. `requiere_foto`: si el paso por ese punto se documenta con imagen. Vive
--      en el catálogo (el valor por defecto del sitio) y se puede SOBREESCRIBIR
--      por ruta (`puntos_control_ruta.requiere_foto`, NULL = hereda): la ronda
--      nocturna puede exigir foto donde la diurna no la pide, y una ruta de paso
--      rápido puede no pedirla donde el catálogo sí.
--   4. `visitas_control.foto_urls`: dónde queda esa evidencia, y un trigger que
--      no deja cerrar un punto que la exige sin ella. La UI también lo valida;
--      la BD es la que manda.
--
-- LO QUE NO HACE
--   · No migra nada. Los puntos de ruta existentes se quedan como están, con
--     `punto_id` NULL: siguen siendo (área + instrucciones sueltas) y la UI los
--     muestra igual. Convertirlos adivinando un nombre de punto sería inventar
--     catálogo; quien quiera normalizarlos los da de alta y reasigna.
--   · No toca `areas_condominio` ni ninguna de sus FKs.
--
-- IDEMPOTENTE: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- constraints dentro de DO $$ con guardia por conname, DROP POLICY/TRIGGER
-- IF EXISTS antes de cada CREATE.
--
-- REVERSA:
--   DROP TRIGGER trg_visitas_control_evidencia ON public.visitas_control;
--   DROP TRIGGER trg_puntos_control_ruta_tenant ON public.puntos_control_ruta;
--   DROP FUNCTION public.visitas_control_exige_evidencia();
--   DROP FUNCTION public.puntos_control_ruta_valida_tenant();
--   DROP FUNCTION public.punto_ruta_requiere_foto(uuid);
--   ALTER TABLE public.visitas_control     DROP COLUMN foto_urls;
--   ALTER TABLE public.puntos_control_ruta DROP COLUMN punto_id, DROP COLUMN requiere_foto;
--   DROP TABLE public.puntos_verificacion;
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. El catálogo
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.puntos_verificacion (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id          uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  -- RESTRICT y no CASCADE: borrar un área no debe llevarse en silencio los
  -- puntos que alguna ruta ya recorre. `areas_condominio` se desactiva, no se
  -- borra, justamente por esto (ver AreasCatalog.handleDelete).
  area_id             uuid        NOT NULL REFERENCES public.areas_condominio(id) ON DELETE RESTRICT,
  nombre              text        NOT NULL,
  instrucciones       text,
  tiempo_estimado_min int,
  requiere_foto       boolean     NOT NULL DEFAULT false,
  orden               int         NOT NULL DEFAULT 0,
  activo              boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT puntos_verif_nombre_check
    CHECK (btrim(nombre) <> ''),
  CONSTRAINT puntos_verif_tiempo_check
    CHECK (tiempo_estimado_min IS NULL OR tiempo_estimado_min > 0),
  -- Ancla de la FK compuesta de puntos_control_ruta (ver bloque 3): con ella,
  -- mover un punto ya asignado a otra área es imposible a nivel de motor.
  CONSTRAINT puntos_verif_id_area_uq UNIQUE (id, area_id)
);

COMMENT ON TABLE public.puntos_verificacion IS
  'Catálogo de puntos de verificación (zonas de control) del condominio, colgados del área. Se dan de alta una vez y se asignan a las rutas de ronda que los recorran.';
COMMENT ON COLUMN public.puntos_verificacion.area_id IS
  'Área del catálogo compartido a la que pertenece el punto. Un área agrupa varios puntos: "Estacionamiento B2" → puerta peatonal, rampa, tablero eléctrico.';
COMMENT ON COLUMN public.puntos_verificacion.requiere_foto IS
  'Valor por defecto: si es true, pasar por este punto se documenta con imagen. Cada ruta puede sobreescribirlo con puntos_control_ruta.requiere_foto.';
COMMENT ON COLUMN public.puntos_verificacion.activo IS
  'false = retirado del catálogo. No se borra: las rutas y las rondas históricas lo siguen mostrando.';

-- Un punto por nombre normalizado dentro del área. Es el guard de la CARGA
-- MASIVA: pegar la misma lista dos veces no fabrica 40 duplicados. Reutiliza el
-- normalizador de áreas (20260904000100) — mismas reglas, mismo criterio.
CREATE UNIQUE INDEX IF NOT EXISTS uq_puntos_verif_nombre_normalizado
  ON public.puntos_verificacion (area_id, public.areas_normalizar_nombre(nombre));

CREATE INDEX IF NOT EXISTS idx_puntos_verif_proyecto
  ON public.puntos_verificacion (project_id, area_id, orden);

-- Trazabilidad: misma columna, mismo trigger y mismo modo que las 88 tablas de
-- 20260731000000. Se declara aquí porque aquella migración ya corrió.
ALTER TABLE public.puntos_verificacion
  ADD COLUMN IF NOT EXISTS creado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.puntos_verificacion.creado_por IS
  'Usuario que creó la fila. Lo sella la BD (trg_sellar_creado_por) y es inmutable. NULL = escritura de sistema.';

DROP TRIGGER IF EXISTS trg_sellar_creado_por ON public.puntos_verificacion;
CREATE TRIGGER trg_sellar_creado_por
  BEFORE INSERT OR UPDATE ON public.puntos_verificacion
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

-- ────────────────────────────────────────────────────────────────────────────
-- 2. RLS del catálogo
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.puntos_verificacion ENABLE ROW LEVEL SECURITY;

-- SELECT: quien administra las rutas Y quien las ejecuta. El guardia trabaja en
-- el tab Seguridad y necesita leer `requiere_foto` para saber si el punto que
-- está cerrando pide evidencia; sin esta segunda clave vería la exigencia solo
-- cuando el trigger le rechaza el cierre.
DROP POLICY IF EXISTS "puntos_verificacion_select" ON public.puntos_verificacion;
CREATE POLICY "puntos_verificacion_select" ON public.puntos_verificacion
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.rutas_ronda')
             OR public.user_has_permission('condominios.tab.seguridad')))
  );

-- Escritura: solo quien administra el recorrido. Definir qué se vigila no es
-- parte de ejecutar la ronda.
DROP POLICY IF EXISTS "puntos_verificacion_insert" ON public.puntos_verificacion;
CREATE POLICY "puntos_verificacion_insert" ON public.puntos_verificacion
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.rutas_ronda')))
  );

DROP POLICY IF EXISTS "puntos_verificacion_update" ON public.puntos_verificacion;
CREATE POLICY "puntos_verificacion_update" ON public.puntos_verificacion
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.rutas_ronda')))
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.rutas_ronda')))
  );

DROP POLICY IF EXISTS "puntos_verificacion_delete" ON public.puntos_verificacion;
CREATE POLICY "puntos_verificacion_delete" ON public.puntos_verificacion
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR ((SELECT public.current_user_role()) = ANY(ARRAY['company_owner', 'admin'])
        AND company_id = (SELECT public.get_my_company_id()))
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 3. La asignación: puntos_control_ruta → catálogo
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.puntos_control_ruta
  -- NULL = fila legada: describe el punto por área e instrucciones sueltas, de
  -- antes de que existiera el catálogo. No se convierten (ver cabecera).
  ADD COLUMN IF NOT EXISTS punto_id      uuid,
  -- NULL = hereda el del catálogo. Solo se guarda cuando esta ruta lo APRIETA.
  ADD COLUMN IF NOT EXISTS requiere_foto boolean;

COMMENT ON COLUMN public.puntos_control_ruta.punto_id IS
  'Punto del catálogo (puntos_verificacion) que esta parada de la ruta recorre. NULL = fila legada, anterior al catálogo.';
COMMENT ON COLUMN public.puntos_control_ruta.requiere_foto IS
  'Override por ruta de puntos_verificacion.requiere_foto. NULL = hereda el del catálogo (o false si no hay punto).';

-- FK COMPUESTA, no simple: ata la parada al punto Y al área del punto a la vez.
-- MATCH SIMPLE (el default) no la exige cuando punto_id es NULL, que es
-- exactamente lo que necesitan las filas legadas.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'puntos_control_ruta_punto_fkey') THEN
    ALTER TABLE public.puntos_control_ruta
      ADD CONSTRAINT puntos_control_ruta_punto_fkey
      FOREIGN KEY (punto_id, area_id)
      REFERENCES public.puntos_verificacion (id, area_id)
      ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_puntos_control_ruta_punto
  ON public.puntos_control_ruta (punto_id)
  WHERE punto_id IS NOT NULL;

-- ── 3b. Guard de tenant en las paradas nuevas ──────────────────────────────
-- `puntos_control_ruta` no tiene project_id: el proyecto sale del área, y el de
-- la ruta sale de `rutas_ronda`. Nada impedía —antes de esto— colgar de una ruta
-- un área de OTRO proyecto de la misma empresa: la parada quedaba invisible en
-- su ruta (sectionData filtra por el proyecto del área) y visible en la ajena.
--
-- Solo INSERT y UPDATE DE LAS COLUMNAS QUE IMPORTAN, con guardia de cambio
-- real: reordenar (`SET orden = …`) o editar instrucciones no puede tropezar
-- con esto, y una fila legada que ya viole la regla se sigue pudiendo mover y
-- borrar. Mismo criterio que el trigger de cargo de 20260904000200.
CREATE OR REPLACE FUNCTION public.puntos_control_ruta_valida_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_proyecto_ruta  uuid;
  v_proyecto_area  uuid;
  v_proyecto_punto uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.ruta_id  IS NOT DISTINCT FROM OLD.ruta_id
     AND NEW.area_id  IS NOT DISTINCT FROM OLD.area_id
     AND NEW.punto_id IS NOT DISTINCT FROM OLD.punto_id THEN
    RETURN NEW;
  END IF;

  SELECT r.project_id INTO v_proyecto_ruta
  FROM public.rutas_ronda r WHERE r.id = NEW.ruta_id;

  SELECT a.project_id INTO v_proyecto_area
  FROM public.areas_condominio a WHERE a.id = NEW.area_id;

  IF v_proyecto_ruta IS DISTINCT FROM v_proyecto_area THEN
    RAISE EXCEPTION
      'PUNTOS_CONTROL_RUTA: el área % es del proyecto % y la ruta % es del proyecto %',
      NEW.area_id, v_proyecto_area, NEW.ruta_id, v_proyecto_ruta
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.punto_id IS NOT NULL THEN
    SELECT p.project_id INTO v_proyecto_punto
    FROM public.puntos_verificacion p WHERE p.id = NEW.punto_id;

    IF v_proyecto_punto IS DISTINCT FROM v_proyecto_ruta THEN
      RAISE EXCEPTION
        'PUNTOS_CONTROL_RUTA: el punto % es del proyecto % y la ruta % es del proyecto %',
        NEW.punto_id, v_proyecto_punto, NEW.ruta_id, v_proyecto_ruta
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.puntos_control_ruta_valida_tenant() IS
  'Trigger: una parada de ruta no puede mezclar proyectos (ruta, área y punto del catálogo deben coincidir). Solo valida cuando ruta_id/area_id/punto_id cambian.';

DROP TRIGGER IF EXISTS trg_puntos_control_ruta_tenant ON public.puntos_control_ruta;
CREATE TRIGGER trg_puntos_control_ruta_tenant
  BEFORE INSERT OR UPDATE OF ruta_id, area_id, punto_id ON public.puntos_control_ruta
  FOR EACH ROW EXECUTE FUNCTION public.puntos_control_ruta_valida_tenant();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. La evidencia: visitas_control.foto_urls
-- ────────────────────────────────────────────────────────────────────────────
-- jsonb y no text[], como ejecuciones_limpieza.foto_urls y
-- tareas_bloque.foto_urls: misma forma en las tres tablas de evidencia.
ALTER TABLE public.visitas_control
  ADD COLUMN IF NOT EXISTS foto_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.visitas_control.foto_urls IS
  'Evidencia del paso por el punto: array JSON de paths de `condominios-media` (se firman al render). [] = sin fotos.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visitas_control_foto_urls_check') THEN
    ALTER TABLE public.visitas_control
      ADD CONSTRAINT visitas_control_foto_urls_check
      CHECK (jsonb_typeof(foto_urls) = 'array');
  END IF;
END;
$$;

-- Exigencia efectiva del punto: el override de la ruta si lo hay, si no el del
-- catálogo, si no false. Un CHECK no puede mirar otras tablas; de ahí la
-- función + trigger.
CREATE OR REPLACE FUNCTION public.punto_ruta_requiere_foto(p_punto_ruta_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(pcr.requiere_foto, pv.requiere_foto, false)
  FROM public.puntos_control_ruta pcr
  LEFT JOIN public.puntos_verificacion pv ON pv.id = pcr.punto_id
  WHERE pcr.id = p_punto_ruta_id
$$;

REVOKE EXECUTE ON FUNCTION public.punto_ruta_requiere_foto(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.punto_ruta_requiere_foto(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.punto_ruta_requiere_foto(uuid) IS
  'true si esa parada de ruta exige evidencia fotográfica: override de la ruta, si no el del catálogo, si no false.';

-- Cerrar un punto es AFIRMAR que se pasó por ahí. Donde el punto exige imagen,
-- esa afirmación no se acepta sin ella.
--
-- 'omitido' queda fuera a propósito: es justamente el estado de NO haber pasado,
-- y exigirle foto lo volvería inalcanzable. 'pendiente' tampoco, por lo mismo.
CREATE OR REPLACE FUNCTION public.visitas_control_exige_evidencia()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.estado NOT IN ('ok', 'novedad') THEN
    RETURN NEW;
  END IF;

  IF jsonb_array_length(COALESCE(NEW.foto_urls, '[]'::jsonb)) > 0 THEN
    RETURN NEW;
  END IF;

  IF public.punto_ruta_requiere_foto(NEW.punto_id) THEN
    RAISE EXCEPTION
      'VISITAS_CONTROL: el punto % exige evidencia fotográfica para cerrarse como "%"',
      NEW.punto_id, NEW.estado
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.visitas_control_exige_evidencia() IS
  'Trigger: no deja marcar ok/novedad un punto que exige foto sin al menos una. omitido y pendiente quedan fuera: son el estado de no haber pasado.';

DROP TRIGGER IF EXISTS trg_visitas_control_evidencia ON public.visitas_control;
CREATE TRIGGER trg_visitas_control_evidencia
  BEFORE INSERT OR UPDATE OF estado, foto_urls ON public.visitas_control
  FOR EACH ROW EXECUTE FUNCTION public.visitas_control_exige_evidencia();
