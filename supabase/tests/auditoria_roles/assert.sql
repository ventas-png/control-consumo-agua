-- Sólo fixture. El caller puede configurar estos dos UUID para sandbox.
-- Toda la prueba se revierte; nunca usarla contra producción.
BEGIN;
DO $$
DECLARE
  cid uuid := COALESCE(NULLIF(current_setting('test.audit_company', true), ''),
    'cccccccc-cccc-cccc-cccc-cccccccccccc')::uuid;
  uid uuid := COALESCE(NULLIF(current_setting('test.audit_user', true), ''),
    'c0c0c0c0-0000-0000-0000-00000000000a')::uuid;
  rid uuid := gen_random_uuid();
  simple uuid := gen_random_uuid();
  before_count bigint;
  other_cid uuid;
  other_role uuid := gen_random_uuid();
  owned_role uuid := gen_random_uuid();
  affected bigint;
  last_evt bigint;
  tmpu uuid := gen_random_uuid();
  urole uuid := gen_random_uuid();
  k text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_users WHERE id=uid AND company_id=cid) THEN
    RAISE EXCEPTION 'AUDIT_FIXTURE_MISSING';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', uid::text, true);
  IF EXISTS (SELECT 1 FROM public.permission_audit_log WHERE target_role_id IS NOT NULL
    AND NOT (COALESCE(details,'{}'::jsonb) ? 'role_id')) THEN
    RAISE EXCEPTION 'AUDIT_LEGACY_BACKFILL_FAILED';
  END IF;
  INSERT INTO public.roles(id, company_id, name) VALUES (rid,cid,'Audit regresión '||rid);
  IF NOT EXISTS (SELECT 1 FROM public.permission_audit_log WHERE target_role_id=rid
    AND action='create_role' AND actor_id=uid AND details->>'role_id'=rid::text) THEN
    RAISE EXCEPTION 'AUDIT_CREATE_FAILED';
  END IF;
  UPDATE public.roles SET name='Audit actualizado '||rid, description='actualizada' WHERE id=rid;
  IF NOT EXISTS (SELECT 1 FROM public.permission_audit_log WHERE target_role_id=rid
    AND action='update_role' AND details->'after'->>'description'='actualizada'
    AND details->'before'->>'name'='Audit regresión '||rid) THEN
    RAISE EXCEPTION 'AUDIT_UPDATE_FAILED';
  END IF;
  INSERT INTO public.role_permissions(role_id,permission_key,effect) VALUES (rid,'platform.contabilidad.view','allow');
  INSERT INTO public.user_roles(user_id,role_id) VALUES (uid,rid);
  -- Las altas también guardan la identidad en details (no solo la FK viva).
  IF NOT EXISTS (SELECT 1 FROM public.permission_audit_log WHERE target_role_id=rid AND action='grant_permission'
      AND actor_id=uid AND details->>'role_id'=rid::text AND details->>'permission_key'='platform.contabilidad.view'
      AND details->>'effect'='allow') THEN
    RAISE EXCEPTION 'AUDIT_GRANT_EVENT_FAILED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.permission_audit_log WHERE target_role_id=rid AND action='assign_role'
      AND actor_id=uid AND target_user_id=uid AND details->>'role_id'=rid::text AND details->>'user_id'=uid::text) THEN
    RAISE EXCEPTION 'AUDIT_ASSIGN_EVENT_FAILED';
  END IF;
  DELETE FROM public.role_permissions WHERE role_id=rid;
  DELETE FROM public.user_roles WHERE role_id=rid;
  IF (SELECT count(*) FROM public.permission_audit_log WHERE target_role_id=rid
    AND action IN ('remove_role','revoke_permission')) <> 2 THEN
    RAISE EXCEPTION 'AUDIT_DIRECT_REMOVAL_FAILED';
  END IF;
  -- Con el rol todavía vivo, el retiro directo conserva la FK viva y además identifica usuario y permiso.
  IF NOT EXISTS (SELECT 1 FROM public.permission_audit_log WHERE target_role_id=rid AND action='remove_role'
      AND target_user_id=uid AND details->>'user_id'=uid::text AND actor_id=uid)
    OR NOT EXISTS (SELECT 1 FROM public.permission_audit_log WHERE target_role_id=rid AND action='revoke_permission'
      AND details->>'permission_key'='platform.contabilidad.view' AND details->>'effect'='allow' AND actor_id=uid) THEN
    RAISE EXCEPTION 'AUDIT_DIRECT_REMOVAL_DETAIL_FAILED';
  END IF;
  INSERT INTO public.role_permissions(role_id,permission_key,effect) VALUES (rid,'platform.contabilidad.view','allow');
  INSERT INTO public.user_roles(user_id,role_id) VALUES (uid,rid);
  before_count := (SELECT count(*) FROM public.permission_audit_log WHERE target_role_id=rid);
  SELECT COALESCE(max(id),0) INTO last_evt FROM public.permission_audit_log;
  DELETE FROM public.roles WHERE id=rid;
  IF EXISTS (SELECT 1 FROM public.roles WHERE id=rid)
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE role_id=rid)
    OR EXISTS (SELECT 1 FROM public.role_permissions WHERE role_id=rid) THEN
    RAISE EXCEPTION 'AUDIT_CASCADE_FAILED';
  END IF;
  IF (SELECT count(*) FROM public.permission_audit_log WHERE details->>'role_id'=rid::text)
    <> before_count+3 THEN RAISE EXCEPTION 'AUDIT_HISTORY_LOST'; END IF;
  IF EXISTS (SELECT 1 FROM public.permission_audit_log WHERE details->>'role_id'=rid::text
    AND target_role_id IS NOT NULL) THEN RAISE EXCEPTION 'AUDIT_DANGLING_FK'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.permission_audit_log WHERE details->>'role_id'=rid::text
    AND action='delete_role' AND actor_id=uid AND details->>'company_id'=cid::text
    AND details->>'name'='Audit actualizado '||rid AND details->>'is_system'='false') THEN
    RAISE EXCEPTION 'AUDIT_DELETE_SNAPSHOT_FAILED';
  END IF;
  -- La cascada deja EXACTAMENTE los tres eventos nuevos (borrado del rol, retiro del permiso, retiro de la asignación),
  -- todos con el actor y con la FK en NULL: el rol ya no existe y su identidad vive en details.role_id.
  IF (SELECT array_agg(action ORDER BY action) FROM public.permission_audit_log
        WHERE id>last_evt AND details->>'role_id'=rid::text)
     IS DISTINCT FROM ARRAY['delete_role','remove_role','revoke_permission'] THEN
    RAISE EXCEPTION 'AUDIT_CASCADE_EVENTS_FAILED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.permission_audit_log WHERE id>last_evt AND details->>'role_id'=rid::text
      AND (actor_id IS DISTINCT FROM uid OR target_role_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'AUDIT_CASCADE_ACTOR_OR_FK_FAILED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.permission_audit_log WHERE id>last_evt AND action='revoke_permission'
      AND details->>'role_id'=rid::text AND details->>'permission_key'='platform.contabilidad.view'
      AND details->>'effect'='allow')
    OR NOT EXISTS (SELECT 1 FROM public.permission_audit_log WHERE id>last_evt AND action='remove_role'
      AND details->>'role_id'=rid::text AND details->>'user_id'=uid::text AND target_user_id=uid) THEN
    RAISE EXCEPTION 'AUDIT_CASCADE_IDENTITIES_FAILED';
  END IF;
  -- Borrar un USUARIO con asignaciones: el evento de retiro conserva la identidad en details.user_id con target_user_id NULL
  -- (el usuario ya no existe) y la FK viva hacia el rol, que sí existe.
  INSERT INTO auth.users(id) VALUES (tmpu);
  INSERT INTO public.app_users(id,company_id,full_name,role) VALUES (tmpu,cid,'Audit usuario temporal','viewer');
  INSERT INTO public.roles(id,company_id,name) VALUES (urole,cid,'Audit rol de usuario '||urole);
  INSERT INTO public.user_roles(user_id,role_id) VALUES (tmpu,urole);
  SELECT COALESCE(max(id),0) INTO last_evt FROM public.permission_audit_log;
  DELETE FROM public.app_users WHERE id=tmpu;
  IF EXISTS (SELECT 1 FROM public.app_users WHERE id=tmpu) OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=tmpu) THEN
    RAISE EXCEPTION 'AUDIT_USER_DELETE_FAILED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.permission_audit_log WHERE id>last_evt AND action='remove_role'
      AND target_role_id=urole AND target_user_id IS NULL AND actor_id=uid
      AND details->>'user_id'=tmpu::text AND details->>'role_id'=urole::text) THEN
    RAISE EXCEPTION 'AUDIT_USER_DELETE_EVENT_FAILED';
  END IF;
  INSERT INTO public.roles(id,company_id,name) VALUES (simple,cid,'Audit simple '||simple);
  DELETE FROM public.roles WHERE id=simple;
  IF (SELECT count(*) FROM public.permission_audit_log WHERE details->>'role_id'=simple::text) <> 2 THEN
    RAISE EXCEPTION 'AUDIT_SIMPLE_DELETE_FAILED';
  END IF;
  SELECT id INTO other_cid FROM public.companies WHERE id<>cid ORDER BY id LIMIT 1;
  IF other_cid IS NULL THEN RAISE EXCEPTION 'AUDIT_SECOND_COMPANY_MISSING'; END IF;
  INSERT INTO public.roles(id,company_id,name) VALUES
    (other_role,other_cid,'Audit aislado '||other_role),
    (owned_role,cid,'Audit administrador '||owned_role);
  -- La corrección no debe ampliar el acceso: el admin normal sólo borra su empresa.
  EXECUTE 'SET LOCAL ROLE authenticated';
  DELETE FROM public.roles WHERE id=other_role;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>0 THEN RAISE EXCEPTION 'AUDIT_CROSS_COMPANY_DELETE'; END IF;
  DELETE FROM public.roles WHERE id=owned_role;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'AUDIT_ADMIN_DELETE_FAILED'; END IF;
  EXECUTE 'RESET ROLE';
  IF NOT EXISTS (SELECT 1 FROM public.permission_audit_log
    WHERE action='delete_role' AND actor_id=uid AND details->>'role_id'=owned_role::text) THEN
    RAISE EXCEPTION 'AUDIT_ADMIN_ACTOR_LOST';
  END IF;
  FOREACH k IN ARRAY ARRAY['audit_roles_changes','audit_role_permissions_changes','audit_user_roles_changes'] LOOP
    IF has_function_privilege('anon','public.'||k||'()','EXECUTE')
      OR has_function_privilege('authenticated','public.'||k||'()','EXECUTE') THEN
      RAISE EXCEPTION 'AUDIT_EXPOSED_FUNCTION: %',k;
    END IF;
  END LOOP;
  RAISE NOTICE 'AUDIT_ROLES_OK: creación, edición, retiro directo, cascada, snapshots, actor, FK, ACL y RLS de empresa';
END;
$$;
-- El veredicto va ANTES del ROLLBACK a propósito: si el DO falló, la transacción está abortada y este SELECT no imprime nada,
-- así que ejecutado sin ON_ERROR_STOP nunca muestra «OK» tras un fallo. Después, ROLLBACK revierte todo.
SELECT 'AUDIT_ROLES_OK_REVERTIDO' AS resultado;
ROLLBACK;
