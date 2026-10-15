-- Fixture adicional de plantillas_importacion: lo que 20261031000200 necesita y los fixtures
-- de housekeeping (evidencias + RBAC real) no traen. Todo son COPIAS de las definiciones
-- vigentes de las migraciones indicadas (sin recortar policies ni triggers).
--
-- · `areas_condominio` (20260424000059 + policies de 20260904000100/20260910000000: lectura por empresa).
-- · `suministros_condominio` (20260420000021) con las policies VIGENTES (20260906000100: exigen
--   condominios.tab.suministros) y el ancla UNIQUE (20260904000300).
-- · `inventario_condominio` (20260420000004, lectura por empresa) y su ancla UNIQUE.
-- · `plantillas_tarea_cargo` (20260424000060 + 20260904000200: columnas, CHECKs,
--   plantilla_checklist_valido, ancla UNIQUE, policies vigentes) y el trigger del cargo en su
--   versión vigente (20260904000400).
-- · Las puentes `plantilla_tarea_suministros` / `plantilla_tarea_herramientas` (20260904000300)
--   con `plantilla_recurso_coherente`, el sello `creado_por` y sus policies.

-- ── areas_condominio ────────────────────────────────────────────────────────
CREATE TABLE public.areas_condominio (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id),
  project_id  uuid NOT NULL REFERENCES public.projects(id),
  nombre      text NOT NULL,
  descripcion text,
  icono       text NOT NULL DEFAULT '📍',
  orden       int  NOT NULL DEFAULT 0,
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE public.areas_condominio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "areas_condominio_select" ON public.areas_condominio FOR SELECT TO authenticated
  USING (public.is_super_admin() OR company_id = public.get_my_company_id());

-- ── suministros_condominio (20260420000021 + 20260906000100 + 20260904000300) ──
CREATE TABLE public.suministros_condominio (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre          text        NOT NULL,
  categoria       text        NOT NULL DEFAULT 'limpieza',
  unidad_medida   text        NOT NULL DEFAULT 'unidad',
  stock_actual    numeric(10,2) NOT NULL DEFAULT 0,
  stock_minimo    numeric(10,2) NOT NULL DEFAULT 0,
  activo          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suministros_id_tenant_uq UNIQUE (id, company_id, project_id)
);
ALTER TABLE public.suministros_condominio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "suministros_condominio_select" ON public.suministros_condominio FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.user_has_permission('condominios.tab.suministros'))));

-- ── inventario_condominio (20260420000004 + 20260904000300) ────────────────
CREATE TABLE public.inventario_condominio (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id        uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre            text        NOT NULL,
  categoria         text        NOT NULL DEFAULT 'herramienta',
  estado            text        NOT NULL DEFAULT 'disponible',
  cantidad          int         NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventario_id_tenant_uq UNIQUE (id, company_id, project_id)
);
ALTER TABLE public.inventario_condominio ENABLE ROW LEVEL SECURITY;
-- 20260518000010 (rbac_rls_condominios_phase1): ver el inventario exige condominios.tab.inventario.
CREATE POLICY "inventario_condominio_select" ON public.inventario_condominio FOR SELECT TO authenticated
  USING (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.user_has_permission('condominios.tab.inventario')));

-- ── plantillas_tarea_cargo (20260424000060 + 20260904000200 + 20260904000400) ──
CREATE TABLE public.plantillas_tarea_cargo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id),
  project_id    uuid NOT NULL REFERENCES public.projects(id),
  cargo         text NOT NULL,
  titulo        text NOT NULL,
  descripcion   text,
  icono         text NOT NULL DEFAULT '✅',
  orden         int  NOT NULL DEFAULT 0,
  area_id       uuid REFERENCES public.areas_condominio(id),
  requiere_foto boolean NOT NULL DEFAULT false,
  activo        boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  servicio                text,
  duracion_estimada_min   int,
  checklist               jsonb   NOT NULL DEFAULT '[]'::jsonb,
  instrucciones_seguridad text,
  requiere_comentario     boolean NOT NULL DEFAULT false,
  requiere_checklist      boolean NOT NULL DEFAULT false,
  CONSTRAINT plantillas_cargo_servicio_check CHECK (servicio IS NULL OR servicio IN
    ('limpieza', 'mantenimiento', 'seguridad', 'jardineria', 'administracion', 'otro')),
  CONSTRAINT plantillas_cargo_duracion_check CHECK (duracion_estimada_min IS NULL OR duracion_estimada_min > 0),
  CONSTRAINT plantillas_cargo_checklist_check CHECK (jsonb_typeof(checklist) = 'array'),
  CONSTRAINT plantillas_cargo_id_tenant_uq UNIQUE (id, company_id, project_id)
);
CREATE INDEX idx_plantillas_cargo_project ON public.plantillas_tarea_cargo(project_id);

