BEGIN;
DO $$
DECLARE
  cid uuid := COALESCE(NULLIF(current_setting('test.audit_company', true), ''),
    'cccccccc-cccc-cccc-cccc-cccccccccccc')::uuid;
  rid uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.roles(id,company_id,name) VALUES (rid,cid,'Audit negativo '||rid);
  -- Sin la corrección debe fallar exactamente por la FK del rol eliminado.
  DELETE FROM public.roles WHERE id=rid;
END;
$$;
ROLLBACK;
