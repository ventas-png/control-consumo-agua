-- Retiro del padrón de PANTALLA de Contabilidad (`padron_ui_contabilidad.sql.tpl`) del sandbox `control-agua-rls-sandbox`.
-- NUNCA producción. Borra SOLO filas del prefijo 5b5b3000… y sus dependientes; no toca los padrones 5b5b1000… ni 5b5b2000….
--
-- CÓMO SE BORRA (mecanismo soportado, sin `session_replication_role`, sin desactivar triggers y sin tocar el esquema)
--   Los documentos de compras (órdenes, recepciones, facturas, órdenes de pago) no se borran por la API: «los documentos con
--   efecto se anulan» (20261027000200), y los asientos son de solo añadir (`trg_conta_proteger_asiento`). Pero la migración
--   20261027000200 declara el camino de salida: «la eliminación en CASCADA de una empresa (purga definitiva) no es un borrado
--   de usuario y no se bloquea». Este retiro hace exactamente eso: UN `DELETE` de la fila de la empresa del padrón, y las claves
--   foráneas `ON DELETE CASCADE` se llevan sus proyectos, catálogo, mapeos, folios, asientos y líneas, documentos, roles,
--   asignaciones y personas de la empresa.
--   El único obstáculo es `conta_cuenta_proteger_borrado` (20260822000001): las cuentas del catálogo base (`es_sistema`) no se
--   borran «salvo con el GUC documentado `conta.allow_system_write = on`», que es el mismo que usa el sistema en sus propios
--   triggers. Se activa SOLO con `set_config(…, true)` (vale hasta el fin de esta transacción) y SOLO alrededor del DELETE de
--   la empresa del padrón; se apaga antes de borrar a las personas.
--   Lo que la cascada NO alcanza (no hay clave foránea que lo una a la empresa) se borra por su prefijo, también con DELETE
--   ordinario y sin desactivar nada: los perfiles `public.app_users` (ni `company_id` ni `id` tienen clave foránea) y las filas de
--   `auth.users` (en cascada: identidades, sesiones, fichas de actualización y métodos de autenticación de GoTrue).
--   Por último, las huellas de AUDITORÍA de esas mismas entidades: `public.audit_log` (alta y baja de la suscripción de la empresa
--   de prueba) y `public.permission_audit_log` (crear/asignar/conceder/revocar de sus roles; la cascada de borrado escribe más
--   filas «revoke_permission/remove_role/delete_role»). Ninguna de las dos tiene triggers ni política de borrado que lo impida
--   para el administrador de la base; se borran SOLO las filas cuyo contenido (`company_id`, `record_id`, `before/after`,
--   `details`) nombra el prefijo 5b5b3000-. Las de otras empresas y otros padrones no se tocan.
--
-- ORDEN: (1) empresa en cascada → (2) perfiles y personas de auth → (3) huellas de auditoría del prefijo → (4) comprobación:
-- ninguna fila del prefijo en ninguna columna uuid de `public` ni de `auth`.
-- Es idempotente: si el padrón ya no existe, no borra nada y lo dice. Todo ocurre en UNA transacción (un bloque DO): si algo
-- falla, no se borra nada. En el sandbox un DELETE suelto tarda más de 60 s y la herramienta lo corta; dentro de un DO una
-- empresa pequeña se purga en ~1 s.
DO $retiro$
DECLARE
  c constant uuid := '5b5b3000-0000-0000-0000-00000000000c';
  v_nombre text;
  v_borradas bigint;
  v_perfiles bigint;
  v_personas bigint;
  v_aud1 bigint;
  v_aud2 bigint;
  r record;
  n bigint;
  v_restos text := '';
BEGIN
  -- Salvaguarda: lo que se purga es EXACTAMENTE la empresa del padrón (id y nombre), nunca otra.
  SELECT nombre INTO v_nombre FROM public.companies WHERE id = c;
  IF FOUND AND v_nombre IS DISTINCT FROM 'ZZ UI Contabilidad' THEN
    RAISE EXCEPTION 'ABORTA: la empresa % no se llama «ZZ UI Contabilidad» (se llama «%»); no se borra nada.', c, v_nombre;
  END IF;

  -- (1) Purga en cascada de la empresa del padrón.
  PERFORM set_config('conta.allow_system_write', 'on', true);
  DELETE FROM public.companies WHERE id = c AND nombre = 'ZZ UI Contabilidad';
  GET DIAGNOSTICS v_borradas = ROW_COUNT;
  PERFORM set_config('conta.allow_system_write', 'off', true);

  -- (2) Los perfiles y las personas del padrón (solo el prefijo 5b5b3000…).
  DELETE FROM public.app_users WHERE id::text LIKE '5b5b3000-%' OR company_id::text LIKE '5b5b3000-%';
  GET DIAGNOSTICS v_perfiles = ROW_COUNT;
  DELETE FROM auth.users WHERE id::text LIKE '5b5b3000-%';
  GET DIAGNOSTICS v_personas = ROW_COUNT;

  -- (3) Huellas de auditoría de esas entidades (la cascada también escribió las suyas)
  DELETE FROM public.audit_log
  WHERE company_id::text LIKE '5b5b3000-%' OR record_id::text LIKE '5b5b3000-%' OR actor_id::text LIKE '5b5b3000-%'
     OR before::text LIKE '%5b5b3000-%' OR after::text LIKE '%5b5b3000-%';
  GET DIAGNOSTICS v_aud1 = ROW_COUNT;
  DELETE FROM public.permission_audit_log
  WHERE actor_id::text LIKE '5b5b3000-%' OR target_user_id::text LIKE '5b5b3000-%' OR target_role_id::text LIKE '5b5b3000-%'
     OR details::text LIKE '%5b5b3000-%';
  GET DIAGNOSTICS v_aud2 = ROW_COUNT;

  -- (4) Comprobación: ninguna columna uuid de `public` ni de `auth` conserva el prefijo.
  FOR r IN
    SELECT col.table_schema AS esquema, col.table_name AS tabla, col.column_name AS columna
    FROM information_schema.columns col
    JOIN information_schema.tables t
      ON t.table_schema = col.table_schema AND t.table_name = col.table_name AND t.table_type = 'BASE TABLE'
    WHERE col.table_schema IN ('public', 'auth') AND col.data_type = 'uuid'
    ORDER BY 1, 2, 3
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I::text LIKE %L', r.esquema, r.tabla, r.columna, '5b5b3000-%') INTO n;
    IF n > 0 THEN
      v_restos := v_restos || format(E'\n  %s.%s.%s: %s fila(s)', r.esquema, r.tabla, r.columna, n);
    END IF;
  END LOOP;
  IF v_restos <> '' THEN
    RAISE EXCEPTION 'ABORTA (nada se borra, la transaccion se deshace): quedan filas con el prefijo 5b5b3000 en:%', v_restos;
  END IF;

  RAISE NOTICE 'Retiro 5b5b3000: % empresa(s) purgada(s) en cascada, % perfil(es) app_users, % persona(s) de auth, % fila(s) de audit_log, % de permission_audit_log; 0 filas con el prefijo en public/auth.',
    v_borradas, v_perfiles, v_personas, v_aud1, v_aud2;
END
$retiro$;
