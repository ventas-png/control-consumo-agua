-- ============================================================
-- Centro de Comunicación: alcance por proyecto
-- ============================================================
-- Problema: `conversations` solo se acota por empresa. `conversations_select`
-- (20260417000014) deja pasar CUALQUIER fila de la empresa por la rama
-- `company_id = get_my_company_id()`, así que un usuario asignado a un solo
-- proyecto veía las conversaciones de los clientes de todos los proyectos —y la
-- rama de operator/collector/viewer que venía debajo quedaba muerta, porque esa
-- rama previa ya había concedido el acceso.
--
-- Esta migración:
--   1. sella `project_id` en las conversaciones existentes (backfill), que es lo
--      que permite decidir a qué proyecto pertenece cada hilo;
--   2. acota `conversations_select` / `conv_messages_select` por proyecto para
--      los roles NO exentos, con la misma regla que `projects_select`
--      (20260519000007): company_owner/admin/super_admin ven su empresa
--      completa; el resto, solo sus proyectos asignados.
--
-- Regla de ambigüedad (idéntica a src/lib/comunicacionAccess.ts): una
-- conversación con `project_id IS NULL` sigue siendo visible para la empresa. No
-- se puede afirmar que sea de otro proyecto, y ocultarla escondería hilos
-- heredados que el backfill no supo resolver.

-- ── 0. Columnas que la app ya usa ────────────────────────────────────────────
-- No-ops si ya existen; dejan la migración auto-contenida.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;
ALTER TABLE public.conversations
  ALTER COLUMN cliente_id DROP NOT NULL;

-- Índice parcial: los filtros por proyecto solo miran filas selladas.
CREATE INDEX IF NOT EXISTS conversations_project_id_idx
  ON public.conversations (project_id)
  WHERE project_id IS NOT NULL;

-- ── 1. Backfill: conversaciones de cliente ───────────────────────────────────
-- Los clientes no llevan `project_id`: su proyecto se deriva de las unidades que
-- ocupan y de las lecturas registradas a su nombre (misma derivación que
-- lib/rutasAccess y lib/comunicacionAccess). Solo se sella cuando el cliente
-- pertenece a UN único proyecto: si cruza varios, la elección sería arbitraria y
-- es preferible dejarlo sin sellar (ambiguo) que encerrarlo donde no va.
WITH cliente_proyecto AS (
  SELECT
    cliente_id,
    MIN(project_id::text)::uuid AS project_id
  FROM (
    SELECT u.cliente_id, u.project_id
      FROM public.unidades u
     WHERE u.cliente_id IS NOT NULL AND u.project_id IS NOT NULL
    UNION
    SELECT r.cliente_id, r.project_id
      FROM public.registros r
     WHERE r.cliente_id IS NOT NULL AND r.project_id IS NOT NULL
  ) s
  GROUP BY cliente_id
  HAVING COUNT(DISTINCT project_id) = 1
)
UPDATE public.conversations c
   SET project_id = cp.project_id
  FROM cliente_proyecto cp
 WHERE c.project_id IS NULL
   AND c.cliente_id = cp.cliente_id
   AND EXISTS (
     SELECT 1 FROM public.projects p
      WHERE p.id = cp.project_id AND p.company_id = c.company_id
   );

-- ── 2. Backfill: discusiones internas ────────────────────────────────────────
-- Una discusión de equipo no tiene cliente del que derivar el proyecto. Se usa
-- al autor del primer mensaje: si ese usuario está asignado a UN solo proyecto,
-- la discusión es de ese equipo. Si el autor es un rol exento (sin asignaciones)
-- o cubre varios proyectos, la discusión queda general.
WITH primer_mensaje AS (
  SELECT DISTINCT ON (m.conversation_id)
         m.conversation_id,
         m.sender_id
    FROM public.conversation_messages m
   ORDER BY m.conversation_id, m.created_at ASC
),
autor_proyecto AS (
  SELECT
    upa.user_id,
    MIN(upa.project_id::text)::uuid AS project_id
  FROM public.user_project_assignments upa
  GROUP BY upa.user_id
  HAVING COUNT(DISTINCT upa.project_id) = 1
)
UPDATE public.conversations c
   SET project_id = ap.project_id
  FROM primer_mensaje pm
  JOIN autor_proyecto ap ON ap.user_id = pm.sender_id
 WHERE c.id = pm.conversation_id
   AND c.project_id IS NULL
   AND c.is_internal = true
   AND EXISTS (
     SELECT 1 FROM public.projects p
      WHERE p.id = ap.project_id AND p.company_id = c.company_id
   );

