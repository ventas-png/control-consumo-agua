-- Fixture adicional de str_importacion: lo que 20261031000100 necesita y los fixtures de
-- housekeeping (evidencias + RBAC real) no traen.
--
-- · `app_users.cliente_id` y `get_my_cliente_id()` (20260330000001), `solicitud_renta_unidad`
--   mínima: la RLS VIGENTE de `reservas_str` (20260519000003) los usa en su rama de cliente.
-- · `unidades` (20260324000003, columnas mínimas) con lectura por empresa.
-- · `reservas_str` (20260420000007 + 20260514000001 + 20260522000007) con sus policies
--   VIGENTES copiadas y el sello `creado_por` (20260731000000: trg_sellar_creado_por).

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS cliente_id uuid;
CREATE OR REPLACE FUNCTION public.get_my_cliente_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT cliente_id FROM public.app_users WHERE id = auth.uid() LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION public.get_my_cliente_id() TO authenticated, service_role;

CREATE TABLE public.solicitud_renta_unidad (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL, cliente_id uuid, unidad_id uuid, estado text, tipo_renta text, tipo_aprobado text);
ALTER TABLE public.solicitud_renta_unidad ENABLE ROW LEVEL SECURITY;

-- ── unidades ────────────────────────────────────────────────────────────────
CREATE TABLE public.unidades (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nombre     text NOT NULL,
  tipo       text NOT NULL DEFAULT 'otro',
  activo     boolean NOT NULL DEFAULT true
);
ALTER TABLE public.unidades ENABLE ROW LEVEL SECURITY;
CREATE POLICY unidades_select ON public.unidades FOR SELECT TO authenticated
  USING (is_super_admin() OR company_id = get_my_company_id());

-- ── reservas_str ────────────────────────────────────────────────────────────
CREATE TABLE public.reservas_str (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id            uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id             uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  huesped_nombre        text        NOT NULL,
  huesped_email         text,
  huesped_telefono      text,
  fecha_entrada         date        NOT NULL,
  fecha_salida          date        NOT NULL,
  num_adultos           int         NOT NULL DEFAULT 1,
  num_ninos             int         NOT NULL DEFAULT 0,
  num_bebes             int         NOT NULL DEFAULT 0,
  plataforma            text        NOT NULL DEFAULT 'directo',
  monto_noche           numeric(10,2),
  monto_total           numeric(12,2),
  estado                text        NOT NULL DEFAULT 'confirmada',
  notas                 text,
  codigo_confirmacion   text,
  fecha_reservacion     date,
  hora_llegada_estimada time,
  hora_salida_estimada  time,
  politica_cancelacion  text,
  mascotas              boolean     NOT NULL DEFAULT false,
  foto_url              text,
  foto_documento_url    text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  creado_por            uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.reservas_str ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_sellar_creado_por BEFORE INSERT OR UPDATE ON public.reservas_str
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

-- Policies VIGENTES (20260519000003_perf_rls_consolidate_policies.sql:404-460).
CREATE POLICY "reservas_str_select" ON public.reservas_str FOR SELECT TO authenticated USING (
  is_super_admin()
  OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.str'))
  OR (current_user_role() = 'cliente' AND EXISTS (
        SELECT 1 FROM solicitud_renta_unidad s
        WHERE s.cliente_id = get_my_cliente_id() AND s.unidad_id = reservas_str.unidad_id
          AND s.company_id = reservas_str.company_id AND s.estado = 'aprobada'
          AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('str', 'ambas'))));
CREATE POLICY "reservas_str_insert" ON public.reservas_str FOR INSERT TO authenticated WITH CHECK (
  is_super_admin()
  OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.str'))
  OR (current_user_role() = 'cliente' AND EXISTS (
        SELECT 1 FROM solicitud_renta_unidad s
        WHERE s.cliente_id = get_my_cliente_id() AND s.unidad_id = reservas_str.unidad_id
          AND s.company_id = reservas_str.company_id AND s.estado = 'aprobada'
          AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('str', 'ambas'))));
CREATE POLICY "reservas_str_update" ON public.reservas_str FOR UPDATE TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.str')))
  WITH CHECK (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.str')));
CREATE POLICY "reservas_str_delete" ON public.reservas_str FOR DELETE TO authenticated USING (
  is_super_admin() OR (current_user_role() = ANY (ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
