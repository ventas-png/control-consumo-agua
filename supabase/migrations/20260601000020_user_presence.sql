-- ============================================================================
-- user_presence — F4.4.2: realtime presencia para anti-conflictos
-- ============================================================================
-- Tabla compacta que registra qué usuario está activo dónde, refrescada cada
-- 30s desde el cliente. Otros usuarios viendo la misma sección/proyecto la
-- consumen via Realtime para mostrar indicadores "X está editando esto".
--
-- Diseño:
--   - Una sola fila por user_id (PK). UPSERT en cada heartbeat.
--   - last_seen permite filtrar "activos en los últimos N minutos" sin DELETE.
--   - company_id replicado para RLS sin join (lectura per-tenant).
--   - section es texto libre (sin FK) porque las secciones del frontend son
--     dinámicas (191 tabs de condominios, agua sections, etc).
--   - record_id opcional: cuando el usuario está EDITANDO un row específico
--     (cuota, pago, ticket), lo registra para que otros vean "user X está
--     editando cuota Y" — base para locks colaborativos futuros.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id     uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id  uuid        REFERENCES public.projects(id) ON DELETE SET NULL,
  section     text,
  record_id   text,
  last_seen   timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_presence_company_lastseen
  ON public.user_presence(company_id, last_seen DESC);

CREATE INDEX IF NOT EXISTS idx_user_presence_project_lastseen
  ON public.user_presence(project_id, last_seen DESC)
  WHERE project_id IS NOT NULL;

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

-- SELECT: cada usuario ve la presencia de otros en su misma company.
-- super_admin ve todo (vía RLS pre-existente).
DROP POLICY IF EXISTS "user_presence_select" ON public.user_presence;
CREATE POLICY "user_presence_select" ON public.user_presence
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR company_id = get_my_company_id()
  );

-- INSERT/UPDATE: cada usuario solo escribe su propia fila (con sus claims).
DROP POLICY IF EXISTS "user_presence_upsert_self" ON public.user_presence;
CREATE POLICY "user_presence_upsert_self" ON public.user_presence
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND company_id = get_my_company_id());

COMMENT ON TABLE public.user_presence IS
  'Heartbeat por usuario (F4.4.2). Refresh cada ~30s desde el cliente; lecturas via Realtime para indicadores colaborativos.';

-- Realtime publication: que el cliente reciba INSERT/UPDATE en su company.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'user_presence'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_presence;
  END IF;
END $$;