-- ── 3. Helper: ¿puede este usuario ver una conversación de este proyecto? ────
-- SECURITY DEFINER para no re-entrar en la RLS de app_users /
-- user_project_assignments (mismo patrón que user_has_project_access).
CREATE OR REPLACE FUNCTION public.can_access_conversation_project(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Sin proyecto sellado: ambiguo, no ajeno (ver cabecera).
    p_project_id IS NULL
    -- Roles exentos: ven la empresa completa (espeja PROJECT_EXEMPT_ROLES y la
    -- rama equivalente de projects_select).
    OR public.current_user_role() = ANY (ARRAY['super_admin', 'superadmin', 'company_owner', 'admin'])
    -- Resto: solo sus proyectos (app_users.project_id o user_project_assignments).
    OR public.user_has_project_access(p_project_id)
$$;

COMMENT ON FUNCTION public.can_access_conversation_project(uuid) IS
  'Alcance por proyecto del Centro de Comunicación: NULL (ambiguo) o rol exento o proyecto asignado.';

-- ¿La conversación está asignada al usuario actual vía conversation_assignments?
-- TIENE que ser SECURITY DEFINER: las policies de conversation_assignments hacen
-- JOIN contra conversations, así que consultarla desde conversations_select sin
-- saltarse su RLS provocaría recursión infinita.
CREATE OR REPLACE FUNCTION public.is_conversation_assigned_to_me(p_conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_assignments ca
    WHERE ca.conversation_id = p_conversation_id
      AND ca.user_id = auth.uid()
  )
$$;

COMMENT ON FUNCTION public.is_conversation_assigned_to_me(uuid) IS
  'true si la conversación está asignada al usuario actual (lectura sin RLS para evitar recursión).';

-- ── 4. RLS: conversations ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "conversations_select" ON public.conversations;

CREATE POLICY "conversations_select" ON public.conversations
  FOR SELECT TO authenticated
  USING (
    -- El cliente ve SIEMPRE sus propias conversaciones (el proyecto no aplica).
    is_user_cliente_with_id(cliente_id)
    OR (cliente_id = (SELECT get_my_cliente_id()))
    -- Staff: acceso de empresa/rol Y además acceso al proyecto del hilo.
    OR (
      (
        has_super_admin_access()
        OR has_admin_or_owner_access_in_company(company_id)
        OR (company_id = (SELECT get_my_company_id()))
        OR EXISTS (
          SELECT 1 FROM app_users u
          WHERE u.id = (SELECT auth.uid())
            AND u.role = ANY(ARRAY['operator','collector','viewer'])
            AND u.company_id = conversations.company_id
            AND (conversations.assigned_to = (SELECT auth.uid()) OR EXISTS (
              SELECT 1 FROM conversation_access_rules r
              WHERE r.company_id = u.company_id AND r.role = u.role AND r.can_view_all = true
                AND (r.categories IS NULL OR conversations.category = ANY(r.categories))
            ))
        )
      )
      AND (
        -- Una conversación asignada al usuario nunca se le oculta, aunque sea de
        -- otro proyecto (espeja la rama de asignación de la propia policy).
        conversations.assigned_to = (SELECT auth.uid())
        OR public.is_conversation_assigned_to_me(conversations.id)
        OR public.can_access_conversation_project(conversations.project_id)
      )
    )
  );

-- ── 5. RLS: conversation_messages ────────────────────────────────────────────
-- La rama de empresa hereda el mismo recorte; la del cliente no se toca.
DROP POLICY IF EXISTS "conv_messages_select" ON public.conversation_messages;

CREATE POLICY "conv_messages_select" ON public.conversation_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_messages.conversation_id
        AND (
          (
            c.company_id = (SELECT get_my_company_id())
            AND (
              c.assigned_to = (SELECT auth.uid())
              OR public.is_conversation_assigned_to_me(c.id)
              OR public.can_access_conversation_project(c.project_id)
            )
          )
          OR c.cliente_id = (SELECT get_my_cliente_id())
        )
    )
  );
