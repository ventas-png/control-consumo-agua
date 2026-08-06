-- ════════════════════════════════════════════════════════════════════════════
-- Comunicados y difusión: el residente/cliente NO podía leer NADA (revisión
-- del área "Comunicados y Difusiones").
--
-- SÍNTOMA REPORTADO
-- "Se publican comunicados pero no se despliegan". No hay error en pantalla:
-- RLS no falla, simplemente devuelve 0 filas, así que la UI cae en su estado
-- vacío ("Sin anuncios" / "Sin comunicados") y parece que no hay nada publicado.
--
-- ── BUG 1 · anuncios_comunidad: el residente perdió el acceso ───────────────
-- `20260420000001_condominios_mvp.sql:279` creó la policy original:
--     USING (company_id = get_my_company_id() OR is_super_admin())
-- Esa rama SÍ alcanzaba al residente. `20260518000010_rbac_rls_condominios_
-- phase1.sql:206` la reemplazó por la variante RBAC:
--     is_super_admin() OR (company_id = get_my_company_id()
--                          AND user_has_permission('condominios.tab.comunicados'))
-- El encabezado de esa migración dice "Preserves any cliente_* policies (resident
-- portal access)" — pero esta tabla NUNCA tuvo una policy `cliente_*`: su acceso
-- de residente vivía dentro de la policy que se sustituyó. Y
-- `user_has_permission()` es false para el rol `cliente` (no está en la lista de
-- roles con todo, y un residente no tiene filas en `user_roles`), así que la
-- rama entera colapsa a false.
--
-- Resultado: el tab "Anuncios" del portal del residente
-- (`CondominiosClientPortal` → `fetchCondominiosPortalData` →
-- `anuncios_comunidad`) siempre devuelve []. Y el botón "📢 Publicar en portal"
-- de ComunicadosTab —que promete "Los residentes ya pueden verlo"— es, desde el
-- lado del residente, un no-op silencioso.
--
-- La fase 2 del portal de residentes reparó exactamente esta clase de bug en ~44
-- policies (`20260713000000`…`20260713040000`), pero `anuncios_comunidad` quedó
-- fuera: es scopeada por `project_id`, y el helper de proyectos
-- (`mis_proyectos_ids()`) recién nació en el batch 5 — que sólo repuntó las
-- tablas que ya tenían rama de residente (amenidades, amenidades_bloqueos,
-- config_condominio). Esta tabla no la tenía, así que no había nada que repuntar
-- y no entró en la lista.
--
-- Fix: añadir la rama de residente con el MISMO recipe del batch 5:
--   OR (project_id IN (SELECT public.mis_proyectos_ids()))
--
-- ── BUG 2 · broadcasts/broadcast_recipients: la difusión no llega al cliente ─
-- Las policies de `20260417000012_consolidate_rls_policies_part1.sql` resuelven
-- al cliente a través de `app_users.company_id`:
--     broadcasts_all:               company_id IN (SELECT company_id FROM app_users WHERE id = auth.uid())
--     broadcast_recipients_select:  … OR cliente_id IN (SELECT cc.cliente_id FROM company_clientes cc
--                                          JOIN app_users u ON u.id = auth.uid() WHERE u.company_id = cc.company_id)
-- Pero las DOS rutas que crean la cuenta de un cliente insertan su fila de
-- `app_users` SIN company_id — `create-cliente-account/index.ts:212` y
-- `complete-oauth-onboarding/index.ts:132` sólo ponen id/full_name/role/
-- cliente_id/activo. Con `app_users.company_id IS NULL`:
--   · `company_id IN (SELECT NULL)` → NULL → no pasa;
--   · el JOIN `u.company_id = cc.company_id` no casa ninguna fila.
-- Ambas ramas de cliente son código muerto → el tab "Comunicados" del portal
-- (`CustomerComunicacion` → `fetchClienteBroadcasts`) siempre muestra
-- "Sin comunicados", aunque `create-broadcast` haya abanicado sus destinatarios.
-- (El front ya convivía con esto: `CondominiosClientPortal:108` resuelve el
-- company_id desde el proyecto justamente porque el cliente no lo trae.)
--
-- NO se "arregla" poniéndole company_id a esas filas: un cliente puede estar
-- ligado a VARIAS empresas vía `company_clientes`, así que ese campo es ambiguo
-- para el rol `cliente` — y rellenarlo ENSANCHARÍA de golpe todo lo que hoy
-- depende de `get_my_company_id()`. Se corrige donde está el error: resolviendo
-- al cliente por su `cliente_id`, que es lo que sí tiene.
--
-- De paso cierra un exceso de la misma policy: la rama vieja daba al cliente
-- SELECT/UPDATE sobre los recipients de TODA la empresa (los acuses de lectura
-- de los demás), no sólo los suyos. Queda acotada a `cliente_id = el mío`.
--
-- ── BUG 3 (mismo par de tablas) · la rama de staff alcanza a los clientes ────
-- `company_id IN (SELECT company_id FROM app_users WHERE id = auth.uid())` no
-- mira el ROL. Es inofensiva mientras el cliente tenga company_id NULL, pero no
-- todas las cuentas de cliente lo tienen —`CondominiosClientPortal:108` existe
-- justamente porque unas sí y otras no—, y a las que lo traen esa rama les da
-- lectura (y escritura) sobre la difusión de TODA la empresa. Se le añade el
-- guard `current_user_role() <> 'cliente'`: el staff conserva su rama tal cual
-- y el cliente pasa siempre por la suya, tenga company_id o no.
--
-- ALCANCE
-- Se AMPLÍA el acceso del residente/cliente a lo que le corresponde (sus
-- anuncios, su difusión) y se ACOTA todo lo demás. Para un usuario de staff el
-- acceso resultante es EXACTAMENTE el de antes: su rama sigue siendo
-- `company_id` (+ `user_has_permission` en anuncios), sólo que ahora no la
-- comparte con el rol `cliente`. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. anuncios_comunidad — rama de residente por proyecto (recipe del batch 5).
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "anuncios_comunidad_select" ON public.anuncios_comunidad;
CREATE POLICY "anuncios_comunidad_select" ON public.anuncios_comunidad
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR ((company_id = public.get_my_company_id())
        AND public.user_has_permission('condominios.tab.comunicados'))
    OR (project_id IN (SELECT public.mis_proyectos_ids()))
  );

