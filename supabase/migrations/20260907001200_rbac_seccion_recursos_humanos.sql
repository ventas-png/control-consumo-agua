-- ════════════════════════════════════════════════════════════════════════════
-- Sección "Recursos Humanos" en el catálogo RBAC
--
-- POR QUÉ
-- El Módulo Completo agrupa los tabs en secciones (components/condominios/
-- sections.ts) y el editor de roles agrupa los permisos por `permissions.
-- category`. Ambos usaban las mismas llaves, y el personal quedaba repartido:
-- el expediente y la formación colgaban de "Administración" (junto a los
-- documentos y la configuración del condominio) y el trabajo que se le asigna
-- —tareas y limpieza— de "Operaciones" (junto a proveedores y órdenes de
-- compra). Quien armaba un rol para la persona que administra al personal
-- tenía que ir a dos bloques y arrastraba permisos que no quería dar.
--
-- QUÉ CAMBIA
-- Se reclasifican a la categoría `recursos_humanos` los cinco tabs de la
-- sección nueva, con sus claves de acción:
--   personal              expediente del empleado
--   capacitacion_personal formación y certificados
--   tareas_cond           tareas asignadas al personal
--   prog_limpieza         programación de limpieza
--   actividad_equipo      lo que cada persona reportó (medición)
--
-- LAS CLAVES NO CAMBIAN, SOLO SU CATEGORÍA. `condominios.tab.tareas_cond` y
-- `condominios.tab.prog_limpieza` siguen llamándose igual, así que las policies
-- que gatean sobre ellas (20260518000010, 20260807130000, 20260904000200,
-- 20260904000300, 20260907000100…) siguen valiendo y ningún rol pierde acceso.
--
-- `actividad_equipo` ES NUEVO EN EL CATÁLOGO
-- El tab existe desde 20260731000300 pero nunca se sembró su permiso, y
-- `hasPermission()` es fail-closed: hoy solo lo ve un rol exento (super_admin /
-- company_owner / admin) y ningún rol personalizado podía recibirlo. Se siembra
-- aquí y hereda los grants de `condominios.tab.personal`, que es el tab cuyo
-- trabajo continúa (quien ya ve el expediente del empleado es quien mide su
-- actividad). Se respeta el `effect` allow/deny tal cual.
--
-- IMPACTO EN DATOS: solo catálogo RBAC y role_permissions. Ningún dato de
-- negocio. `trg_audit_role_permissions` registra los grants nuevos solo.
--
-- CÓMO REVERTIR
--   UPDATE public.permissions SET category = 'administracion'
--    WHERE key LIKE 'condominios.tab.personal%'
--       OR key LIKE 'condominios.tab.capacitacion_personal%';
--   UPDATE public.permissions SET category = 'operaciones'
--    WHERE key LIKE 'condominios.tab.tareas_cond%'
--       OR key LIKE 'condominios.tab.prog_limpieza%';
--   DELETE FROM public.role_permissions WHERE permission_key LIKE 'condominios.tab.actividad_equipo%';
--   DELETE FROM public.permissions      WHERE key            LIKE 'condominios.tab.actividad_equipo%';
--
-- Idempotente: ON CONFLICT DO NOTHING + UPDATE por categoría destino.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Clave de visibilidad de actividad_equipo (3 segmentos = "Ver") ───────
INSERT INTO public.permissions (key, category, label, description) VALUES
  ('condominios.tab.actividad_equipo', 'recursos_humanos', 'Actividad equipo',
   'Actividad operativa reportada por cada persona del equipo')
ON CONFLICT (key) DO NOTHING;

-- ── 2. Acciones del tab (misma derivación que 20260703000000 parte 3) ───────
INSERT INTO public.permissions (key, category, label, description)
SELECT
  p.key || '.' || a.akey,
  p.category,
  a.alabel || ' — ' || p.label,
  a.alabel || ' en ' || p.label
FROM public.permissions p
CROSS JOIN (VALUES
  ('create',        'Crear'),
  ('edit',          'Editar'),
  ('change_status', 'Cambiar estado'),
  ('approve',       'Autorizar / Denegar'),
  ('delete',        'Eliminar')
) AS a(akey, alabel)
WHERE p.key = 'condominios.tab.actividad_equipo'
ON CONFLICT (key) DO NOTHING;

-- ── 3. Administrador General de condominios: acceso completo ────────────────
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, p.key, 'allow'
FROM public.permissions p
WHERE p.key LIKE 'condominios.tab.actividad_equipo%'
ON CONFLICT DO NOTHING;

-- ── 4. Herencia desde `personal` (ver cabecera) ─────────────────────────────
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT rp.role_id, p.key, rp.effect
FROM public.role_permissions rp
JOIN public.permissions p
  ON p.key = replace(rp.permission_key, 'condominios.tab.personal', 'condominios.tab.actividad_equipo')
WHERE rp.permission_key = 'condominios.tab.personal'
   OR rp.permission_key LIKE 'condominios.tab.personal.%'
ON CONFLICT DO NOTHING;

-- ── 5. Reclasificación de los cuatro tabs que se mudan de sección ───────────
-- El patrón por tab es exacto (clave base o clave base + '.' + acción), no un
-- LIKE 'personal%' suelto: `condominios.tab.personal` no debe arrastrar a otras
-- claves que empiecen igual.
UPDATE public.permissions
SET category = 'recursos_humanos'
WHERE (
     key IN (
       'condominios.tab.personal',
       'condominios.tab.capacitacion_personal',
       'condominios.tab.tareas_cond',
       'condominios.tab.prog_limpieza'
     )
  OR key LIKE 'condominios.tab.personal.%'
  OR key LIKE 'condominios.tab.capacitacion_personal.%'
  OR key LIKE 'condominios.tab.tareas_cond.%'
  OR key LIKE 'condominios.tab.prog_limpieza.%'
)
AND category IS DISTINCT FROM 'recursos_humanos';
