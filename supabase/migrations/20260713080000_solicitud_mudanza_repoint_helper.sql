-- Portal propietario/inquilino — repunte de solicitud_mudanza_unidad al helper.
--
-- Cierra el último caso que la fase 2 dejó DEFERIDO (ver cabecera de
-- 20260713040000_portal_residentes_fase2_batch5.sql): las solicitudes por unidad.
-- Decisión de producto (confirmada tras la QA del portal dual): la MUDANZA
-- (entrada/salida de la unidad) es relevante para el inquilino, así que su rama
-- residente se repunta a `mis_unidades_ids()` — que incluye a los residentes de
-- `unidad_residentes` (propietario Y/O inquilino). La RENTA (poner la unidad en
-- alquiler) es acción del dueño y NO se toca aquí (queda solo-dueño).
--
-- Alcance: solo `solicitud_mudanza_unidad` SELECT + INSERT (las ramas con acceso
-- del residente). UPDATE/DELETE (staff-only) y TODO `solicitud_renta_unidad` quedan
-- intactos. La rama `cliente_id = get_my_cliente_id()` (el residente que CREÓ la
-- solicitud siempre la ve/gestiona) se conserva; solo se cambia la rama de
-- "pertenece a mi unidad".
--
-- CAMBIO DE CONDUCTA (por eso estaba deferido y requería la QA que ya pasó):
--   • + El inquilino (unidad_residentes activo) ahora ve/crea mudanzas de su unidad.
--   • ~ La rama de propiedad pasa del EXISTS (sin filtro de activo) al helper (que
--     filtra unidades.activo=true). Un dueño que NO creó la solicitud pero es dueño
--     de una unidad INACTIVA pierde el SELECT sobre esas mudanzas viejas — caso
--     borde aceptable (unidad inactiva = fuera de gestión), y el creador la sigue
--     viendo por la rama cliente_id. Consistente con las ~46 policies de fase 2.
--
-- VALIDACIÓN: el dry-run en vivo (BEGIN…ROLLBACK) no se pudo correr esta sesión (MCP
-- de Supabase sin re-autenticar). El modelo dual-login que este cambio extiende fue
-- validado en preview (QA del operador). El apply a prod pasa por el gate humano
-- P0 #9 y el RLS harness de CI cubre el aislamiento por tenant. SECURITY DEFINER +
-- get_my_cliente_id() (auth.uid()): siempre acotado al llamante.

-- ── SELECT: rama residente repuntada al helper ──────────────────────────────
DROP POLICY IF EXISTS "solicitud_mudanza_unidad_select" ON public.solicitud_mudanza_unidad;
CREATE POLICY "solicitud_mudanza_unidad_select" ON public.solicitud_mudanza_unidad
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_mudanza'))
    OR company_id = get_my_company_id()
    OR (
      current_user_role() = 'cliente'
      AND (
        cliente_id = get_my_cliente_id()
        OR unidad_id IN (SELECT public.mis_unidades_ids())
      )
    )
  );

-- ── INSERT: rama residente repuntada al helper (mantiene estado='pendiente') ──
DROP POLICY IF EXISTS "solicitud_mudanza_unidad_insert" ON public.solicitud_mudanza_unidad;
CREATE POLICY "solicitud_mudanza_unidad_insert" ON public.solicitud_mudanza_unidad
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_mudanza'))
    OR company_id = get_my_company_id()
    OR (
      current_user_role() = 'cliente'
      AND (
        cliente_id = get_my_cliente_id()
        OR (
          estado = 'pendiente'
          AND unidad_id IN (SELECT public.mis_unidades_ids())
        )
      )
    )
  );
