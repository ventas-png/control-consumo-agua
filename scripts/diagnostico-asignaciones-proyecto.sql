-- ════════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO · asignaciones de proyecto (public.user_project_assignments) y autoridad del PRINCIPAL — SOLO LECTURA
--
-- UN ÚNICO SELECT: no escribe nada, no crea nada, no cambia ningún parámetro. Se corre en el Editor SQL de Supabase (producción) ANTES
-- y DESPUÉS de aplicar supabase/migrations/20261026000600_seguridad_asignaciones_proyecto.sql y 20261026000700_autoridad_principal_empresa.sql
-- y se comparan las dos salidas:
--   · la sección «tabla» (filas, usuarios, huella) debe ser IDÉNTICA antes y después (las migraciones no cambian filas);
--   · la sección «estado» dice si la 0600 está aplicada (regla del principal, triggers, políticas de escritura con la regla, privilegios);
--   · «huérfanas», «cruces» y «admins» son lo que las migraciones NO corrigen y hay que decidir aparte;
--   · «principales» cuenta quién escribirá la tabla (propietarios y superadministradores) y qué empresas con personas no tienen propietario;
--   · «administrables» cuenta las filas que el propietario de su empresa alcanza con la regla (esperado en producción: 33 de 43; las otras 10, las
--     huérfanas, sólo las alcanzan el superadministrador y el rol de servicio);
--   · «0700» dice, política por política, si ya es del principal («sólo el principal») o todavía admite al administrador (texto de producción).
-- Sin correos ni nombres: sólo conteos e identificadores.
--
-- Salida: tres columnas (seccion, clave, valor), ordenadas.
-- ════════════════════════════════════════════════════════════════════════════
WITH filas AS (
  SELECT u.id, u.user_id, u.project_id, u.permission_type, a.role, a.company_id AS emp_persona, p.company_id AS emp_proyecto,
         (a.id IS NULL) AS huerfana,
         EXISTS (SELECT 1 FROM public.app_users o WHERE o.company_id = p.company_id AND o.role = 'company_owner') AS tiene_propietario
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
  UNION ALL SELECT '4 admins', 'los administradores (acotados o exentos) NO son principales: no escriben asignaciones, proyectos, roles ni llaves (0600 + 0700)', count(*)::text FROM admins
  -- ── principales: quién escribirá la tabla ────────────────────────────────
  UNION ALL SELECT '7 principales', 'propietarios (company_owner)', count(*)::text FROM public.app_users WHERE role = 'company_owner'
  UNION ALL SELECT '7 principales', 'superadministradores (super_admin / superadmin)', count(*)::text FROM public.app_users WHERE role IN ('super_admin', 'superadmin')
  UNION ALL SELECT '7 principales', 'empresas con personas y SIN propietario (sólo las alcanza el superadministrador)', count(DISTINCT a.company_id)::text
                   FROM public.app_users a WHERE a.company_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.app_users o WHERE o.company_id = a.company_id AND o.role = 'company_owner')
  UNION ALL SELECT '7 principales', 'empresa ' || a.company_id::text || ' (propietarios / administradores / personas)',
                   count(*) FILTER (WHERE a.role = 'company_owner') || ' / ' || count(*) FILTER (WHERE a.role = 'admin') || ' / ' || count(*)
                   FROM public.app_users a WHERE a.company_id IS NOT NULL GROUP BY a.company_id
  -- ── filas administrables por el propietario de su empresa ────────────────
  UNION ALL SELECT '8 administrables', 'filas que el propietario de su empresa puede administrar (persona y proyecto de SU empresa, empresa con propietario)',
                   count(*) FILTER (WHERE NOT huerfana AND emp_proyecto IS NOT NULL AND emp_persona IS NOT DISTINCT FROM emp_proyecto AND tiene_propietario)::text FROM filas
  UNION ALL SELECT '8 administrables', 'filas sólo del superadministrador o del rol de servicio (huérfanas, cruzadas, sin empresa o de una empresa sin propietario)',
                   count(*) FILTER (WHERE NOT (NOT huerfana AND emp_proyecto IS NOT NULL AND emp_persona IS NOT DISTINCT FROM emp_proyecto AND tiene_propietario))::text FROM filas
  -- ── filas por rol: las personas que, con la política anterior, podían escribir las suyas ──
  UNION ALL SELECT '5 filas por rol', COALESCE(role, 'huérfana'), count(*) || ' filas / ' || count(DISTINCT user_id) || ' personas' FROM filas GROUP BY role
  -- ── estado de la migración ───────────────────────────────────────────────
  UNION ALL SELECT '6 estado', 'privilegios de anon', COALESCE(tiene, '(ninguno)') FROM privs WHERE rol = 'anon'
  UNION ALL SELECT '6 estado', 'privilegios de authenticated', COALESCE(tiene, '(ninguno)') FROM privs WHERE rol = 'authenticated'
  UNION ALL SELECT '6 estado', 'privilegios de service_role', COALESCE(tiene, '(ninguno)') FROM privs WHERE rol = 'service_role'
  UNION ALL SELECT '6 estado', 'política ' || p.polname::text || ' (' || p.polcmd::text || ')',
                   CASE WHEN COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ 'asignacion_puede_administrar'
                          THEN 'usa asignacion_puede_administrar (corregida)'
                        WHEN COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ E'\\m(auth\\.)?uid\\(\\)'     -- «auth.uid()» o, si auth está en el search_path de la sesión, «uid()»
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
  UNION ALL SELECT '6 estado', 'regla asignacion_puede_administrar',
                   CASE WHEN p.prosrc ~ 'is_company_owner' AND p.prosrc !~ '''admin''' THEN 'del principal (propietario o superadministrador)'
                        WHEN p.prosrc ~ '''admin''' THEN 'anterior: admite al administrador' ELSE 'otra' END
                   FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'asignacion_puede_administrar'
  -- ── 0700: las 11 políticas que cambió la migración de autoridad del principal ──
  UNION ALL SELECT '9 0700', c.relname::text || '.' || p.polname::text,
                   CASE WHEN COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ 'is_company_owner'
                          THEN CASE WHEN c.relname = 'user_invitations' THEN 'role admin sólo del principal' ELSE 'sólo el principal' END
                        WHEN COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ '''admin''' THEN 'admite al administrador (producción)'
                        ELSE 'otra' END
                   FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                  WHERE c.relnamespace = 'public'::regnamespace
                    AND (c.relname, p.polname) IN (('projects', 'projects_insert'), ('projects', 'projects_delete'),
                         ('roles', 'roles_insert'), ('roles', 'roles_update'), ('roles', 'roles_delete'),
                         ('role_permissions', 'role_permissions_insert'), ('role_permissions', 'role_permissions_delete'),
                         ('user_roles', 'user_roles_insert'), ('user_roles', 'user_roles_delete'),
                         ('user_invitations', 'user_invitations_insert'), ('user_invitations', 'user_invitations_update'))
  UNION ALL SELECT '6 estado', 'RLS', CASE WHEN c.relrowsecurity THEN 'activa' ELSE 'DESACTIVADA' END || CASE WHEN c.relforcerowsecurity THEN ', forzada' ELSE ', no forzada' END
                   FROM pg_class c WHERE c.oid = 'public.user_project_assignments'::regclass
) t
ORDER BY seccion, clave;