CREATE OR REPLACE FUNCTION public.plantilla_checklist_valido(p_checklist jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_typeof(p_checklist) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_checklist) AS paso WHERE btrim(paso) <> '')
$$;
REVOKE EXECUTE ON FUNCTION public.plantilla_checklist_valido(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plantilla_checklist_valido(jsonb) TO authenticated, service_role;
ALTER TABLE public.plantillas_tarea_cargo ADD CONSTRAINT plantillas_cargo_checklist_oblig_check
  CHECK (NOT requiere_checklist OR public.plantilla_checklist_valido(checklist));

CREATE OR REPLACE FUNCTION public.plantillas_cargo_valida_cargo()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.cargo IS DISTINCT FROM OLD.cargo THEN
    IF lower(btrim(NEW.cargo)) NOT IN
       ('conserje', 'guardia', 'jardinero', 'mantenimiento', 'administrador', 'otro') THEN
      RAISE EXCEPTION 'PLANTILLAS_CARGO: cargo "%" fuera del catálogo (conserje|guardia|jardinero|mantenimiento|administrador|otro)', NEW.cargo
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_plantillas_cargo_controlado
  BEFORE INSERT OR UPDATE OF cargo ON public.plantillas_tarea_cargo
  FOR EACH ROW EXECUTE FUNCTION public.plantillas_cargo_valida_cargo();

ALTER TABLE public.plantillas_tarea_cargo ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plantillas_tarea_cargo_select" ON public.plantillas_tarea_cargo FOR SELECT TO authenticated
  USING (public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.plantillas_cargo')
             OR public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.prog_limpieza'))));
CREATE POLICY "plantillas_tarea_cargo_insert" ON public.plantillas_tarea_cargo FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin()
    OR (company_id = public.get_my_company_id() AND (SELECT public.user_has_permission('condominios.tab.plantillas_cargo'))));
CREATE POLICY "plantillas_tarea_cargo_update" ON public.plantillas_tarea_cargo FOR UPDATE TO authenticated
  USING (public.is_super_admin()
    OR (company_id = public.get_my_company_id() AND (SELECT public.user_has_permission('condominios.tab.plantillas_cargo'))))
  WITH CHECK (public.is_super_admin()
    OR (company_id = public.get_my_company_id() AND (SELECT public.user_has_permission('condominios.tab.plantillas_cargo'))));
CREATE POLICY "plantillas_tarea_cargo_delete" ON public.plantillas_tarea_cargo FOR DELETE TO authenticated
  USING (public.is_super_admin()
    OR (public.current_user_role() = ANY(ARRAY['company_owner', 'admin']) AND company_id = public.get_my_company_id()));

-- ── puentes (20260904000300) ─────────────────────────────────────────────────
CREATE TABLE public.plantilla_tarea_suministros (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id         uuid          NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  plantilla_tarea_id uuid          NOT NULL,
  suministro_id      uuid          NOT NULL,
  cantidad           numeric(10,2) NOT NULL DEFAULT 1,
  notas              text,
  creado_por         uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pt_suministro_cantidad_check CHECK (cantidad > 0),
  CONSTRAINT pt_suministro_unico UNIQUE (plantilla_tarea_id, suministro_id),
  CONSTRAINT pt_suministro_plantilla_fk FOREIGN KEY (plantilla_tarea_id, company_id, project_id)
    REFERENCES public.plantillas_tarea_cargo(id, company_id, project_id) ON DELETE CASCADE,
  CONSTRAINT pt_suministro_recurso_fk FOREIGN KEY (suministro_id, company_id, project_id)
    REFERENCES public.suministros_condominio(id, company_id, project_id) ON DELETE RESTRICT
);
CREATE TABLE public.plantilla_tarea_herramientas (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id         uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  plantilla_tarea_id uuid        NOT NULL,
  inventario_id      uuid        NOT NULL,
  cantidad           int         NOT NULL DEFAULT 1,
  obligatoria        boolean     NOT NULL DEFAULT false,
  notas              text,
  creado_por         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pt_herramienta_cantidad_check CHECK (cantidad > 0),
  CONSTRAINT pt_herramienta_unica UNIQUE (plantilla_tarea_id, inventario_id),
  CONSTRAINT pt_herramienta_plantilla_fk FOREIGN KEY (plantilla_tarea_id, company_id, project_id)
    REFERENCES public.plantillas_tarea_cargo(id, company_id, project_id) ON DELETE CASCADE,
  CONSTRAINT pt_herramienta_recurso_fk FOREIGN KEY (inventario_id, company_id, project_id)
    REFERENCES public.inventario_condominio(id, company_id, project_id) ON DELETE RESTRICT
);
CREATE INDEX idx_pt_suministros_suministro  ON public.plantilla_tarea_suministros(suministro_id);
CREATE INDEX idx_pt_suministros_project     ON public.plantilla_tarea_suministros(project_id, company_id);
CREATE INDEX idx_pt_herramientas_inventario ON public.plantilla_tarea_herramientas(inventario_id);
CREATE INDEX idx_pt_herramientas_project    ON public.plantilla_tarea_herramientas(project_id, company_id);

CREATE OR REPLACE FUNCTION public.plantilla_recurso_coherente()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tabla       text := TG_ARGV[0];
  v_col         text := TG_ARGV[1];
  v_recurso     uuid;
  v_plantilla   record;
  v_rec_company uuid;
  v_rec_project uuid;
BEGIN
  v_recurso := (to_jsonb(NEW) ->> v_col)::uuid;
  SELECT company_id, project_id INTO v_plantilla FROM public.plantillas_tarea_cargo WHERE id = NEW.plantilla_tarea_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLANTILLA_RECURSO: la plantilla % no existe', NEW.plantilla_tarea_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.company_id := v_plantilla.company_id;
  NEW.project_id := v_plantilla.project_id;
  EXECUTE format('SELECT company_id, project_id FROM public.%I WHERE id = $1', v_tabla) INTO v_rec_company, v_rec_project USING v_recurso;
  IF v_rec_company IS NULL THEN
    RAISE EXCEPTION 'PLANTILLA_RECURSO: %.% = % no existe', v_tabla, v_col, v_recurso USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_rec_company IS DISTINCT FROM v_plantilla.company_id OR v_rec_project IS DISTINCT FROM v_plantilla.project_id THEN
    RAISE EXCEPTION 'PLANTILLA_RECURSO: el recurso % de %.% pertenece a otra empresa o a otro proyecto que la plantilla %',
      v_recurso, v_tabla, v_col, NEW.plantilla_tarea_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.plantilla_recurso_coherente() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_pt_sum_coherente BEFORE INSERT OR UPDATE OF plantilla_tarea_id, suministro_id, company_id, project_id
  ON public.plantilla_tarea_suministros FOR EACH ROW EXECUTE FUNCTION public.plantilla_recurso_coherente('suministros_condominio', 'suministro_id');
CREATE TRIGGER trg_pt_her_coherente BEFORE INSERT OR UPDATE OF plantilla_tarea_id, inventario_id, company_id, project_id
  ON public.plantilla_tarea_herramientas FOR EACH ROW EXECUTE FUNCTION public.plantilla_recurso_coherente('inventario_condominio', 'inventario_id');
CREATE TRIGGER trg_sellar_creado_por BEFORE INSERT OR UPDATE ON public.plantilla_tarea_suministros
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');
CREATE TRIGGER trg_sellar_creado_por BEFORE INSERT OR UPDATE ON public.plantilla_tarea_herramientas
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

ALTER TABLE public.plantilla_tarea_suministros  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plantilla_tarea_herramientas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plantilla_tarea_suministros, public.plantilla_tarea_herramientas FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plantilla_tarea_suministros, public.plantilla_tarea_herramientas TO authenticated;
GRANT ALL ON public.plantilla_tarea_suministros, public.plantilla_tarea_herramientas TO service_role;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['plantilla_tarea_suministros', 'plantilla_tarea_herramientas'] LOOP
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_super_admin()
      OR (company_id = public.get_my_company_id() AND (SELECT public.user_has_permission('condominios.tab.plantillas_cargo')
          OR public.user_has_permission('condominios.tab.tareas_personal') OR public.user_has_permission('condominios.tab.prog_limpieza'))))$p$, t || '_select', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_super_admin()
      OR (company_id = public.get_my_company_id() AND (SELECT public.user_has_permission('condominios.tab.plantillas_cargo'))))$p$, t || '_insert', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_super_admin()
      OR (company_id = public.get_my_company_id() AND (SELECT public.user_has_permission('condominios.tab.plantillas_cargo'))))
      WITH CHECK (public.is_super_admin() OR (company_id = public.get_my_company_id() AND (SELECT public.user_has_permission('condominios.tab.plantillas_cargo'))))$p$, t || '_update', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_super_admin()
      OR (company_id = public.get_my_company_id() AND (SELECT public.user_has_permission('condominios.tab.plantillas_cargo'))))$p$, t || '_delete', t);
  END LOOP;
END $$;
