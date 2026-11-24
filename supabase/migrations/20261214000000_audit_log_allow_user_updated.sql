-- La edge function update-user (el propietario de la empresa edita el nombre, el
-- correo o la contraseña de una persona de su empresa) registra el cambio en
-- permission_audit_log con action = 'user_updated'. El CHECK de la columna no
-- incluía ese valor: sin esta migración la inserción falla y el cambio no queda
-- auditado. Mismo patrón que 20260522000010 ('user_deleted').
--
-- CÓMO REVERTIR: volver a crear el CHECK sin 'user_updated' (la lista de
-- 20260522000010). Antes hay que borrar o conservar aparte las filas con
-- action = 'user_updated': con ellas presentes el CHECK anterior no valida.

ALTER TABLE public.permission_audit_log
  DROP CONSTRAINT IF EXISTS permission_audit_log_action_check;

ALTER TABLE public.permission_audit_log
  ADD CONSTRAINT permission_audit_log_action_check
  CHECK (action IN (
    'assign_role',
    'remove_role',
    'create_role',
    'update_role',
    'delete_role',
    'grant_permission',
    'revoke_permission',
    'user_deleted',
    'user_updated'
  ));
