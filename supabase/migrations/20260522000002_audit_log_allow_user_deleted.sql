-- La edge function delete-user registra la baja de un usuario en
-- permission_audit_log con action = 'user_deleted', pero el CHECK de la columna
-- no incluía ese valor, por lo que la inserción fallaba en silencio y la baja
-- no quedaba auditada. Agregamos 'user_deleted' a la lista permitida.

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
    'user_deleted'
  ));
