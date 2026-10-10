-- ════════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO · asignaciones de proyecto (public.user_project_assignments) — SOLO LECTURA
--
-- UN ÚNICO SELECT: no escribe nada, no crea nada, no cambia ningún parámetro. Se corre en el Editor SQL de Supabase (producción) ANTES
-- y DESPUÉS de aplicar supabase/migrations/20261026000600_seguridad_asignaciones_proyecto.sql y se comparan las dos salidas:
--   · la sección «tabla» (filas, usuarios, huella) debe ser IDÉNTICA antes y después (la migración no cambia filas);
--   · la sección «estado» dice si la migración está aplicada (regla, triggers, políticas de escritura con la regla, privilegios);
--   · «huérfanas», «cruces» y «admins» son lo que la migración NO corrige y hay que decidir aparte.
-- Sin correos ni nombres: sólo conteos e identificadores.
--
-- Salida: tres columnas (seccion, clave, valor), ordenadas.
-- ════════════════════════════════════════════════════════════════════════════
WITH filas AS (
  SELECT u.id, u.user_id, u.project_id, u.permission_type, a.role, a.company_id AS emp_persona, p.company_id AS emp_proyecto,
         (a.id IS NULL) AS huerfana
    FROM public.user_project_assignments u
    LEFT JOIN public.app_users a ON a.id = u.user_id
    LEFT JOIN public.projects  p ON p.id = u.project_id
),
admins AS (
  SELECT a.id, (SELECT count(*) FROM public.user_project_assignments u WHERE u.user_id = a.id) AS n
    FROM public.app_users a WHERE a.role = 'admin'
),
privs AS (
  SELECT r.rol, string_agg(p.priv, ',' ORDER BY p.priv) FILTER (WHERE has_table_privilege(r.rol, 'public.user_project_assignments', p.priv)) AS tiene
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(rol)
   CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(priv)
   GROUP BY r.rol
)
SELECT seccion, clave, valor FROM (
  -- ── tabla ────────────────────────────────────────────────────────────────
  SELECT '1 tabla' AS seccion, 'filas' AS clave, count(*)::text AS valor FROM filas
  UNION ALL SELECT '1 tabla', 'usuarios distintos', count(DISTINCT user_id)::text FROM filas
  UNION ALL SELECT '1 tabla', 'proyectos distintos', count(DISTINCT project_id)::text FROM filas
  UNION ALL SELECT '1 tabla', 'permission_type ' || permission_type, count(*)::text FROM filas GROUP BY permission_type
  UNION ALL SELECT '1 tabla', 'huella md5 (id|user_id|project_id|permission_type)',
                   md5(COALESCE(string_agg(id::text || '|' || user_id::text || '|' || project_id::text || '|' || permission_type, E'\n' ORDER BY id), '')) FROM filas
  -- ── lo que la migración no corrige ───────────────────────────────────────
  UNION ALL SELECT '2 huérfanas', 'filas con user_id sin app_users', count(*)::text FROM filas WHERE huerfana
  UNION ALL SELECT '2 huérfanas', 'usuarios distintos', count(DISTINCT user_id)::text FROM filas WHERE huerfana
  UNION ALL SELECT '3 cruces', 'filas con empresa de la persona distinta de la del proyecto (o sin empresa)', count(*)::text
                   FROM filas WHERE NOT huerfana AND emp_persona IS DISTINCT FROM emp_proyecto
  UNION ALL SELECT '3 cruces', 'filas cuyo proyecto no existe', count(*)::text FROM filas WHERE emp_proyecto IS NULL
  UNION ALL SELECT '4 admins', 'administradores sin filas (exentos de proyecto)', count(*)::text FROM admins WHERE n = 0
  UNION ALL SELECT '4 admins', 'administradores con filas (acotados)', count(*)::text FROM admins WHERE n > 0
  UNION ALL SELECT '4 admins', 'filas de los administradores acotados', COALESCE(sum(n), 0)::text FROM admins WHERE n > 0
  UNION ALL SELECT '4 admins', 'id del administrador acotado con ' || n || ' fila(s)', id::text FROM admins WHERE n > 0
  -- ── filas por rol: las personas que, con la política anterior, podían escribir las suyas ──
  UNION ALL SELECT '5 filas por rol', COALESCE(role, 'huérfana'), count(*) || ' filas / ' || count(DISTINCT user_id) || ' personas' FROM filas GROUP BY role
  -- ── estado de la migración ───────────────────────────────────────────────
  UNION ALL SELECT '6 estado', 'privilegios de anon', COALESCE(tiene, '(ninguno)') FROM privs WHERE rol = 'anon'
  UNION ALL SELECT '6 estado', 'privilegios de authenticated', COALESCE(tiene, '(ninguno)') FROM privs WHERE rol = 'authenticated'
  UNION ALL SELECT '6 estado', 'privilegios de service_role', COALESCE(tiene, '(ninguno)') FROM privs WHERE rol = 'service_role'
  UNION ALL SELECT '6 estado', 'política ' || p.polname::text || ' (' || p.polcmd::text || ')',
                   CASE WHEN COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ 'asignacion_puede_administrar'
                          THEN 'usa asignacion_puede_administrar (corregida)'
                        WHEN COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ 'auth\.uid'
                          THEN 'conserva «OR user_id = auth.uid()»' || CASE WHEN p.polcmd = 'r' THEN ' (correcto en SELECT)' ELSE ' (EL HUECO)' END
                        ELSE 'otra' END
                   FROM pg_policy p WHERE p.polrelid = 'public.user_project_assignments'::regclass
  UNION ALL SELECT '6 estado', 'trigger ' || t.tgname, CASE WHEN t.tgenabled = 'O' THEN 'habilitado' ELSE 'DESHABILITADO (' || t.tgenabled::text || ')' END
                   FROM pg_trigger t WHERE t.tgrelid = 'public.user_project_assignments'::regclass AND NOT t.tgisinternal
  UNION ALL SELECT '6 estado', 'triggers de la migración presentes (esperado 2 tras aplicarla, 0 antes)', count(*)::text
                   FROM pg_trigger t WHERE t.tgrelid = 'public.user_project_assignments'::regclass AND NOT t.tgisinternal
                    AND t.tgname IN ('trg_asignacion_empresa', 'trg_asignacion_propia')
  UNION ALL SELECT '6 estado', 'funciones de la migración presentes (esperado 3 tras aplicarla, 0 antes)', count(*)::text
                   FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                    AND p.proname IN ('asignacion_puede_administrar', 'asignacion_validar_empresa', 'asignacion_bloquear_propia')
  UNION ALL SELECT '6 estado', 'RLS', CASE WHEN c.relrowsecurity THEN 'activa' ELSE 'DESACTIVADA' END || CASE WHEN c.relforcerowsecurity THEN ', forzada' ELSE ', no forzada' END
                   FROM pg_class c WHERE c.oid = 'public.user_project_assignments'::regclass
) t
ORDER BY seccion, clave;
