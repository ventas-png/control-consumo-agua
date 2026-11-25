-- ════════════════════════════════════════════════════════════════════════════
-- CONTABILIDAD · REVALUAR FX Y CIERRE ANUAL VUELVEN A ACEPTAR EL PERMISO DEL ROL
--
-- QUÉ FALLABA
-- 20260818000000 inyectó en las RPC contables la rama por permiso
-- (`OR public.user_has_permission('platform.contabilidad.<acción>')`). Un mes
-- después, 20260918121413 (cuentas especiales) reescribió conta_revaluar_fx y
-- conta_cierre_anual con `CREATE OR REPLACE` copiando el guard ANTIGUO: sólo
-- company_owner / admin. Desde entonces un rol «Finanzas / Contador» con todas
-- las claves platform.contabilidad.* ve los botones «💱 Revaluar FX» y «Cerrar
-- ejercicio» (la pantalla los ofrece con create / change_status) y recibe
-- «no autorizado». Medido sobre la cadena completa de migraciones
-- (supabase/tests/conta_revaluar_cierre_rbac).
--
-- QUÉ CAMBIA
-- Se repone la rama por permiso, con las MISMAS acciones que fijó 20260818000000:
--   conta_revaluar_fx   → platform.contabilidad.create
--   conta_cierre_anual  → platform.contabilidad.change_status
-- En sitio (pg_get_functiondef + sustitución de la subexpresión del rol), igual
-- que 20260818000000: no se recopia el cuerpo, así que ningún arreglo posterior
-- se pierde, y CREATE OR REPLACE conserva la ACL (anon sigue sin EXECUTE).
-- El alcance no cambia: ambas operan sobre get_my_company_id(); el permiso sólo
-- decide QUIÉN de la empresa puede, nunca sobre qué empresa.
--
-- IDEMPOTENTE: sólo toca las definiciones que aún no llevan la clave.
--
-- CÓMO REVERTIR: volver a aplicar las definiciones de conta_cierre_anual(int,uuid)
-- y conta_revaluar_fx(date,boolean,uuid) de 20260918121413 (y el parche en sitio
-- de 20261029000000 si aplicara); los contadores vuelven a recibir «no autorizado».
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  acciones jsonb := jsonb_build_object(
    'conta_cierre_anual', 'change_status',
    'conta_revaluar_fx',  'create'
  );
  patron constant text :=
    'public\.current_user_role\(\)\s*=\s*ANY\(ARRAY\[''company_owner'',''admin''\]\)';
  r      record;
  faltan text[];
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure::text AS ident, acciones ->> p.proname AS accion
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND acciones ? p.proname
      AND p.prosrc ~ patron
      AND p.prosrc NOT LIKE '%platform.contabilidad.%'
    ORDER BY p.proname
  LOOP
    EXECUTE regexp_replace(
      pg_get_functiondef(r.oid),
      patron,
      '(public.current_user_role() = ANY(ARRAY[''company_owner'',''admin''])'
        || ' OR public.user_has_permission(''platform.contabilidad.' || r.accion || '''))',
      'g');
    RAISE NOTICE 'conta rbac: guard repuesto en % (platform.contabilidad.%)', r.ident, r.accion;
  END LOOP;

  -- Red de seguridad: cada función listada debe tener una definición con SU
  -- clave. Si no, el guard cambió de forma y la migración falla en vez de dejar
  -- el guard viejo en pie creyéndolo arreglado.
  SELECT array_agg(k ORDER BY k) INTO faltan
  FROM jsonb_object_keys(acciones) AS k
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = k
      AND p.prosrc LIKE '%platform.contabilidad.' || (acciones ->> k) || '%'
  );
  IF faltan IS NOT NULL THEN
    RAISE EXCEPTION 'conta rbac: sin reponer % — el guard cambió de forma, revisar a mano', faltan;
  END IF;
END $$;