COMMENT ON POLICY "anuncios_comunidad_select" ON public.anuncios_comunidad IS
  'Staff: company_id + permiso condominios.tab.comunicados. Residente: anuncios de los proyectos de sus unidades activas (mis_proyectos_ids). La rama de residente se perdió en 20260518000010 y se restituye aquí.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Helper: comunicados de difusión dirigidos AL cliente que llama.
--    SECURITY DEFINER para no re-entrar en la RLS de broadcast_recipients desde
--    la policy de broadcasts (la recursión que 20260417000001 tuvo que arreglar).
--    Acotado siempre al llamante vía get_my_cliente_id() → auth.uid().
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mis_broadcast_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT br.broadcast_id
  FROM public.broadcast_recipients br
  WHERE br.cliente_id = public.get_my_cliente_id()
$fn$;

REVOKE ALL ON FUNCTION public.mis_broadcast_ids() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mis_broadcast_ids() TO authenticated;

COMMENT ON FUNCTION public.mis_broadcast_ids() IS
  'Ids de broadcasts con un destinatario = mi cliente_id. Hermano de mis_unidades_ids/mis_proyectos_ids: resuelve al cliente por cliente_id, no por app_users.company_id (que es NULL en las cuentas de cliente).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. broadcasts — se parte el `FOR ALL` en una policy por comando para poder
--    darle al cliente SOLO el SELECT, sin duplicar policies permisivas por
--    comando (el motivo por el que existe 20260417000012).
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "broadcasts_all"            ON public.broadcasts;
DROP POLICY IF EXISTS "staff_broadcasts_all"      ON public.broadcasts;
DROP POLICY IF EXISTS "cliente_broadcasts_select" ON public.broadcasts;
DROP POLICY IF EXISTS "broadcasts_select"         ON public.broadcasts;
DROP POLICY IF EXISTS "broadcasts_insert"         ON public.broadcasts;
DROP POLICY IF EXISTS "broadcasts_update"         ON public.broadcasts;
DROP POLICY IF EXISTS "broadcasts_delete"         ON public.broadcasts;

