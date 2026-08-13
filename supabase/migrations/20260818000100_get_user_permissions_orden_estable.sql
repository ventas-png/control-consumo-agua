-- ─── get_user_permissions: orden estable para poder paginarla ───────────────
-- La RPC devuelve SETOF text y el cliente la consumía de una sola vez, así que
-- quedaba sujeta al tope de filas de PostgREST igual que cualquier tabla. Un
-- rol de acceso amplio ("Finanzas / Contador") pasa de las 1100 claves: por
-- encima del tope, la sesión se quedaba con un subconjunto ARBITRARIO y —al no
-- haber ORDER BY— distinto en cada login. Un módulo aparecía o no según la
-- suerte del plan de ejecución, que es exactamente la clase de fallo
-- intermitente que motivó esta revisión.
--
-- El cliente pasa a leerla paginada con .range() (src/domain/auth/session.ts).
-- `.range()` sin un orden TOTAL puede saltar o duplicar filas entre ventanas,
-- así que el orden tiene que vivir aquí: permission_key es único dentro del
-- resultado (el SELECT ya deduplica con DISTINCT y descuenta los denies), o sea
-- que ordenar por esa columna es un orden total.
--
-- Único cambio respecto de 20260518000008: el ORDER BY final. La firma, los
-- permisos de ejecución y la semántica allow/deny se conservan intactos.

CREATE OR REPLACE FUNCTION public.get_user_permissions(target_user_id uuid)
RETURNS SETOF text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_self boolean := target_user_id = auth.uid();
  is_admin_of_target boolean := false;
BEGIN
  IF NOT is_self THEN
    SELECT EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = target_user_id
        AND (
          public.is_super_admin()
          OR (
            u.company_id = public.get_my_company_id()
            AND public.current_user_role() IN ('company_owner', 'admin')
          )
        )
    ) INTO is_admin_of_target;
    IF NOT is_admin_of_target THEN
      RAISE EXCEPTION 'access denied: cannot read permissions of other users';
    END IF;
  END IF;

  RETURN QUERY
    WITH allowed AS (
      SELECT DISTINCT rp.permission_key
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = target_user_id
        AND rp.effect = 'allow'
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
    ),
    denied AS (
      SELECT DISTINCT rp.permission_key
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = target_user_id
        AND rp.effect = 'deny'
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
    )
    SELECT permission_key FROM allowed
    WHERE permission_key NOT IN (SELECT permission_key FROM denied)
    ORDER BY permission_key;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_permissions(uuid) TO authenticated;
