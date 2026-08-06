-- Cuotas diferenciadas — FASE visibilidad: el residente ve en su portal SÓLO las
-- cuotas de su responsabilidad (regla "ocultar del otro").
--
-- Sobre la migración 20260713060000 (que agregó cuotas_condominio.rol_responsable):
-- ahora la rama RESIDENTE de la policy SELECT se vuelve consciente del rol. Un
-- residente ve una cuota de su unidad si:
--   • NO está diferenciada (rol_responsable IS NULL = responsabilidad de la unidad,
--     visible para todos los residentes de la unidad — comportamiento de hoy), O
--   • su rol en ESA unidad coincide con el rol responsable del cargo
--     (propietario ve las 'propietario', inquilino ve las 'arrendatario', etc.).
--
-- El staff del tenant (company_id + permiso) y el super admin NO cambian: siguen
-- viendo todas las cuotas. Sólo se acota la rama del residente en el portal.
--
-- ── BEHAVIOR-PRESERVING HOY (por construcción) ──────────────────────────────
-- Todas las cuotas existentes tienen rol_responsable IS NULL (la migración 060000
-- no rellenó ninguna). Para cada fila, `rol_responsable IS NULL` es TRUE, así que
-- la rama residente se reduce EXACTAMENTE a `unidad_id IN mis_unidades_ids()` — la
-- policy anterior, idéntica. NINGUNA cuota cambia de visibilidad hoy. La separación
-- se activa por-cuota recién cuando un operador etiqueta una (rol_responsable).
--
-- VALIDACIÓN: el dry-run en vivo contra prod (BEGIN…ROLLBACK) no se pudo correr en
-- esta sesión (el MCP de Supabase necesita re-autenticación). La equivalencia hoy es
-- por construcción (arriba); el RLS harness de CI verifica que el aislamiento por
-- tenant se preserva; y como toca el portal del residente (dual-login), requiere QA
-- en preview ANTES de que los residentes dependan de la separación: verificar que
-- un login 'propietario' y uno 'arrendatario' de la MISMA unidad ven cada uno sólo
-- sus cuotas (y ambos las NULL). El apply a prod pasa por el gate humano P0 #9.

-- ── Helper: (unidad, rol) que ejerce el llamante ────────────────────────────
-- Mismas dos fuentes que mis_unidades_ids(), pero conservando el rol:
--   • unidades.cliente_id = mi cliente  → rol 'propietario' (dueño legacy).
--   • unidad_residentes (activo) de mi cliente → su `tipo`.
-- Nombres de salida (unidad/rol) elegidos para NO colisionar con columnas del
-- cuerpo (unidad_id/tipo) — evita cualquier ambigüedad. SECURITY DEFINER +
-- get_my_cliente_id() (auth.uid()): SIEMPRE acotado al llamante.
CREATE OR REPLACE FUNCTION public.mis_unidad_roles()
RETURNS TABLE(unidad uuid, rol text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT u.id, 'propietario'::text
  FROM public.unidades u
  WHERE u.activo = true AND u.cliente_id = public.get_my_cliente_id()
  UNION
  SELECT ur.unidad_id, ur.tipo
  FROM public.unidad_residentes ur
    JOIN public.unidades u2 ON u2.id = ur.unidad_id
  WHERE ur.activo = true AND u2.activo = true AND ur.cliente_id = public.get_my_cliente_id()
$fn$;
REVOKE ALL ON FUNCTION public.mis_unidad_roles() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mis_unidad_roles() TO authenticated;

-- ── Repunte de la rama residente en cuotas_condominio_select ─────────────────
DROP POLICY IF EXISTS cuotas_condominio_select ON public.cuotas_condominio;
CREATE POLICY cuotas_condominio_select ON public.cuotas_condominio
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.cuotas'))
    OR (
      -- Rama residente (portal), consciente del rol responsable del cargo.
      unidad_id IN (SELECT public.mis_unidades_ids())
      AND (
        rol_responsable IS NULL
        OR (unidad_id, rol_responsable) IN (
          SELECT m.unidad, m.rol FROM public.mis_unidad_roles() m
        )
      )
    )
  );
