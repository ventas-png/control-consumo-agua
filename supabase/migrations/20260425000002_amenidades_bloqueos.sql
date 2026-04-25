-- Bloqueos de amenidades por mantenimiento u otros motivos
-- Una amenidad puede tener uno o varios rangos de fecha (con horario opcional)
-- en los que NO se aceptan reservas.

CREATE TABLE IF NOT EXISTS public.amenidades_bloqueos (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id)  ON DELETE CASCADE,
  project_id    uuid        NOT NULL REFERENCES public.projects(id)   ON DELETE CASCADE,
  amenidad_id   uuid        NOT NULL REFERENCES public.amenidades(id) ON DELETE CASCADE,
  fecha_inicio  date        NOT NULL,
  fecha_fin     date        NOT NULL,
  hora_inicio   time,                 -- NULL = día completo
  hora_fin      time,                 -- NULL = día completo
  motivo        text        NOT NULL DEFAULT 'mantenimiento',
  -- motivo: 'mantenimiento' | 'limpieza' | 'evento_privado' | 'reparacion' | 'otro'
  notas         text,
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amenidades_bloqueos_fechas_chk CHECK (fecha_fin >= fecha_inicio),
  CONSTRAINT amenidades_bloqueos_horas_chk  CHECK (
    (hora_inicio IS NULL AND hora_fin IS NULL)
    OR (hora_inicio IS NOT NULL AND hora_fin IS NOT NULL AND hora_fin > hora_inicio)
  )
);

ALTER TABLE public.amenidades_bloqueos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "amenidades_bloqueos_select" ON public.amenidades_bloqueos
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "amenidades_bloqueos_insert" ON public.amenidades_bloqueos
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE POLICY "amenidades_bloqueos_update" ON public.amenidades_bloqueos
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  )
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE POLICY "amenidades_bloqueos_delete" ON public.amenidades_bloqueos
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE INDEX IF NOT EXISTS idx_amenidades_bloqueos_amenidad ON public.amenidades_bloqueos(amenidad_id);
CREATE INDEX IF NOT EXISTS idx_amenidades_bloqueos_rango    ON public.amenidades_bloqueos(fecha_inicio, fecha_fin);
