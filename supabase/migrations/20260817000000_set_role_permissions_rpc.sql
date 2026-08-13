-- ============================================================================
-- RBAC: reemplazar el conjunto de permisos de un rol en UNA sola petición
-- ============================================================================
-- Bug reportado: al editar un rol personalizado, "Guardar rol" fallaba con un
-- «Bad Request» a secas. No venía de PostgREST (sus errores son JSON con
-- mensaje, y la UI los muestra tal cual): era el cuerpo de texto plano con el
-- que la pasarela rechaza una petición cuya URL es descomunal.
--
-- El origen: el guardado hacía el diff en el cliente y borraba con
--   DELETE /role_permissions?role_id=eq.<uuid>&permission_key=in.("a","b",…)
-- es decir, TODAS las claves a quitar dentro de la query string. Con el caso
-- real del tenant —un rol con los 1 170 permisos del catálogo del que se
-- dejaban 90 seleccionados— eso son 1 080 claves; a ~35 caracteres cada una,
-- más las comillas y comas ya URL-encodeadas, la URL pasa de 50 KB. Ningún
-- proxy acepta una línea de petición así.
--
-- La forma correcta es mandar la lista en el CUERPO, y de paso hacer el diff
-- donde están los datos: el conjunto deseado entra completo, la función quita
-- lo que sobra e inserta lo que falta, todo en la misma transacción. Antes, un
-- fallo entre el DELETE y el INSERT dejaba el rol a medio guardar.
--
-- SECURITY INVOKER a propósito: la autorización YA la hace la RLS de
-- `role_permissions` (sus policies exigen que el rol sea de la empresa del
-- llamante, no sea de sistema, y que el llamante sea company_owner/admin).
-- Con SECURITY DEFINER habría que reimplementar ese chequeo aquí y arriesgarse
-- a que se desalinee del de las policies.
--
-- IMPACTO EN DATOS: ninguno por sí sola (solo crea la función). Los cambios los
-- hace la UI al guardar un rol, como antes.
--
-- CÓMO REVERTIR: DROP FUNCTION public.set_role_permissions(uuid, text[]);
-- y devolver CustomRoleEditor al diff cliente (delete + insert).

CREATE OR REPLACE FUNCTION public.set_role_permissions(p_role_id uuid, p_keys text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_total integer;
BEGIN
  -- NULL no es "vaciar el rol": es una llamada mal armada. Vaciar se pide
  -- explícitamente con '{}', y ese caso sí borra todo.
  IF p_keys IS NULL THEN
    RAISE EXCEPTION 'set_role_permissions: p_keys no puede ser NULL (usa ''{}'' para dejar el rol sin permisos)'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- Lo que ya no está en el conjunto deseado.
  DELETE FROM public.role_permissions rp
   WHERE rp.role_id = p_role_id
     AND NOT (rp.permission_key = ANY (p_keys));

  -- Lo que falta. Las filas que YA existen no se tocan: así se conserva su
  -- `effect` (los ajustes individuales guardan 'deny' además de 'allow') en vez
  -- de reescribirlo a 'allow', que es justo lo que hacía el diff del cliente.
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
  SELECT p_role_id, k, 'allow'
    FROM unnest(p_keys) AS k
   WHERE NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = p_role_id AND rp.permission_key = k
   );

  SELECT count(*) INTO v_total
    FROM public.role_permissions rp WHERE rp.role_id = p_role_id;
  RETURN v_total;
END $$;

COMMENT ON FUNCTION public.set_role_permissions(uuid, text[]) IS
  'Deja el rol EXACTAMENTE con los permisos de p_keys (quita sobrantes, agrega faltantes) en una sola transacción. La lista viaja en el cuerpo, no en la URL. SECURITY INVOKER: autoriza la RLS de role_permissions.';

REVOKE EXECUTE ON FUNCTION public.set_role_permissions(uuid, text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_role_permissions(uuid, text[]) TO authenticated;
