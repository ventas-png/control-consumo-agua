-- ─── Linaje de plantillas en roles ───────────────────────────────────────────
-- Los roles del sistema pasan a ser PLANTILLAS: ya no se asignan directamente,
-- sino que al usarse se crea (o reutiliza) una copia de empresa. Esta columna
-- registra de qué plantilla nació cada copia, lo que permite:
--   1. "Usar plantilla" idempotente (busca-o-crea la copia por linaje+nombre).
--   2. Conservar los gates gruesos que dependen de UUIDs de roles del sistema
--      (proyectosAccess.RESTRICTED_COND_ROLE_IDS, ADMIN_GENERAL_ROLE_ID en
--      ComunicacionSection): la sesión expande assigned_role_ids con el
--      cloned_from_role_id de cada rol asignado.
-- Aditiva: invisible para las queries existentes hasta que el código la escribe.

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS cloned_from_role_id uuid
  REFERENCES public.roles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_roles_cloned_from
  ON public.roles(cloned_from_role_id)
  WHERE cloned_from_role_id IS NOT NULL;
