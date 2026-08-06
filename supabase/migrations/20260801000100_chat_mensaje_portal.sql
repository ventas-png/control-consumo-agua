-- Conversación con fotos en los mensajes del residente a la administración.
--
-- Espeja lo que 20260801000000 hizo con los tickets, sobre `mensajes_portal`:
-- el residente escribe desde "Mi Unidad" y hoy solo existe UN ida y vuelta —
-- `mensajes_portal.respuesta` (texto único) que la administración llena una vez.
-- No hay hilo ni adjuntos.
--
--   1. `mensajes_portal.foto_urls` — el mensaje inicial admite fotos (paths bare
--      de `condominios-media`, firmados al render por SecureImage). Storage no
--      cambia: el residente ya puede escribir bajo `${project_id}/…` de sus
--      unidades (20260603220000).
--   2. `comentarios_mensaje_portal` — el hilo. Misma forma que
--      `comentarios_ticket` (autor, contenido, fotos, nota interna, creado_por
--      sellado por la BD) para que la UI de conversación sea la misma.
--
-- MODELO DE ACCESO — se hereda del mensaje padre, que ya define quién es quién:
--   * staff     → mensaje de SU company (misma rama que `mensajes_portal_select`).
--                 Ve todo el hilo, incluidas las notas internas.
--   * residente → mensaje de SUS unidades (`mis_unidades_ids()`), y solo los
--                 mensajes NO internos.
-- `get_my_company_id()` es NULL en un residente, así que la rama staff nunca le
-- aplica; y la rama de residente exige `es_interno = false` en ambos comandos.
--
-- `respuesta`/`respondido_en` NO se tocan: las respuestas históricas se siguen
-- mostrando. Las nuevas van al hilo.
--
-- IDEMPOTENTE: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
--   DROP POLICY IF EXISTS + CREATE.
-- REVERSA: DROP TABLE public.comentarios_mensaje_portal;
--   ALTER TABLE public.mensajes_portal DROP COLUMN foto_urls;

-- ── 1. Fotos en el mensaje inicial ──────────────────────────────────────────
ALTER TABLE public.mensajes_portal
  ADD COLUMN IF NOT EXISTS foto_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.mensajes_portal.foto_urls IS
  'Paths (bare) de `condominios-media` adjuntos al mensaje. Se firman al render.';

-- ── 2. Hilo de conversación ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comentarios_mensaje_portal (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  mensaje_id   uuid        NOT NULL REFERENCES public.mensajes_portal(id) ON DELETE CASCADE,
  autor_nombre text        NOT NULL,
  contenido    text        NOT NULL DEFAULT '',
  foto_urls    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  es_interno   boolean     NOT NULL DEFAULT false,
  creado_por   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.comentarios_mensaje_portal.es_interno IS
  'true = nota interna del equipo; el residente no la ve (RLS + UI).';
COMMENT ON COLUMN public.comentarios_mensaje_portal.creado_por IS
  'Usuario que creó la fila. Lo sella la BD (trg_sellar_creado_por) y es inmutable. NULL = escritura de sistema.';

-- Mismo sellado de trazabilidad que el resto de tablas (20260731000000).
DROP TRIGGER IF EXISTS trg_sellar_creado_por ON public.comentarios_mensaje_portal;
CREATE TRIGGER trg_sellar_creado_por
  BEFORE INSERT OR UPDATE ON public.comentarios_mensaje_portal
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

CREATE INDEX IF NOT EXISTS idx_coment_msg_portal_hilo
  ON public.comentarios_mensaje_portal(mensaje_id, created_at);

ALTER TABLE public.comentarios_mensaje_portal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comentarios_mensaje_portal_select" ON public.comentarios_mensaje_portal;
CREATE POLICY "comentarios_mensaje_portal_select" ON public.comentarios_mensaje_portal
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    -- Staff de la company dueña del mensaje: hilo completo.
    OR EXISTS (
      SELECT 1 FROM public.mensajes_portal m
      WHERE m.id = comentarios_mensaje_portal.mensaje_id
        AND m.company_id = public.get_my_company_id()
    )
    -- Residente: mensajes NO internos de los hilos de SUS unidades.
    OR (
      es_interno = false
      AND EXISTS (
        SELECT 1 FROM public.mensajes_portal m
        WHERE m.id = comentarios_mensaje_portal.mensaje_id
          AND m.unidad_id IN (SELECT public.mis_unidades_ids())
      )
    )
  );

DROP POLICY IF EXISTS "comentarios_mensaje_portal_insert" ON public.comentarios_mensaje_portal;
CREATE POLICY "comentarios_mensaje_portal_insert" ON public.comentarios_mensaje_portal
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.mensajes_portal m
      WHERE m.id = comentarios_mensaje_portal.mensaje_id
        AND m.company_id = public.get_my_company_id()
        AND m.company_id = comentarios_mensaje_portal.company_id
    )
    -- El residente no elige el company_id (va el del mensaje) ni escribe notas
    -- internas.
    OR (
      es_interno = false
      AND EXISTS (
        SELECT 1 FROM public.mensajes_portal m
        WHERE m.id = comentarios_mensaje_portal.mensaje_id
          AND m.company_id = comentarios_mensaje_portal.company_id
          AND m.unidad_id IN (SELECT public.mis_unidades_ids())
      )
    )
  );

-- Sin UPDATE: el hilo es inmutable (igual que comentarios_ticket).
DROP POLICY IF EXISTS "comentarios_mensaje_portal_delete" ON public.comentarios_mensaje_portal;
CREATE POLICY "comentarios_mensaje_portal_delete" ON public.comentarios_mensaje_portal
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.current_user_role() = ANY(ARRAY['company_owner', 'admin'])
      AND company_id = public.get_my_company_id()
    )
  );
