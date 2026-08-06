-- ════════════════════════════════════════════════════════════════════════════
-- clientes — la policy de INSERT no valida el tenant
-- (auditoría 2026-07-28, Bloque A · PR-3).
--
-- POR QUÉ
-- `clientes_insert_by_role` (20260327000003:57) es la policy de INSERT vigente:
--
--   WITH CHECK (
--     current_user_role() IN ('super_admin','superadmin')
--     OR current_user_role() IN ('company_owner','admin','operator','operador','user')
--   );
--
-- Solo comprueba el ROL del caller. No mira `project_id`, ni la junction
-- `company_clientes`, ni nada que ate la fila a la empresa de quien la inserta.
--
-- Es un superviviente: 20260417000012 dropeó `clientes_select_by_role` (:103) y
-- `clientes_update_by_role` (:105) y los reemplazó por versiones acotadas
-- (`clientes_select`, `clientes_update`), y 20260411000001 restringió el DELETE
-- a super_admin — pero NUNCA dropeó la de INSERT. Rastreadas las 11 migraciones
-- que tocan policies de `clientes`; ésta es la única sin acotar.
--
-- QUÉ PERMITE HOY
-- Un `operator` (el rol de escritura más bajo) del tenant A puede insertar una
-- fila con `project_id` apuntando a un proyecto del tenant B, envenenando su
-- listado de clientes.
--
-- EL ARREGLO — Y SU LÍMITE, QUE IMPORTA
-- `clientes` NO tiene `company_id`: su vínculo con la empresa es la junction
-- `company_clientes`, que se crea DESPUÉS del insert (ver
-- `ImportClientesModal.tsx:322` → `addCompanyClientesLinks` en :338, y el
-- comentario de :321 que lo explica). Por eso el WITH CHECK NO puede exigir la
-- junction: en el momento del INSERT todavía no existe.
--
-- Lo único atable en ese instante es `project_id`. Y como el único camino de
-- INSERT autenticado que existe (el importador de Excel) NO envía `project_id`
-- —lo deja NULL—, exigir `project_id NOT NULL IN (...)` rompería el import por
-- completo. Así que la regla es: si vienes con `project_id`, tiene que ser de un
-- proyecto TUYO; si viene NULL, se permite como hasta ahora.
--
-- LO QUE ESTO **NO** ARREGLA (dicho explícitamente para que nadie lo asuma):
-- `clientes.codigo` es UNIQUE global y hay índice único parcial sobre `cui_dui`
-- (20260317000001:130). Un atacante puede seguir insertando con `project_id`
-- NULL y OCUPAR códigos/DPIs reales, bloqueando a otro tenant el alta de esos
-- clientes. Eso no se cierra con una policy: es consecuencia de que `clientes`
-- sea una tabla GLOBAL compartida con unicidad global. Cerrarlo de verdad exige
-- decidir el modelo (¿`company_id` en `clientes`? ¿unicidad por empresa?) y es
-- un cambio de diseño, no un parche de RLS. Queda como follow-up del Bloque E.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "clientes_insert_by_role" ON public.clientes;
DROP POLICY IF EXISTS "clientes_insert"         ON public.clientes;

CREATE POLICY "clientes_insert" ON public.clientes
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (
      current_user_role() = ANY(ARRAY['company_owner','admin','operator','operador','user'])
      AND (
        -- Camino normal del importador: sin proyecto asignado todavía.
        project_id IS NULL
        -- Con proyecto: tiene que ser de la empresa del caller.
        OR project_id IN (
          SELECT p.id FROM public.projects p
          WHERE p.company_id = (SELECT public.get_my_company_id())
        )
      )
    )
  );

COMMENT ON POLICY "clientes_insert" ON public.clientes IS
  'INSERT acotado al tenant: impide sembrar clientes en proyectos ajenos. `project_id IS NULL` se permite porque la junction company_clientes se crea DESPUÉS del insert (ver ImportClientesModal). NO previene la ocupación de `codigo`/`cui_dui` (UNIQUE global) — eso requiere cambio de modelo. Auditoría 2026-07-28, Bloque A · PR-3.';
