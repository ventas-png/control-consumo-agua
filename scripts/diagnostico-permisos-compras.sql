-- ════════════════════════════════════════════════════════════════════════════
-- MATRIZ ANTES / DESPUÉS · permisos por acción del circuito de compras y pagos
-- SOLO LECTURA (un único SELECT; no escribe nada, no llama a funciones que dependan de la sesión: se puede correr con el
-- SQL Editor de Supabase, con psql o con el rol de servicio). Funciona en cualquier base del esquema, ANTES o DESPUÉS de
-- aplicar 20261027000900: calcula "después" con los nombres de las llaves, no con el catálogo.
--
-- QUÉ CALCULA, para cada una de las SEIS acciones, por rol y por usuario:
--
--   Acción                          ANTES (reglas de 20261027000300/0700)      DESPUÉS (20261027000900)
--   ──────────────────────────────  ─────────────────────────────────────────  ──────────────────────────────────────────────
--   1 Aprobar orden de compra       platform.contabilidad.approve              condominios.tab.ordenes_compra.approve
--   2 Registrar recepción           platform.contabilidad.change_status        platform.contabilidad.compras.recepcion_registrar
--   3 Aprobar factura de proveedor  platform.contabilidad.approve              platform.contabilidad.compras.factura_aprobar
--   4 Aprobar orden de pago         platform.contabilidad.approve              platform.contabilidad.compras.orden_pago_aprobar
--   5 Ejecutar pago                 platform.contabilidad.change_status        platform.contabilidad.compras.pago_ejecutar
--   6 Anular pago                   platform.contabilidad.change_status        platform.contabilidad.compras.pago_anular
--
--   En AMBOS lados la PERSONA necesita además `platform.contabilidad.edit` (la política UPDATE de las cuatro tablas lo exige y
--   no se toca): en las filas de usuario ya va incluido; en las filas de ROL se evalúa solo la llave y `edit` se informa en la
--   columna `incluye_edit` (un rol puede combinarse con otro que sí lo tenga). Una celda se lee «antes → después»: «sí → no» = PIERDE la acción; «sí → sí» = la conserva;
--   «no → sí» = la GANA (p. ej. quien ya tenía la llave de la pestaña de órdenes pero no `approve`); «no → no» = no la tuvo ni la tendrá.
--
--   Reglas de evaluación, idénticas a user_has_permission(): super_admin, superadmin, company_owner y admin pasan TODA llave;
--   el resto, por llaves: un `deny` en un rol vigente gana a cualquier `allow`; un rol con `expires_at` pasado no cuenta.
--   Un ROL se evalúa solo por sus llaves 'allow' (un rol no tiene vencimiento: lo tiene su asignación a la persona).
--
-- FILAS DEVUELTAS (una sola consulta; ordene por las columnas que quiera)
--   tipo = 'rol_sistema'  plantillas (is_system, sin empresa): «Administrador General», «Finanzas / Contador»…; `usuarios` = personas
--                          activas que tienen asignada ESA plantilla hoy (sin vencer). OJO con el rótulo «0»: las personas casi nunca
--                          llevan la plantilla sino una COPIA de su empresa con el MISMO nombre (fila `rol_empresa`, p. ej. el «Admin
--                          Plataforma» de una persona), así que una plantilla puede decir 0 mientras alguien «tiene un rol» con ese nombre.
--                          (Producción, 2026-10-10, solo lectura: las plantillas tienen 0 asignaciones en `user_roles`, ni vencidas ni de
--                          personas inactivas; las copias por empresa con esos nombres suman 3 asignaciones vigentes.)
--   tipo = 'rol_empresa'  roles de la empresa (incluye los de «ajustes individuales», user_override_for); `perfil` dice si es de ajustes
--   tipo = 'usuario'      personas NO exentas de proyecto con alguna de las seis acciones antes o después, junto con los
--                          proyectos asignados. Exentas = super_admin, superadmin, company_owner y administrador SIN
--                          asignaciones (user_is_project_exempt); un administrador CON asignaciones SÍ aparece: pasa por
--                          rol pero solo en sus proyectos, y ese alcance NO cambia.
--   tipo = 'resumen'      una fila con los totales (cuántas personas pierden alguna acción)
--
--   «pierde» lista las acciones de «sí → no». La pieza NO concede nada: toda concesión se decide aparte
--   (propuesta_asignaciones.sql, sin ejecutar).
--
-- USO:   psql "$DATABASE_URL" -f matriz_antes_despues.sql -P pager=off          (producción: SOLO LECTURA; usar un rol de solo lectura)
--        o pegar el SELECT en el editor SQL del proyecto. Para exportar: \copy (…) TO 'matriz.csv' CSV HEADER
-- ════════════════════════════════════════════════════════════════════════════
WITH
acciones (n, nombre, generica, nueva) AS (
  VALUES
    (1, 'Aprobar orden de compra',      'platform.contabilidad.approve',       'condominios.tab.ordenes_compra.approve'),
    (2, 'Registrar recepción',          'platform.contabilidad.change_status', 'platform.contabilidad.compras.recepcion_registrar'),
    (3, 'Aprobar factura de proveedor', 'platform.contabilidad.approve',       'platform.contabilidad.compras.factura_aprobar'),
    (4, 'Aprobar orden de pago',        'platform.contabilidad.approve',       'platform.contabilidad.compras.orden_pago_aprobar'),
    (5, 'Ejecutar pago',                'platform.contabilidad.change_status', 'platform.contabilidad.compras.pago_ejecutar'),
    (6, 'Anular pago',                  'platform.contabilidad.change_status', 'platform.contabilidad.compras.pago_anular')
),
-- ── ROLES: llaves 'allow' de cada rol ───────────────────────────────────────
rol_llaves AS (
  SELECT r.id AS rol_id, r.name, r.is_system, r.company_id, r.user_override_for,
         COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.effect = 'allow'), ARRAY[]::text[]) AS permite
    FROM public.roles r
    LEFT JOIN public.role_permissions rp ON rp.role_id = r.id
   GROUP BY r.id, r.name, r.is_system, r.company_id, r.user_override_for
),
-- Usuarios (activos, con la asignación sin vencer) que tienen hoy cada rol
rol_usuarios AS (
  SELECT ur.role_id, count(DISTINCT ur.user_id) AS usuarios
    FROM public.user_roles ur
    JOIN public.app_users u ON u.id = ur.user_id AND u.activo
   WHERE ur.expires_at IS NULL OR ur.expires_at > now()
   GROUP BY ur.role_id
),
roles_celdas AS (
  SELECT rl.rol_id, rl.name, rl.is_system, rl.company_id, rl.user_override_for, COALESCE(ru.usuarios, 0) AS usuarios,
         a.n, a.nombre,
         (a.generica = ANY (rl.permite)) AS antes,
         (a.nueva    = ANY (rl.permite)) AS despues,
         CASE WHEN 'platform.contabilidad.edit' = ANY (rl.permite) THEN 'sí' ELSE 'no' END AS incluye_edit
    FROM rol_llaves rl
    CROSS JOIN acciones a
    LEFT JOIN rol_usuarios ru ON ru.role_id = rl.rol_id
),
roles_filas AS (
  SELECT CASE WHEN is_system THEN 'rol_sistema' ELSE 'rol_empresa' END AS tipo,
         c.nombre AS empresa,
         name AS nombre,
         CASE WHEN is_system THEN 'plantilla de sistema (no sus copias por empresa, que son filas rol_empresa)'
              WHEN user_override_for IS NOT NULL THEN 'ajustes individuales'
              ELSE 'rol de empresa' END AS perfil,
         usuarios::text AS usuarios,
         NULL::boolean AS activo,
         rc.incluye_edit,
         rc.n, rc.nombre AS accion, rc.antes, rc.despues,
         NULL::text AS proyectos, NULL::text AS exento_de_proyecto, NULL::text AS roles_asignados
    FROM roles_celdas rc
    LEFT JOIN public.companies c ON c.id = rc.company_id
),
-- ── USUARIOS no exentos ─────────────────────────────────────────────────────
usuarios_base AS (
  SELECT u.id, u.full_name, u.role, u.company_id, u.activo,
         (u.role IN ('super_admin', 'superadmin', 'company_owner', 'admin')) AS pasa_todo,
         (u.role IN ('super_admin', 'superadmin', 'company_owner')
          OR (u.role = 'admin' AND NOT EXISTS (SELECT 1 FROM public.user_project_assignments upa WHERE upa.user_id = u.id))) AS exento
    FROM public.app_users u
),
usuarios_noexentos AS (
  SELECT * FROM usuarios_base WHERE NOT exento
),
-- llaves vigentes de cada persona (roles sin vencer): allow y deny
usuario_llaves AS (
  SELECT ub.id AS user_id,
         COALESCE(array_agg(DISTINCT rp.permission_key) FILTER (WHERE rp.effect = 'allow'), ARRAY[]::text[]) AS permite,
         COALESCE(array_agg(DISTINCT rp.permission_key) FILTER (WHERE rp.effect = 'deny'),  ARRAY[]::text[]) AS niega
    FROM usuarios_noexentos ub
    LEFT JOIN public.user_roles ur ON ur.user_id = ub.id AND (ur.expires_at IS NULL OR ur.expires_at > now())
    LEFT JOIN public.role_permissions rp ON rp.role_id = ur.role_id
   GROUP BY ub.id
),
usuario_roles_txt AS (
  SELECT ur.user_id,
         string_agg(r.name || CASE WHEN ur.expires_at IS NOT NULL THEN ' (vence ' || to_char(ur.expires_at, 'YYYY-MM-DD') || CASE WHEN ur.expires_at <= now() THEN ', VENCIDO' ELSE '' END || ')' ELSE '' END,
                    '; ' ORDER BY r.name) AS roles
    FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
   GROUP BY ur.user_id
),
usuario_proyectos AS (
  SELECT upa.user_id, string_agg(p.nombre, '; ' ORDER BY p.nombre) AS proyectos, count(*) AS n
    FROM public.user_project_assignments upa JOIN public.projects p ON p.id = upa.project_id
   GROUP BY upa.user_id
),
usuarios_celdas AS (
  SELECT ub.id, ub.full_name, ub.role, ub.company_id, ub.activo, a.n, a.nombre,
         -- user_has_permission: bypass por perfil; si no, un deny vigente gana; si no, un allow vigente
         (ub.pasa_todo OR (NOT ('platform.contabilidad.edit' = ANY (ul.niega)) AND 'platform.contabilidad.edit' = ANY (ul.permite)))
         AND (ub.pasa_todo OR (NOT (a.generica = ANY (ul.niega)) AND a.generica = ANY (ul.permite))) AS antes,
         (ub.pasa_todo OR (NOT ('platform.contabilidad.edit' = ANY (ul.niega)) AND 'platform.contabilidad.edit' = ANY (ul.permite)))
         AND (ub.pasa_todo OR (NOT (a.nueva = ANY (ul.niega)) AND a.nueva = ANY (ul.permite))) AS despues
    FROM usuarios_noexentos ub
    JOIN usuario_llaves ul ON ul.user_id = ub.id
    CROSS JOIN acciones a
),
usuarios_con_algo AS (
  SELECT id FROM usuarios_celdas GROUP BY id HAVING bool_or(antes) OR bool_or(despues)
),
usuarios_filas AS (
  SELECT 'usuario'::text AS tipo,
         c.nombre AS empresa,
         uc.full_name AS nombre,
         uc.role AS perfil,
         NULL::text AS usuarios,
         uc.activo,
         NULL::text AS incluye_edit,
         uc.n, uc.nombre AS accion, uc.antes, uc.despues,
         COALESCE(up.proyectos, '(sin proyectos asignados)') AS proyectos,
         CASE WHEN uc.role = 'admin' THEN 'no (administrador con ' || COALESCE(up.n, 0) || ' proyecto(s) asignado(s): pasa por rol, solo en los suyos)'
              ELSE 'no' END AS exento_de_proyecto,
         COALESCE(ut.roles, '(sin roles)') AS roles_asignados
    FROM usuarios_celdas uc
    JOIN usuarios_con_algo ua ON ua.id = uc.id
    LEFT JOIN public.companies c ON c.id = uc.company_id
    LEFT JOIN usuario_proyectos up ON up.user_id = uc.id
    LEFT JOIN usuario_roles_txt ut ON ut.user_id = uc.id
),
todo AS (
  SELECT * FROM roles_filas
  UNION ALL
  SELECT * FROM usuarios_filas
),
-- Una fila por rol/usuario, con las seis celdas «antes → después»
pivote AS (
  SELECT tipo, empresa, nombre, perfil, usuarios, activo, incluye_edit, proyectos, exento_de_proyecto, roles_asignados,
         max(CASE WHEN n = 1 THEN CASE WHEN antes THEN 'sí' ELSE 'no' END || ' → ' || CASE WHEN despues THEN 'sí' ELSE 'no' END END) AS "1_aprobar_oc",
         max(CASE WHEN n = 2 THEN CASE WHEN antes THEN 'sí' ELSE 'no' END || ' → ' || CASE WHEN despues THEN 'sí' ELSE 'no' END END) AS "2_registrar_recepcion",
         max(CASE WHEN n = 3 THEN CASE WHEN antes THEN 'sí' ELSE 'no' END || ' → ' || CASE WHEN despues THEN 'sí' ELSE 'no' END END) AS "3_aprobar_factura",
         max(CASE WHEN n = 4 THEN CASE WHEN antes THEN 'sí' ELSE 'no' END || ' → ' || CASE WHEN despues THEN 'sí' ELSE 'no' END END) AS "4_aprobar_orden_pago",
         max(CASE WHEN n = 5 THEN CASE WHEN antes THEN 'sí' ELSE 'no' END || ' → ' || CASE WHEN despues THEN 'sí' ELSE 'no' END END) AS "5_ejecutar_pago",
         max(CASE WHEN n = 6 THEN CASE WHEN antes THEN 'sí' ELSE 'no' END || ' → ' || CASE WHEN despues THEN 'sí' ELSE 'no' END END) AS "6_anular_pago",
         string_agg(accion, '; ' ORDER BY n) FILTER (WHERE antes AND NOT despues) AS pierde,
         string_agg(accion, '; ' ORDER BY n) FILTER (WHERE antes AND despues)     AS conserva,
         string_agg(accion, '; ' ORDER BY n) FILTER (WHERE NOT antes AND despues) AS gana
    FROM todo
   GROUP BY tipo, empresa, nombre, perfil, usuarios, activo, incluye_edit, proyectos, exento_de_proyecto, roles_asignados
)
SELECT tipo, empresa, nombre, perfil, usuarios, activo, incluye_edit,
       "1_aprobar_oc", "2_registrar_recepcion", "3_aprobar_factura", "4_aprobar_orden_pago", "5_ejecutar_pago", "6_anular_pago",
       pierde, conserva, gana, proyectos, exento_de_proyecto, roles_asignados
  FROM pivote
UNION ALL
SELECT 'resumen', NULL, 'TOTALES', NULL,
       (SELECT count(*) FROM usuarios_noexentos WHERE activo)::text || ' personas activas no exentas',
       NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL,
       (SELECT count(*) FROM pivote WHERE tipo = 'usuario' AND pierde IS NOT NULL)::text || ' persona(s) pierden alguna acción; '
         || (SELECT count(*) FROM pivote WHERE tipo = 'rol_sistema' AND pierde IS NOT NULL)::text || ' plantilla(s) de sistema y '
         || (SELECT count(*) FROM pivote WHERE tipo = 'rol_empresa' AND pierde IS NOT NULL)::text || ' rol(es) de empresa pierden alguna',
       NULL, NULL, NULL, NULL, NULL
ORDER BY 1, 2 NULLS LAST, 3;
