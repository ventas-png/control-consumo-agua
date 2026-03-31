-- Fix: prefer records with puede_crear_cuenta = true when duplicates exist
-- Previously LIMIT 1 with no ORDER BY could return the disabled record first.
CREATE OR REPLACE FUNCTION public.buscar_cliente_para_onboarding(p_cui_dui text, p_fecha_nac date, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_client   record;
BEGIN
  -- Check 3-of-3 match (exact) — prefer records where puede_crear_cuenta = true
  SELECT id, nombre, cui_dui, fecha_nacimiento, email
    INTO v_client
    FROM clientes
   WHERE cui_dui = p_cui_dui
     AND fecha_nacimiento = p_fecha_nac
     AND lower(email) = lower(p_email)
   ORDER BY puede_crear_cuenta DESC NULLS LAST
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'match_count', 3,
      'cliente_id', v_client.id,
      'cliente_nombre', v_client.nombre
    );
  END IF;

  -- Check 2-of-3 matches — prefer records where puede_crear_cuenta = true
  SELECT id, nombre, cui_dui, fecha_nacimiento, email
    INTO v_client
    FROM clientes
   WHERE (
     (cui_dui = p_cui_dui AND fecha_nacimiento = p_fecha_nac) OR
     (cui_dui = p_cui_dui AND lower(email) = lower(p_email)) OR
     (fecha_nacimiento = p_fecha_nac AND lower(email) = lower(p_email))
   )
   ORDER BY puede_crear_cuenta DESC NULLS LAST
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'match_count', 2,
      'cliente_id', v_client.id,
      'cliente_nombre', v_client.nombre,
      'mismatched_fields', (
        SELECT jsonb_agg(field) FROM (
          SELECT 'cui_dui' AS field WHERE v_client.cui_dui IS DISTINCT FROM p_cui_dui
          UNION ALL
          SELECT 'fecha_nacimiento' WHERE v_client.fecha_nacimiento IS DISTINCT FROM p_fecha_nac
          UNION ALL
          SELECT 'email' WHERE lower(COALESCE(v_client.email, '')) IS DISTINCT FROM lower(p_email)
        ) sub
      )
    );
  END IF;

  -- 0 or 1 match - client not found
  RETURN jsonb_build_object('match_count', 0, 'cliente_id', NULL);
END;
$function$;