CREATE POLICY "broadcasts_select" ON public.broadcasts
  FOR SELECT TO authenticated
  USING (
    (public.current_user_role() <> 'cliente' AND company_id IN (
      SELECT au.company_id FROM public.app_users au WHERE au.id = (SELECT auth.uid())
    ))
    OR id IN (SELECT public.mis_broadcast_ids())
  );

CREATE POLICY "broadcasts_insert" ON public.broadcasts
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.current_user_role() <> 'cliente' AND company_id IN (
      SELECT au.company_id FROM public.app_users au WHERE au.id = (SELECT auth.uid())
    ))
  );

CREATE POLICY "broadcasts_update" ON public.broadcasts
  FOR UPDATE TO authenticated
  USING (
    (public.current_user_role() <> 'cliente' AND company_id IN (
      SELECT au.company_id FROM public.app_users au WHERE au.id = (SELECT auth.uid())
    ))
  )
  WITH CHECK (
    (public.current_user_role() <> 'cliente' AND company_id IN (
      SELECT au.company_id FROM public.app_users au WHERE au.id = (SELECT auth.uid())
    ))
  );

CREATE POLICY "broadcasts_delete" ON public.broadcasts
  FOR DELETE TO authenticated
  USING (
    (public.current_user_role() <> 'cliente' AND company_id IN (
      SELECT au.company_id FROM public.app_users au WHERE au.id = (SELECT auth.uid())
    ))
  );

COMMENT ON POLICY "broadcasts_select" ON public.broadcasts IS
  'Staff: los de su empresa. Cliente: sólo los comunicados que lo tienen como destinatario (mis_broadcast_ids) — su app_users.company_id es NULL, así que la rama de empresa nunca lo alcanza.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. broadcast_recipients — rama de cliente por cliente_id propio.
--    Sustituye el JOIN contra app_users.company_id (muerto: NULL en cuentas de
--    cliente) y, de paso, deja de exponerle los acuses de lectura ajenos.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "broadcast_recipients_select" ON public.broadcast_recipients;
DROP POLICY IF EXISTS "staff_recipients_select"     ON public.broadcast_recipients;
DROP POLICY IF EXISTS "cliente_recipients_select"   ON public.broadcast_recipients;

CREATE POLICY "broadcast_recipients_select" ON public.broadcast_recipients
  FOR SELECT TO authenticated
  USING (
    (public.current_user_role() <> 'cliente' AND company_id IN (
      SELECT au.company_id FROM public.app_users au WHERE au.id = (SELECT auth.uid())
    ))
    OR cliente_id = (SELECT public.get_my_cliente_id())
  );

DROP POLICY IF EXISTS "broadcast_recipients_update" ON public.broadcast_recipients;
DROP POLICY IF EXISTS "staff_recipients_update"     ON public.broadcast_recipients;
DROP POLICY IF EXISTS "cliente_recipients_update"   ON public.broadcast_recipients;
DROP POLICY IF EXISTS "cliente_recipients_read"     ON public.broadcast_recipients;

CREATE POLICY "broadcast_recipients_update" ON public.broadcast_recipients
  FOR UPDATE TO authenticated
  USING (
    (public.current_user_role() <> 'cliente' AND company_id IN (
      SELECT au.company_id FROM public.app_users au WHERE au.id = (SELECT auth.uid())
    ))
    OR cliente_id = (SELECT public.get_my_cliente_id())
  )
  WITH CHECK (
    (public.current_user_role() <> 'cliente' AND company_id IN (
      SELECT au.company_id FROM public.app_users au WHERE au.id = (SELECT auth.uid())
    ))
    OR cliente_id = (SELECT public.get_my_cliente_id())
  );

COMMENT ON POLICY "broadcast_recipients_select" ON public.broadcast_recipients IS
  'Staff: los de su empresa. Cliente: SÓLO sus propias filas (antes veía las de toda la empresa por una rama que además nunca casaba, al ser NULL su app_users.company_id).';
