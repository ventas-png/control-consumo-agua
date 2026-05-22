-- ============================================================
-- Ocurrencias de rutas (una fila por cada fecha programada)
-- ============================================================
-- Cada repetición de una ruta periódica se registra por separado para tener
-- historial (cuáles se completaron, cuáles se vencieron) y para controlar el
-- envío de recordatorios sin duplicados (recordatorio_enviado).

CREATE TABLE IF NOT EXISTS public.ruta_ocurrencias (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ruta_id     uuid NOT NULL REFERENCES public.rutas(id) ON DELETE CASCADE,
  company_id  uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id  uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  fecha       date NOT NULL,
  hora        time,
  estado      text NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','completada','vencida','omitida')),
  completada_at           timestamptz,
  recordatorio_enviado    boolean NOT NULL DEFAULT false,
  recordatorio_enviado_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ruta_id, fecha)   -- ancla de idempotencia para el generador
);

-- Rellenar company_id / project_id desde la ruta padre si vienen nulos.
CREATE OR REPLACE FUNCTION public.set_ruta_ocurrencia_scope()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.company_id IS NULL OR NEW.project_id IS NULL THEN
    SELECT COALESCE(NEW.company_id, r.company_id),
           COALESCE(NEW.project_id, r.project_id)
      INTO NEW.company_id, NEW.project_id
      FROM public.rutas r WHERE r.id = NEW.ruta_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ruta_ocurrencia_scope ON public.ruta_ocurrencias;
CREATE TRIGGER trg_ruta_ocurrencia_scope
  BEFORE INSERT ON public.ruta_ocurrencias
  FOR EACH ROW EXECUTE FUNCTION public.set_ruta_ocurrencia_scope();

ALTER TABLE public.ruta_ocurrencias ENABLE ROW LEVEL SECURITY;

-- SELECT: misma lógica que rutas_select, evaluada contra la ruta padre.
DROP POLICY IF EXISTS "ruta_ocu_select" ON public.ruta_ocurrencias;
CREATE POLICY "ruta_ocu_select" ON public.ruta_ocurrencias
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.rutas r
      WHERE r.id = ruta_id
        AND (
          r.asignado_a = (SELECT auth.uid())
          OR (
            r.company_id = (SELECT get_my_company_id())
            AND (SELECT public.user_has_permission('agua.rutas.view'))
            AND (
              current_user_role() = ANY (ARRAY['company_owner','admin'])
              OR r.project_id IS NULL
              OR public.user_has_project_access(r.project_id)
            )
          )
        )
    )
  );

-- INSERT/UPDATE a nivel empresa: permite que el operador asignado (que está en la
-- empresa) marque su ocurrencia como completada al ejecutar la ruta, igual que ya
-- podía marcar rutas.completada. El generador y el edge function corren como
-- service role y omiten RLS.
DROP POLICY IF EXISTS "ruta_ocu_insert" ON public.ruta_ocurrencias;
CREATE POLICY "ruta_ocu_insert" ON public.ruta_ocurrencias
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR company_id = (SELECT get_my_company_id()));

DROP POLICY IF EXISTS "ruta_ocu_update" ON public.ruta_ocurrencias;
CREATE POLICY "ruta_ocu_update" ON public.ruta_ocurrencias
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR company_id = (SELECT get_my_company_id()))
  WITH CHECK (is_super_admin() OR company_id = (SELECT get_my_company_id()));

-- DELETE solo admin/owner (normalmente baja por cascade al borrar la ruta).
DROP POLICY IF EXISTS "ruta_ocu_delete" ON public.ruta_ocurrencias;
CREATE POLICY "ruta_ocu_delete" ON public.ruta_ocurrencias
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (company_id = (SELECT get_my_company_id())
        AND current_user_role() = ANY (ARRAY['company_owner','admin']))
  );

-- Índices: escaneo "due & unsent" del job, y joins por ruta/empresa.
CREATE INDEX IF NOT EXISTS idx_ruta_ocu_due
  ON public.ruta_ocurrencias(fecha)
  WHERE recordatorio_enviado = false AND estado = 'pendiente';
CREATE INDEX IF NOT EXISTS idx_ruta_ocu_ruta ON public.ruta_ocurrencias(ruta_id);
CREATE INDEX IF NOT EXISTS idx_ruta_ocu_company ON public.ruta_ocurrencias(company_id);
