-- Chat de tickets de mantenimiento entre el residente y el equipo del condominio.
--
-- CONTEXTO: `comentarios_ticket` (fase 28) nació como hilo interno del panel admin:
-- sus policies exigen `company_id = get_my_company_id()` + permiso de tab, y los
-- residentes tienen `company_id = NULL`, así que hoy no pueden leer ni escribir el
-- hilo. El portal del residente pasa a tener conversación por ticket (mensajes con
-- fotos), así que esta migración:
--
--   1. Agrega `foto_urls` (mismo shape que `tickets_mantenimiento.foto_urls`: array
--      de paths bare del bucket privado `condominios-media`, firmados al render por
--      SecureImage). Las policies de storage ya permiten al residente escribir/leer
--      bajo `${project_id}/...` de SUS unidades (20260603220000), así que no hay
--      cambio de storage.
--   2. Agrega `es_interno`: nota que el residente NO ve. El hilo deja de ser
--      admin-only, y sin este flag cualquier nota operativa quedaría expuesta al
--      residente. Las filas PREEXISTENTES se marcan internas: se escribieron cuando
--      el hilo era admin-only y nadie consintió mostrárselas al residente.
--   3. Reescribe las policies SELECT/INSERT con una tercera rama de residente,
--      acotada por `mis_unidades_ids()` — el mismo helper que ya acota tickets,
--      cuotas y visitantes (20260713000000/20260713050000).
--
-- La rama staff se amplía a `condominios.tab.mantenimiento` ADEMÁS de
-- `condominios.tab.kanban_tickets` (era la única): la conversación se abre ahora
-- desde el tab Mantenimiento, y quien administra tickets ahí debe poder contestarle
-- al residente sin depender de un permiso de otro tab.
--
-- DELETE queda como está (owner/admin de la company): el residente no borra mensajes.
-- UPDATE sigue sin policy — el hilo es inmutable, igual que antes.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS + DROP POLICY IF EXISTS/CREATE.
-- REVERSA: recrear las 2 policies de 20260518000010 (rama staff sola con
--   'condominios.tab.kanban_tickets') y DROP de las 2 columnas.

-- ── 1. Columnas ─────────────────────────────────────────────────────────────
ALTER TABLE public.comentarios_ticket
  ADD COLUMN IF NOT EXISTS foto_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

-- `es_interno` se crea con DEFAULT true y recién después se baja el default a
-- false: así las filas PREEXISTENTES quedan internas (se escribieron cuando el
-- hilo era admin-only) sin un UPDATE masivo, y las nuevas nacen visibles. El
-- IF-existe hace la migración idempotente sin re-marcar mensajes legítimos del
-- residente si se re-aplica sobre datos ya en producción.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'comentarios_ticket'
      AND column_name = 'es_interno'
  ) THEN
    ALTER TABLE public.comentarios_ticket
      ADD COLUMN es_interno boolean NOT NULL DEFAULT true;
    ALTER TABLE public.comentarios_ticket
      ALTER COLUMN es_interno SET DEFAULT false;
  END IF;
END;
$$;

COMMENT ON COLUMN public.comentarios_ticket.foto_urls IS
  'Paths (bare) de `condominios-media` adjuntos al mensaje. Se firman al render.';
COMMENT ON COLUMN public.comentarios_ticket.es_interno IS
  'true = nota interna del equipo; el residente no la ve (RLS + UI).';

-- ── 2. RLS ──────────────────────────────────────────────────────────────────
-- Nombres canónicos instalados por rbac_install_company_policies (20260518000010).
DROP POLICY IF EXISTS "comentarios_ticket_select" ON public.comentarios_ticket;
CREATE POLICY "comentarios_ticket_select" ON public.comentarios_ticket
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND (
        public.user_has_permission('condominios.tab.kanban_tickets')
        OR public.user_has_permission('condominios.tab.mantenimiento')
      )
    )
    -- Residente: mensajes NO internos de los tickets de SUS unidades.
    OR (
      es_interno = false
      AND EXISTS (
        SELECT 1 FROM public.tickets_mantenimiento t
        WHERE t.id = comentarios_ticket.ticket_id
          AND t.unidad_id IN (SELECT public.mis_unidades_ids())
      )
    )
  );

DROP POLICY IF EXISTS "comentarios_ticket_insert" ON public.comentarios_ticket;
CREATE POLICY "comentarios_ticket_insert" ON public.comentarios_ticket
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND (
        public.user_has_permission('condominios.tab.kanban_tickets')
        OR public.user_has_permission('condominios.tab.mantenimiento')
      )
    )
    -- Residente: solo sobre tickets de SUS unidades, con el company_id del ticket
    -- (no uno arbitrario), nunca interno y sin cambiar el estado del ticket —
    -- `estado_nuevo` es la bitácora de un cambio que solo el staff puede hacer
    -- (tickets_mantenimiento no tiene rama de UPDATE para residentes).
    OR (
      es_interno = false
      AND estado_nuevo IS NULL
      AND EXISTS (
        SELECT 1 FROM public.tickets_mantenimiento t
        WHERE t.id = comentarios_ticket.ticket_id
          AND t.company_id = comentarios_ticket.company_id
          AND t.unidad_id IN (SELECT public.mis_unidades_ids())
      )
    )
  );

-- Índice del hilo: la conversación se lee por ticket en orden cronológico.
CREATE INDEX IF NOT EXISTS idx_coment_ticket_hilo
  ON public.comentarios_ticket(ticket_id, created_at);
