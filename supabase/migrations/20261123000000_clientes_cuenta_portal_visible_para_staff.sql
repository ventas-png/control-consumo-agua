-- ════════════════════════════════════════════════════════════════════════════
-- Clientes: el staff vuelve a ver qué clientes tienen cuenta del portal
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ SE ROMPIÓ
-- La columna «Cuenta» de Administración → Clientes decía «Sin cuenta» para
-- TODOS los clientes, también para los que ya entran al portal. La pantalla
-- averiguaba la cuenta leyendo app_users por cliente_id
-- (fetchClienteAccountMap, src/domain/clientes/queries.ts), y la policy de
-- lectura de app_users (app_users_select, 20260417000012) sólo deja ver al
-- staff las filas con SU company_id. Desde 20260801000400 las cuentas con
-- role = 'cliente' llevan company_id = NULL a propósito —es la frontera de
-- privilegio que las saca de las ramas de staff de las policies—, así que
-- esa consulta devuelve cero filas para cualquier administrador y la pantalla
-- concluye «sin cuenta». No es un dato perdido: es una lectura que la policy
-- ya no permite.
--
-- LO QUE HACE
--   `clientes_con_cuenta_portal(p_cliente_ids uuid[])` — SECURITY DEFINER —
--   devuelve, de los ids pedidos, los clientes que tienen cuenta del portal
--   (app_users con role = 'cliente') y si esa cuenta está activa. Sólo
--   responde al staff: exige sesión, que el llamador no sea un cliente, y
--   para cada fila que el cliente esté vinculado a la empresa del llamador en
--   company_clientes y que éste tenga permiso de ver Clientes
--   (platform.clientes.view, la misma compuerta que la policy clientes_select
--   de 20260519000008). super_admin ve todo. No expone nombre, correo ni
--   ningún otro dato de la cuenta: sólo «existe» y «activa».
--
-- LO QUE **NO** HACE: no toca app_users_select (abrir la fila entera de las
-- cuentas de cliente al staff es más de lo que la pantalla necesita) ni las
-- cuentas mismas.
--
-- IDEMPOTENTE: CREATE OR REPLACE + REVOKE/GRANT.
-- REVERSA: DROP FUNCTION public.clientes_con_cuenta_portal(uuid[]);
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.clientes_con_cuenta_portal(p_cliente_ids uuid[])
RETURNS TABLE (cliente_id uuid, activo boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'CLIENTES_CUENTA: sesión requerida' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Una cuenta de cliente no consulta cuentas de otros clientes.
  IF public.current_user_role() = 'cliente' THEN
    RAISE EXCEPTION 'CLIENTES_CUENTA: sólo el personal de la empresa consulta las cuentas del portal' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF cardinality(COALESCE(p_cliente_ids, ARRAY[]::uuid[])) > 5000 THEN
    RAISE EXCEPTION 'CLIENTES_CUENTA: hasta 5000 clientes por consulta' USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT u.cliente_id, u.activo
    FROM public.app_users u
   WHERE u.role = 'cliente'
     AND u.cliente_id IS NOT NULL
     AND u.cliente_id = ANY (COALESCE(p_cliente_ids, ARRAY[]::uuid[]))
     AND (
       public.is_super_admin()
       OR (
         COALESCE(public.user_has_permission('platform.clientes.view'), false)
         AND EXISTS (
           SELECT 1 FROM public.company_clientes cc
            WHERE cc.cliente_id = u.cliente_id
              AND cc.company_id = public.get_my_company_id()
         )
       )
     );
END;
$$;

-- Regla (e) del migrations-guard: toda SECURITY DEFINER nueva revoca PUBLIC.
REVOKE EXECUTE ON FUNCTION public.clientes_con_cuenta_portal(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.clientes_con_cuenta_portal(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.clientes_con_cuenta_portal(uuid[]) IS
  'De los clientes pedidos, cuáles tienen cuenta del portal (app_users.role = cliente) y si está activa. Sólo para el staff con permiso de ver Clientes, acotado a los clientes vinculados a su empresa (company_clientes); super_admin ve todo. Existe porque app_users_select no deja ver al staff las cuentas de cliente (company_id NULL, 20260801000400).';
