-- Fixture adicional de equipos_herramientas: lo que 20261122000000 necesita y los fixtures
-- de housekeeping (evidencias + RBAC real), plantillas_importacion y rrhh_catalogos no
-- traen. COPIA de la definición vigente ANTES de la migración bajo prueba.
--
-- · `equipos_comunes` (20260420000020) con la policy de lectura VIGENTE
--   (20260518000010: ver el catálogo exige condominios.tab.equipos) y escritura por
--   acción del tab (20261104000300, resumida: la prueba escribe como admin o por RPC).
--   SIN `cantidad`, SIN `foto_url` y SIN el ancla UNIQUE: los agrega la migración.

CREATE TABLE public.equipos_comunes (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id            uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre                text        NOT NULL,
  categoria             text        NOT NULL DEFAULT 'otro',
  marca                 text,
  modelo                text,
  serial                text,
  ubicacion             text,
  fecha_compra          date,
  valor_compra          numeric(12,2),
  vida_util_anios       int,
  estado                text        NOT NULL DEFAULT 'operativo',
  ultimo_mantenimiento  date,
  proximo_mantenimiento date,
  notas                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_equipos_comunes_project ON public.equipos_comunes(project_id);
ALTER TABLE public.equipos_comunes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.equipos_comunes TO authenticated;
GRANT ALL ON public.equipos_comunes TO service_role;
CREATE POLICY "equipos_comunes_select" ON public.equipos_comunes FOR SELECT TO authenticated
  USING (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.user_has_permission('condominios.tab.equipos')));
CREATE POLICY "equipos_comunes_insert" ON public.equipos_comunes FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.user_has_permission('condominios.tab.equipos.create')));
CREATE POLICY "equipos_comunes_update" ON public.equipos_comunes FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.user_has_permission('condominios.tab.equipos.edit')))
  WITH CHECK (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.user_has_permission('condominios.tab.equipos.edit')));
