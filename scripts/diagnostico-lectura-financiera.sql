-- ════════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO PREVIO A 20261026000000 (lectura financiera por permiso y proyecto)
-- SOLO LECTURA: un único SELECT, sin escribir nada. Se puede correr en el SQL
-- Editor del proyecto (producción incluida) ANTES de aplicar la migración.
--
-- QUÉ RESPONDE
-- La migración hace que quien tiene lectura contable lea las contabilidades de los
-- proyectos que tiene asignados (más la de la empresa), igual que el resto de la
-- plataforma. Un usuario con lectura contable que NO es exento (owner, super admin,
-- admin sin asignaciones) y que tiene asignados MENOS proyectos que los de su
-- empresa dejará de ver las contabilidades de los demás. Es lo correcto si es
-- intencional; si es un olvido (un contador de toda la empresa sin asignaciones),
-- hay que asignarlo ANTES de aplicar, o verá solo la contabilidad de la empresa.
--
-- CÓMO LEERLO
--   · `proyectos_que_dejara_de_ver` > 0  → revisar con el dueño de la cuenta.
--   · `motivo_lectura` dice por qué el usuario lee Contabilidad hoy.
-- Mismas reglas que `user_is_project_exempt()` y `user_has_project_access()`.
-- ════════════════════════════════════════════════════════════════════════════
WITH lectores AS (
  SELECT u.id, u.full_name, u.role, u.company_id, u.project_id AS proyecto_principal,
         CASE WHEN u.role IN ('admin', 'company_owner', 'contador') THEN 'rol ' || u.role
              ELSE 'permiso platform.contabilidad.view' END AS motivo_lectura
    FROM public.app_users u
   WHERE u.activo IS NOT FALSE
     AND u.role NOT IN ('super_admin', 'superadmin')
     AND (
       u.role IN ('admin', 'company_owner', 'contador')
       OR EXISTS (
         SELECT 1
           FROM public.user_roles ur
           JOIN public.role_permissions rp ON rp.role_id = ur.role_id
          WHERE ur.user_id = u.id
            AND rp.permission_key = 'platform.contabilidad.view'
            AND rp.effect = 'allow'
            AND (ur.expires_at IS NULL OR ur.expires_at > now()))
     )
), calculo AS (
  SELECT l.*,
         (SELECT count(*) FROM public.projects p WHERE p.company_id = l.company_id) AS proyectos_empresa,
         EXISTS (SELECT 1 FROM public.user_project_assignments a WHERE a.user_id = l.id) AS tiene_asignaciones,
         (SELECT count(*) FROM public.projects p
           WHERE p.company_id = l.company_id
             AND (p.id = l.proyecto_principal
                  OR EXISTS (SELECT 1 FROM public.user_project_assignments a
                              WHERE a.user_id = l.id AND a.project_id = p.id))) AS proyectos_asignados
    FROM lectores l
)
SELECT c.company_id, c.id AS usuario_id, c.full_name, c.role, c.motivo_lectura,
       c.proyectos_empresa, c.proyectos_asignados,
       (c.proyectos_empresa - c.proyectos_asignados) AS proyectos_que_dejara_de_ver
  FROM calculo c
 WHERE c.role <> 'company_owner'
   AND NOT (c.role = 'admin' AND NOT c.tiene_asignaciones)   -- admin sin asignaciones = exento: ve todo
   AND c.proyectos_asignados < c.proyectos_empresa
 ORDER BY c.company_id, c.full_name;
